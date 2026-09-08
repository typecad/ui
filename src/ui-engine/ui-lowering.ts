// ---------------------------------------------------------------------------
// UI lowering — styled tree + computed boxes → C++ node/binding/transition
// tables + a .ui.d.html.ts declaration file.
//
// This is the bridge between the host-side parse/layout pipeline and the
// device-side retained runtime. Colors are resolved to the target color format
// here (once, at transpile time) so the device never converts colors.
//
// Output shape:
//   - nodeTable:       `static const UINode __ui_nodes[] = { ... };`
//   - transitionTable: `static const UITransition __ui_trans[] = { ... };`
//   - typeDecl:        TypeScript declarations so .ui.html imports are typed.
// ---------------------------------------------------------------------------

import { StyledNode } from "./style-resolver.js";
import { Box } from "./layout-engine.js";
import { lowerUIToModel, type UIProgram, type UINodeModel, type KeyframeSetModel } from "./model.js";
import { resolveColor } from "./color.js";
import { defaultFontAttribution } from "./default-font.js";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "./default-keyboards.js";
import type { KeyboardTemplate, UIKeyTemplate } from "./html-parser.js";
import type { CSSRule, CSSProperty } from "./css-parser.js";
import type { DisplayProfile } from "@typecad/cuttlefish/api/shared";
import type { UIFontAssetModel } from "./font-assets.js";
import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import { getListBindings } from "@typecad/cuttlefish/ir/transformers/ui-reactive";

export interface LoweredUI {
  fontTables: string;
  nodeTable: string;
  transitionTable: string;
  typeDecl: string;
  /** C++ keyboard loader function bodies (one per keyboard in use). */
  keyboardLoaders: string;
  /** C++ dispatch table mapping input node index → loader function. */
  keyboardDispatch: string;
  /** Number of distinct screens (for multi-screen navigation). */
  screenCount: number;
  /** C++ image data arrays + index table (for <img> support). */
  imageTables: string;
  /** C++ keyframe data arrays + animation table. */
  keyframeTables: string;
  /** Layout-time diagnostics (viewport overflow, text overflow). Populated by
   *  lowerOnMount after the boxes are computed; empty until then. */
  diagnostics: Diagnostic[];
}

type ColorFormat = "rgb565" | "rgb666" | "rgb888" | "mono";
type Storage = "progmem" | "flash";

export function lowerUIToCpp(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  storage: Storage,
  keyboards: KeyboardTemplate[] = [],
  rules: CSSRule[] = [],
  display?: DisplayProfile,
  fontAssets: UIFontAssetModel[] = [],
  allScreens: StyledNode[] = [],
  imageAssetIds: Map<string, number> = new Map(),
  keyframeSets: KeyframeSetModel[] = [],
  keyframeNs: string = "",
): LoweredUI {
  void storage;
  const model = lowerUIToModel(root, boxes, colorFormat, display, fontAssets, allScreens, imageAssetIds, keyframeSets);

  // Tables are mutable RAM (ui_tick updates bg/dirty/elapsed/active each
  // frame), so no PROGMEM/flash storage keyword — those imply read-only.
  const fontTables = emitFontTables(model);
  const nodeTable = emitNodeTable(model);
  const transitionTable = emitTransitionTable(model);
  const typeDecl = emitTypeDecl(root);

  // Keyboard loaders + dispatch: collect input nodes in tree order, resolve
  // each to its loader (default by type, or a referenced <keyboard>).
  // Walk ALL screens (inputs may live on any screen, not just the root).
  const inputSpecs: Array<{ type?: string; keyboard?: string }> = [];
  const collectInputs = (n: StyledNode) => {
    if (n.tag === "input") inputSpecs.push({ type: n.type, keyboard: n.keyboard });
    n.children.forEach(collectInputs);
  };
  const inputRoots = allScreens.length > 0 ? allScreens : [root];
  for (const sr of inputRoots) collectInputs(sr);

  const neededKeyboards: KeyboardTemplate[] = [];
  const addIfNeeded = (kb: KeyboardTemplate) => {
    if (!neededKeyboards.some(k => k.id === kb.id)) neededKeyboards.push(kb);
  };
  for (const spec of inputSpecs) {
    if (spec.keyboard) {
      const match = keyboards.find(k => k.id === spec.keyboard);
      if (match) addIfNeeded(match);
    } else {
      addIfNeeded(spec.type === "number" ? DEFAULT_NUMBER_KEYBOARD : DEFAULT_ALPHA_KEYBOARD);
    }
  }
  // The runtime header's keyboard page-swap (the 123/ABC toggle key) calls
  // BOTH default loaders regardless of which input opened the keyboard. Emit
  // both whenever any input exists, or a text-only project fails to link
  // (undefined __ui_kb_load_default_number on non-Arduino linkers).
  if (inputSpecs.length > 0) {
    addIfNeeded(DEFAULT_ALPHA_KEYBOARD);
    addIfNeeded(DEFAULT_NUMBER_KEYBOARD);
  }

  const keyboardLoaders = neededKeyboards
    .map(kb => emitKeyboardLoader(loaderNameForId(kb.id), kb, rules, colorFormat))
    .join("\n\n");

  const dispatchEntries = inputSpecs.map(spec => loaderNameForInput(spec, keyboards));
  const keyboardDispatch = dispatchEntries.length > 0
    ? `void (*__ui_kb_loaders[])() = { ${dispatchEntries.join(", ")} };\nconst uint16_t __ui_kb_loader_count = ${dispatchEntries.length};`
    : `void (*__ui_kb_loaders[])() = {};\nconst uint16_t __ui_kb_loader_count = 0;`;

  const screenCount = model.nodes.length > 0 ? Math.max(...model.nodes.map(n => n.screenId)) + 1 : 1;
  const imageTables = "const UIImage __ui_images[] = {};\nconst uint16_t __ui_image_count = 0;";
  const keyframeTables = emitKeyframeTables(model, keyframeNs);
  return { fontTables, nodeTable, transitionTable, typeDecl, keyboardLoaders, keyboardDispatch, screenCount, imageTables, keyframeTables, diagnostics: [] };
}

function sanitizedId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function loaderNameForId(id: string): string {
  return `__ui_kb_load_${sanitizedId(id)}`;
}

function loaderNameForInput(input: { type?: string; keyboard?: string }, keyboards: KeyboardTemplate[]): string {
  if (input.keyboard) {
    const match = keyboards.find(k => k.id === input.keyboard);
    if (match) return loaderNameForId(match.id);
  }
  return input.type === "number" ? "__ui_kb_load_default_number" : "__ui_kb_load_default_alpha";
}

// Default key colors (fallback when no CSS matches). Used for all keys.
const DEFAULT_KEY_BG = 0x4208;    // dark gray
const DEFAULT_KEY_FG = 0xFFFF;    // white
const DEFAULT_KEY_BORDER = 0xFFFF; // white
const DEFAULT_KB_BG = 0x0000;     // black

/** Resolve a key's CSS classes into a merged CSSProperty (cascade: last wins). */
/** Check if a CSS rule's selector matches any of the given class names.
 *  Only matches single-compound class selectors (no descendant for keys). */
function ruleMatchesClass(rule: CSSRule, classes: string[]): boolean {
  // Must be a single compound (no descendant combinator).
  if (rule.selector.compounds.length !== 1) return false;
  const compound = rule.selector.compounds[0];
  // Every simple in the compound must be a class that's in the list.
  for (const s of compound) {
    if (s.kind !== "class" || !classes.includes(s.name)) return false;
  }
  return true;
}

function resolveKeyStyle(keyClasses: string[] | undefined, kbClasses: string[] | undefined, rules: CSSRule[]): CSSProperty {
  const merged: CSSProperty = {};
  const allClasses = [...(kbClasses ?? []), ...(keyClasses ?? [])];
  for (const rule of rules) {
    if (ruleMatchesClass(rule, allClasses)) {
      Object.assign(merged, rule.properties);
    }
  }
  return merged;
}

/** Resolve the keyboard-level background from CSS (keyboard classes). */
function resolveKbBg(kbClasses: string[] | undefined, rules: CSSRule[], colorFormat: ColorFormat): number {
  const merged: CSSProperty = {};
  const classes = kbClasses ?? [];
  for (const rule of rules) {
    if (ruleMatchesClass(rule, classes)) {
      Object.assign(merged, rule.properties);
    }
  }
  return merged.background ? resolveColor(merged.background, colorFormat) : DEFAULT_KB_BG;
}

function emitKeyboardLoader(name: string, kb: KeyboardTemplate, rules: CSSRule[], colorFormat: ColorFormat): string {
  const rows = kb.rows;
  const cols = rows.length > 0 ? Math.max(...rows.map(r => r.length)) : 0;
  const kbBg = resolveKbBg(kb.classes, rules, colorFormat);
  const lines: string[] = [];
  lines.push(`void ${name}() {`);
  lines.push(`  __ui_kb_rows = ${rows.length};`);
  lines.push(`  __ui_kb_cols = ${cols};`);
  lines.push(`  __ui_kb_keyCount = 0;`);
  lines.push(`  __ui_kb_bg = ${hex(kbBg)};`);
  for (const row of rows) {
    for (const key of row) {
      lines.push(`  ${emitKeyLine(key, kb.classes, rules, colorFormat)}`);
    }
    // Pad short rows so ui_kb_key_rect's idx/cols math stays aligned. Padded
    // cells use special=255 (skipped in draw + hit-test) with a space char.
    for (let p = row.length; p < cols; p++) {
      lines.push(`  ui_kb_add_key(' ', 255, ${hex(DEFAULT_KEY_BG)}, ${hex(DEFAULT_KEY_FG)}, ${hex(DEFAULT_KEY_BORDER)});`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}

/** Emit one key's keys[] + styles[] lines, resolving CSS classes to colors. */
function emitKeyLine(key: UIKeyTemplate, kbClasses: string[] | undefined, rules: CSSRule[], colorFormat: ColorFormat): string {
  // The C++ UIKey.ch field is a single `char`. Special keys (shift=1, bs=2,
  // ok=3, page=4) use the `special` field for their behavior and label — the
  // `ch` value is never read. Their label strings ("OK", "123", "⇧", "⌫") are
  // multi-char or multi-byte and would overflow `char` if emitted as literals.
  // Emit a space placeholder for any key whose ch isn't a single ASCII byte.
  const isSingleAscii = key.special === 0 && key.ch.length === 1 && key.ch.charCodeAt(0) < 128;
  if (key.special === 0 && !isSingleAscii) {
    console.warn(
      `[cuttlefish] keyboard key ch="${key.ch}" is non-ASCII and will be emitted as ` +
      `a space placeholder. The native C++ UIKey.ch field is a single char and ` +
      `cannot hold multi-byte codepoints. Use a custom keyboard layout or the ` +
      `Adafruit path for full Unicode key labels.`,
    );
  }
  const chRaw = isSingleAscii ? key.ch : ' ';
  const chEsc = chRaw === "\\" ? "\\\\" : chRaw === "'" ? "\\'" : chRaw;
  const style = resolveKeyStyle(key.classes, kbClasses, rules);
  const bg = style.background ? resolveColor(style.background, colorFormat) : DEFAULT_KEY_BG;
  const fg = style.color ? resolveColor(style.color, colorFormat) : DEFAULT_KEY_FG;
  const border = style.borderColor ? resolveColor(style.borderColor, colorFormat) : DEFAULT_KEY_BORDER;
  return `ui_kb_add_key('${chEsc}', ${key.special}, ${hex(bg)}, ${hex(fg)}, ${hex(border)});`;
}

function cppKind(kind: UINodeModel["kind"]): string {
  switch (kind) {
    case "fill": return "NODE_FILL";
    case "button": return "NODE_BUTTON";
    case "check": return "NODE_CHECK";
    case "radio": return "NODE_RADIO";
    case "progress": return "NODE_PROGRESS";
    case "range": return "NODE_RANGE";
    case "input": return "NODE_INPUT";
    case "img": return "NODE_IMG";
    case "list": return "NODE_LIST";
    case "canvas": return "NODE_CANVAS";
    case "select": return "NODE_SELECT";
    case "text": return "NODE_TEXT";
  }
}

function hex(c: number): string {
  return `0x${c.toString(16).padStart(4, "0")}`;
}

function cppString(value: string | undefined): string {
  return value ? JSON.stringify(value) : "nullptr";
}

function byteArray(values: number[]): string {
  if (values.length === 0) return "";
  const chunks: string[] = [];
  for (let i = 0; i < values.length; i += 16) {
    chunks.push("  " + values.slice(i, i + 16).map((v) => `0x${(v & 0xff).toString(16).padStart(2, "0")}`).join(", "));
  }
  return chunks.join(",\n");
}

function emitFontTables(model: UIProgram): string {
   const assets = model.fontAssets ?? [];
   if (assets.length === 0) {
     return [
       `const UIFontFace __ui_font_faces[] = {};`,
       `const uint16_t __ui_font_face_count = 0;`,
     ].join("\n");
   }

   const lines: string[] = [];
   for (const asset of assets) {
     lines.push(`// Font ${asset.id}: ${asset.family} ${asset.px}px ${asset.fontWeight} ${asset.fontStyle} ${asset.subset} (source: ${asset.sourcePath.split(/[\\/]/).pop()})`);
     // Bundled DejaVu faces carry their license attribution into the binary
     // (the Bitstream Vera License requires the notice accompany distributions).
     const attribution = defaultFontAttribution(asset.sourcePath);
     if (attribution) lines.push(`// ${attribution}`);
     // Alpha data goes in PROGMEM (constants in flash, not RAM) - accessed via pgm_read_byte on AVR
     lines.push(`static const uint8_t __ui_font_${asset.id}_alpha[] PROGMEM = {`);
     lines.push(byteArray(asset.alpha));
     lines.push(`};`);
     lines.push(`static const UIFontGlyph __ui_font_${asset.id}_glyphs[] = {`);
     for (const glyph of asset.glyphs) {
       lines.push(
         `  { ${glyph.codepoint}, ${glyph.xOffset}, ${glyph.yOffset}, ${glyph.width}, ${glyph.height}, ${glyph.advance}, ${glyph.dataOffset} },`,
       );
     }
     lines.push(`};`);
   }

   // Font faces and glyphs stay in regular memory for direct struct access
   // (AVR optimized builds can move the whole table to PROGMEM + accessor functions)
   lines.push(`const UIFontFace __ui_font_faces[] = {`);
   for (const asset of assets) {
     lines.push(
       `  { ${asset.id}, ${asset.glyphs.length}, ${asset.lineHeight}, ${asset.baseline}, __ui_font_${asset.id}_glyphs, __ui_font_${asset.id}_alpha },`,
     );
   }
   lines.push(`};`);
   lines.push(`const uint16_t __ui_font_face_count = ${assets.length};`);
   return lines.join("\n");
 }

function emitNodeTable(model: UIProgram): string {
  // Map node index → list binding so virtualized nodes carry their count/item/
  // tap function pointers on-node (no UIListBinding side table at runtime).
  const listBindingByNode = new Map<number, ReturnType<typeof getListBindings>[number]>();
  for (const lb of getListBindings()) listBindingByNode.set(lb.nodeIndex, lb);

  // <select> option tables: one fn per select feeding the node's optionTextFn
  // (the modal option list reads options through it). Emitted before the node
  // table so the initializers can reference the names.
  const optionFnByNode = new Map<number, string>();
  const optionFns: string[] = [];
  for (const n of model.nodes) {
    if (n.kind !== "select" || !n.options || n.options.length === 0) continue;
    const fnName = `__ui_select_opts_${n.index}`;
    optionFnByNode.set(n.index, fnName);
    const cases = n.options.map((o, i) =>
      `  if (idx == ${i}) { snprintf(buf, static_cast<size_t>(size), "%s", ${JSON.stringify(o.text)}); return; }`).join("\n");
    optionFns.push(`static void ${fnName}(uint8_t idx, char* buf, uint8_t size) {\n${cases}\n  buf[0] = 0;\n}`);
  }

  // Accumulate rich-text run / segment / line parallel arrays across all
  // run-bearing nodes, assigning each a contiguous slice (runStart/richSegStart/
  // richLineStart + counts). Emitted as global tables after the node table.
  const runRows: string[] = [];
  const segRows: string[] = [];
  const lineRows: string[] = [];
  const richRanges = new Map<number, { runCount: number; runStart: number; richLineCount: number; richSegStart: number; richSegCount: number; richLineStart: number }>();
  for (const n of model.nodes) {
    if (!n.runs || !n.runLines || n.runs.length === 0) continue;
    const runStart = runRows.length;
    for (const r of n.runs) {
      runRows.push(`  { .text=${cppString(r.text)}, .fg=${hex(r.fg)}, .textSize=${r.textSize}, .fontFace=${r.fontFace}, .underline=${r.underline}, .letterSpacing=${r.letterSpacing}, .linkTarget=${r.linkTarget} },`);
    }
    const richSegStart = segRows.length;
    for (let s = 0; s < n.runLines.segRun.length; s++) {
      segRows.push(`  { .runIndex=${n.runLines.segRun[s]}, .text=${cppString(n.runLines.segText[s])}, .x=${n.runLines.segX[s]}, .w=${n.runLines.segW[s]}, .line=${n.runLines.segLine[s]} },`);
    }
    const richLineStart = lineRows.length;
    for (let l = 0; l < n.runLines.lineY.length; l++) {
      lineRows.push(`  { .y=${n.runLines.lineY[l]}, .h=${n.runLines.lineH[l]}, .baseline=${n.runLines.lineBaseline[l]}, .w=${n.runLines.lineW[l]} },`);
    }
    richRanges.set(n.index, {
      runCount: n.runs.length, runStart,
      richLineCount: n.runLines.lineY.length, richSegStart,
      richSegCount: n.runLines.segRun.length, richLineStart,
    });
  }

  const lines = model.nodes.map((n) => {
    const text = cppString(n.text);
    const font = "nullptr";
    // Input nodes store the placeholder in .text (static literal) so the draw
    // can show it grayed when textBuffer is empty. textBuffer stays {0} so
    // ui_kb_open starts with a clean edit buffer (no placeholder to delete).
    const inputText = n.kind === "input" && n.textBuffer ? cppString(n.textBuffer) : text;
    const box = `{${n.box.x},${n.box.y},${n.box.w},${n.box.h}}`;
    const parent = n.parentIndex >= 0 ? n.parentIndex : 0xFFFF;  // UI_NO_PARENT
    // Progress/range use lastTextWidth as a "previous fill width" for
    // incremental redraw. -1 = never drawn, because fill width 0 is valid.
    const lastTextWidth = n.kind === "progress" || n.kind === "range" ? -1 : 0;
    const shArr = (vals: number[], n = 4) => `{${[...vals.slice(0, n), ...Array(n - Math.min(vals.length, n)).fill(0)].join(",")}}`;
    // Virtualized list: resolve on-node function pointers from the binding.
    const lb = listBindingByNode.get(n.index);
    const virtualized = n.virtualized ? 1 : 0;
    const listCountFn = lb ? lb.countFnName : "nullptr";
    const listItemFn = lb ? lb.itemFnName : "nullptr";
    const listTapFn = lb && lb.tapFnName ? lb.tapFnName : "nullptr";
    const rr = richRanges.get(n.index);
    const runCount = rr ? rr.runCount : 0;
    const runStart = rr ? rr.runStart : 0;
    const richLineCount = rr ? rr.richLineCount : 0;
    const richSegStart = rr ? rr.richSegStart : 0;
    const richSegCount = rr ? rr.richSegCount : 0;
    const richLineStart = rr ? rr.richLineStart : 0;
    return `  { .box=${box}, .bg=${hex(n.bg)}, .fg=${hex(n.fg)}, .kind=${cppKind(n.kind)}, .text=${inputText}, .textBuffer={0}, .hasTextBinding=0, .font=${font}, .hasBg=${n.hasBg ? 1 : 0}, .textAlign=${n.textAlign}, .textSize=${n.textSize}, .lineHeight=${n.lineHeight}, .letterSpacing=${n.letterSpacing}, .fontAntialias=${n.fontAntialias ? 1 : 0}, .fontFace=${n.fontFace}, .borderColor=${hex(n.borderColor)}, .borderStyle=${n.borderStyle}, .borderWidth=${n.borderWidth}, .borderTopWidth=${(n as any).borderTopWidth ?? n.borderWidth}, .borderRightWidth=${(n as any).borderRightWidth ?? n.borderWidth}, .borderBottomWidth=${(n as any).borderBottomWidth ?? n.borderWidth}, .borderLeftWidth=${(n as any).borderLeftWidth ?? n.borderWidth}, .hasPerSideBorder=${(((n as any).borderTopWidth ?? n.borderWidth) !== n.borderWidth || ((n as any).borderRightWidth ?? n.borderWidth) !== n.borderWidth || ((n as any).borderBottomWidth ?? n.borderWidth) !== n.borderWidth || ((n as any).borderLeftWidth ?? n.borderWidth) !== n.borderWidth) ? 1 : 0}, .borderRadius=${Math.min(255, n.borderRadius)}, .paddingTop=${n.paddingTop ?? 0}, .paddingRight=${n.paddingRight ?? 0}, .paddingBottom=${n.paddingBottom ?? 0}, .paddingLeft=${n.paddingLeft ?? 0}, .gradientEnabled=${n.gradientEnabled}, .gradientColor1=${hex(n.gradientColor1)}, .gradientColor2=${hex(n.gradientColor2)}, .outlineColor=${hex(n.outlineColor)}, .outlineStyle=${n.outlineStyle}, .outlineWidth=${n.outlineWidth}, .zIndex=${n.zIndex}, .transformOffsetX=${n.transformOffsetX}, .transformOffsetY=${n.transformOffsetY}, .rotateDeg=${n.rotateDeg}, .pressedOffsetX=${n.pressedOffsetX}, .pressedOffsetY=${n.pressedOffsetY}, .shadowCount=${n.shadowCount}, .shadowOffsetX=${shArr(n.shadowOffsetX)}, .shadowOffsetY=${shArr(n.shadowOffsetY)}, .shadowBlur=${shArr(n.shadowBlur)}, .shadowColor={${n.shadowColor.slice(0, 4).map(hex).join(",")}}, .shadowAlpha=${shArr(n.shadowAlpha)}, .shadowInset=${shArr(n.shadowInset.map(v => v ? 1 : 0))}, .textShadowCount=${n.textShadowCount}, .textShadowOffsetX=${n.textShadowOffsetX}, .textShadowOffsetY=${n.textShadowOffsetY}, .textShadowBlur=${n.textShadowBlur}, .textShadowColor=${hex(n.textShadowColor)}, .textShadowAlpha=${n.textShadowAlpha}, .underline=${n.underline}, .textOverflow=${n.textOverflow ? 1 : 0}, .nowrap=${n.nowrap ? 1 : 0}, .whiteSpaceMode=${n.whiteSpaceMode}, .visible=${n.visible ? 1 : 0}, .opacity=${n.opacity}, .clearColor=${hex(n.clearColor)}, .lastTextWidth=${lastTextWidth}, .lastTextHeight=0, .layoutCacheKey=0, .layoutMetricsW=0, .layoutMetricsH=0, .scrollable=${n.scrollable ? 1 : 0}, .virtualized=${virtualized}, .scrollY=0, .contentHeight=${n.contentHeight}, .overscrollPx=0, .settling=0, .lastPaintedScrollY=0, .listCount=0, .listCountFn=${listCountFn}, .listItemFn=${listItemFn}, .listTapFn=${listTapFn}, .parent=${parent}, .subtreeEnd=${n.subtreeEnd}, .screenId=${n.screenId}, .imgDataId=${n.imgDataId ?? 255}, .objectFit=${n.objectFit ?? 1}, .listItemHeight=${(n as any).listItemHeight ?? 0}, .rangeMin=${n.rangeMin}, .rangeMax=${n.rangeMax}, .maxlen=${n.maxlen}, .canvasW=${n.canvasW ?? 0}, .canvasH=${n.canvasH ?? 0}, .runCount=${runCount}, .richLineCount=${richLineCount}, .runStart=${runStart}, .richSegStart=${richSegStart}, .richSegCount=${richSegCount}, .richLineStart=${richLineStart}, .dirty=0, .value=${n.value}, .disabled=${n.disabled ? 1 : 0}, .optionCount=${n.kind === "select" && n.options ? n.options.length : 0}, .optionTextFn=${optionFnByNode.get(n.index) ?? "nullptr"}, .drawerSide=${(n as any).drawerSide ?? -1}, .toastDuration=${n.toastDuration ?? 0}, .checkedBg=${(n as any).checkedBg !== undefined && (n as any).checkedBg >= 0 ? hex((n as any).checkedBg) : "0x0"}, .checkedFg=${(n as any).checkedFg !== undefined && (n as any).checkedFg >= 0 ? hex((n as any).checkedFg) : "0x0"}, .hasCheckedBg=${(n as any).checkedBg !== undefined && (n as any).checkedBg >= 0 ? 1 : 0}, .hasCheckedFg=${(n as any).checkedFg !== undefined && (n as any).checkedFg >= 0 ? 1 : 0}, .flowAxis=${n.flowAxis ?? 0}, .flowGap=${n.flowGap ?? 0}, .flowFlags=${n.flowFlags ?? 0} },`;
  });
  return [
    // <select> option tables (must precede __ui_nodes[]: initializers
    // reference the function names).
    ...optionFns,
    // Mutable (not const) so ui_tick can update bg/dirty during transitions.
    // AVR would want PROGMEM + a shadow copy; ESP32-class has RAM to spare.
    `UINode __ui_nodes[] = {`,
    ...lines,
    `};`,
    // Rich-text parallel arrays. Mutable is unnecessary (static content) but
    // matches __ui_nodes[] linkage; nodes reference slices via runStart etc.
    runRows.length > 0
      ? [`UIRichRun __ui_runs[] = {`, ...runRows, `};`].join("\n")
      : `UIRichRun __ui_runs[1];`,
    segRows.length > 0
      ? [`UIRichSeg __ui_rich_segs[] = {`, ...segRows, `};`].join("\n")
      : `UIRichSeg __ui_rich_segs[1];`,
    lineRows.length > 0
      ? [`UIRichLine __ui_rich_lines[] = {`, ...lineRows, `};`].join("\n")
      : `UIRichLine __ui_rich_lines[1];`,
    `const uint16_t __ui_run_count = ${runRows.length};`,
    `const uint16_t __ui_rich_seg_count = ${segRows.length};`,
    `const uint16_t __ui_rich_line_count = ${lineRows.length};`,
  ].join("\n");
}

function emitTransitionTable(model: UIProgram): string {
  // Skip no-op transitions (pressed target equals base) — they'd never change
  // the node's appearance and only bloat the per-tick scan.
  const entries = model.transitions
    .filter((t) => t.pressedTarget !== t.baseTarget)
    .map((t) => {
    const prop = t.prop === "background" ? "PROP_BG" : "PROP_FG";
    return `  { .node=${t.node}, .prop=${prop}, .durationMs=${t.durationMs}, .pressedTarget=${hex(t.pressedTarget)}, .baseTarget=${hex(t.baseTarget)} },`;
  });
  if (entries.length === 0) {
    return `UITransition __ui_trans[] = {};`;
  }
  return [
    `UITransition __ui_trans[] = {`,
    ...entries,
    `};`,
  ].join("\n");
}

/** Emit keyframe stop arrays + keyframe set index + animation table. */
function emitKeyframeTables(model: UIProgram, keyframeNs: string = ""): string {
  if (model.keyframeSets.length === 0 && model.animations.length === 0) {
    return [
      `const UIKeyframeSet __ui_keyframe_sets[] = {};`,
      `const uint16_t __ui_keyframe_set_count = 0;`,
      `UIAnimation __ui_anims[] = {};`,
      `const uint16_t __ui_anim_count = 0;`,
    ].join("\n");
  }
  const lines: string[] = [];
  // Emit one stop array per keyframe set.
  // `keyframeNs` namespaces symbols per UI module, and shared stylesheets can
  // register the same animation name into multiple mounted modules — dedupe
  // by name so identical sets emit once (duplicate static arrays fail to link).
  const seenKfNames = new Set<string>();
  for (const ks of model.keyframeSets) {
    if (seenKfNames.has(ks.name)) continue;
    seenKfNames.add(ks.name);
    const safeName = (keyframeNs ? keyframeNs + "_" : "") + ks.name.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`static const UIKeyframeStop __ui_kf_${safeName}_stops[] = {`);
    for (const s of ks.stops) {
      lines.push(`  { .percent=${s.percent}, .props=${s.props}, .bg=${hex(s.bg)}, .fg=${hex(s.fg)}, .opacity=${s.opacity}, .transformOffsetX=${s.transformOffsetX}, .transformOffsetY=${s.transformOffsetY}, .translatePctX=${s.translatePctX}, .translatePctY=${s.translatePctY}, .scaleX=${s.scaleX}, .scaleY=${s.scaleY}, .rotateDeg=${s.rotateDeg}, .width=${s.width}, .height=${s.height} },`);
    }
    lines.push(`};`);
  }
  // Emit keyframe set index table.
  lines.push(`const UIKeyframeSet __ui_keyframe_sets[] = {`);
  model.keyframeSets.forEach((ks) => {
    if (!seenKfNames.has(ks.name)) return;
    const safeName = (keyframeNs ? keyframeNs + "_" : "") + ks.name.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`  { .stopCount=${ks.stops.length}, .stops=__ui_kf_${safeName}_stops },`);
  });
  lines.push(`};`);
  lines.push(`const uint16_t __ui_keyframe_set_count = ${model.keyframeSets.length};`);
  // Emit animation table (mutable — runtime advances elapsed/active).
  lines.push(`UIAnimation __ui_anims[] = {`);
  for (const a of model.animations) {
    lines.push(`  { .node=${a.node}, .keyframeSet=${a.keyframeSet}, .durationMs=${a.durationMs}, .delayMs=${a.delayMs}, .iterations=${a.iterations}, .baseWidth=${a.baseWidth}, .baseHeight=${a.baseHeight}, .originX=${a.originX}, .originY=${a.originY}, .timingFunction=${a.timingFunction}, .elapsed=0, .active=1, .lastUpdateMs=0 },`);
  }
  lines.push(`};`);
  lines.push(`const uint16_t __ui_anim_count = ${model.animations.length};`);
  return lines.join("\n");
}

function emitTypeDecl(root: StyledNode): string {
  // Collect id → tag pairs by walking the tree.
  const ids: Array<{ id: string; tag: string }> = [];
  const collect = (n: StyledNode) => {
    if (n.id) ids.push({ id: n.id, tag: n.tag });
    n.children.forEach(collect);
  };
  collect(root);

  const fields = ids.map(({ id, tag }) => {
    const typeName = tag.charAt(0).toUpperCase() + tag.slice(1);
    return `  ${id}: ${typeName}Element;`;
  }).join("\n");

  return [
    `// Auto-generated by cuttlefish UI lowering. Do not edit.`,
    `export interface ScreenTree {`,
    fields,
    `}`,
    ``,
    `export const screen: ScreenTree;`,
  ].join("\n");
}
