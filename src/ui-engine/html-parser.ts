// ---------------------------------------------------------------------------
// HTML parser — uses linkedom for robust DOM parsing, then adapts to the
// UIElementNode shape that the rest of the pipeline expects.
//
// Supported subset:
//   - One <screen> root (required, exactly one).
//   - Child elements: <text>, <button>, <view> (a generic container).
//   - Attributes: id="...", class="a b".
//   - Text content of leaf elements.
//
// The public API (parseHtml: string → UIElementNode) is unchanged — callers
// don't know whether linkedom or a regex parser is behind it.
// ---------------------------------------------------------------------------

import { parseHTML } from "linkedom";
import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import { collectInlineSequence, INLINE_TAGS, InlineItem } from "./inline-parser.js";

export interface UIElementNode {
  tag: string;
  /** Original HTML tag before remapping (label/a/div/...), so CSS tag
   *  selectors still match remapped elements. Equals tag when no remap. */
  origTag?: string;
  id?: string;
  classes: string[];
  text?: string;
  /** Value attribute (for <option>, <radio>). */
  value?: string;
  /** Name attribute (for <radio>: groups radios together). */
  name?: string;
  /** Checked attribute (for <radio>: initially selected). */
  checked?: boolean;
  /** Min/max attributes (for <range>). */
  min?: string;
  max?: string;
  /** Input type (for <input>: "text" | "number"). */
  type?: "text" | "number";
  /** Placeholder (for <input>). */
  placeholder?: string;
  /** Max length (for <input>). */
  maxlength?: number;
  /** Keyboard ref id (for <input>). */
  keyboard?: string;
  /** HTML hidden attribute: removes the element subtree from layout/rendering. */
  hidden?: boolean;
  /** Inline style attribute: style="color: red; font-size: 16px" */
  inlineStyle?: string;
  /** Navigation target for <a href="#screenId"> links. */
  href?: string;
  /** Image source path for <img src="...">. */
  src?: string;
  /** Image width in pixels (for <img>). */
  imgWidth?: number;
  /** Image height in pixels (for <img>). */
  imgHeight?: number;
  /** Item height in pixels (for <list item-height="24">). */
  itemHeight?: number;
  /** Canvas buffer width in pixels (for <canvas>). */
  canvasW?: number;
  /** Canvas buffer height in pixels (for <canvas>). */
  canvasH?: number;
  
  /** Disabled state */
  disabled?: boolean;
  /** <drawer side="bottom|top|left|right"> — the edge the panel slides from. */
  drawerSide?: string;
  /** <toast duration="2500"> — ms a toast stays open before auto-closing. */
  toastDuration?: number;
  children: UIElementNode[];
  /** Ordered inline content sequence (text/element/break items). Present only
   *  for text nodes with mixed inline children; absent for plain-text nodes. */
  inline?: InlineItem[];
  /** True when the text content contains a `{expr}` interpolation, which the
   *  auto-wire layer lowers to an implicit ui.bind(node,'text',...) text
   *  binding. Plain text (no braces) is unchanged. */
  hasInterpolation?: boolean;
  /** Declarative event handlers from on:* attributes (e.g. on:click="save").
   *  Keys: click | hold | release | change. Values: a named TS export function
   *  the transpiler emits as a standalone C++ function; the handler table
   *  references it by name. Absent when no on:* attributes are present. */
  events?: { click?: string; hold?: string; release?: string; change?: string };
  /** Declarative two-way bindings from bind:* attributes (e.g. bind:text="ssid").
   *  Keys: text | value. Values: a signal name — the node reflects the signal
   *  (one-way: signal → node), and user input writes back (node → signal.set).
   *  Absent when no bind:* attributes are present. */
  bind?: { text?: string; value?: string };
  /** TS handle name (screen.<ref>), separate from the CSS #id selector target.
   *  When absent, falls back to `id` (backward-compatible). Lets an author keep
   *  a CSS id without leaking every styled element into the TS surface. */
  ref?: string;
  /** For <select>: parsed option list from <option> children. */
  options?: Array<{ value: string; text: string }>;
}

/** A single key in a keyboard template. */
export interface UIKeyTemplate {
  /** Character to insert, or label for special keys. */
  ch: string;
  /** 0=char, 1=shift, 2=backspace, 3=ok, 4=page-swap. */
  special: 0 | 1 | 2 | 3 | 4;
  /** CSS classes from <key class="..."> for styling. */
  classes?: string[];
}

/** A keyboard template parsed from <keyboard>. */
export interface KeyboardTemplate {
  id: string;
  variant: "alpha" | "number";
  rows: UIKeyTemplate[][];
  /** CSS classes from <keyboard class="..."> for styling the keyboard background. */
  classes?: string[];
}

export interface ParsedHtml {
  /** The first <screen> tree (backward compat). */
  tree: UIElementNode;
  /** All <screen> roots (for multi-screen navigation). */
  screens: UIElementNode[];
  keyboards: KeyboardTemplate[];
}

const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check", "select", "option", "label", "radio", "progress", "range", "input", "keyboard", "row", "key", "style", "a", "img", "list", "canvas", "br", "drawer", "dialog", "toast"]);

/** Document-furniture tags that never render. Skipped silently (unlike unknown
 *  tags, which fall back to generic containers with a warning). */
const METADATA_TAGS = new Set(["link", "meta", "title", "head", "script", "source", "track", "col", "colgroup"]);

/** Web elements that cannot work on microcontroller targets (vector graphics,
 *  media, embedded browsing). Their subtree still renders as generic containers
 *  — content is never dropped — but the diagnostic says WHY, with the native
 *  alternative, instead of a generic unknown-tag warning. */
const UNSUPPORTED_TAGS: Record<string, string> = {
  svg: "vector graphics have no renderer — draw via <canvas> or export a bitmap for <img>",
  video: "there is no video pipeline on MCU targets",
  audio: "there is no audio pipeline on MCU targets",
  iframe: "there is no browser engine to embed",
  embed: "there is no plugin/content engine on MCU targets",
  object: "there is no plugin/content engine on MCU targets",
  picture: "art-direction source selection is unsupported — a child <img> still renders",
};

/** HTML tag aliases — common HTML elements remapped to internal primitives.
 *  Semantic block containers -> view; inline/heading text tags -> text.
 *  Applied before the SUPPORTED_TAGS check so authors can write familiar HTML. */
const TAG_REMAP: Record<string, string> = {
  // Block-level containers -> view (flexbox/positioning surface)
  body: "view", div: "view", header: "view", footer: "view", nav: "view",
  main: "view", section: "view", article: "view", aside: "view",
  // Forms are layout-transparent here (no submission model) — the wrapper is
  // just a container; children render normally.
  form: "view", fieldset: "view",
  // Lists: the container is a plain view; <li> gets a marker prefix below.
  ul: "view", ol: "view", li: "text",
  // Definition lists: dt = bold term, dd = indented description (UA rules).
  dl: "view", dt: "text", dd: "text",
  // Tables: equal-width flex approximation — tr is a row, td/th are stretched
  // cells (UA rules); thead/tbody/tfoot are plain row groups. Approximation
  // surfaced via the html-table-approximation diagnostic.
  table: "view", tr: "view", td: "text", th: "text",
  thead: "view", tbody: "view", tfoot: "view", caption: "text",
  // Horizontal rule -> 1px rule (styled by the UA stylesheet).
  hr: "view",
  // Inline/heading text -> text
  span: "text", p: "text", small: "text", output: "text",
  h1: "text", h2: "text", h3: "text", h4: "text", h5: "text", h6: "text",
  // Styling tags -> text (inline; resolver applies bold/italic/underline defaults
  // and absorbs them into the parent's run list).
  b: "text", strong: "text", i: "text", em: "text", u: "text",
  // Code phrase groups -> text; the UA stylesheet gives them the mono family.
  code: "text", kbd: "text", samp: "text", pre: "text",
  // Meter is the same bar primitive as progress (min/max/value).
  meter: "progress",
  // Multiline text area -> single-line input (single-line OSK at runtime).
  textarea: "input",
};

/** <input type="..."> spellings that remap to the dedicated control tags. */
const INPUT_TYPE_REMAP: Record<string, string> = {
  checkbox: "check",
  radio: "radio",
  range: "range",
};

/** Extract <style>...</style> block contents from HTML source.
 *  Returns the concatenated CSS text (empty if no style blocks). */
export function extractStyleBlocks(src: string): string {
  const matches = src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  return Array.from(matches).map(m => m[1]).join("\n");
}

export function parseHtml(src: string, diagnostics?: Diagnostic[]): UIElementNode {
  return parseAllScreens(src, diagnostics)[0];
}

// HTML-spec parsers treat `<view .../>` as an OPEN tag for non-void elements
// (XML-style self-closing is not HTML), so JSX-habit markup silently nests:
// `<view class="a"/><view class="b"/>` puts b INSIDE a. Expand every
// self-closing non-void tag to an explicit pair before parsing. Void
// elements (img, hr, input, ...) already parse correctly and are skipped.
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
function expandSelfClosingTags(src: string): string {
  return src.replace(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g, (m, tag: string, attrs: string) => {
    if (VOID_TAGS.has(tag.toLowerCase())) return m;
    return `<${tag}${attrs}></${tag}>`;
  });
}

/** Parse all <screen> roots from HTML. Returns one tree per screen.
 *  Used for multi-screen navigation (<a href="#screenId">). */
export function parseAllScreens(src: string, diagnostics?: Diagnostic[]): UIElementNode[] {
  const withoutComments = expandSelfClosingTags(src.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ""));

  const wrapped = `<div id="__root__">${withoutComments}</div>`;
  const { document } = parseHTML(wrapped);
  const root = document.getElementById("__root__");
  if (!root) {
    throw new Error("UI HTML: failed to parse document");
  }

  const screenEls = Array.from(root.children).filter(
    (c) => c.tagName.toLowerCase() === "screen",
  );

  if (screenEls.length === 0) {
    throw new Error("UI HTML must have at least one <screen> root element");
  }

  return screenEls.map(el => domToUIElementNode(el, diagnostics));
}

/** Parse HTML, returning both the <screen> tree and any <keyboard> templates. */
export function parseHtmlWithKeyboards(src: string, diagnostics?: Diagnostic[]): ParsedHtml {
  const withoutComments = expandSelfClosingTags(src.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ""));
  const wrapped = `<div id="__root__">${withoutComments}</div>`;
  const { document } = parseHTML(wrapped);
  const root = document.getElementById("__root__");
  if (!root) {
    throw new Error("UI HTML: failed to parse document");
  }

  // Parse keyboards first (they are siblings of <screen>, not children).
  const keyboards: KeyboardTemplate[] = [];
  for (const child of Array.from(root.children)) {
    if (child.tagName.toLowerCase() !== "keyboard") continue;
    keyboards.push(parseKeyboardElement(child));
  }

  // Parse all screens (for multi-screen navigation) + keyboards.
  const screens = parseAllScreens(src, diagnostics);
  const tree = screens[0];
  return { tree, screens, keyboards };
}

/** Parse a <keyboard> element into a KeyboardTemplate. */
function parseKeyboardElement(el: Element): KeyboardTemplate {
  const id = el.getAttribute("id") || "";
  const variantAttr = el.getAttribute("variant");
  const variant: "alpha" | "number" = variantAttr === "number" ? "number" : "alpha";
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  const rows: UIKeyTemplate[][] = [];
  for (const rowEl of Array.from(el.children)) {
    if (rowEl.tagName.toLowerCase() !== "row") continue;
    const row: UIKeyTemplate[] = [];
    for (const keyEl of Array.from(rowEl.children)) {
      if (keyEl.tagName.toLowerCase() !== "key") continue;
      row.push(parseKeyElement(keyEl));
    }
    if (row.length > 0) rows.push(row);
  }
  return { id, variant, rows, classes: classes.length > 0 ? classes : undefined };
}

/** Parse a <key> element. Special keys are identified by label or special attr. */
function parseKeyElement(el: Element): UIKeyTemplate {
  const label = el.textContent?.trim() || "";
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  const specialAttr = el.getAttribute("special");
  let special: 0 | 1 | 2 | 3 | 4 = 0;
  if (specialAttr !== null) {
    const s = parseInt(specialAttr, 10);
    if (s >= 1 && s <= 4) special = s as 1 | 2 | 3 | 4;
  } else {
    // Recognize special keys by conventional labels.
    if (label === "⇧" || label.toUpperCase() === "SHIFT") special = 1;
    else if (label === "⌫" || label.toUpperCase() === "BACKSPACE") special = 2;
    else if (label.toUpperCase() === "OK") special = 3;
    else if (label === "123" || label.toUpperCase() === "ABC") special = 4;
  }
  return { ch: label, special, classes: classes.length > 0 ? classes : undefined };
}

/** Adapt a DOM element to UIElementNode, recursively walking children. */
function domToUIElementNode(el: Element, diagnostics?: Diagnostic[]): UIElementNode {
  const tag = el.tagName.toLowerCase();

  // <label> and <a> are treated as <text> internally; HTML aliases
  // (div/header/span/p/h1-h6/...) remap to view or text.
  const remapped = TAG_REMAP[tag];
  let effectiveTag = remapped ? remapped
    : (tag === "label" || tag === "a") ? "text" : tag;

  // <input type="checkbox|radio|range"> — the spelling web authors type  // reflexively — remaps to the dedicated control tags with identical behavior.
  // Other non-text types (email, date, ...) have no MCU counterpart: they
  // normalize to a single-line text input with a warning.
  if (tag === "input") {
    const inputType = (el.getAttribute("type") || "text").toLowerCase();
    const remap = INPUT_TYPE_REMAP[inputType];
    if (remap) {
      effectiveTag = remap;
    } else if (inputType !== "text" && inputType !== "number") {
      diagnostics?.push({
        severity: "warning",
        message: `<input type="${inputType}"> has no embedded equivalent — treated as a single-line text input.`,
        hint: `Supported types: text, number, checkbox, radio, range.`,
        code: "html-input-type-unsupported",
        source: "input",
      });
    }
  }

  if (!SUPPORTED_TAGS.has(effectiveTag)) {
    // Web behavior: unknown elements are generic boxes (this is why custom
    // elements work in HTML). Content is NEVER dropped — a text-only leaf
    // becomes a text node, anything with element children a container.
    const hasElementChildren = Array.from(el.children).some(
      (c) => !METADATA_TAGS.has(c.tagName.toLowerCase()),
    );
    effectiveTag = hasElementChildren ? "view" : "text";
    const knownUnsupported = UNSUPPORTED_TAGS[tag];
    if (knownUnsupported) {
      diagnostics?.push({
        severity: "warning",
        message: `<${tag}> is not supported on microcontroller targets — rendered as a generic container.`,
        hint: `${knownUnsupported}.`,
        code: "unsupported-html-tag",
        source: tag,
      });
    } else {
      diagnostics?.push({
        severity: "warning",
        message: `Unknown HTML tag <${tag}> — rendered as a generic ${hasElementChildren ? "container" : "text"} element.`,
        hint: `Supported tags: ${[...SUPPORTED_TAGS].sort().join(", ")}.`,
        code: "unknown-html-tag",
        source: tag,
      });
    }
  }

  const id = el.getAttribute("id") || undefined;
  const refAttr = el.getAttribute("ref") || undefined;
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  const valueAttr = el.getAttribute("value") || undefined;
  const nameAttr = el.getAttribute("name") || undefined;
  const checkedAttr = el.hasAttribute("checked");
  const minAttr = el.getAttribute("min") || undefined;
  const maxAttr = el.getAttribute("max") || undefined;
  // Text-input specifics only apply to the text/number input (not to
  // checkbox/radio/range inputs remapped above, and not to <textarea>).
  const isTextInput = tag === "input" && effectiveTag === "input";
  if (tag === "textarea") {
    diagnostics?.push({
      severity: "warning",
      message: `<textarea> renders as a single-line <input> (the on-screen keyboard is single-line).`,
      code: "html-textarea-single-line",
      source: "textarea",
    });
  }
  const typeAttr = isTextInput
    ? (el.getAttribute("type") === "number" ? "number" : "text")
    : undefined;
  const placeholderAttr = isTextInput ? (el.getAttribute("placeholder") || undefined) : undefined;
  const maxlengthAttr = el.getAttribute("maxlength");
  // <input> defaults maxlength to 16 when absent or unparseable.
  const maxlengthNum = isTextInput
    ? (maxlengthAttr ? (parseInt(maxlengthAttr, 10) || 16) : 16)
    : undefined;
  const keyboardAttr = isTextInput ? (el.getAttribute("keyboard") || undefined) : undefined;
  const hiddenAttr = el.hasAttribute("hidden");
  const inlineStyleAttr = el.getAttribute("style") || undefined;
  const hrefAttr = (tag === "a" || tag === "button") ? (el.getAttribute("href") || undefined) : undefined;

  // Directive value normalization: Svelte encloses directive values in braces
  // (on:click={handler}, bind:value={signal}). The bare-string form
  // (on:click="handler") is also accepted for backward compatibility. Strip the
  // surrounding braces when present so both forms produce the same value.
  const normalizeDirective = (v: string | null): string | undefined => {
    if (!v) return undefined;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    // Svelte brace form: {expr} → expr
    const braceMatch = /^\{(.+)\}$/.exec(trimmed);
    return braceMatch ? braceMatch[1].trim() : trimmed;
  };

  // Declarative on:* event attributes → named-function references. Accept both
  // Svelte form (on:click={fn}) and quoted form (on:click="fn").
  const EVENT_KINDS = ["click", "hold", "release", "change"] as const;
  const events: { click?: string; hold?: string; release?: string; change?: string } = {};
  for (const kind of EVENT_KINDS) {
    const v = normalizeDirective(el.getAttribute(`on:${kind}`));
    if (v) events[kind] = v;
  }
  const hasEvents = Object.keys(events).length > 0;

  // Declarative bind:* two-way bindings → signal names. Accept both
  // Svelte form (bind:text={signal}) and quoted form (bind:text="signal").
  const BIND_KINDS = ["text", "value"] as const;
  const bind: { text?: string; value?: string } = {};
  for (const kind of BIND_KINDS) {
    const v = normalizeDirective(el.getAttribute(`bind:${kind}`));
    if (v) bind[kind] = v;
  }
  const hasBind = Object.keys(bind).length > 0;
  const srcAttr = tag === "img" ? (el.getAttribute("src") || undefined) : undefined;
  const imgWidthAttr = tag === "img" ? parseInt(el.getAttribute("width") || "0", 10) : undefined;
  const imgHeightAttr = tag === "img" ? parseInt(el.getAttribute("height") || "0", 10) : undefined;
  const itemHeightAttr = tag === "list" ? (parseInt(el.getAttribute("item-height") || "24", 10) || 24) : undefined;
  const canvasWAttr = tag === "canvas" ? (parseInt(el.getAttribute("width") || "0", 10) || 0) : undefined;
  const canvasHAttr = tag === "canvas" ? (parseInt(el.getAttribute("height") || "0", 10) || 0) : undefined;
  const disabledAttr = el.hasAttribute("disabled");

  // For <select>, parse <option> children into an options list
  if (tag === "select") {
    const optionEls = Array.from(el.children).filter(c => c.tagName.toLowerCase() === "option");
    if (optionEls.length > 0) {
      const options = optionEls.map(opt => ({
        value: opt.getAttribute("value") || opt.textContent?.trim() || "",
        text: opt.textContent?.trim() || "",
      }));
      // Use the first option's text as the initial display text
      const firstText = options[0]?.text ?? "";
      return {
        tag: "select",
        id, classes, text: firstText, value: valueAttr,
        hidden: hiddenAttr,
        inlineStyle: inlineStyleAttr,
        children: [],
        options,
      };
    }
    // Fallback: comma-separated text (legacy shorthand)
    const text = el.textContent?.trim() || "";
    const optNames = text.split(",").map(s => s.trim()).filter(Boolean);
    return {
      tag: "select",
      id, classes, text: optNames[0] || "",
      hidden: hiddenAttr,
      inlineStyle: inlineStyleAttr,
      children: [],
      options: optNames.map(t => ({ value: t.toLowerCase(), text: t })),
    };
  }

  // Text content: only direct text, not children's text.
  let text: string | undefined;
  // Element children that become nodes: everything except document metadata
  // (skipped silently) and option/br (consumed by the select/text paths).
  // Unknown tags are KEPT — their own recursive call renders them as generic
  // containers, so no subtree is ever dropped for being unrecognized.
  const childElements = Array.from(el.children).filter((c) => {
    const ct = c.tagName.toLowerCase();
    if (METADATA_TAGS.has(ct)) return false;
    return ct !== "option" && ct !== "br";
  });
  // Non-empty direct text runs (trimmed). Runs that sit next to element
  // children become anonymous text children below — the CSS anonymous-box
  // model: a container's stray text is never silently dropped.
  const directTextRuns: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    if ((child as any).nodeType === 3) {
      const t = (child.textContent ?? "").trim();
      if (t) directTextRuns.push(t);
    }
  }

  // Inline-bearing text nodes collect an ordered inline sequence instead of a
  // single text string. Only effective-tag "text" can be inline-bearing;
  // collectInlineSequence returns undefined for plain text or block-child nodes.
  let inline: InlineItem[] | undefined;
  if (effectiveTag === "text") {
    inline = collectInlineSequence(el, diagnostics ?? []);
  }
  // A text tag whose inline collection failed (block child inside <p>/<text>)
  // keeps its tag — selectors must keep matching it — and its stray text is
  // preserved as anonymous text children below (the anonymous-block-box model).

  // Text content: only direct text, and only when there's no inline sequence
  // (inline content is captured above; the plain-text path is unchanged).
  let hasInterpolation = false;
  if (!inline && childElements.length === 0) {
    const parts: string[] = [];
    for (const child of Array.from(el.childNodes)) {
      if ((child as any).nodeType === 3) {
        parts.push(child.textContent ?? "");
        continue;
      }
      const childTag = (child as Element).tagName?.toLowerCase();
      if (childTag === "br") parts.push("\n");
    }
    const tc = parts.join("").trim();
    if (tc) {
      text = tc;
      // Detect a `{expr}` interpolation (non-empty content between braces).
      // Inline + interpolation is rejected later by the run-text-binding guard.
      hasInterpolation = /\{[^{}]+\}/.test(tc);
    }
  }

  // <table> approximation note: rows are flex rows of equal-width stretched
  // cells. Visible, not silent — see the UA stylesheet for the styling.
  if (tag === "table") {
    diagnostics?.push({
      severity: "info",
      message: `<table> renders as equal-width flex columns (tr = row, td/th = cells) — no auto column sizing, colspan, or rowspan.`,
      hint: `Set explicit widths or flex-grow on cells for custom column sizes.`,
      code: "html-table-approximation",
      source: "table",
    });
  }
  // colspan/rowspan have no equal-width-flex equivalent — warn when present.
  if (tag === "td" || tag === "th") {
    for (const span of ["colspan", "rowspan"]) {
      if (el.hasAttribute(span)) {
        diagnostics?.push({
          severity: "warning",
          message: `<${tag}> ${span} is not supported — the cell renders as a single equal-width column/row.`,
          hint: `Split the content across cells, or restructure with a flex row.`,
          code: "html-table-span-unsupported",
          source: tag,
        });
      }
    }
  }

  // <li> list markers: text-only items get a prefix ("• " for <ul>, "N. " for
  // <ol>) so plain lists read correctly with zero styling. Items with block
  // children render as containers without a marker (style those yourself).
  if (tag === "li" && (text || inline)) {
    const parentTag = (el.parentElement as Element | null)?.tagName?.toLowerCase();
    let marker = "• ";
    if (parentTag === "ol") {
      let n = 0;
      for (const sib of Array.from(el.parentElement!.children)) {
        if (sib === el) break;
        if (sib.tagName.toLowerCase() === "li") n++;
      }
      marker = `${n + 1}. `;
    }
    if (text) text = marker + text;
    if (inline) inline = [{ kind: "text", text: marker }, ...inline];
  }

  const remappedFrom = (remapped || tag === "label" || tag === "a") && tag !== effectiveTag ? tag : undefined;
  const drawerSideAttr = tag === "dialog"
    ? "center"
    : (tag === "drawer" || tag === "toast") ? (el.getAttribute("side") ?? "bottom").toLowerCase() : undefined;
  const toastDurationAttr = tag === "toast"
    ? Math.max(500, parseInt(el.getAttribute("duration") || "2500", 10) || 2500)
    : undefined;
  const node: UIElementNode = { tag: effectiveTag, origTag: remappedFrom, id, classes, text, value: valueAttr, name: nameAttr, drawerSide: drawerSideAttr, toastDuration: toastDurationAttr, checked: checkedAttr, min: minAttr, max: maxAttr, type: typeAttr, placeholder: placeholderAttr, maxlength: maxlengthNum, keyboard: keyboardAttr, hidden: hiddenAttr, inlineStyle: inlineStyleAttr, href: hrefAttr, src: srcAttr, imgWidth: imgWidthAttr || undefined, imgHeight: imgHeightAttr || undefined, itemHeight: itemHeightAttr, canvasW: canvasWAttr, canvasH: canvasHAttr, disabled: disabledAttr, inline, hasInterpolation, events: hasEvents ? events : undefined, bind: hasBind ? bind : undefined, ref: refAttr, children: [] };

  // Anonymous inline wrap: stray text next to ONLY-inline element children
  // flows as one text line (CSS anonymous inline boxes) instead of stacking
  // "Total:" above the <b>3</b> run. Requires stray text to trigger — inline
  // elements alone keep the legacy stacked behavior (deliberate chip layout).
  if (!inline && childElements.length > 0 && directTextRuns.length > 0) {
    const allInline = childElements.every((c) => INLINE_TAGS.has(c.tagName.toLowerCase()));
    if (allInline) {
      const seq = collectInlineSequence(el, diagnostics ?? []);
      if (seq) {
        node.children.push({
          tag: "text",
          classes: [],
          inline: seq,
          hasInterpolation: directTextRuns.some((t) => /\{[^{}]+\}/.test(t)),
          children: [],
        });
        return node;
      }
    }
  }

  // Children in document order, interleaving anonymous text children for
  // stray text runs (never dropped — the CSS anonymous-block-box model).
  // Inline children already absorbed by an inline[] sequence are skipped.
  let textBuffer = "";
  const flushText = (): void => {
    const t = textBuffer.trim();
    textBuffer = "";
    if (!t) return;
    node.children.push({
      tag: "text",
      classes: [],
      text: t,
      hasInterpolation: /\{[^{}]+\}/.test(t),
      children: [],
    });
  };
  for (const child of Array.from(el.childNodes)) {
    if ((child as any).nodeType === 3) {
      if (childElements.length > 0 && !inline) textBuffer += child.textContent ?? "";
      continue;
    }
    const childTag = (child as Element).tagName?.toLowerCase();
    if (!childTag || METADATA_TAGS.has(childTag) || childTag === "option" || childTag === "br") continue;
    if (inline && INLINE_TAGS.has(childTag)) continue;
    flushText();
    node.children.push(domToUIElementNode(child as Element, diagnostics));
  }
  flushText();
  return node;
}
