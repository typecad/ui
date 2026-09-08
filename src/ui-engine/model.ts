import type { DisplayProfile } from "@typecad/cuttlefish/api/shared";
import { effectiveDisplaySize } from "@typecad/cuttlefish/api/shared";
import { deriveCapabilities } from "@typecad/cuttlefish/api/shared";
import { resolveColorInternal, isTransparentColor } from "./color.js";
import { parseAnimation, type CSSProperty } from "./css-parser.js";
import type { UIFontAssetModel } from "./font-assets.js";
import { selectFontAssetForStyle, assetTextWidth, assetLineHeight } from "./font-assets.js";
import type { UIImageAsset } from "./image-assets.js";
import { isDisplayNone, type Box } from "./layout-engine.js";
import type { StyledNode } from "./style-resolver.js";
import { whiteSpaceMode } from "./text-layout.js";
import { layoutRuns } from "./rich-layout.js";
import { timingFunctionCode } from "./easing.js";
export {
  easeCurveLerpK,
  TIMING_EASE,
  TIMING_EASE_IN,
  TIMING_EASE_IN_OUT,
  TIMING_EASE_OUT,
  TIMING_LINEAR,
  timingFunctionCode,
} from "./easing.js";

export type UINodeKindModel = "fill" | "text" | "button" | "check" | "radio" | "progress" | "range" | "input" | "img" | "list" | "canvas" | "select";
export type UIPropertyModel = "background" | "color" | "text" | "visible" | "borderColor";

export interface UINodeModel {
  index: number;
  tag: string;
  id?: string;
  classes: string[];
  box: Box;
  bg: number;
  fg: number;
  /** Checked-state color pair baked from :checked rules (RGB565; -1 unset).
   *  Check/radio/select draw paths swap to it when the value flips — the
   *  switch track, checkbox face, radio dot, and the select list's selected
   *  row (shadcn data-[state=checked] theming). */
  checkedBg: number;
  checkedFg: number;
  kind: UINodeKindModel;
  text?: string;
  placeholder?: string;
  valueAttr?: string;
  name?: string;
  checked?: boolean;
  textBuffer: string;
  hasTextBinding: boolean;
  hasBg: boolean;
  textAlign: 0 | 1 | 2;
  textSize: number;       // GFX text size: 1-4 (from font-size + font-weight)
  lineHeight: number;     // px between text baselines/lines (0 = default)
  letterSpacing: number;  // px between chars (0 = default)
  fontAntialias: boolean; // true = smooth text edges when UI_AA is compiled
  fontFace: number;       // 0 = classic GFX bitmap font; otherwise UIFontAsset id
  borderColor: number;
  borderStyle: 0 | 1 | 2;
  borderWidth: number;
  /** Per-side border widths. When all four equal borderWidth, the runtime draws
   *  the uniform rect outline; when any differs, it draws per-side lines. */
  borderTopWidth: number;
  borderRightWidth: number;
  borderBottomWidth: number;
  borderLeftWidth: number;
  borderRadius: number;  // px, 0=square
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  gradientEnabled: number;  // 0=none, 1=vertical, 2=horizontal
  gradientColor1: number;   // resolved RGB565 (top/left stop)
  gradientColor2: number;   // resolved RGB565 (bottom/right stop)
  outlineColor: number;
  outlineStyle: 0 | 1 | 2;
  outlineWidth: number;
  zIndex: number;       // effective draw layer; higher draws later
  transformOffsetX: number;
  transformOffsetY: number;
  rotateDeg: number;
  pressedOffsetX: number;
  pressedOffsetY: number;
  shadowCount: number;                    // 0-4 active shadows
  shadowOffsetX: number[];                // [4]
  shadowOffsetY: number[];
  shadowBlur: number[];
  shadowColor: number[];
  shadowAlpha: number[];
  shadowInset: boolean[];
  // Text shadow (single shadow for text elements)
  textShadowCount: number;        // 0-1
  textShadowOffsetX: number;
  textShadowOffsetY: number;
  textShadowBlur: number;
  textShadowColor: number;        // resolved RGB565
  textShadowAlpha: number;
  underline: number;   // text-decoration: 0=none, 1=underline, 2=line-through, 3=both
  textOverflow: boolean; // text-overflow: ellipsis (true = truncate + ...)
  nowrap: boolean;       // white-space: nowrap (true = no wrapping, the default)
  whiteSpaceMode: 0 | 1 | 2 | 3; // 0=normal, 1=nowrap, 2=pre, 3=pre-line
  visible: boolean;
  /** HTML disabled attribute: blocks taps/keyboard and dims the control. */
  disabled: boolean;
  /** <drawer side>: 0=bottom 1=top 2=left 3=right; -1 = not a drawer. */
  drawerSide: number;
  /** <toast duration>: ms before auto-close (0 = manual close only). */
  toastDuration: number;
  /** Visibility-reflow axis (device): 0 none, 1 column, 2 row. */
  flowAxis: number;
  /** Visibility-reflow: main-axis gap between in-flow children (px, 0-255). */
  flowGap: number;
  /** Visibility-reflow flags: bit0 auto height, bit1 auto width, bit2 out-of-flow. */
  flowFlags: number;
  opacity: number;       // 0-100
  clearColor: number;
  lastTextWidth: number;
  lastTextHeight: number;
  dirty: boolean;
  value: number;
  options?: Array<{ value: string; text: string }>;
  scrollable: boolean;
  scrollY: number;
  contentHeight: number;
  /** Elastic excursion past a scroll boundary (0 in-bounds; +top, -bottom). */
  overscrollPx: number;
  /** True while a bounce-back / edge-snap settle animation is running. */
  settling: boolean;
  /** scrollY captured at the last container repaint (Mode B shift delta). */
  lastPaintedScrollY: number;
  rangeMin: number;
  rangeMax: number;
  /** For <input>: max character length (0 = use UI_TEXT_BUF). */
  maxlen: number;
  /** For <input>: text or number keyboard. */
  inputType?: "text" | "number";
  /** For <input>: custom keyboard template id. */
  keyboard?: string;
  parentIndex: number;
  subtreeEnd: number;
  screenId: number;
  imgDataId: number;  // index into image table (255 = no image)
  objectFit: 0 | 1 | 2 | 3 | 4;  // 0=none, 1=fill, 2=contain, 3=cover, 4=scale-down
  listItemHeight: number;  // px per item (for <list>, 0 = not a list)
  /** Children are produced by callbacks (virtualized), not static nodes. Set for <list>. */
  virtualized: boolean;
  /** Canvas buffer width in pixels (for kind "canvas"). */
  canvasW: number;
  /** Canvas buffer height in pixels (for kind "canvas"). */
  canvasH: number;
  /** Rich-text runs. Present only for text nodes with mixed inline content;
   *  absent for plain single-string text nodes. When present, the runs are the
   *  node's content and `text` is empty. */
  runs?: UITextRunModel[];
  /** Precomputed wrapped-line geometry for rich-text runs (struct-of-arrays).
   *  The parallel arrays are indexed together; segment i is
   *  (segRun[i], segText[i], segX[i], segW[i], segLine[i]). Baked at lower time
   *  because runs are static-content only (no runtime re-flow). */
  runLines?: RunLines;
}

/** One rich-text run in lowered form: a piece of styled inline text with all
 *  style fields pre-resolved to their runtime representations. */
export interface UITextRunModel {
  text: string;
  /** Resolved RGB565/mono foreground color. */
  fg: number;
  /** GFX text size 1-4 (from run font-size + font-weight). */
  textSize: number;
  /** Font asset id (0 = classic GFX bitmap font). */
  fontFace: number;
  /** text-decoration: 0=none, 1=underline, 2=line-through, 3=both. */
  underline: number;
  /** Letter spacing in px. */
  letterSpacing: number;
  /** Resolved screen index for an <a href> run, or -1 if not a link. */
  linkTarget: number;
}

/** Precomputed wrapped-line geometry for a rich-text node, as parallel arrays
 *  (mirrors how the C++ runtime emits them). Segment arrays are indexed
 *  together; each segment belongs to the line given by its segLine entry. */
export interface RunLines {
  segRun: number[];      // runIndex per segment
  segText: string[];     // segment text
  segX: number[];        // segment x offset within its line (pre-alignment)
  segW: number[];        // segment measured width
  segLine: number[];     // which line each segment is on
  lineY: number[];       // top y of each line
  lineH: number[];       // height of each line
  lineBaseline: number[];// baseline y of each line
  lineW: number[];       // total width of each line (for alignment)
}

export interface UITransitionModel {
  node: number;
  prop: "background" | "color";
  durationMs: number;
  pressedTarget: number;
  baseTarget: number;
  elapsed: number;
  prevValue: number;
  targetValue: number;
  active: boolean;
}

export interface KeyframeStopModel {
  percent: number;
  props: number;    // bitmask: 1=background, 2=color, 4=opacity, 8=transform, 16=size
  bg: number;      // resolved RGB565 (0 = use node's current bg)
  fg: number;      // resolved RGB565
  opacity: number; // 0-100
  transformOffsetX: number;
  transformOffsetY: number;
  translatePctX: number; // percent of the animated node's base width
  translatePctY: number; // percent of the animated node's base height
  scaleX: number;        // percent, 100 = identity
  scaleY: number;        // percent, 100 = identity
  rotateDeg: number;
  width: number;
  height: number;
}

export const KEYFRAME_PROP_BG = 1;
export const KEYFRAME_PROP_FG = 2;
export const KEYFRAME_PROP_OPACITY = 4;
export const KEYFRAME_PROP_TRANSFORM = 8;
export const KEYFRAME_PROP_SIZE = 16;

export interface KeyframeSetModel {
  name: string;
  stops: KeyframeStopModel[];
}

export interface AnimationModel {
  node: number;
  keyframeSet: number;   // index into keyframeSets
  durationMs: number;
  delayMs: number;
  iterations: number;    // -1 = infinite
  baseWidth: number;
  baseHeight: number;
  originX: number;       // percent, 0=left, 50=center, 100=right
  originY: number;       // percent, 0=top, 50=center, 100=bottom
  timingFunction: number;  // TIMING_* code (applied to the lerp factor between stops)
}

export interface UIProgram {
  width: number;
  height: number;
  colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono";
  display?: DisplayProfile;
  fontAssets: UIFontAssetModel[];
  imageAssets: UIImageAsset[];
  nodes: UINodeModel[];
  transitions: UITransitionModel[];
  keyframeSets: KeyframeSetModel[];
  animations: AnimationModel[];
}

type ColorFormat = "rgb565" | "rgb666" | "rgb888" | "mono";

interface FlatModelSource {
  index: number;
  node: StyledNode;
  box: Box;
  hasBg: boolean;
  clearColor?: string;
  parentIndex: number;
  subtreeEnd: number;
  screenId: number;
  zIndex: number;
  effectiveOpacity: number;
}

function nodeKind(tag: string): UINodeKindModel {
  if (tag === "screen" || tag === "view" || tag === "drawer" || tag === "dialog" || tag === "toast") return "fill";
  if (tag === "button") return "button";
  if (tag === "check") return "check";
  if (tag === "radio") return "radio";
  if (tag === "progress") return "progress";
  if (tag === "range") return "range";
  if (tag === "input") return "input";
  if (tag === "img") return "img";
  if (tag === "list") return "list";
  if (tag === "canvas") return "canvas";
  if (tag === "select") return "select";
  return "text";
}

function intAttr(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function initialValueOf(node: StyledNode, kind: UINodeKindModel, rangeMin: number, rangeMax: number): number {
  if (kind === "radio") return node.checked ? 1 : 0;
  if (kind === "range") {
    const parsed = intAttr(node.value, rangeMin);
    const value = rangeMax > rangeMin ? clampNumber(parsed, rangeMin, rangeMax) : parsed;
    return clampInt16(value);
  }
  if (kind === "progress") return clampNumber(intAttr(node.value, 0), 0, 100);
  return 0;
}

function textAlign(style: CSSProperty): 0 | 1 | 2 {
  if (style.textAlign === "center") return 1;
  if (style.textAlign === "right") return 2;
  return 0;
}

function borderStyle(style: CSSProperty): 0 | 1 | 2 {
  if (style.borderStyle === "solid") return 1;
  if (style.borderStyle === "dashed" || style.borderStyle === "dotted") return 2;
  if (style.borderStyle === "none") return 0;
  if (style.border || style.borderWidth) return 1;
  return 0;
}

function borderWidthOf(style: CSSProperty): number {
  // A none-style border renders nothing and must consume no space either:
  // the draw path subtracts borderWidth*2 from the text max width, so a
  // residual UA width on a borderless kit button wrapped its last glyph
  // ("Primar" / "y"). Style none wins over any declared width.
  if (borderStyle(style) === 0) return 0;
  const px = cssPx(style.borderWidth);
  if (px > 0) return Math.max(1, Math.min(8, px));
  return 1;
}

/** Per-side border width: the per-side field wins when set, else falls back to
 *  the uniform borderWidth. Used for border-left/top/right/bottom support. */
function perSideBorderWidth(style: CSSProperty, sideWidth: string | undefined, sideStyle: string | undefined): number {
  // Per-side style "none" forces 0 for this side.
  if (sideStyle === "none") return 0;
  if (sideWidth !== undefined) {
    const px = cssPx(sideWidth);
    if (px > 0) return Math.max(1, Math.min(8, px));
    // sideWidth set but 0px and style isn't none → default to 1 if a style was given.
    return sideStyle !== undefined ? 1 : 0;
  }
  // No per-side width: fall back to the uniform border width when the per-side
  // style is set (author wrote e.g. border-top: solid → inherit uniform width).
  if (sideStyle !== undefined) return borderWidthOf(style);
  return borderWidthOf(style);
}

/** Parse border-radius px value (0 if absent). */
/** Map CSS text-decoration to the runtime enum.
 *  0=none, 1=underline, 2=line-through, 3=both. */
function textDecorationOf(val: string | undefined): number {
  if (!val) return 0;
  const v = val.toLowerCase();
  const hasU = /underline/.test(v);
  const hasS = /line-through/.test(v) || /strikethrough/.test(v);
  return (hasU && hasS) ? 3 : hasS ? 2 : hasU ? 1 : 0;
}

/** text-overflow: ellipsis -> true. clip/absent -> false. */
function textOverflowOf(val: string | undefined): boolean {
  return !!val && /ellipsis/.test(val.toLowerCase());
}

function borderRadiusOf(style: CSSProperty): number {
  if (!style.borderRadius) return 0;
  const px = parseInt(style.borderRadius, 10);
  // Clamp at 0: kit recipes like `calc(var(--radius) - 2px)` go negative for
  // 0px-radius themes (tweakcn's sharper exports) — a negative radius is both
  // meaningless and a uint8 narrowing error in the emitted node table.
  if (isNaN(px) || px < 0) return 0;
  return Math.min(255, px);
}

function paddingOf(style: CSSProperty): { top: number; right: number; bottom: number; left: number } {
  if (!style.padding) return { top: 0, right: 0, bottom: 0, left: 0 };
  const parts = style.padding.trim().split(/\s+/).filter(Boolean).map(cssPx);
  const top = parts[0] ?? 0;
  const right = parts.length > 1 ? parts[1] : top;
  const bottom = parts.length > 2 ? parts[2] : top;
  const left = parts.length > 3 ? parts[3] : right;
  return {
    top: Math.max(0, Math.min(255, top)),
    right: Math.max(0, Math.min(255, right)),
    bottom: Math.max(0, Math.min(255, bottom)),
    left: Math.max(0, Math.min(255, left)),
  };
}

/** Parse letter-spacing px value (0 if absent). */
function letterSpacingOf(style: CSSProperty): number {
  if (!style.letterSpacing) return 0;
  const px = parseInt(style.letterSpacing, 10);
  return isNaN(px) ? 0 : px;
}

function lineHeightOf(style: CSSProperty, textSize: number): number {
  const base = Math.max(1, textSize || 2) * 8;
  const raw = style.lineHeight?.trim();
  if (!raw || raw === "normal") return base;
  if (raw.endsWith("%")) {
    const pct = parseFloat(raw);
    return Number.isFinite(pct) ? Math.max(1, Math.min(255, Math.round(base * pct / 100))) : base;
  }
  if (/^-?\d*\.?\d+$/.test(raw)) {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(1, Math.min(255, Math.round(base * n))) : base;
  }
  const px = parseInt(raw, 10);
  return Number.isFinite(px) && px > 0 ? Math.max(1, Math.min(255, px)) : base;
}

/** Parse object-fit value: none | fill | contain | cover | scale-down. */
function objectFitOf(value: string): 0 | 1 | 2 | 3 | 4 {
  const v = value.trim().toLowerCase();
  if (v === "none") return 0;
  if (v === "fill") return 1;
  if (v === "contain") return 2;
  if (v === "cover") return 3;
  if (v === "scale-down") return 4;
  return 1; // default: fill
}

function whiteSpaceModeOf(style: CSSProperty): 0 | 1 | 2 | 3 {
  switch (whiteSpaceMode(style.whiteSpace)) {
    case "nowrap": return 1;
    case "pre": return 2;
    case "pre-line": return 3;
    default: return 0;
  }
}

function zIndexOf(style: CSSProperty): number {
  const raw = style.zIndex?.trim();
  if (!raw || raw === "auto") return 0;
  const z = parseInt(raw, 10);
  return Number.isFinite(z) ? Math.max(-32768, Math.min(32767, z)) : 0;
}

interface OutlineSpec { width: number; style: 0 | 1 | 2; color?: string; }
function outlineOf(style: CSSProperty): OutlineSpec {
  const raw = style.outline?.trim();
  if (!raw || raw === "none") return { width: 0, style: 0 };

  let width = 1;
  let outlineStyle: 0 | 1 | 2 = 1;
  let color: string | undefined;
  const parts = raw.split(/\s+/);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (/^\d+(?:\.\d+)?(?:px)?$/.test(lower)) {
      width = Math.max(1, Math.min(8, cssPx(lower)));
    } else if (lower === "solid") {
      outlineStyle = 1;
    } else if (lower === "dashed" || lower === "dotted") {
      outlineStyle = 2;
    } else if (lower === "none") {
      return { width: 0, style: 0 };
    } else {
      color = part;
    }
  }

  return { width, style: outlineStyle, color };
}

export function cssPx(value: string | undefined): number {
  if (!value) return 0;
  const m = /(-?\d+(?:\.\d+)?)/.exec(value);
  return m ? Math.round(Number(m[1])) : 0;
}

export function clampInt8(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-128, Math.min(127, Math.round(n)));
}

export function clampInt16(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(n)));
}

function splitTransformArgs(args: string): string[] {
  return args
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface ParsedTransform {
  x: number;
  y: number;
  pctX: number;
  pctY: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
}

function parseLengthOrPercent(value: string | undefined): { px: number; pct: number } {
  if (!value) return { px: 0, pct: 0 };
  const trimmed = value.trim();
  const m = /^(-?\d+(?:\.\d+)?)(%)?$/.exec(trimmed);
  if (m?.[2]) return { px: 0, pct: Math.round(Number(m[1])) };
  return { px: cssPx(trimmed), pct: 0 };
}

function parseScale(value: string | undefined): number {
  if (!value) return 100;
  const trimmed = value.trim();
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) return 100;
  const pct = trimmed.endsWith("%") ? n : n * 100;
  return Math.max(0, Math.min(400, Math.round(pct)));
}

function parseAngleDeg(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim().toLowerCase();
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) return 0;
  if (trimmed.endsWith("turn")) return Math.round(n * 360);
  if (trimmed.endsWith("rad")) return Math.round(n * 180 / Math.PI);
  return Math.round(n);
}

export function parseTransform(transform: string | undefined): ParsedTransform {
  const parsed: ParsedTransform = { x: 0, y: 0, pctX: 0, pctY: 0, scaleX: 100, scaleY: 100, rotateDeg: 0 };
  if (!transform) return parsed;

  const fnRe = /([a-zA-Z][\w-]*)\(\s*([^)]*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(transform)) !== null) {
    const fn = m[1].toLowerCase();
    const args = splitTransformArgs(m[2]);
    if (fn === "translate" || fn === "translate3d") {
      const x = parseLengthOrPercent(args[0]);
      const y = parseLengthOrPercent(args[1]);
      parsed.x += x.px;
      parsed.pctX += x.pct;
      parsed.y += y.px;
      parsed.pctY += y.pct;
    } else if (fn === "translatex") {
      const x = parseLengthOrPercent(args[0]);
      parsed.x += x.px;
      parsed.pctX += x.pct;
    } else if (fn === "translatey") {
      const y = parseLengthOrPercent(args[0]);
      parsed.y += y.px;
      parsed.pctY += y.pct;
    } else if (fn === "scale" || fn === "scale3d") {
      const sx = parseScale(args[0]);
      const sy = args[1] ? parseScale(args[1]) : sx;
      parsed.scaleX = Math.round(parsed.scaleX * sx / 100);
      parsed.scaleY = Math.round(parsed.scaleY * sy / 100);
    } else if (fn === "scalex") {
      parsed.scaleX = Math.round(parsed.scaleX * parseScale(args[0]) / 100);
    } else if (fn === "scaley") {
      parsed.scaleY = Math.round(parsed.scaleY * parseScale(args[0]) / 100);
    } else if (fn === "rotate" || fn === "rotatez") {
      parsed.rotateDeg += parseAngleDeg(args[0]);
    }
  }

  parsed.scaleX = Math.max(0, Math.min(400, parsed.scaleX));
  parsed.scaleY = Math.max(0, Math.min(400, parsed.scaleY));
  parsed.rotateDeg = clampInt16(parsed.rotateDeg);
  return parsed;
}

export function transformOffset(transform: string | undefined): { x: number; y: number } {
  const parsed = parseTransform(transform);
  return { x: parsed.x, y: parsed.y };
}

function originTokenPercent(token: string | undefined, axis: "x" | "y"): number | undefined {
  if (!token) return undefined;
  const lower = token.trim().toLowerCase();
  if (lower === "center") return 50;
  if (axis === "x") {
    if (lower === "left") return 0;
    if (lower === "right") return 100;
  } else {
    if (lower === "top") return 0;
    if (lower === "bottom") return 100;
  }
  const m = /^(-?\d+(?:\.\d+)?)%$/.exec(lower);
  if (!m) return undefined;
  return Math.max(0, Math.min(100, Math.round(Number(m[1]))));
}

function isVerticalOriginToken(token: string | undefined): boolean {
  const lower = token?.trim().toLowerCase();
  return lower === "top" || lower === "bottom";
}

function isHorizontalOriginToken(token: string | undefined): boolean {
  const lower = token?.trim().toLowerCase();
  return lower === "left" || lower === "right";
}

export function transformOriginPercent(value: string | undefined): { x: number; y: number } {
  if (!value) return { x: 50, y: 50 };
  const tokens = splitTransformArgs(value.replace(/\//g, " ")).slice(0, 2);
  if (tokens.length === 0) return { x: 50, y: 50 };
  if (tokens.length === 1) {
    if (isVerticalOriginToken(tokens[0])) return { x: 50, y: originTokenPercent(tokens[0], "y") ?? 50 };
    return { x: originTokenPercent(tokens[0], "x") ?? 50, y: 50 };
  }
  if (isVerticalOriginToken(tokens[0]) || isHorizontalOriginToken(tokens[1])) {
    return {
      x: originTokenPercent(tokens[1], "x") ?? 50,
      y: originTokenPercent(tokens[0], "y") ?? 50,
    };
  }
  return {
    x: originTokenPercent(tokens[0], "x") ?? 50,
    y: originTokenPercent(tokens[1], "y") ?? 50,
  };
}

function transformedBox(base: Box, transform: ParsedTransform, origin: { x: number; y: number }): { box: Box; x: number; y: number } {
  const scaledW = Math.max(0, Math.min(32767, Math.round(base.w * transform.scaleX / 100)));
  const scaledH = Math.max(0, Math.min(32767, Math.round(base.h * transform.scaleY / 100)));
  const originPxX = Math.round(base.w * origin.x / 100);
  const originPxY = Math.round(base.h * origin.y / 100);
  const scaleOffsetX = originPxX - Math.round(originPxX * transform.scaleX / 100);
  const scaleOffsetY = originPxY - Math.round(originPxY * transform.scaleY / 100);
  const pctOffsetX = Math.round(base.w * transform.pctX / 100);
  const pctOffsetY = Math.round(base.h * transform.pctY / 100);
  return {
    box: { ...base, w: scaledW, h: scaledH },
    x: transform.x + pctOffsetX + scaleOffsetX,
    y: transform.y + pctOffsetY + scaleOffsetY,
  };
}

function pressedOffsetOf(style: CSSProperty): { x: number; y: number } {
  const pressed = (style as CSSProperty & { pressed?: CSSProperty }).pressed;
  if (!pressed) return { x: 0, y: 0 };

  let x = 0;
  let y = 0;
  if (pressed.left) x += cssPx(pressed.left) - cssPx(style.left);
  else if (pressed.right) x -= cssPx(pressed.right) - cssPx(style.right);
  if (pressed.top) y += cssPx(pressed.top) - cssPx(style.top);
  else if (pressed.bottom) y -= cssPx(pressed.bottom) - cssPx(style.bottom);

  if (pressed.transform) {
    const baseTransform = parseTransform(style.transform);
    const pressedTransform = parseTransform(pressed.transform);
    x += pressedTransform.x - baseTransform.x;
    y += pressedTransform.y - baseTransform.y;
  }

  return {
    x: clampInt8(x),
    y: clampInt8(y),
  };
}

/** Parse box-shadow into up to 4 shadow specs. Handles multi-shadow
 *  (comma-separated) and the `inset` keyword.
 *  Format per shadow: [inset] offsetX offsetY [blur] [spread] color. */
const MAX_SHADOWS = 4;
interface ShadowSpec { x: number; y: number; blur: number; color: number; alpha: number; inset: boolean; }
function parseBoxShadow(style: CSSProperty, format: ColorFormat): ShadowSpec[] {
  const raw = style.boxShadow;
  if (!raw || raw === "none") return [];
  // Split on commas that are NOT inside parentheses (so rgba(0,0,0,0.5) isn't split).
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "(") depth++;
    else if (raw[i] === ")") depth--;
    else if (raw[i] === "," && depth === 0) { parts.push(raw.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(raw.slice(start).trim());

  const specs: ShadowSpec[] = [];
  for (const part of parts) {
    if (specs.length >= MAX_SHADOWS) break;
    const inset = /\binset\b/i.test(part);
    // Split into a numbers zone (offset/blur) and a color zone. The color
    // zone starts at the first # hex, rgb(, rgba(, or color name. css-tree
    // may strip spaces between values, so we can't rely on whitespace split.
    const colorStart = part.search(/#|rgba?\(|hsla?\(|\b(?:black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|cyan|magenta|silver|gold|brown|tan|navy|teal|maroon|lime|olive|aqua|fuchsia|transparent)\b/i);
    const numZone = colorStart >= 0 ? part.slice(0, colorStart) : part;
    const colorZone = colorStart >= 0 ? part.slice(colorStart) : "";

    // Extract numbers from the numeric zone only (safe — no hex digits here).
    const numTokens: number[] = [];
    const numRe = /(-?\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = numRe.exec(numZone)) !== null) numTokens.push(parseInt(m[1], 10));
    if (numTokens.length < 2) continue;
    const x = numTokens[0];
    const y = numTokens[1];
    const blur = numTokens.length >= 3 ? Math.max(0, Math.min(numTokens[2], 8)) : 0;

    // Resolve color from the color zone.
    let color = 0x0000;
    let alpha = 100;
    if (colorZone) {
      // Extract alpha from rgba(r,g,b,a) comma OR hsl(... / a) slash syntax.
      const alphaM = /(?:rgba?\([^,]*,[^,]*,[^,]*,\s*([\d.]+)\s*\)|hsla?\([^)]*\/\s*([\d.]+)\s*\))/.exec(colorZone);
      if (alphaM) {
        alpha = Math.round(parseFloat(alphaM[1] ?? alphaM[2]) * 100);
        alpha = Math.max(0, Math.min(100, alpha));
      }
      try { color = resolveColorInternal(colorZone, format); } catch { color = 0x0000; }
    }
    specs.push({ x, y, blur, color, alpha, inset });
  }
  return specs;
}

/** Parse opacity (0-100, default 100). */
function opacityOf(style: CSSProperty): number {
  if (!style.opacity) return 100;
  return cssOpacityToPercent(style.opacity);
}

export function cssOpacityToPercent(value: string | undefined): number {
  if (!value) return 100;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 100;
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  return Math.max(0, Math.min(100, pct));
}

/** Parse a linear-gradient background into 2 color stops + direction.
 *  Returns null for solid colors or unsupported gradients. */
interface GradientSpec { dir: 1 | 2; color1: number; color2: number; }

/** Extract the first color string from a linear-gradient(...) value.
 *  Used by flatten() to pass a valid color string as clearColor/parentBg. */
function extractFirstGradientColor(bg: string): string | undefined {
  const innerM = /linear-gradient\(\s*([^)]+)\)/.exec(bg);
  if (!innerM) return undefined;
  const colorRe = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-z]+/gi;
  let cm: RegExpExecArray | null;
  while ((cm = colorRe.exec(innerM[1])) !== null) {
    if (!["to", "linear", "bottom", "top", "left", "right"].includes(cm[0])) return cm[0];
  }
  return undefined;
}

function parseGradient(bg: string | undefined, format: ColorFormat): GradientSpec | null {
  if (!bg || !bg.includes("linear-gradient")) return null;
  // Extract the content inside linear-gradient(...).
  const innerM = /linear-gradient\(\s*([^)]+)\)/.exec(bg);
  if (!innerM) return null;
  const inner = innerM[1];
  // Extract color stops: match #hex, rgb(), rgba(), or named colors.
  const colorRe = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-z]+/gi;
  const colors: string[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = colorRe.exec(inner)) !== null) {
    if (!["to", "linear", "bottom", "top", "left", "right"].includes(cm[0])) colors.push(cm[0]);
  }
  if (colors.length < 2) return null;
  // Direction: "to bottom" = vertical (1), "to right" = horizontal (2).
  // Default to vertical if not specified.
  let dir: 1 | 2 = 1;
  if (/to\s+right/i.test(inner) || /to\s+left/i.test(inner)) dir = 2;
  return {
    dir,
    color1: resolveColorInternal(colors[0], format),
    color2: resolveColorInternal(colors[1], format),
  };
}

/** Map font-size (px) to a GFX text size (1-4).
 *  ≤12px→1, 13-20px→2, 21-28px→3, 29+→4.
 *
 *  font-weight no longer inflates the bucket: matching web behavior, bold only
 *  affects glyph stroke weight (via the chosen @font-face), not the rendered
 *  glyph size. Previously bold added 1 to the bucket, which made <h3> labels
 *  render larger than their declared font-size and surprised authors. */
function textSizeOf(style: CSSProperty): number {
  let size = 2;  // default
  if (style.fontSize) {
    const px = parseInt(style.fontSize, 10);
    if (!isNaN(px)) {
      if (px <= 12) size = 1;
      else if (px <= 20) size = 2;
      else if (px <= 28) size = 3;
      else size = 4;
    }
  }
  return size;
}

function fontAntialiasOf(style: CSSProperty, display?: DisplayProfile): boolean {
  if (display?.colorFormat === "mono") return false;
  const smoothing = style.fontSmoothing?.toLowerCase();
  if (smoothing) {
    if (smoothing.includes("antialiased") || smoothing.includes("smooth") || smoothing.includes("grayscale")) {
      return true;
    }
    if (smoothing.includes("none") || smoothing.includes("aliased") || smoothing.includes("pixel")) {
      return false;
    }
  }
  // Explicit profile.antialias === false still wins for back-compat (existing
  // configs). Otherwise derive from capabilities: TFT default true, eink false.
  if (display?.antialias === false) return false;
  return deriveCapabilities(display ?? { width: 0, height: 0, colorFormat: "rgb565" }).features.antialias;
}

function fontFaceOf(style: CSSProperty, fontAssets: UIFontAssetModel[]): number {
  const match = selectFontAssetForStyle(fontAssets, style);
  return match?.id ?? 0;
}

/** Apply text-transform (uppercase/lowercase/capitalize) to a static string. */
function applyTextTransform(text: string | undefined, style: CSSProperty): string | undefined {
  if (!text) return text;
  switch (style.textTransform) {
    case "uppercase": return text.toUpperCase();
    case "lowercase": return text.toLowerCase();
    case "capitalize":
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default: return text;
  }
}

/** Default-font (Adafruit GFX bitmap) advance width for a string: 6*textSize
 *  per character plus the per-character letter spacing. Used when a run has no
 *  matching custom @font-face asset (mirrors layout-engine.ts textWidthOf). */
function textWidthOfDefault(text: string, textSize: number, letterSpacing: number): number {
  const advance = 6 * textSize + letterSpacing;
  let w = 0;
  for (const _ch of text) w += advance;
  return w;
}

function firstListValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim();
}

function animationDeclOf(style: CSSProperty) {
  const shorthand = firstListValue(style.animation);
  if (shorthand) {
    const decl = parseAnimation(shorthand);
    // Shorthand resets all longhands; if it omitted timing-function, fall back
    // to the explicit longhand (or default linear).
    if (decl && !decl.timingFunction && style.animationTimingFunction) {
      decl.timingFunction = style.animationTimingFunction;
    }
    return decl;
  }
  const name = firstListValue(style.animationName);
  if (!name || name === "none") return null;
  const decl = parseAnimation([
    name,
    firstListValue(style.animationDuration),
    firstListValue(style.animationIterationCount),
    firstListValue(style.animationDelay),
  ].filter(Boolean).join(" "));
  if (decl && style.animationTimingFunction) decl.timingFunction = style.animationTimingFunction;
  return decl;
}

function flatten(
  node: StyledNode,
  boxes: Box[],
  out: FlatModelSource[],
  cursor: { i: number },
  parentBg: string | undefined,
  parentIndex: number = -1,
  screenId: number = 0,
  parentZIndex: number = 0,
  parentOpacity: number = 100,
): void {
  const index = cursor.i++;
  const box = boxes[index] ?? { x: 0, y: 0, w: 0, h: 0 };
  // `background: transparent` (or alpha-0) means NO fill — the parent's
  // background shows through, matching browsers. (It used to paint black.)
  const bgStr = node.style.background;
  const bgIsGradient = bgStr !== undefined && bgStr.includes("linear-gradient");
  const hasBg = bgStr !== undefined && !bgIsGradient ? !isTransparentColor(bgStr) : !!bgStr;
  // If background is a gradient, extract the first color stop as the base
  // clearColor string (avoids resolveColor choking on "linear-gradient(...)").
  const bgBaseColor = bgIsGradient ? extractFirstGradientColor(bgStr!) : bgStr;
  const clearColor = hasBg ? bgBaseColor : parentBg;
  const zIndex = Math.max(-32768, Math.min(32767, parentZIndex + zIndexOf(node.style)));
  // Opacity compounds down the tree: a child's effective opacity is its own
  // value scaled by the parent's effective opacity (50% parent × 100% child = 50%).
  const ownOpacity = opacityOf(node.style);
  const effectiveOpacity = Math.round((parentOpacity * ownOpacity) / 100);
  out.push({ index, node, box, hasBg, clearColor, parentIndex, subtreeEnd: index + 1, screenId, zIndex, effectiveOpacity });

  // For opaque nodes, children clear/redraw against this node's own fill
  // (the normal case). For translucent nodes, children must clear against the
  // same BACKDROP this node blends toward (parentBg) — otherwise a child text
  // node repaints a solid block of the (translucent) parent's raw fill around
  // its glyphs, making the area around the text look opaque.
  const childParentBg = (effectiveOpacity < 100) ? parentBg : (hasBg ? bgBaseColor : parentBg);
  // Iterate children in the same order sequence the flex engine lays them out
  // (the yoga binding can't apply order, so yoga-layout sorts children by order
  // first). flatten must match that order so each node pairs with its box.
  const orderNum = (v: string | undefined) => {
    const n = parseInt(String(v ?? "0"), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const orderedChildren = node.children.slice().sort((a, b) => orderNum(a.style.order) - orderNum(b.style.order));
  for (const child of orderedChildren) {
    flatten(child, boxes, out, cursor, childParentBg, index, screenId, zIndex, effectiveOpacity);
  }
  out[index].subtreeEnd = cursor.i;
}

export function lowerUIToModel(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  display?: DisplayProfile,
  fontAssets: UIFontAssetModel[] = [],
  allScreens: StyledNode[] = [],
  imageAssetIds: Map<string, number> = new Map(),
  keyframeSets: KeyframeSetModel[] = [],
  imageAssets: UIImageAsset[] = [],
): UIProgram {
  const flat: FlatModelSource[] = [];
  const cursor = { i: 0 };
  if (allScreens.length > 0) {
    for (let s = 0; s < allScreens.length; s++) {
      flatten(allScreens[s], boxes, flat, cursor, undefined, -1, s);
    }
    } else {
      flatten(root, boxes, flat, cursor, undefined);
    }

  // Build a screen-id → screen-index map for resolving <a href="#screenId">
  // runs to their target screen index. Screens are indexed by their position in
  // allScreens; their id attribute names them. Built once here so each run's
  // linkTarget can be resolved without crossing into the ir/ layer.
  const screenIdToIndex = new Map<string, number>();
  allScreens.forEach((s, i) => {
    if (s.id) screenIdToIndex.set(s.id, i);
  });

  // Raw flex direction per node index (pre-order, parents first) — the
  // visibility-reflow flags use the parent's direction to decide cross-axis
  // stretch vs content sizing (see the flowAxis/flowFlags IIFE below).
  const flowDirByIndex: number[] = [];

  const nodes = flat.map(({ index, node, box, hasBg, clearColor, parentIndex, subtreeEnd, screenId, zIndex, effectiveOpacity }): UINodeModel => {
    // If background is a gradient, use the first stop as the base bg color
    // (the runtime draws the actual gradient per-row on top of this).
    const grad = parseGradient(node.style.background, colorFormat);
    const bg = node.style.background
      ? (grad ? grad.color1 : resolveColorInternal(node.style.background, colorFormat))
      : 0;
    const fg = node.style.color ? resolveColorInternal(node.style.color, colorFormat) : 0xffff;
    // Checked-state pair from :checked rules (e.g. the kit's switch/checkbox/
    // radio primary pair, the select list's accent pair). -1 = unset.
    const checkedStyle = (node.style as CSSProperty & { checked?: CSSProperty }).checked;
    const checkedBg = checkedStyle && checkedStyle.background
      ? resolveColorInternal(checkedStyle.background, colorFormat)
      : -1;
    const checkedFg = checkedStyle && checkedStyle.color
      ? resolveColorInternal(checkedStyle.color, colorFormat)
      : -1;
    // Border color defaults to currentColor (the node's resolved text color),
    // matching browsers — `border: 1px solid` on a white-on-dark theme gets a
    // white border, not a hardcoded black one.
    const bColor = node.style.borderColor ? resolveColorInternal(node.style.borderColor, colorFormat) : fg;
    const clear = clearColor ? resolveColorInternal(clearColor, colorFormat) : 0;
    const outline = outlineOf(node.style);
    const outlineColor = outline.color ? resolveColorInternal(outline.color, colorFormat) : fg;
    const baseTransform = parseTransform(node.style.transform);
    const transformOrigin = transformOriginPercent(node.style.transformOrigin);
    const baseTransformOffset = transformedBox(box, baseTransform, transformOrigin);
    const pressedOffset = pressedOffsetOf(node.style);
    const textSize = textSizeOf(node.style);
    const wsMode = whiteSpaceModeOf(node.style);
    const kind = nodeKind(node.tag);
    const rangeMin = intAttr(node.min, 0);
    const rangeMax = intAttr(node.max, 100);
    const value = initialValueOf(node, kind, rangeMin, rangeMax);

    // Rich-text runs: build the run model + precomputed line geometry. Only
    // text nodes with mixed inline content carry runs; all other nodes (and
    // plain single-string text nodes) leave runs/runLines undefined.
    let runsModel: UITextRunModel[] | undefined;
    let runLinesModel: RunLines | undefined;
    if (node.runs && node.runs.length > 0) {
      // Per-run resolved style = node style + run style (run overrides).
      const runStyleOf = (r: { style: Partial<CSSProperty> }): CSSProperty =>
        ({ ...node.style, ...r.style }) as CSSProperty;
      // Build layoutRuns input: each run measured at its own font/size advance.
      const layoutInput = node.runs.map(r => {
        const rs = runStyleOf(r);
        const rTextSize = textSizeOf(rs);
        const rLetterSpacing = letterSpacingOf(rs);
        const rAssetH = assetLineHeight(rs, fontAssets);
        return {
          text: applyTextTransform(r.text, rs) ?? "",
          hardBreak: r.hardBreak,
          // Per-glyph asset advance when the run has a custom font, else the
          // flat 6*textSize + letterSpacing per-char default-font advance.
          measureText: (s: string) =>
            assetTextWidth(s, rs, fontAssets) ?? textWidthOfDefault(s, rTextSize, rLetterSpacing),
          // Asset lineHeight when the run has a custom font, else 8*textSize.
          // Must match layout-engine.ts's rich-run height (so the baked
          // runLines geometry matches the measured box).
          height: rAssetH ?? (8 * rTextSize),
          ascent: rAssetH ?? (7 * rTextSize),
        };
      });
      const layout = layoutRuns(layoutInput, { maxWidth: box.w, whiteSpace: node.style.whiteSpace });

      runsModel = node.runs.map(r => {
        const rs = runStyleOf(r);
        let target = -1;
        if (r.href) {
          const id = r.href.startsWith("#") ? r.href.slice(1) : r.href;
          target = screenIdToIndex.has(id) ? screenIdToIndex.get(id)! : -1;
        }
        return {
          text: applyTextTransform(r.text, rs) ?? "",
          fg: rs.color ? resolveColorInternal(rs.color, colorFormat) : fg,
          textSize: textSizeOf(rs),
          fontFace: fontFaceOf(rs, fontAssets),
          underline: textDecorationOf(rs.textDecoration),
          letterSpacing: letterSpacingOf(rs),
          linkTarget: target,
        };
      });

      // Bake the laid-out lines into the struct-of-arrays. Cursor advance uses
      // the node's explicit line-height if set (uniform lines), else each
      // line's tallest run height (variable — new for mixed font-sizes).
      const rl: RunLines = {
        segRun: [], segText: [], segX: [], segW: [], segLine: [],
        lineY: [], lineH: [], lineBaseline: [], lineW: [],
      };
      const explicitLineHeight = node.style.lineHeight ? lineHeightOf(node.style, textSize) : 0;
      let y = 0;
      layout.lines.forEach((line, li) => {
        rl.lineY.push(y);
        rl.lineH.push(line.height);
        rl.lineBaseline.push(y + line.ascent);
        rl.lineW.push(line.width);
        y += explicitLineHeight > 0 ? explicitLineHeight : line.height;
        for (const seg of line.segments) {
          rl.segRun.push(seg.runIndex);
          rl.segText.push(seg.text);
          rl.segX.push(seg.x);
          rl.segW.push(seg.width);
          rl.segLine.push(li);
        }
      });
      runLinesModel = rl;
    }

    return {
      index,
      tag: node.tag,
      id: node.id,
      classes: node.classes,
      box: baseTransformOffset.box,
      bg,
      fg,
      checkedBg,
      checkedFg,
      kind,
      text: applyTextTransform(node.text, node.style),
      placeholder: applyTextTransform(node.placeholder, node.style),
      valueAttr: node.value,
      name: node.name,
      checked: node.checked,
      textBuffer: applyTextTransform(node.placeholder, node.style) ?? "",
      hasTextBinding: false,
      hasBg,
      textAlign: textAlign(node.style),
      textSize,
      lineHeight: assetLineHeight(node.style, fontAssets) ?? lineHeightOf(node.style, textSize),
      letterSpacing: letterSpacingOf(node.style),
      fontAntialias: fontAntialiasOf(node.style, display),
      fontFace: fontFaceOf(node.style, fontAssets),
      borderColor: bColor,
      borderStyle: borderStyle(node.style),
      borderWidth: borderWidthOf(node.style),
      borderTopWidth: perSideBorderWidth(node.style, node.style.borderTopWidth, node.style.borderTopStyle),
      borderRightWidth: perSideBorderWidth(node.style, node.style.borderRightWidth, node.style.borderRightStyle),
      borderBottomWidth: perSideBorderWidth(node.style, node.style.borderBottomWidth, node.style.borderBottomStyle),
      borderLeftWidth: perSideBorderWidth(node.style, node.style.borderLeftWidth, node.style.borderLeftStyle),
      borderRadius: borderRadiusOf(node.style),
      ...(() => {
        const padding = paddingOf(node.style);
        return {
          paddingTop: padding.top,
          paddingRight: padding.right,
          paddingBottom: padding.bottom,
          paddingLeft: padding.left,
        };
      })(),
      outlineColor,
      outlineStyle: outline.style,
      outlineWidth: outline.width,
      zIndex,
      transformOffsetX: clampInt16(baseTransformOffset.x),
      transformOffsetY: clampInt16(baseTransformOffset.y),
      rotateDeg: clampInt16(baseTransform.rotateDeg),
      pressedOffsetX: pressedOffset.x,
      pressedOffsetY: pressedOffset.y,
      // Background gradient (if background is a linear-gradient).
      ...(() => {
        const grad = parseGradient(node.style.background, colorFormat);
        return grad
          ? { gradientEnabled: grad.dir, gradientColor1: grad.color1, gradientColor2: grad.color2 }
          : { gradientEnabled: 0, gradientColor1: 0, gradientColor2: 0 };
      })(),
      ...(() => {
        const shadows = parseBoxShadow(node.style, colorFormat);
        const pad = <T>(arr: T[], val: T, n: number): T[] => {
          const out = [...arr];
          while (out.length < n) out.push(val);
          return out.slice(0, n);
        };
        return {
          shadowCount: shadows.length,
          shadowOffsetX: pad(shadows.map(s => s.x), 0, MAX_SHADOWS),
          shadowOffsetY: pad(shadows.map(s => s.y), 0, MAX_SHADOWS),
          shadowBlur: pad(shadows.map(s => s.blur), 0, MAX_SHADOWS),
          shadowColor: pad(shadows.map(s => s.color), 0, MAX_SHADOWS),
          shadowAlpha: pad(shadows.map(s => s.alpha), 0, MAX_SHADOWS),
          shadowInset: pad(shadows.map(s => s.inset), false, MAX_SHADOWS),
        };
      })(),
      // Text shadow: reuse parseBoxShadow for the text-shadow value.
      ...(() => {
        const tsShadows = parseBoxShadow({ boxShadow: node.style.textShadow } as CSSProperty, colorFormat);
        const ts = tsShadows[0];
        return ts
          ? { textShadowCount: 1, textShadowOffsetX: ts.x, textShadowOffsetY: ts.y, textShadowBlur: ts.blur, textShadowColor: ts.color, textShadowAlpha: ts.alpha }
          : { textShadowCount: 0, textShadowOffsetX: 0, textShadowOffsetY: 0, textShadowBlur: 0, textShadowColor: 0, textShadowAlpha: 0 };
      })(),
      underline: textDecorationOf(node.style.textDecoration),
      textOverflow: textOverflowOf(node.style.textOverflow),
      nowrap: wsMode === 1 || wsMode === 2,
      whiteSpaceMode: wsMode,
      visible: node.style.visibility !== "hidden" && node.style.visibility !== "collapse" && !isDisplayNone(node),
      disabled: node.disabled === true,
      drawerSide: (node.tag === "drawer" || node.tag === "dialog" || node.tag === "toast")
        ? ({ bottom: 0, top: 1, left: 2, right: 3, center: 4 } as Record<string, number>)[
            node.tag === "dialog" ? "center" : (node.drawerSide ?? "bottom")] ?? 0
        : -1,
      toastDuration: node.tag === "toast" ? (node.toastDuration ?? 2500) : 0,
      // Visibility-reflow metadata: how this node's in-flow children stack, so
      // the device runtime can re-stack them when a child's visibility changes
      // (the preview re-layouts with yoga every frame; the device's boxes are
      // baked at build time). The flex mapping mirrors yoga-layout.ts exactly;
      // wrapped, reversed, or non-flex-start-justified containers opt out
      // (axis 0) because a linear re-stack can't reproduce their layout.
      ...(() => {
        const s = node.style;
        const fd = s.display === "flex" ? s.flexDirection : "column";
        const outOfFlow = s.position === "absolute" || s.position === "fixed";
        const gapPx = (v: string | undefined): number => {
          const n = v === undefined ? 0 : parseFloat(v);
          return Number.isFinite(n) && n > 0 ? Math.min(255, Math.round(n)) : 0;
        };
        const dirAxis = (fd === "row" || fd === "row-reverse") ? 2 : 1;
        flowDirByIndex[index] = dirAxis;
        let axis = 0;
        if ((node.children?.length ?? 0) > 0 && !outOfFlow &&
            fd !== "row-reverse" && fd !== "column-reverse" &&
            s.flexWrap !== "wrap" && s.flexWrap !== "wrap-reverse" &&
            (!s.justifyContent || s.justifyContent === "flex-start" || s.justifyContent === "normal")) {
          axis = dirAxis;
        }
        const gap = axis === 2 ? gapPx(s.rowGap) : gapPx(s.columnGap);
        // Content-sized only when the size truly comes from the content: an
        // explicit size, flex-grow space, a flex-basis, or cross-axis
        // stretch (a child of a row parent stretches its height; of a column
        // parent its width) all derive the dimension from elsewhere. Getting
        // this wrong let the reflow resize a flex-grown scroll body to its
        // collapsed content — contentHeight == box.h, nothing scrollable.
        const grown = s.flexGrow !== undefined && parseFloat(String(s.flexGrow)) > 0;
        const basisSet = s.flexBasis !== undefined && s.flexBasis !== "auto";
        const parentDir = parentIndex >= 0 ? (flowDirByIndex[parentIndex] ?? 1) : 0;
        const parentDerived = grown || basisSet || parentDir === 0;
        const autoH = !parentDerived && parentDir !== 2 && (s.height === undefined || s.height === "auto");
        const autoW = !parentDerived && parentDir !== 1 && (s.width === undefined || s.width === "auto");
        return { flowAxis: axis, flowGap: gap, flowFlags: (autoH ? 1 : 0) | (autoW ? 2 : 0) | (outOfFlow ? 4 : 0) };
      })(),
      opacity: effectiveOpacity,
      clearColor: clear,
      lastTextWidth: 0,
      lastTextHeight: 0,
      dirty: false,
      value,
      options: node.options,
      scrollable: node.style.overflow === "scroll" || node.style.overflow === "hidden",
      scrollY: 0,
      contentHeight: 0, // computed after layout
      overscrollPx: 0,
      settling: false,
      lastPaintedScrollY: 0,
      rangeMin,
      rangeMax,
      maxlen: node.maxlen ?? 0,
      inputType: node.type,
      keyboard: node.keyboard,
      parentIndex,
      subtreeEnd,
      screenId,
      imgDataId: node.id && imageAssetIds.has(node.id) ? imageAssetIds.get(node.id)! : 255,
      // Image scaling mode: 0=none, 1=fill, 2=contain, 3=cover, 4=scale-down
      objectFit: node.style.objectFit ? objectFitOf(node.style.objectFit) : 1,
      listItemHeight: (node as any).itemHeight ?? 0,
      virtualized: node.tag === "list",
      canvasW: node.canvasW ?? 0,
      canvasH: node.canvasH ?? 0,
      runs: runsModel,
      runLines: runLinesModel,
    };
  });

  // Compute contentHeight for scrollable nodes from actual tree descendants.
  for (let i = 0; i < flat.length; i++) {
    if (!nodes[i].scrollable) continue;
    const parentBox = nodes[i].box;
    let maxBottom = parentBox.y;
    for (let j = i + 1; j < nodes[i].subtreeEnd; j++) {
      const bottom = nodes[j].box.y + nodes[j].box.h;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    nodes[i].contentHeight = Math.max(parentBox.h, maxBottom - parentBox.y);
  }

  const transitions: UITransitionModel[] = [];
  const pushTransition = (
    index: number,
    nodeModel: UINodeModel,
    prop: "background" | "color",
    durationMs: number,
    pressedStyle?: CSSProperty,
  ) => {
    const baseTarget = prop === "background" ? nodeModel.bg : nodeModel.fg;
    const pressedValue = prop === "background" ? pressedStyle?.background : pressedStyle?.color;
    const pressedTarget = pressedValue ? resolveColorInternal(pressedValue, colorFormat) : baseTarget;
    transitions.push({
      node: index,
      prop,
      durationMs,
      pressedTarget,
      baseTarget,
      elapsed: 0,
      prevValue: 0,
      targetValue: 0,
      active: false,
    });
  };

  for (const { index, node } of flat) {
    const nodeModel = nodes[index];
    const pressedStyle = (node.style as CSSProperty & { pressed?: CSSProperty }).pressed;
    const explicitProp = node.style.transition?.property === "background"
      ? "background"
      : node.style.transition?.property === "color" ? "color" : undefined;

    if (explicitProp) {
      pushTransition(index, nodeModel, explicitProp, node.style.transition!.durationMs, pressedStyle);
    }

    for (const prop of ["background", "color"] as const) {
      if (prop === explicitProp) continue;
      const pressedValue = prop === "background" ? pressedStyle?.background : pressedStyle?.color;
      if (!pressedValue) continue;
      const pressedTarget = resolveColorInternal(pressedValue, colorFormat);
      const baseTarget = prop === "background" ? nodeModel.bg : nodeModel.fg;
      if (pressedTarget === baseTarget) continue;
      pushTransition(index, nodeModel, prop, 0, pressedStyle);
    }
  }

  // Build animations from nodes that have an 'animation' CSS property.
  const animations: AnimationModel[] = [];
  for (const fn of flat) {
    const animation = animationDeclOf(fn.node.style);
    if (!animation) continue;
    const setIdx = keyframeSets.findIndex(k => k.name === animation.name);
    if (setIdx < 0) continue;
    animations.push({
      node: fn.index,
      keyframeSet: setIdx,
      durationMs: Math.max(0, Math.min(65535, animation.durationMs)),
      delayMs: Math.max(0, Math.min(65535, animation.delayMs)),
      iterations: Math.max(-1, Math.min(32767, animation.iterations)),
      baseWidth: Math.max(0, Math.min(32767, fn.box.w)),
      baseHeight: Math.max(0, Math.min(32767, fn.box.h)),
      originX: transformOriginPercent(fn.node.style.transformOrigin).x,
      originY: transformOriginPercent(fn.node.style.transformOrigin).y,
      timingFunction: timingFunctionCode(animation.timingFunction),
    });
  }

  const displaySize = display ? effectiveDisplaySize(display) : { width: 0, height: 0 };

  return {
    width: displaySize.width,
    height: displaySize.height,
    colorFormat,
    display,
    fontAssets,
    imageAssets,
    nodes,
    transitions,
    keyframeSets,
    animations,
  };
}
