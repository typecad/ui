import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import type { CSSFontFace, CSSProperty } from "./css-parser.js";
import type { StyledNode } from "./style-resolver.js";
import { getDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

export interface UIFontGlyphModel {
  codepoint: number;
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  advance: number;
  /** Offset into the packed alpha stream, measured in 4-bit pixels. */
  dataOffset: number;
}

export type UIFontSubsetMode = "exact" | "fallback";

export interface UIFontAssetModel {
  id: number;
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  lineHeight: number;
  baseline: number;
  glyphs: UIFontGlyphModel[];
  alpha: number[];
}

interface FontAssetRequest {
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: Set<string>;
}

export interface UIFontAssetPlan {
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: string[];
}

interface OpenTypePathCommand {
  type: "M" | "L" | "C" | "Q" | "Z";
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface Point {
  x: number;
  y: number;
}

const FALLBACK_CHARS = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:;!?+-*/=%()[]{}<>_#@&^~$'|";
const SUPERSAMPLE = 4;

export function normalizeFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  if (!first) return undefined;
  if ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'"))) {
    return first.slice(1, -1);
  }
  return first;
}

export function fontPxOf(style: CSSProperty): number {
  if (!style.fontSize) return 16;
  const px = parseInt(style.fontSize, 10);
  return Number.isFinite(px) && px > 0 ? px : 16;
}

export function normalizeFontWeight(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "normal") return "400";
  if (normalized === "bold" || normalized === "bolder") return "700";
  if (normalized === "lighter") return "300";
  const numeric = /^(\d{1,4})/.exec(normalized);
  if (!numeric) return "400";
  const n = Math.max(1, Math.min(1000, Number(numeric[1])));
  return Number.isFinite(n) ? String(n) : "400";
}

export function normalizeFontStyle(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "normal") return "normal";
  if (normalized.includes("italic")) return "italic";
  if (normalized.includes("oblique")) return "oblique";
  return "normal";
}

export function fontSubsetOf(style: CSSProperty): UIFontSubsetMode {
  const subset = style.fontSubset?.trim().toLowerCase();
  if (!subset || subset === "exact" || subset === "used") return "exact";
  if (subset === "fallback" || subset === "auto" || subset === "ascii" || subset === "common") {
    return "fallback";
  }
  return "exact";
}

export function selectFontFaceForStyle(fontFaces: CSSFontFace[], style: CSSProperty): CSSFontFace | undefined {
  const family = normalizeFontFamily(style.fontFamily);
  if (!family) return undefined;
  const candidates = fontFaces.filter((face) => face.fontFamily.toLowerCase() === family.toLowerCase());
  if (candidates.length === 0) return undefined;
  const desiredWeight = Number(normalizeFontWeight(style.fontWeight));
  const desiredStyle = normalizeFontStyle(style.fontStyle);
  return [...candidates].sort((a, b) =>
    fontFaceScore(a, desiredWeight, desiredStyle) - fontFaceScore(b, desiredWeight, desiredStyle)
  )[0];
}

export function selectFontAssetForStyle(fontAssets: UIFontAssetModel[], style: CSSProperty): UIFontAssetModel | undefined {
  const family = normalizeFontFamily(style.fontFamily);
  if (!family) return undefined;
  const px = fontPxOf(style);
  const candidates = fontAssets.filter((asset) => asset.family.toLowerCase() === family.toLowerCase() && asset.px === px);
  if (candidates.length === 0) return undefined;
  const desiredWeight = Number(normalizeFontWeight(style.fontWeight));
  const desiredStyle = normalizeFontStyle(style.fontStyle);
  return [...candidates].sort((a, b) =>
    fontAssetScore(a, desiredWeight, desiredStyle) - fontAssetScore(b, desiredWeight, desiredStyle)
  )[0];
}

/** Measure a string's pixel width using the real per-glyph advances of the
 *  asset font a node resolves to. Returns undefined when the node uses the
 *  default font (no matching asset), so callers fall back to the 6*ts advance.
 *  Characters missing from the asset's subset fall back to half the line height
 *  (matching the runtime's ui_asset_text_width fallback). */
export function assetTextWidth(text: string, style: CSSProperty, fontAssets: UIFontAssetModel[]): number | undefined {
  const asset = selectFontAssetForStyle(fontAssets, style);
  if (!asset) return undefined;
  if (text.length === 0) return 0;
  const fallback = Math.max(1, Math.floor(asset.lineHeight / 2));
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const glyph = asset.glyphs.find((g) => g.codepoint === cp);
    w += glyph ? glyph.advance : fallback;
  }
  return w;
}

/** The line height the runtime will render a custom-font node at
 *  (ui_asset_text_height → face->lineHeight), or undefined when the node uses
 *  the default font. Layout must use this for the glyph-cell height instead of
 *  the 8*ts GFX bitmap default, otherwise the laid-out box is shorter than the
 *  drawn glyphs and the text overflows its container (e.g. a bold @font-face
 *  title spilling past its header's padded box). Mirrors the preview's
 *  textHeight(size, fontFace) = asset.lineHeight ?? gfx.textHeight(size). */
export function assetLineHeight(style: CSSProperty, fontAssets: UIFontAssetModel[]): number | undefined {
  const asset = selectFontAssetForStyle(fontAssets, style);
  if (!asset || asset.lineHeight <= 0) return undefined;
  return asset.lineHeight;
}

export function buildUIFontAssets(
  root: StyledNode,
  fontFaces: CSSFontFace[],
  baseDir: string,
  dynamicNodeIds?: Set<string>,
): UIFontAssetModel[] {
  const plans = planUIFontAssets(root, fontFaces, baseDir, dynamicNodeIds);

  const parsedFonts = new Map<string, any>();
  const assets: UIFontAssetModel[] = [];
  let id = 1;
  for (const plan of plans) {
    let font = parsedFonts.get(plan.sourcePath);
    if (!font) {
      const bytes = fs.readFileSync(plan.sourcePath);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      font = opentype.parse(arrayBuffer);
      parsedFonts.set(plan.sourcePath, font);
    }
    assets.push(rasterizeFontAsset({
      id: id++,
      family: plan.family,
      sourcePath: plan.sourcePath,
      px: plan.px,
      fontWeight: plan.fontWeight,
      fontStyle: plan.fontStyle,
      subset: plan.subset,
      chars: plan.chars,
      font,
    }));
  }

  return assets;
}

export function planUIFontAssets(
  root: StyledNode,
  fontFaces: CSSFontFace[],
  baseDir: string,
  dynamicNodeIds?: Set<string>,
): UIFontAssetPlan[] {
  if (fontFaces.length === 0) return [];

  const requests = new Map<string, FontAssetRequest>();
  const collect = (node: StyledNode) => {
    const face = selectFontFaceForStyle(fontFaces, node.style);
    if (face) {
      // Runtime-dynamic text renders strings the static template can't
      // predict — widen those faces to the fallback charset so bound values
      // ("Gamma" against a subset planned from authored "mode: alpha") don't
      // drop glyphs. Dynamic = ui.bind(..., 'text') targets (via
      // dynamicNodeIds), {expr} interpolations, and bind:text attributes.
      const dynamicText =
        (node.id !== undefined && dynamicNodeIds?.has(node.id)) ||
        node.hasInterpolation === true ||
        node.bind?.text !== undefined;
      const px = fontPxOf(node.style);
      const sourcePath = resolveFontPath(face.src, baseDir);
      const fontWeight = normalizeFontWeight(face.fontWeight ?? node.style.fontWeight);
      const fontStyle = normalizeFontStyle(face.fontStyle ?? node.style.fontStyle);
      const key = `${sourcePath}:${px}:${fontWeight}:${fontStyle}`;
      let request = requests.get(key);
      if (!request) {
        request = {
          family: face.fontFamily,
          sourcePath,
          px,
          fontWeight,
          fontStyle,
          subset: "exact",
          chars: new Set<string>(),
        };
        requests.set(key, request);
      }
      if ((fontSubsetOf(node.style) === "fallback" || dynamicText) && request.subset !== "fallback") {
        request.subset = "fallback";
        addText(request.chars, FALLBACK_CHARS);
      }
      // Virtualized lists render RUNTIME text — item expressions produce
      // strings the static template can't predict (the same reason `{expr}`
      // interpolations add digits). Without this the list's face only carries
      // glyphs from unrelated static text and items render blanks (e.g. a
      // subset with '0' but no '1'-'9' draws "Item 10" as "Item  0").
      if (node.tag === "list" && request.subset !== "fallback") {
        request.subset = "fallback";
        addText(request.chars, FALLBACK_CHARS);
      }
      addNodeText(request.chars, node);
    }
    // Rich-text inline runs: each run has its own resolved style (bold, italic,
    // different font-size) which maps to a different font face/asset. Collect
    // each run's text under its OWN style so the per-face subsetting includes
    // the run's characters. Without this, the run's font face is subsetted from
    // unrelated text and glyphs go missing at draw time.
    if (node.runs) {
      for (const run of node.runs) {
        const runStyle = { ...node.style, ...run.style } as CSSProperty;
        const runFace = selectFontFaceForStyle(fontFaces, runStyle);
        if (!runFace) continue;
        const runPx = fontPxOf(runStyle);
        const runSourcePath = resolveFontPath(runFace.src, baseDir);
        const runWeight = normalizeFontWeight(runFace.fontWeight ?? runStyle.fontWeight);
        const runStyleAttr = normalizeFontStyle(runFace.fontStyle ?? runStyle.fontStyle);
        const runKey = `${runSourcePath}:${runPx}:${runWeight}:${runStyleAttr}`;
        let runReq = requests.get(runKey);
        if (!runReq) {
          runReq = {
            family: runFace.fontFamily,
            sourcePath: runSourcePath,
            px: runPx,
            fontWeight: runWeight,
            fontStyle: runStyleAttr,
            subset: "exact",
            chars: new Set<string>(),
          };
          requests.set(runKey, runReq);
        }
        addText(runReq.chars, applyTextTransform(run.text, runStyle));
      }
    }
    for (const child of node.children) collect(child);
  };
  collect(root);

  return [...requests.values()]
    .filter((request) => request.chars.size > 0)
    .map((request) => ({
      family: request.family,
      sourcePath: request.sourcePath,
      px: request.px,
      fontWeight: request.fontWeight,
      fontStyle: request.fontStyle,
      subset: request.subset,
      chars: [...request.chars].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!),
    }));
}

function resolveFontPath(src: string, baseDir: string): string {
  if (/^https?:\/\//i.test(src)) {
    throw new Error(`@font-face src "${src}" is remote; use a local font file for embedded builds.`);
  }
  const withoutFileScheme = src.startsWith("file://") ? src.slice("file://".length) : src;
  const resolved = path.isAbsolute(withoutFileScheme)
    ? withoutFileScheme
    : path.resolve(baseDir, withoutFileScheme);
  if (!fs.existsSync(resolved)) {
    throw new Error(`@font-face font file not found: ${resolved}`);
  }
  return resolved;
}

function fontFaceScore(face: CSSFontFace, desiredWeight: number, desiredStyle: string): number {
  const style = normalizeFontStyle(face.fontStyle);
  const weight = Number(normalizeFontWeight(face.fontWeight));
  return styleScore(style, desiredStyle) * 10000 + Math.abs(weight - desiredWeight);
}

function fontAssetScore(asset: UIFontAssetModel, desiredWeight: number, desiredStyle: string): number {
  const weight = Number(normalizeFontWeight(asset.fontWeight));
  return styleScore(asset.fontStyle, desiredStyle) * 10000 + Math.abs(weight - desiredWeight);
}

function styleScore(actual: string, desired: string): number {
  if (actual === desired) return 0;
  if (actual === "normal") return 1;
  return 2;
}

function addNodeText(chars: Set<string>, node: StyledNode): void {
  addText(chars, applyTextTransform(node.text, node.style));
  addText(chars, applyTextTransform(node.placeholder, node.style));
  for (const option of node.options ?? []) {
    addText(chars, applyTextTransform(option.text, node.style));
  }
  // Interpolation ({expr}) and text bindings produce runtime text the static
  // template can't predict (numbers, dates, etc). Add digits + common
  // formatting chars so the font subset can render the runtime output.
  if (node.text && node.text.includes("{")) {
    addText(chars, "0123456789.,-+/()%");
  }
  // <input> nodes on the SDL desktop target (UI_HIDE_OSK) accept arbitrary
  // real-keyboard text — the OSK grid isn't shown, so the user can type any
  // character, not just the keys on the on-screen grid. Pack the full printable
  // ASCII range so every typed character has a glyph (otherwise letters absent
  // from static UI text render blank — ui_font_glyph returns null). Hardware
  // targets keep the minimal subset: the OSK grid is the only input path and
  // only carries the keys it shows.
  if (node.tag === "input") {
    let driver: string | undefined;
    try { driver = getDisplayProfile().driver; } catch { /* no profile bound */ }
    if (driver === "sdl") {
      let ascii = "";
      for (let cp = 0x20; cp <= 0x7e; cp++) ascii += String.fromCodePoint(cp);
      addText(chars, ascii);
    }
  }
}

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

function addText(chars: Set<string>, text: string | undefined): void {
  if (!text) return;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp >= 32 && cp <= 0xffff) chars.add(ch);
  }
}

function rasterizeFontAsset(options: {
  id: number;
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: string[];
  font: any;
}): UIFontAssetModel {
  const scale = options.px / options.font.unitsPerEm;
  const baseline = Math.ceil((options.font.ascender ?? options.font.unitsPerEm) * scale) + 1;
  const lineHeight = Math.ceil(((options.font.ascender ?? options.font.unitsPerEm) - (options.font.descender ?? 0)) * scale) + 2;
  const glyphs: UIFontGlyphModel[] = [];
  const unpackedAlpha: number[] = [];

  for (const ch of options.chars) {
    const glyph = options.font.charToGlyph(ch);
    const advance = Math.max(1, Math.ceil((glyph.advanceWidth ?? options.font.unitsPerEm / 2) * scale));
    const path = glyph.getPath(0, 0, options.px);
    const bbox = path.getBoundingBox();
    const empty = !Number.isFinite(bbox.x1) || !Number.isFinite(bbox.y1) || bbox.x1 === bbox.x2 || bbox.y1 === bbox.y2;
    const xOffset = empty ? 0 : Math.floor(bbox.x1) - 1;
    const yOffset = empty ? 0 : Math.floor(bbox.y1) - 1;
    const width = empty ? 0 : Math.max(0, Math.ceil(bbox.x2) - xOffset + 1);
    const height = empty ? 0 : Math.max(0, Math.ceil(bbox.y2) - yOffset + 1);
    const dataOffset = unpackedAlpha.length;

    if (width > 0 && height > 0) {
      const contours = flattenPath(path.commands as OpenTypePathCommand[]);
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          let covered = 0;
          for (let sy = 0; sy < SUPERSAMPLE; sy++) {
            for (let sx = 0; sx < SUPERSAMPLE; sx++) {
              const x = xOffset + px + (sx + 0.5) / SUPERSAMPLE;
              const y = yOffset + py + (sy + 0.5) / SUPERSAMPLE;
              if (pointInContours(x, y, contours)) covered++;
            }
          }
          unpackedAlpha.push(Math.round((covered * 15) / (SUPERSAMPLE * SUPERSAMPLE)));
        }
      }
    }

    glyphs.push({
      codepoint: ch.codePointAt(0) ?? 0,
      xOffset,
      yOffset,
      width,
      height,
      advance,
      dataOffset,
    });
  }

  return {
    id: options.id,
    family: options.family,
    sourcePath: options.sourcePath,
    px: options.px,
    fontWeight: options.fontWeight,
    fontStyle: options.fontStyle,
    subset: options.subset,
    lineHeight,
    baseline,
    glyphs,
    alpha: packNibbles(unpackedAlpha),
  };
}

function flattenPath(commands: OpenTypePathCommand[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point | null = null;
  let contour: Point[] = [];

  const push = (p: Point) => {
    contour.push(p);
    current = p;
  };
  const finish = () => {
    if (contour.length > 1) contours.push(contour);
    contour = [];
    start = null;
  };

  for (const cmd of commands) {
    if (cmd.type === "M") {
      finish();
      current = { x: cmd.x ?? 0, y: cmd.y ?? 0 };
      start = current;
      contour = [current];
    } else if (cmd.type === "L") {
      push({ x: cmd.x ?? current.x, y: cmd.y ?? current.y });
    } else if (cmd.type === "Q") {
      const p0 = current;
      const p1 = { x: cmd.x1 ?? current.x, y: cmd.y1 ?? current.y };
      const p2 = { x: cmd.x ?? current.x, y: cmd.y ?? current.y };
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const mt = 1 - t;
        push({
          x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
          y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
        });
      }
    } else if (cmd.type === "C") {
      const p0 = current;
      const p1 = { x: cmd.x1 ?? current.x, y: cmd.y1 ?? current.y };
      const p2 = { x: cmd.x2 ?? current.x, y: cmd.y2 ?? current.y };
      const p3 = { x: cmd.x ?? current.x, y: cmd.y ?? current.y };
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const mt = 1 - t;
        push({
          x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
          y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
        });
      }
    } else if (cmd.type === "Z") {
      if (start) push(start);
      finish();
    }
  }
  finish();
  return contours;
}

function pointInContours(x: number, y: number, contours: Point[][]): boolean {
  let inside = false;
  for (const contour of contours) {
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const a = contour[i];
      const b = contour[j];
      const crosses = (a.y > y) !== (b.y > y);
      if (crosses) {
        const ix = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
        if (x < ix) inside = !inside;
      }
    }
  }
  return inside;
}

function packNibbles(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 2) {
    const hi = Math.max(0, Math.min(15, values[i] ?? 0));
    const lo = Math.max(0, Math.min(15, values[i + 1] ?? 0));
    out.push((hi << 4) | lo);
  }
  return out;
}
