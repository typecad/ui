// ---------------------------------------------------------------------------
// Style resolver — match CSS rules to element nodes and produce a computed
// style per node (base state + :pressed state).
//
// Walks the tree; for each node, applies every matching rule in cascade order
// (UA sheet first, then author rules by specificity, then source order — the
// rule applied last wins each property, matching browser cascade rules; the
// inline style attribute always wins over all stylesheet rules).
// :pressed rules populate the separate `style.pressed` object so the runtime
// can lerp to it on press.
// ---------------------------------------------------------------------------

import { UIElementNode } from "./html-parser.js";
import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import { CSSRule, CSSProperty, CSSSelector, SimpleSelector, parseInlineStyle } from "./css-parser.js";
import { getUARules } from "./ua-stylesheet.js";
import { TextRun } from "./run-types.js";
import { InlineItem } from "./inline-parser.js";

// The CSS-standard set of properties that inherit from parent to child. A
// child inherits the parent's resolved value for each of these unless the
// child sets its own (rule or inline); the child's own value always wins.
// Box-model and decorative properties (background, border, padding, margin,
// width/height, opacity, ...) do NOT inherit — matching browser behavior.
// `opacity` is excluded because the lowering already compounds
// effectiveOpacity down the tree; `text-decoration` is excluded because the
// only producer of default underlines is the UA `a` rule applied directly.
export const INHERITED_KEYS = [
  "color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontSmoothing",
  "lineHeight", "letterSpacing", "textAlign", "textTransform", "whiteSpace",
  "textShadow", "textOverflow", "visibility",
] as const;

export interface StyledNode {
  tag: string;
  origTag?: string;
  id?: string;
  classes: string[];
  text?: string;
  /** Rich-text runs. Present only for text nodes with mixed inline content;
   *  when present, `text` is empty and the runs are the node's content. */
  runs?: TextRun[];
  value?: string;
  style: CSSProperty;
  children: StyledNode[];
  /** For <select>: parsed option list. */
  options?: Array<{ value: string; text: string }>;
  /** For <radio>: group name. */
  name?: string;
  /** For <radio>: initially selected. */
  checked?: boolean;
  /** For <range>: minimum value. */
  min?: string;
  /** For <range>: maximum value. */
  max?: string;
  /** For <input>: text or number keyboard. */
  type?: "text" | "number";
  /** For <input>: placeholder text. */
  placeholder?: string;
  /** For <input>: max character length. */
  maxlen?: number;
  /** For <input>: keyboard template id ref. */
  keyboard?: string;
  /** HTML hidden attribute: removes the element subtree from layout/rendering. */
  hidden?: boolean;
  /** Navigation target for <a href="#screenId"> links. */
  href?: string;
  /** Image source path for <img src="...">. */
  src?: string;
  /** Image width in pixels (for <img>). */
  imgWidth?: number;
  /** Image height in pixels (for <img>). */
  imgHeight?: number;
  /** Item height in pixels (for <list>). */
  itemHeight?: number;
  /** Canvas buffer width in pixels (for <canvas>). */
  canvasW?: number;
  /** Canvas buffer height in pixels (for <canvas>). */
  canvasH?: number;
  /** HTML presentational attribute: blocks taps/keyboard, dims the draw. */
  disabled?: boolean;
  /** <drawer side="..."> — the edge the panel slides from (bottom default). */
  drawerSide?: string;
  toastDuration?: number;
  /** True when text contains a `{expr}` interpolation; auto-wire synthesizes an
   *  implicit text binding. Propagated from UIElementNode for the auto-wire walk. */
  hasInterpolation?: boolean;
  /** Declarative on:* event handlers (named-function references). Propagated
   *  from UIElementNode for the auto-wire walk. */
  events?: { click?: string; hold?: string; release?: string; change?: string };
  /** Declarative bind:* two-way bindings (signal names). Propagated from
   *  UIElementNode for the auto-wire walk. */
  bind?: { text?: string; value?: string };
  /** TS handle name (screen.<ref>), separate from CSS #id. Falls back to id.
   *  Propagated for type-decl generation + node-index resolution. */
  ref?: string;
}

/** Look up an HTML attribute value on a node by name, for attribute selectors.
 *  Returns the value as a string, or undefined when absent. Boolean attributes
 *  (checked/disabled/hidden) are "present" only when truthy. UIElementNode has
 *  no generic attribute map, so each name maps to a typed field. */
function attributeValue(node: UIElementNode, name: string): string | undefined {
  switch (name) {
    case "type": return node.type;
    case "name": return node.name;
    case "value": return node.value;
    case "href": return node.href;
    case "src": return node.src;
    case "placeholder": return node.placeholder;
    case "maxlength": return node.maxlength != null ? String(node.maxlength) : undefined;
    // Boolean attributes: report presence by returning the attribute name.
    case "checked": return node.checked ? "checked" : undefined;
    case "disabled": return node.disabled ? "disabled" : undefined;
    case "hidden": return node.hidden ? "hidden" : undefined;
    default: return undefined;
  }
}

/** Does a single element match a compound selector (all simples must match)? */
function matchesCompound(node: UIElementNode, compound: SimpleSelector[]): boolean {
  for (const s of compound) {
    switch (s.kind) {
      case "element": if (node.tag !== s.name && node.origTag !== s.name) return false; break;
      case "id": if (node.id !== s.name) return false; break;
      case "class": if (!node.classes.includes(s.name)) return false; break;
      case "attribute": {
        // Presence ([disabled]) when no value; exact equality ([type="number"])
        // when a value is present. NOTE: the parser captures [~=|^|$*]= but
        // drops the operator, so only presence/equality are supported here.
        const v = attributeValue(node, s.name);
        if (v === undefined) return false;
        if (s.value !== undefined && v !== s.value) return false;
        break;
      }
    }
  }
  return true;
}

/** Match the ancestor-side compounds (indices 0..c) against the `ancestors`
 *  chain, honoring combinators. `pos` is the exclusive upper bound: compound c
 *  may match any ancestor at index < pos. The node itself sits conceptually at
 *  index ancestors.length, so the first ancestor-side compound starts with the
 *  whole chain available. Returns true if all remaining compounds match. */
function matchAncestors(
  compounds: SimpleSelector[][],
  combinators: (">" | " " | "+" | "~")[],
  c: number,
  pos: number,
  ancestors: UIElementNode[],
  precedingSiblings: UIElementNode[],
): boolean {
  if (c < 0) return true;
  const comb = c < combinators.length ? combinators[c] : " ";
  if (comb === ">") {
    // Child combinator: compound c must match the immediate parent (index
    // pos-1) of wherever compound c+1 matched. No scanning.
    const i = pos - 1;
    if (i < 0) return false;
    if (!matchesCompound(ancestors[i], compounds[c])) return false;
    // Children of the matched ancestor are its siblings-in-context; for a
    // child match there are no further preceding siblings to track here.
    return matchAncestors(compounds, combinators, c - 1, i, ancestors, []);
  }
  if (comb === "+") {
    // Adjacent sibling: compound c must match the IMMEDIATE preceding sibling
    // of compound c+1's match. precedingSiblings[0] is the nearest.
    if (precedingSiblings.length === 0) return false;
    if (!matchesCompound(precedingSiblings[0], compounds[c])) return false;
    // The matched sibling's own preceding siblings (for chains like a + b + c).
    const sibAncestors = ancestors;  // siblings share the same ancestors
    return matchAncestors(compounds, combinators, c - 1, pos, sibAncestors, precedingSiblings.slice(1));
  }
  if (comb === "~") {
    // General sibling: compound c matches ANY preceding sibling. Scan from
    // nearest outward; backtrack if a later compound fails.
    for (let si = 0; si < precedingSiblings.length; si++) {
      if (matchesCompound(precedingSiblings[si], compounds[c])) {
        if (matchAncestors(compounds, combinators, c - 1, pos, ancestors, precedingSiblings.slice(si + 1))) {
          return true;
        }
      }
    }
    return false;
  }
  // Descendant combinator: scan ancestors upward (decreasing index) for a
  // match. Backtracking — if a later compound fails, try an earlier ancestor.
  for (let i = pos - 1; i >= 0; i--) {
    if (matchesCompound(ancestors[i], compounds[c])) {
      if (matchAncestors(compounds, combinators, c - 1, i, ancestors, [])) return true;
    }
  }
  return false;
}

/** Does an element match a full selector (compound + combinators)?
 *  The last compound must match the node; preceding compounds must match
 *  ancestors per the combinators (` ` = descendant, `>` = child). */
function matches(node: UIElementNode, sel: CSSSelector, ancestors: UIElementNode[], precedingSiblings: UIElementNode[]): boolean {
  const compounds = sel.compounds;
  // Target compound (last) must match the node.
  if (!matchesCompound(node, compounds[compounds.length - 1])) return false;
  // :not(...) negation: if ANY inner compound matches the node, reject.
  if (sel.not) {
    for (const inner of sel.not) {
      if (matchesCompound(node, inner)) return false;
    }
  }
  // Match preceding compounds against the ancestor chain, honoring combinators.
  return matchAncestors(compounds, sel.combinators ?? [], compounds.length - 2, ancestors.length, ancestors, precedingSiblings);
}

// Styling-tag default style, applied as a low-priority UA-equivalent rule on
// inline runs derived from <b>/<strong>/<i>/<em>/<u>.
const INLINE_TAG_DEFAULTS: Record<string, Partial<CSSProperty>> = {
  b: { fontWeight: "bold" }, strong: { fontWeight: "bold" },
  i: { fontStyle: "italic" }, em: { fontStyle: "italic" },
  u: { textDecoration: "underline" },
};

/** A minimal node-like shape for matching inline element items against the
 *  existing matchesCompound() helper (which reads tag/origTag/id/classes). */
interface InlineMatchable {
  tag: string;
  origTag?: string;
  id?: string;
  classes: string[];
}

/** Does an inline element item match a compound selector? Reuses the same
 *  element/class/id/attribute semantics as the main resolver. Attribute and id
 *  selectors always fail for inline items (they carry neither), which matches
 *  browser behavior where inline elements are usually targeted by tag/class. */
function inlineMatchesCompound(item: Extract<InlineItem, { kind: "element" }>, compound: SimpleSelector[]): boolean {
  for (const s of compound) {
    switch (s.kind) {
      case "element":
        if (item.origTag !== s.name) return false;
        break;
      case "class":
        if (!item.classes.includes(s.name)) return false;
        break;
      case "id":
      case "attribute":
        return false;
    }
  }
  return true;
}

/** Resolve an inline element item's style: match its class/origTag selectors
 *  against the rule list (source order, last-wins), then layer its inlineStyle
 *  on top. Returns only the keys this item sets. */
function matchInlineRules(item: Extract<InlineItem, { kind: "element" }>, rules: CSSRule[]): Partial<CSSProperty> {
  const out: Partial<CSSProperty> = {};
  for (const rule of rules) {
    const compounds = rule.selector.compounds;
    const target = compounds[compounds.length - 1];
    // v1: match by the target compound only (no ancestor combinators for inline
    // items — they're absorbed and no longer have a stable ancestor chain).
    if (inlineMatchesCompound(item, target)) {
      Object.assign(out, rule.properties);
    }
  }
  if (item.inlineStyle) {
    Object.assign(out, parseInlineStyle(item.inlineStyle));
  }
  return out;
}

/** Flatten the inline sequence into a runs[] list in document order. Each run
 *  carries the most-specific style at that point: inherited (parent's resolved
 *  style) → styling-tag default → matched rules → inlineStyle, last-wins.
 *  An <a href> element threads its href onto every text run inside it. */
function flattenInline(
  items: InlineItem[],
  parentStyle: CSSProperty,
  rules: CSSRule[],
  ancestors: UIElementNode[],
  diagnostics: Diagnostic[] | undefined,
): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (items: InlineItem[], inheritedStyle: Partial<CSSProperty>, inheritedHref: string | undefined) => {
    for (const item of items) {
      if (item.kind === "break") {
        runs.push({ text: "\n", style: { ...inheritedStyle }, hardBreak: true, href: inheritedHref });
        continue;
      }
      if (item.kind === "text") {
        if (item.text) runs.push({ text: item.text, style: { ...inheritedStyle }, href: inheritedHref });
        continue;
      }
      // element: compute its style and recurse / emit.
      const tagDefault = item.origTag ? INLINE_TAG_DEFAULTS[item.origTag] ?? {} : {};
      const matched = matchInlineRules(item, rules);
      const runStyle: Partial<CSSProperty> = { ...inheritedStyle, ...tagDefault, ...matched };
      const runHref = item.href ?? inheritedHref;
      if (item.inline && item.inline.length > 0) {
        walk(item.inline, runStyle, runHref);
      }
    }
  };
  walk(items, parentStyle, undefined);
  return runs;
}

/** CSS specificity as (a, b, c): a = id selectors, b = class/attribute/
 *  pseudo-class selectors, c = element selectors. :not()'s argument counts
 *  its own simples (the :not itself adds nothing), per the CSS spec. */
function specificityOf(sel: CSSSelector): [number, number, number] {
  let a = 0, b = 0, c = 0;
  const count = (compounds: SimpleSelector[][]): void => {
    for (const compound of compounds) {
      for (const s of compound) {
        if (s.kind === "id") a++;
        else if (s.kind === "class" || s.kind === "attribute") b++;
        else if (s.kind === "element") c++;
      }
    }
  };
  count(sel.compounds);
  if (sel.not) count(sel.not);
  if (sel.pseudo) b++;
  return [a, b, c];
}

/** Sort rules into cascade application order: ascending specificity (a, b, c),
 *  then source order (Array.prototype.sort is stable, so equal-specificity
 *  rules keep source order and the later one wins). */
function cascadeOrder(rules: CSSRule[]): CSSRule[] {
  return rules
    .map((rule, order) => ({ rule, order, spec: specificityOf(rule.selector) }))
    .sort((x, y) =>
      x.spec[0] - y.spec[0] ||
      x.spec[1] - y.spec[1] ||
      x.spec[2] - y.spec[2] ||
      x.order - y.order)
    .map((e) => e.rule);
}

export function resolveStyles(root: UIElementNode, rules: CSSRule[], diagnostics?: Diagnostic[]): StyledNode {
  // Two cascade layers: the UA sheet loses to any author rule regardless of
  // specificity; author rules cascade by specificity then source order.
  const allRules = [...cascadeOrder(getUARules()), ...cascadeOrder(rules)];
  return resolveNode(root, allRules, [], diagnostics, undefined);
}

function resolveNode(node: UIElementNode, rules: CSSRule[], ancestors: UIElementNode[], diagnostics?: Diagnostic[], parentInherited?: CSSProperty): StyledNode {
  const base: CSSProperty = {};
  const pressed: CSSProperty = {};
  const checked: CSSProperty = {};

  // Preceding siblings of this node (most-recent-first), for + and ~ combinators.
  // The parent is the last ancestor; its children before this node are siblings.
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined;
  let precedingSiblings: UIElementNode[] = [];
  if (parent) {
    const idx = parent.children.indexOf(node);
    if (idx > 0) precedingSiblings = parent.children.slice(0, idx).reverse();
  }

  for (const rule of rules) {
    if (!matches(node, rule.selector, ancestors, precedingSiblings)) continue;
    // Gate pseudo-class rules on the node's actual state. :pressed is stored
    // separately (the transition driver reads it); :checked/:disabled/:focus
    // apply to base only when the node is in that state, otherwise skip.
    const pseudo = rule.selector.pseudo;
    if (pseudo === "pressed") {
      Object.assign(pressed, rule.properties);
    } else if (pseudo === "checked") {
      // Baked as a separate checked-state pair (like :pressed), consumed by
      // the check/radio/select draw paths — the runtime swaps the pair when
      // the value flips. Merging into base only ever worked for statically
      // checked markup and would repaint the node's whole box.
      Object.assign(checked, rule.properties);
    } else if (pseudo === "disabled") {
      if (node.disabled) Object.assign(base, rule.properties);
    } else if (pseudo === "focus") {
      // Focus is a runtime-only state (set on tap), not known at resolve time,
      // so :focus rules can't match statically — skip them here.
      continue;
    } else {
      Object.assign(base, rule.properties);
    }
  }

  const style: CSSProperty = base;
  // Inline style attribute has the highest priority — merge last.
  if (node.inlineStyle) {
    Object.assign(style, parseInlineStyle(node.inlineStyle, diagnostics));
  }
  if (node.hidden) {
    style.display = "none";
  }
  if (Object.keys(pressed).length > 0) {
    // Attach pressed overrides; the transition driver reads these on press.
    (style as CSSProperty & { pressed?: CSSProperty }).pressed = pressed;
  }
  if (Object.keys(checked).length > 0) {
    // Attach checked-state overrides; the lowering bakes the resolved pair
    // (checkedBg/checkedFg) into the node for runtime state swaps.
    (style as CSSProperty & { checked?: CSSProperty }).checked = checked;
  }

  // Apply CSS inheritance: for each inherited key the node didn't set itself
  // (no rule, no inline, no hidden override), take the parent's resolved value.
  // The node's own value always wins; only the gaps are filled.
  if (parentInherited) {
    for (const key of INHERITED_KEYS) {
      if (style[key] === undefined && parentInherited[key] !== undefined) {
        style[key] = parentInherited[key];
      }
    }
  }

  // The resolved inherited subset to pass to this node's children: the node's
  // own value where it set one, else whatever it inherited. Since `style` now
  // holds the effective value after the merge above, read straight off it.
  const inherited: CSSProperty = {};
  for (const key of INHERITED_KEYS) {
    if (style[key] !== undefined) inherited[key] = style[key];
  }

  // Absorb an inline sequence into runs. Each run's style = the parent text
  // node's resolved style + the inline element's matched rules + inheritance,
  // with styling-tag defaults (b/strong→bold, i/em→italic, u→underline) applied
  // as low-priority UA-equivalent rules. Inline children do not become separate
  // StyledNodes — they're flattened into this node's run list.
  let runs: TextRun[] | undefined;
  if (node.inline && node.inline.length > 0) {
    runs = flattenInline(node.inline, style, rules, ancestors, diagnostics);
  }

  const childAncestors = [...ancestors, node];
  return {
    tag: node.tag,
    origTag: node.origTag,
    id: node.id,
    classes: node.classes,
    text: node.text,
    runs,
    value: node.value,
    style,
    children: node.children.map(c => resolveNode(c, rules, childAncestors, diagnostics, inherited)),
    options: node.options,
    name: node.name,
    checked: node.checked,
    min: node.min,
    max: node.max,
    type: node.type,
    placeholder: node.placeholder,
    maxlen: node.maxlength,
    drawerSide: node.drawerSide,
    toastDuration: node.toastDuration,
    keyboard: node.keyboard,
    hidden: node.hidden,
    href: node.href,
    src: node.src,
    imgWidth: node.imgWidth,
    imgHeight: node.imgHeight,
    itemHeight: node.itemHeight,
    canvasW: node.canvasW,
    canvasH: node.canvasH,
    disabled: (node as any).disabled,
    hasInterpolation: node.hasInterpolation,
    events: node.events,
    bind: node.bind,
    ref: node.ref,
  };
}
