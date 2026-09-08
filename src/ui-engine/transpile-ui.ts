// ---------------------------------------------------------------------------
// transpileUI — end-to-end facade: HTML + CSS → lowered C++.
//
// Orchestrates: parse HTML → parse CSS → resolve styles → layout → lower.
// This is the integration contract used by the AST visitor that resolves
// .ui.html imports during a normal `typecad-hal build`.
//
// Selecting the layout engine on the `display` property happens here in v2;
// v1 always uses BlockLayoutEngine.
// ---------------------------------------------------------------------------

import path from "node:path";
import { parseHtml } from "./html-parser.js";
import { parseCss, parseFontFaces, parseKeyframes } from "./css-parser.js";
import { resolveStyles } from "./style-resolver.js";
import { selectEngine } from "./select-engine.js";
import { measureWithFonts, Box } from "./layout-engine.js";
import { lowerUIToCpp, LoweredUI } from "./ui-lowering.js";
import { buildUIFontAssets } from "./font-assets.js";
import { buildKeyframeSets } from "./keyframes.js";
import { injectDefaultFontFaces } from "./default-font.js";
import { cssCompatDiagnostics } from "./compat-report.js";
import { expandCssImports } from "./css-imports.js";

export interface TranspileUIOptions {
  colorFormat: "rgb565" | "mono";
  storage: "progmem" | "flash";
  viewport: { width: number; height: number };
  assetBaseDir?: string;
}

export function transpileUI(html: string, css: string, opts: TranspileUIOptions): LoweredUI {
  const tree = parseHtml(html);
  const cssBaseDir = path.resolve(opts.assetBaseDir ?? process.cwd());
  const expandedCss = expandCssImports(css, cssBaseDir);
  const rules = parseCss(expandedCss);
  const fontFaces = injectDefaultFontFaces(parseFontFaces(expandedCss), opts.colorFormat);
  const rawKeyframes = parseKeyframes(expandedCss);
  const styled = resolveStyles(tree, rules);
  const fontAssets = buildUIFontAssets(styled, fontFaces, cssBaseDir);

  // Select layout engine: Yoga for flexbox, BlockLayout as fallback.
  const engine = selectEngine(styled);
  const viewport: Box = { x: 0, y: 0, w: opts.viewport.width, h: opts.viewport.height };
  const boxes = engine.arrange(styled, viewport, measureWithFonts(fontAssets));

  const keyframeSets = buildKeyframeSets(rawKeyframes, opts.colorFormat);

  const result = lowerUIToCpp(styled, boxes, opts.colorFormat, opts.storage, [], rules, undefined, fontAssets, [], new Map(), keyframeSets);
  result.diagnostics.push(...cssCompatDiagnostics([styled], fontAssets, opts.viewport, opts.colorFormat, "inline"));
  return result;
}
