// ---------------------------------------------------------------------------
// CSS parser — uses css-tree for robust, standards-compliant parsing.
//
// Parses .ui.css into CSSRule[] (the same shape the hand-rolled parser
// produced), but now supports the full CSS property set that Yoga needs:
// display, flex-direction, gap, align-self, border, border-radius, etc.
//
// Unknown properties are silently dropped (forward-compatible) rather than
// throwing — the hand-rolled parser's throw-on-unknown blocked flexbox.
// ---------------------------------------------------------------------------

import { parse, walk, generate } from "css-tree";
import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import { getDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";
import { effectiveDisplaySize } from "@typecad/cuttlefish/api/shared";
import { getThemeClass } from "@typecad/cuttlefish/stores/theme-store";

export type CSSSelectorKind = "element" | "id" | "class" | "attribute";

/** A single simple selector: tag name, #id, or .class. */
export interface SimpleSelector {
  kind: CSSSelectorKind;
  name: string;
  value?: string;
}

/** A full CSS selector, supporting compound (`.foo.bar`, `tag.class`) and
 *  descendant (`parent child`) combinators.
 *  - `compounds[last]` is the target compound (the element the rule applies to).
 *  - Each compound is an array of simples that must ALL match (AND).
 *  - Preceding compounds are ancestor constraints (descendant combinator). */
export interface CSSSelector {
  compounds: SimpleSelector[][];
  combinators?: (">" | " " | "+" | "~")[];
  pseudo?: "pressed" | "disabled" | "checked" | "focus";
  /** :not(...) negation compounds. Each is a compound that must NOT match. */
  not?: SimpleSelector[][];
}

export interface TransitionDecl {
  property: "background" | "color";
  durationMs: number;
}

export interface KeyframeStop {
  percent: number;   // 0-100
  background?: string;
  color?: string;
  opacity?: string;
  transform?: string;
  transformOrigin?: string;
  left?: string;
  top?: string;
  width?: string;
  height?: string;
}

export interface KeyframeSet {
  name: string;
  stops: KeyframeStop[];
}

export interface AnimationDecl {
  name: string;
  durationMs: number;
  iterations: number;  // -1 = infinite
  delayMs: number;
  timingFunction: string;  // raw keyword, e.g. "ease-in-out" ("" / "linear" = linear)
}

export interface CSSProperty {
  // Box model
  padding?: string;
  margin?: string;
  /** Per-side margin overrides (win over the `margin` shorthand when set). */
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  width?: string;
  height?: string;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  aspectRatio?: string;
  boxSizing?: string;
  overflow?: string;
  // Colors
  color?: string;
  background?: string;
  // Text
  font?: string;
  fontFamily?: string;
  fontSize?: string;
  textAlign?: string;       // left | center | right
  textDecoration?: string;  // underline | none
  fontWeight?: string;      // normal | bold
  fontStyle?: string;       // normal | italic | oblique
  fontSmoothing?: string;   // antialiased | none
  fontSubset?: string;      // exact | fallback/auto
  lineHeight?: string;
  letterSpacing?: string;
  whiteSpace?: string;      // nowrap | normal
  textTransform?: string;   // uppercase | lowercase | capitalize | none
  textOverflow?: string;    // ellipsis | clip
  // Animation
  transition?: TransitionDecl;
  animation?: string;  // shorthand: "pulse 2s infinite"
  animationName?: string;
  animationDuration?: string;
  animationIterationCount?: string;
  animationDelay?: string;
  animationTimingFunction?: string;  // linear | ease | ease-in | ease-out | ease-in-out
  // Flexbox / layout (Yoga)
  display?: string;
  flexDirection?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  flexGrow?: string;
  flexShrink?: string;
  flexBasis?: string;
  alignSelf?: string;
  alignItems?: string;
  alignContent?: string;
  justifyContent?: string;
  flexWrap?: string;
  order?: string;
  position?: string;        // relative | absolute | static
  zIndex?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  // Visual
  border?: string;
  borderRadius?: string;
  borderWidth?: string;
  borderColor?: string;
  borderStyle?: string;     // solid | dashed | dotted | none
  /** Per-side border overrides (win over the shorthand when set). */
  borderTopWidth?: string;
  borderTopStyle?: string;
  borderTopColor?: string;
  borderRightWidth?: string;
  borderRightStyle?: string;
  borderRightColor?: string;
  borderBottomWidth?: string;
  borderBottomStyle?: string;
  borderBottomColor?: string;
  borderLeftWidth?: string;
  borderLeftStyle?: string;
  borderLeftColor?: string;
  opacity?: string;
  visibility?: string;      // visible | hidden
  outline?: string;
  boxShadow?: string;
  textShadow?: string;
  transform?: string;
  transformOrigin?: string;
  objectFit?: string;  // fill | contain | cover | scale-down | none
}

export interface CSSRule {
  selector: CSSSelector;
  properties: CSSProperty;
}

export interface CSSFontFace {
  fontFamily: string;
  src: string;
  fontWeight?: string;
  fontStyle?: string;
}

/** Evaluate an @media condition (css-tree prelude string) against the resolved
 *  display profile at transpile time. Each firmware build targets ONE display,
 *  so @media is a compile-time variant selector, not responsive design.
 *  Returns true if the rule should apply. Supports:
 *   - (min|max)-(width|height):Npx, (width|height):Npx
 *   - (e-ink), (update: slow|fast), (monochrome), (monochrome: N),
 *     (color-gamut: srgb|p3)
 *  Clauses AND-combine (comma = OR not supported). Unsupported → null (warn). */
function evalMediaCondition(prelude: string): boolean | null {
  const s = prelude.trim();
  // @media all / @media (no condition) -> always apply.
  if (s === "" || s === "all" || /(?<![\w-])all(?![\w-])/i.test(s)) return true;
  const profile = getDisplayProfile();
  const displaySize = effectiveDisplaySize(profile);
  const w = displaySize.width;
  const h = displaySize.height;
  const isEink = profile.displayClass === "eink";
  const isMono = profile.colorFormat === "mono";
  // Mono level count: mono colorFormat = 2 (B&W). (4/7-level descriptor arrives in Phase 4.)
  const monoLevels = isMono ? 2 : 0;

  let result = true;
  let matched = false;
  // Match each (feature: value) pair. AND-combine (comma = OR not supported).
  // Groups: [1]=min|max, [2]=width|height, [3]=value; or [4]=width|height, [5]=value (bare).
  const featRe = /\((?:\s*(min|max)-(width|height)\s*:\s*(\d+)(?:px)?\s*|\s*(width|height)\s*:\s*(\d+)(?:px)?\s*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = featRe.exec(s)) !== null) {
    matched = true;
    if (m[1] && m[2] && m[3]) {
      const n = parseInt(m[3], 10);
      const axis = m[2] === "width" ? w : h;
      result = result && (m[1] === "min" ? axis >= n : axis <= n);
    } else if (m[4] && m[5]) {
      // bare (width: N) -> exact match
      const n = parseInt(m[5], 10);
      result = result && ((m[4] === "width" ? w : h) === n);
    }
  }

  // (e-ink) — boolean feature: true on an eink display class.
  if (/\(\s*e-?ink\s*\)/i.test(s)) {
    matched = true;
    result = result && isEink;
  }
  // (update: slow|fast) — slow = eink, fast = tft.
  const updateM = /\(\s*update\s*:\s*(slow|fast)\s*\)/i.exec(s);
  if (updateM) {
    matched = true;
    const want = updateM[1].toLowerCase();
    result = result && (want === "slow" ? isEink : !isEink);
  }
  // (monochrome) and (monochrome: N) — true when colorFormat is mono with >=N levels.
  const monoM = /\(\s*monochrome(?:\s*:\s*(\d+))?\s*\)/i.exec(s);
  if (monoM) {
    matched = true;
    const want = monoM[1] ? parseInt(monoM[1], 10) : 1;
    result = result && isMono && monoLevels >= want;
  }
  // (color-gamut: srgb|p3) — srgb is the baseline for both TFT and eink; p3 unsupported.
  const gamutM = /\(\s*color-gamut\s*:\s*(srgb|p3)\s*\)/i.exec(s);
  if (gamutM) {
    matched = true;
    result = result && gamutM[1].toLowerCase() === "srgb";
  }

  if (!matched) return null;  // unrecognized condition
  return result;
}

export function parseCss(src: string, diagnostics?: Diagnostic[]): CSSRule[] {
  // Strip CSS comments before parsing (they may contain { or }).
  const withoutComments = stripKeyframes(src.replace(/\/\*[\s\S]*?\*\//g, ""));
  const rules: CSSRule[] = [];
  // CSS custom properties (--name: value), extracted from :root-like rules.
  const variables: Record<string, string> = {};
  // Class-scoped variables (".dark { --x: ... }"), keyed by class name.
  const scopedVars: Record<string, Record<string, string>> = {};

  let ast;
  try {
    ast = parse(withoutComments, { parseCustomProperty: true });
  } catch {
    // css-tree may fail on edge-case CSS; fall back to empty rules.
    return rules;
  }

  // Track @media nesting so rules inside @media evaluate their condition
  // against the resolved display profile (compile-time variant selection).
  const mediaStack: string[] = [];
  walk(ast, {
    enter(node: any) {
      if (node.type === "Atrule" && node.name === "media") {
        mediaStack.push(generate(node.prelude));
        return;
      }
      // @import / @supports are unsupported at-rules - warn + skip contents.
      if (node.type === "Atrule" && (node.name === "import" || node.name === "supports")) {
        if (diagnostics) diagnostics.push({
          severity: "warning",
          message: `Unsupported @${node.name} at-rule - ignored.`,
          hint: "Only @font-face, @keyframes, and @media are supported.",
          code: "unsupported-at-rule",
          source: node.name,
        });
        return;
      }
      if (node.type !== "Rule") return;
      // If inside @media, evaluate the condition against the display profile.
      if (mediaStack.length > 0) {
        const cond = mediaStack[mediaStack.length - 1];
        const applies = evalMediaCondition(cond);
        if (applies === null) {
          if (diagnostics) diagnostics.push({
            severity: "warning",
            message: `@media ${cond} has an unsupported condition - rule ignored.`,
            hint: "Supported: (max-width:Npx), (min-width:Npx), (max-height:Npx), (min-height:Npx), (e-ink), (update: slow|fast), (monochrome), (monochrome: N), (color-gamut: srgb).",
            code: "unsupported-media-condition",
            source: "media",
          });
          return;
        }
        if (!applies) return;
      }

      // Extract selector text via generate (robust across css-tree versions).
      const selectorText = generate(node.prelude).trim();

      // Capture CSS custom properties from :root declarations.
      if (selectorText === ":root") {
        node.block.children.forEach((child: any) => {
          if (child.type === "Declaration" && child.property.startsWith("--")) {
            variables[child.property] = generate(child.value).trim();
          }
        });
        return; // :root is not a styling rule
      }

      // Class-scoped variables: `.dark { --x: ... }`. Extract into scopedVars
      // keyed by class name so an active theme class (from config) can override
      // :root at substitution time. A rule that contains ONLY --var declarations
      // is treated as a variable scope, not a styling rule.
      const singleClassM = /^\.([\w-]+)$/.exec(selectorText);
      const decls = Array.from(node.block.children as any[]).filter(c => c.type === "Declaration");
      const varDecls = decls.filter(c => typeof c.property === "string" && c.property.startsWith("--"));
      if (singleClassM && varDecls.length > 0) {
        const cls = singleClassM[1];
        if (!scopedVars[cls]) scopedVars[cls] = {};
        for (const c of varDecls) {
          scopedVars[cls][c.property] = generate(c.value).trim();
        }
        // If ALL declarations are variables, this is a pure scope block — skip
        // it as a styling rule (its --var props would match nothing useful).
        if (varDecls.length === decls.length) return;
      }

      const selector = parseSelector(selectorText);
      if (!selector) return;

      // Extract declarations.
      const props: CSSProperty = {};
      node.block.children.forEach((child: any) => {
        if (child.type !== "Declaration") return;
        // Strip vendor prefixes (-webkit-, -moz-, -ms-, -o-) so authors can
        // paste cross-browser CSS without manual cleanup.
        const prop = child.property.replace(/^-(?:webkit|moz|ms|o)-/, "");
        const val = generate(child.value).trim();
        assignProp(props, prop, val, diagnostics);
      });

      // css-tree emits comma-separated selectors as one string ("a, b").
      // Split on commas to produce one CSSRule per selector.
      const selectorParts = selectorText.split(",").map(s => s.trim()).filter(Boolean);
      for (const part of selectorParts) {
        const sel = parseSelector(part);
        if (sel) rules.push({ selector: sel, properties: props });
      }
    },
    leave(node: any) {
      if (node.type === "Atrule" && node.name === "media") mediaStack.pop();
    },
  });

  // Build the effective variable map: :root overridden by the active theme
  // class (e.g. "dark") if one is configured and present in scopedVars.
  const themeClass = getThemeClass();
  const effectiveVars: Record<string, string> = { ...variables };
  if (themeClass && scopedVars[themeClass]) {
    Object.assign(effectiveVars, scopedVars[themeClass]);
  }

  // Substitute var(--name) references in all property values.
  if (Object.keys(effectiveVars).length > 0) {
    for (const rule of rules) {
      substituteVars(rule.properties, effectiveVars);
    }
  }

  return rules;
}

export function parseFontFaces(src: string): CSSFontFace[] {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const faces: CSSFontFace[] = [];

  let ast;
  try {
    ast = parse(withoutComments, { parseCustomProperty: true });
  } catch {
    return faces;
  }

  walk(ast, {
    enter(node: any) {
      if (node.type !== "Atrule" || node.name !== "font-face" || !node.block) return;
      const decls: Record<string, string> = {};
      node.block.children.forEach((child: any) => {
        if (child.type !== "Declaration") return;
        decls[child.property] = generate(child.value).trim();
      });
      const fontFamily = decls["font-family"] ? unquoteCss(decls["font-family"]) : "";
      const src = extractFontSrc(decls.src ?? "");
      if (!fontFamily || !src) return;
      faces.push({
        fontFamily,
        src,
        fontWeight: decls["font-weight"],
        fontStyle: decls["font-style"],
      });
    },
  });

  return faces;
}

/** Replace var(--name) in all string-valued CSS properties. */
function substituteVars(props: CSSProperty, variables: Record<string, string>): void {
  for (const key of Object.keys(props) as (keyof CSSProperty)[]) {
    const val = props[key];
    if (typeof val === "string" && (val.includes("var(") || val.includes("calc("))) {
      let resolved = val.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => variables[name] ?? "");
      // After var substitution, evaluate any calc(...) expressions.
      resolved = resolveCalc(resolved);
      (props[key] as string) = resolved;
    } else if (val && typeof val === "object" && "property" in val) {
      // TransitionDecl — no var() in its fields, skip
    }
  }
}

/** Evaluate calc(...) expressions in a value string. Handles + - * / on
 *  lengths (px/rem/em/%) after var() substitution. Returns the input with
 *  calc(...) replaced by the computed value (with the dominant unit appended).
 *  e.g. "calc(0.625rem - 4px)" → "6px". Unrecognized calc → left as-is. */
function resolveCalc(value: string): string {
  if (!value.includes("calc(")) return value;
  // Repeat to handle nested calc().
  let out = value;
  for (let i = 0; i < 8; i++) {
    const m = /calc\(([^()]*)\)/.exec(out);
    if (!m) break;
    const computed = evalCalcExpr(m[1].trim());
    out = out.slice(0, m.index) + computed + out.slice(m.index + m[0].length);
  }
  return out;
}

/** Evaluate a simple arithmetic expression of lengths to a length string.
 *  Supports + - * /. rem/em terms normalize to px (×16), so any length
 *  expression reduces to px: "calc(0.5rem - 2px)" → "6px".
 *  Percent + length mixes ("calc(50% - 10px)") cannot resolve numerically at
 *  parse time — those stay as literal calc() text. Unrecognized → as-is. */
function evalCalcExpr(expr: string): string {
  // Tokenize into numbers-with-units and operators.
  const tokens = expr.match(/(?:[\d.]+(?:rem|em|px|%)?|[-+*/])/g);
  if (!tokens || tokens.length === 0) return `calc(${expr})`;
  const hasPercent = /[\d.]+%/.test(expr);
  const hasLength = /[\d.]+(?:rem|em|px)/.test(expr);
  if (hasPercent && hasLength) return `calc(${expr})`;
  // rem/em already fold to px in toNum, so the output unit is determined by
  // the term kinds — never "the first unit seen" (that produced 6rem from
  // 0.5rem - 2px).
  const unit = hasPercent ? "%" : hasLength ? "px" : "";
  // Convert each token to a plain number (rem/em × 16).
  const toNum = (tok: string): number => {
    const remM = /^(-?[\d.]+)rem$/.exec(tok);
    if (remM) return parseFloat(remM[1]) * 16;
    const emM = /^(-?[\d.]+)em$/.exec(tok);
    if (emM) return parseFloat(emM[1]) * 16;
    const numM = /^(-?[\d.]+)(?:rem|em|px|%)?$/.exec(tok);
    return numM ? parseFloat(numM[1]) : NaN;
  };
  // Left-to-right evaluation (no operator precedence — matches calc() for the
  // simple two-term cases this targets; * / bind tighter via a tiny pass).
  const nums: number[] = [];
  const ops: string[] = [];
  for (const tok of tokens) {
    if (tok === "+" || tok === "-" || tok === "*" || tok === "/") ops.push(tok);
    else nums.push(toNum(tok));
  }
  if (nums.length === 0 || nums.some(isNaN)) return `calc(${expr})`;
  // First pass: * and /.
  const vals = [nums[0]];
  const lateOps: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === "*") vals[vals.length - 1] = vals[vals.length - 1] * nums[i + 1];
    else if (ops[i] === "/") vals[vals.length - 1] = vals[vals.length - 1] / nums[i + 1];
    else { lateOps.push(ops[i]); vals.push(nums[i + 1]); }
  }
  // Second pass: + and -.
  let result = vals[0];
  for (let i = 0; i < lateOps.length; i++) {
    if (lateOps[i] === "+") result += vals[i + 1];
    else result -= vals[i + 1];
  }
  const rounded = Math.round(result * 1000) / 1000;
  return `${rounded}${unit}`;
}

function unquoteCss(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractFontSrc(value: string): string {
  const url = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(value);
  if (url?.[2]) return url[2].trim();
  return unquoteCss(value.split(",")[0] ?? "");
}

/** Parse an inline style string ("color: red; font-size: 16px") into CSSProperty.
 *  Uses the same assignProp pipeline as rule parsing. */
export function parseInlineStyle(src: string, diagnostics?: Diagnostic[]): CSSProperty {
  const props: CSSProperty = {};
  for (const decl of src.split(";")) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx < 0) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const val = decl.slice(colonIdx + 1).trim();
    if (prop && val) assignProp(props, prop, val, diagnostics);
  }
  return props;
}

/** Parse a selector string into compounds + simples.
 *  Supports: `.foo`, `#bar`, `tag`, `.foo.bar` (compound), `tag.cls` is not valid
 *  CSS (no dot in tag names), `parent child` (descendant), and `:pressed`.
 *  Returns null for empty/invalid selectors. */
/** Re-space the child combinator so whitespace tokenization can isolate it.
 *  css-tree serializes "a > b" as "a>b"; we add spaces around '>' while
 *  leaving any '>' inside [...] attribute brackets untouched. */
function normalizeCombinators(s: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    // Re-space combinators so whitespace tokenization can isolate them.
    // Only outside attribute brackets so values like [data-x=">"] survive.
    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      out += " " + ch + " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/** Parse the inner part of :not(...) into a SimpleSelector compound. */
function parseInnerCompound(inner: string): SimpleSelector[] {
  const simples: SimpleSelector[] = [];
  const attrRe = /\[([\w-]+)(?:([~|^$*]?=)[\"']?([^'\"\]]*)[\"']?)?\]/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(inner)) !== null) {
    simples.push({ kind: "attribute", name: am[1], value: am[3] });
  }
  const remaining = inner.replace(/\[[^\]]*\]/g, "");
  if (remaining) {
    const tokenRe = /([.#]?)([a-zA-Z_][\w-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(remaining)) !== null) {
      if (m[1] === "#") simples.push({ kind: "id", name: m[2] });
      else if (m[1] === ".") simples.push({ kind: "class", name: m[2] });
      else simples.push({ kind: "element", name: m[2] });
    }
  }
  return simples;
}

function parseSelector(s: string): CSSSelector | null {
  // Extract :not(...) negation groups BEFORE the trailing-pseudo regex.
  const notGroups: SimpleSelector[][] = [];
  const notRe = /:not\(([^)]*)\)/g;
  let notM: RegExpExecArray | null;
  let sNoNot = s;
  while ((notM = notRe.exec(s)) !== null) {
    const inner = parseInnerCompound(notM[1]);
    if (inner.length > 0) notGroups.push(inner);
  }
  if (notGroups.length > 0) sNoNot = s.replace(/:not\([^)]*\)/g, "");
  const pseudoM = /:(pressed|active|disabled|checked|focus)$/.exec(sNoNot);
  let pseudo: CSSSelector["pseudo"];
  if (pseudoM) {
    const p = pseudoM[1];
    pseudo = (p === "active") ? "pressed" : p as any;
  }
  const base = pseudoM ? sNoNot.slice(0, pseudoM.index) : sNoNot;
  const trimmed = base.trim().replace(/^[\"']/, "").replace(/[\"']$/, "");
  if (!trimmed) return null;

  // css-tree's generate() emits the child combinator without surrounding
  // spaces ("view>text"), so a plain whitespace split would merge the two
  // compounds into one. Normalize ">" into " > ", but only OUTSIDE attribute
  // brackets so values like [data-x=">"] are preserved.
  const tokens = normalizeCombinators(trimmed).split(/\s+/).filter(Boolean);
  const compounds: SimpleSelector[][] = [];
  const combinators: (">" | " " | "+" | "~")[] = [];
  let expectCombinator = false;

  for (const tok of tokens) {
    if (tok === ">" || tok === "+" || tok === "~") {
      combinators.push(tok);
      expectCombinator = false;
      continue;
    }
    if (expectCombinator) combinators.push(" ");

    const simples: SimpleSelector[] = [];
    // Attribute selectors: [disabled], [type="number"]
    const attrRe = /\[([\w-]+)(?:([~|^$*]?=)["']?([^'"\]]*)["']?)?\]/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(tok)) !== null) {
      simples.push({ kind: "attribute", name: am[1], value: am[3] });
    }
    // Remaining simples from non-attribute parts
    const remaining = tok.replace(/\[[^\]]*\]/g, "");
    if (remaining) {
      const tokenRe = /([.#]?)([a-zA-Z_][\w-]*)/g;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(remaining)) !== null) {
        if (m[1] === "#") simples.push({ kind: "id", name: m[2] });
        else if (m[1] === ".") simples.push({ kind: "class", name: m[2] });
        else simples.push({ kind: "element", name: m[2] });
      }
    }
    if (simples.length > 0) compounds.push(simples);
    expectCombinator = true;
  }

  if (compounds.length === 0) return null;
  const result: CSSSelector = { compounds };
  if (combinators.length > 0) result.combinators = combinators;
  if (pseudo) result.pseudo = pseudo;
  if (notGroups.length > 0) result.not = notGroups;
  return result;
}

/** Parse a numeric value from a CSS string to device pixels.
 *  Supports px (as-is), bare numbers (as-is), rem/em (× root font size = 16),
 *  and % (number used as-is, meaningful only in flex/position contexts). */
function num(val: string): number {
  const v = val.trim();
  const remM = /^(-?[\d.]+)rem$/.exec(v);
  if (remM) return Math.round(parseFloat(remM[1]) * 16);
  const emM = /^(-?[\d.]+)em$/.exec(v);
  if (emM) return Math.round(parseFloat(emM[1]) * 16);
  const digits = v.replace(/px$|%$|rem$|em$/g, "").trim();
  const n = Number(digits);
  return isNaN(n) ? 0 : n;
}

/** Parse a transition value: "background 80ms" → { property, durationMs }. */
function parseTransition(val: string): TransitionDecl {
  const parts = val.split(/\s+/);
  if (parts.length < 2) return { property: "background", durationMs: 0 };
  const property = parts[0];
  if (property !== "background" && property !== "color") {
    return { property: "background", durationMs: 0 };
  }
  const durStr = parts[1].replace(/ms$|s$/g, "").trim();
  let durationMs = Number(durStr);
  if (parts[1].endsWith("s") && !parts[1].endsWith("ms")) durationMs *= 1000;
  if (isNaN(durationMs)) durationMs = 0;
  return { property: property as "background" | "color", durationMs };
}

/** Parse the animation shorthand: "pulse 2s infinite 500ms".
 *  Fields: name (identifier), duration (Nms/Ns), iterations (number|infinite), delay (Nms/Ns). */
export function parseAnimation(val: string): AnimationDecl | null {
  const first = val.split(",")[0]?.trim() ?? "";
  const parts = first.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const decl: AnimationDecl = { name: "", durationMs: 1000, iterations: 1, delayMs: 0, timingFunction: "" };
  let foundDuration = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "none") {
      return null;
    } else if (lower === "infinite") {
      decl.iterations = -1;
    } else if (/^\d+(?:\.\d+)?ms$/.test(lower)) {
      const ms = Math.round(parseFloat(lower));
      if (!foundDuration) { decl.durationMs = ms; foundDuration = true; }
      else decl.delayMs = ms;
    } else if (/^\d+(?:\.\d+)?s$/.test(lower)) {
      const ms = Math.round(parseFloat(lower) * 1000);
      if (!foundDuration) { decl.durationMs = ms; foundDuration = true; }
      else decl.delayMs = ms;
    } else if (/^\d+$/.test(lower)) {
      decl.iterations = parseInt(lower, 10);
    } else if (
      lower === "linear" ||
      lower === "ease" ||
      lower === "ease-in" ||
      lower === "ease-out" ||
      lower === "ease-in-out"
    ) {
      decl.timingFunction = lower;  // capture (applied to the lerp factor between stops)
    } else if (
      lower === "normal" ||
      lower === "reverse" ||
      lower === "alternate" ||
      lower === "alternate-reverse" ||
      lower === "forwards" ||
      lower === "backwards" ||
      lower === "both" ||
      lower === "running" ||
      lower === "paused"
    ) {
      continue;
    } else {
      // Identifier: the first non-keyword token is the animation name.
      decl.name = part;
    }
  }
  if (!decl.name) return null;
  return decl;
}

/** Parse @keyframes blocks from CSS source.
 *  Returns KeyframeSet[] — one per @keyframes name. */
export function parseKeyframes(src: string): KeyframeSet[] {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sets: KeyframeSet[] = [];

  let ast;
  try {
    ast = parse(withoutComments, { parseCustomProperty: true });
  } catch {
    return sets;
  }

  const variables = extractVariables(withoutComments);

  walk(ast, {
    enter(node: any) {
      if (node.type !== "Atrule" || node.name !== "keyframes" || !node.block) return;
      const name = node.prelude ? generate(node.prelude).trim() : "";
      if (!name) return;

      const merged = new Map<number, KeyframeStop>();
      node.block.children.forEach((rule: any) => {
        if (rule.type !== "Rule" || !rule.block) return;
        const percents = keyframePercents(rule.prelude ? generate(rule.prelude) : "");
        if (percents.length === 0) return;

        const props: Omit<KeyframeStop, "percent"> = {};
        rule.block.children.forEach((decl: any) => {
          if (decl.type !== "Declaration") return;
          const prop = decl.property.replace(/^-(?:webkit|moz|ms|o)-/, "");
          const val = substituteVarsInValue(generate(decl.value).trim(), variables);
          if (prop === "background" || prop === "background-color") props.background = val;
          else if (prop === "color") props.color = val;
          else if (prop === "opacity") props.opacity = val;
          else if (prop === "transform") props.transform = val;
          else if (prop === "transform-origin") props.transformOrigin = val;
          else if (prop === "left") props.left = val;
          else if (prop === "top") props.top = val;
          else if (prop === "width") props.width = val;
          else if (prop === "height") props.height = val;
        });

        for (const percent of percents) {
          const existing = merged.get(percent) ?? { percent };
          merged.set(percent, { ...existing, ...props, percent });
        }
      });

      const stops = [...merged.values()].sort((a, b) => a.percent - b.percent);
      if (stops.length > 0) sets.push({ name, stops });
    },
  });

  return sets;
}

function keyframePercents(selectorText: string): number[] {
  return selectorText
    .split(",")
    .map((part) => {
      const trimmed = part.trim().toLowerCase();
      if (trimmed === "from") return 0;
      if (trimmed === "to") return 100;
      const match = /^(\d+(?:\.\d+)?)%$/.exec(trimmed);
      if (!match) return undefined;
      const value = Math.round(Number(match[1]));
      return value >= 0 && value <= 100 ? value : undefined;
    })
    .filter((value): value is number => value !== undefined);
}

function extractVariables(src: string): Record<string, string> {
  const variables: Record<string, string> = {};
  let ast;
  try {
    ast = parse(src, { parseCustomProperty: true });
  } catch {
    return variables;
  }

  walk(ast, {
    enter(node: any) {
      if (node.type !== "Rule") return;
      const selectorText = generate(node.prelude).trim();
      if (selectorText !== ":root") return;
      node.block.children.forEach((child: any) => {
        if (child.type === "Declaration" && child.property.startsWith("--")) {
          variables[child.property] = generate(child.value).trim();
        }
      });
    },
  });

  return variables;
}

function substituteVarsInValue(value: string, variables: Record<string, string>): string {
  return value.includes("var(")
    ? value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => variables[name] ?? "")
    : value;
}

function stripKeyframes(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const match = /@keyframes\s+[\w-]+\s*\{/iy;
    match.lastIndex = i;
    const found = match.exec(src);
    if (!found) {
      out += src[i++];
      continue;
    }

    out += src.slice(i, found.index);
    let depth = 1;
    let j = match.lastIndex;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    i = j;
  }
  return out;
}
function parseFontShorthand(props: CSSProperty, val: string): void {
  const parts = val.trim().split(/\s+/);
  const sizeIndex = parts.findIndex((part) => /^\d+(?:\.\d+)?(?:px|pt|em|rem)?(?:\/.+)?$/.test(part));
  if (sizeIndex < 0) return;
  const beforeSize = parts.slice(0, sizeIndex);
  const [size, lineHeight] = parts[sizeIndex].split("/");
  const family = parts.slice(sizeIndex + 1).join(" ").trim();
  if (size) props.fontSize = size;
  if (lineHeight) props.lineHeight = lineHeight;
  if (family) props.fontFamily = family;
  for (const part of beforeSize) {
    const lower = part.toLowerCase();
    if (lower === "italic" || lower === "oblique" || lower === "normal") props.fontStyle = lower;
    else if (lower === "bold" || lower === "bolder" || lower === "lighter" || /^\d{3}$/.test(lower)) props.fontWeight = lower;
  }
}

/** Assign a CSS property to the CSSProperty object. Unknown properties emit a warning
 *  (forward-compatible: they are dropped from output, but the author is notified).
 *  Known properties with values the engine can only partially honor also warn —
 *  a visible approximation beats a silent one. */
function assignProp(props: CSSProperty, prop: string, val: string, diagnostics?: Diagnostic[]): void {
  const warn = (message: string, hint?: string): void => {
    if (diagnostics) diagnostics.push({ severity: "warning", message, hint, code: "unknown-css-property", source: prop });
  };
  const warnValue = (code: string, message: string, hint?: string): void => {
    if (diagnostics) diagnostics.push({ severity: "warning", message, hint, code, source: prop });
  };
  switch (prop) {
    // Box model
    case "padding": props.padding = val; break;
    case "margin": props.margin = val; break;
    case "margin-top": props.marginTop = val; break;
    case "margin-right": props.marginRight = val; break;
    case "margin-bottom": props.marginBottom = val; break;
    case "margin-left": props.marginLeft = val; break;
    case "width": props.width = val; break;
    case "height": props.height = val; break;
    case "min-width": props.minWidth = val; break;
    case "max-width": props.maxWidth = val; break;
    case "min-height": props.minHeight = val; break;
    case "max-height": props.maxHeight = val; break;
    case "aspect-ratio": props.aspectRatio = val; break;
    case "box-sizing":
      if (val.trim().toLowerCase() === "content-box") {
        warnValue("css-box-sizing", `box-sizing: content-box is ignored — the engine always lays out border-box (borders and padding inside width/height).`, `Remove the declaration, or size elements accounting for padding/border.`);
      }
      props.boxSizing = val;
      break;
    case "overflow": props.overflow = val; break;
    // Colors
    case "color": props.color = val; break;
    case "background":
    case "background-color": props.background = val; break;
    // Text
    case "font": props.font = val; parseFontShorthand(props, val); break;
    case "font-family": props.fontFamily = val; break;
    case "font-size": {
      const v = val.trim();
      if (v.endsWith("%")) {
        warnValue("css-font-size-unit", `font-size "${val}" — percent sizes are not supported; use px. The declaration is ignored.`, `font-size accepts px (or a bare number, treated as px).`);
      } else {
        const em = /^([\d.]+)(em|rem)$/.exec(v);
        if (em) {
          props.fontSize = `${Math.round(parseFloat(em[1]) * 16)}px`;
          warnValue("css-font-size-unit", `font-size "${val}" — em/rem resolve against the root (16px), not the parent; wrote ${props.fontSize}.`, `Use px to size text exactly.`);
        } else {
          props.fontSize = val;
        }
      }
      break;
    }
    case "text-align": props.textAlign = val; break;
    case "text-decoration": props.textDecoration = val; break;
    case "font-weight": props.fontWeight = val; break;
    case "font-style": props.fontStyle = val; break;
    case "font-smoothing":
    case "font-smooth":
    case "-webkit-font-smoothing": props.fontSmoothing = val; break;
    case "font-subset": props.fontSubset = val; break;
    case "line-height":
      if (/^\d+(?:\.\d+)?$/.test(val.trim())) {
        warnValue("css-line-height", `line-height "${val}" — unitless multipliers are treated as px, not a multiple of the font size.`, `Write an explicit px value (e.g. line-height: 22px).`);
      }
      props.lineHeight = val;
      break;
    case "letter-spacing": props.letterSpacing = val; break;
    case "white-space": props.whiteSpace = val; break;
    case "text-transform": props.textTransform = val; break;
    case "text-overflow": props.textOverflow = val; break;
    // Animation
    case "transition": props.transition = parseTransition(val); break;
    case "animation": props.animation = val; break;
    case "animation-name": props.animationName = val; break;
    case "animation-duration": props.animationDuration = val; break;
    case "animation-iteration-count": props.animationIterationCount = val; break;
    case "animation-delay": props.animationDelay = val; break;
    case "animation-timing-function": props.animationTimingFunction = val; break;
    // Flexbox / layout
    case "display":
      if (["inline", "inline-block", "inline-flex", "grid", "flow-root", "table"].includes(val.trim().toLowerCase())) {
        warnValue("css-display", `display: ${val.trim()} is not supported — elements stack vertically like a flex column (children use display:flex semantics).`, `Use the default stacking, or a row container with flex-direction: row + gap for inline flows.`);
      }
      props.display = val;
      break;
    case "flex-direction": props.flexDirection = val; break;
    case "gap": props.gap = val; props.rowGap = val; props.columnGap = val; break;
    case "row-gap": props.rowGap = val; if (!props.columnGap) props.columnGap = val; break;
    case "column-gap": props.columnGap = val; if (!props.rowGap) props.rowGap = val; break;
    case "flex": parseFlexShorthand(props, val); break;
    case "flex-grow": props.flexGrow = val; break;
    case "flex-shrink": props.flexShrink = val; break;
    case "flex-basis": props.flexBasis = val; break;
    case "align-self": props.alignSelf = val; break;
    case "align-items": props.alignItems = val; break;
    case "align-content": props.alignContent = val; break;
    case "justify-content": props.justifyContent = val; break;
    case "flex-wrap": props.flexWrap = val; break;
    case "order": props.order = val; break;
    case "position":
      if (["fixed", "sticky"].includes(val.trim().toLowerCase())) {
        warnValue("css-position", `position: ${val.trim()} is not supported — treated as static.`, `Use position: absolute (against the nearest ancestor) or keep flow layout.`);
      }
      props.position = val;
      break;
    case "z-index": props.zIndex = val; break;
    case "top": props.top = val; break;
    case "right": props.right = val; break;
    case "bottom": props.bottom = val; break;
    case "left": props.left = val; break;
    // Visual
    case "border": props.border = val; parseBorderShorthand(props, val); break;
    case "border-radius": props.borderRadius = val; break;
    case "border-width": props.borderWidth = val; break;
    case "border-color": props.borderColor = val; break;
    case "border-style": props.borderStyle = val; break;
    case "border-left": case "border-top": case "border-right": case "border-bottom":
      parsePerSideBorder(props, prop, val);
      break;
    case "opacity": props.opacity = val; break;
    case "visibility": props.visibility = val; break;
    case "outline": props.outline = val; break;
    case "box-shadow": props.boxShadow = val; break;
    case "text-shadow": props.textShadow = val; break;
    case "transform": props.transform = val; break;
    case "transform-origin": props.transformOrigin = val; break;
    case "object-fit": props.objectFit = val; break;
    // Unknown properties are dropped (forward-compatible) but reported as a warning
    // so authors notice typos and unsupported features.
    default:
      warn(`Unknown CSS property "${prop}" — ignored.`);
      break;
  }
}

/** Parse the `flex` shorthand: "1" → grow=1,shrink=1,basis=0%.
 *  "1 0 auto" → grow=1, shrink=0, basis=auto. */
function parseFlexShorthand(props: CSSProperty, val: string): void {
  const parts = val.trim().split(/\s+/);
  if (parts.length === 1) {
    // Single value: either a number (grow) or a dimension (basis) or "none"
    if (parts[0] === "none") {
      props.flexGrow = "0"; props.flexShrink = "0"; props.flexBasis = "auto";
    } else if (/^\d+(\.\d+)?$/.test(parts[0])) {
      props.flexGrow = parts[0]; props.flexShrink = "1"; props.flexBasis = "0%";
    } else {
      props.flexBasis = parts[0];
    }
  } else if (parts.length >= 2) {
    props.flexGrow = parts[0];
    props.flexShrink = parts[1];
    if (parts[2]) props.flexBasis = parts[2];
  }
}

/** Parse the `border` shorthand: "2px solid #808080" → width, style, color.
 *  Width accepts px, bare numbers (unitless = px), and decimals. */
function parseBorderShorthand(props: CSSProperty, val: string): void {
  const parts = val.trim().split(/\s+/);
  for (const p of parts) {
    const w = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(p);
    if (w) props.borderWidth = `${w[1]}px`;
    else if (["solid", "dashed", "dotted", "double", "none"].includes(p)) props.borderStyle = p;
    // Color: #hex, rgb()/hsl(), a CSS named color, or a var() reference (the
    // token is substituted later by substituteVars, like other properties).
    else if (p.startsWith("#") || p.startsWith("rgb") || p.startsWith("hsl") || p.startsWith("var(") || /^[a-z]+$/i.test(p)) props.borderColor = p;
  }
}

/** Parse a per-side border shorthand (border-left/top/right/bottom) into the
 *  per-side width/style/color fields. Same `<width> <style> <color>` format as
 *  the `border` shorthand. */
function parsePerSideBorder(props: CSSProperty, prop: string, val: string): void {
  const side = prop.slice("border-".length);  // "left" | "top" | "right" | "bottom"
  const cap = side.charAt(0).toUpperCase() + side.slice(1);  // "Left" | "Top" | ...
  const wKey = `border${cap}Width` as keyof CSSProperty;
  const sKey = `border${cap}Style` as keyof CSSProperty;
  const cKey = `border${cap}Color` as keyof CSSProperty;
  const parts = val.trim().split(/\s+/);
  for (const p of parts) {
    const w = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(p);
    if (w) (props[wKey] as string | undefined) = `${w[1]}px`;
    else if (["solid", "dashed", "dotted", "double", "none"].includes(p)) (props[sKey] as string | undefined) = p;
    else if (p.startsWith("#") || p.startsWith("rgb") || p.startsWith("hsl") || p.startsWith("var(") || /^[a-z]+$/i.test(p)) (props[cKey] as string | undefined) = p;
  }
}
