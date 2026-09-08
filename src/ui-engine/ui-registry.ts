// ---------------------------------------------------------------------------
// UI module registry — cross-phase state for `.ui.html` modules.
//
// `.ui.html` is parsed once at resolution time (graph build), and its styled
// tree is stored here. Two later phases consume it independently:
//   - call lowering (ui.mount) → lowerOnMount() does final layout+lower using
//     the mount's viewport, and marks the entry file as having a UI.
//   - emit injection (cpp-emitter) → reads lowered tables + the entry-has-UI
//     flag to inject the runtime header + tables into the entry TU.
//
// Mirrors the module-scoped Map pattern of halInstances / halClassRegistry.
//
// Design choice: final layout is deferred to mount time because the viewport
// comes from ui.mount's display context, not from the .ui.html itself. So
// loadUIModule stores the styled tree; lowerOnMount produces the C++ tables.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { parseHtml, parseHtmlWithKeyboards, extractStyleBlocks } from "./html-parser.js";
import type { KeyboardTemplate } from "./html-parser.js";
import { getThemeCss } from "@typecad/cuttlefish/stores/theme-store";
import { parseCss, parseFontFaces, parseKeyframes } from "./css-parser.js";
import type { CSSFontFace, CSSRule, KeyframeSet } from "./css-parser.js";
import { resolveStyles, StyledNode } from "./style-resolver.js";
import { buildKeyframeSets } from "./keyframes.js";
import { selectEngine } from "./select-engine.js";
import { measure, measureWithFonts, Box } from "./layout-engine.js";
import { lowerUIToCpp, LoweredUI } from "./ui-lowering.js";
import { getDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";
import { buildUIFontAssets } from "./font-assets.js";
import type { UIFontAssetModel } from "./font-assets.js";
import { injectDefaultFontFaces } from "./default-font.js";
import { cssCompatDiagnostics } from "./compat-report.js";
import { expandCssImports } from "./css-imports.js";
import { SHADCN_KIT_CSS } from "./shadcn-kit.js";
import { emitImageTables, loadImageAssets, applyDecodedImageSizes } from "./image-assets.js";
import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import { splitUiFile } from "./ui-file-splitter.js";

export interface UIModule {
  /** Absolute path of the .ui.html source. */
  htmlPath: string;
  /** Absolute path of the generated type declaration for this UI module. */
  typeDeclPath: string;
  /** Source root overlaid with typeDeclRoot for .ui.html TypeScript imports. */
  typeDeclSourceRoot: string;
  /** Generated type declaration root used with TypeScript rootDirs. */
  typeDeclRoot: string;
  /** Resolved-style tree (HTML + CSS merged). Layout deferred to mount. */
  styled: StyledNode;
  /** All resolved <screen> trees (for multi-screen navigation). */
  allStyledScreens: StyledNode[];
  /** <keyboard> templates parsed from the same .ui.html (sibling declarations). */
  keyboards: KeyboardTemplate[];
  /** CSS rules from the sibling .ui.css (used for keyboard key styling). */
  rules: CSSRule[];
  /** @font-face rules from CSS, resolved into build-time font assets. */
  fontFaces: CSSFontFace[];
  fontAssets: UIFontAssetModel[];
  /** Raw @keyframes blocks parsed from CSS. */
  rawKeyframes: KeyframeSet[];
  /** Parser-level warnings (unknown CSS properties / HTML tags). */
  diagnostics: Diagnostic[];
  /** Layout-time warnings (scroll memory budget, etc.) from ui.mount lowering. */
  mountDiagnostics: Diagnostic[];
}

export interface LowerOptions {
  colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono";
  storage: "progmem" | "flash";
  viewport: { width: number; height: number };
}

const modules = new Map<string, UIModule>();
const lowered = new Map<string, LoweredUI>();
let entryHasUIFlag = false;

export interface UITypeDeclInfo {
  dtsPath: string;
  sourceRoot: string;
  typesRoot: string;
}

export interface UITypeDeclarationResult {
  written: string[];
  errors: Array<{ filePath: string; error: Error }>;
}

interface UITypeDeclNode {
  tag: string;
  id?: string;
  ref?: string;
  children: UITypeDeclNode[];
}

/** Reset the registry. Called at the start of each transpile run. */
export function resetUIRegistry(): void {
  modules.clear();
  lowered.clear();
  entryHasUIFlag = false;
}

/** Load a `.ui.html` module: parse HTML + sibling `.ui.css`, resolve styles, cache. */
export function loadUIModule(htmlPath: string): UIModule {
  const abs = path.resolve(htmlPath);
  const cached = modules.get(abs);
  if (cached) return cached;

  if (!fs.existsSync(abs)) {
    throw new Error(`UI module not found: ${abs}`);
  }
  const htmlText = fs.readFileSync(abs, "utf-8");
  // CSS path: use theme override if set, else the default sibling .ui.css.
  const themeOverride = getThemeCss();
  const cssPath = themeOverride
    ? (path.isAbsolute(themeOverride) ? themeOverride : path.resolve(path.dirname(abs), themeOverride))
    : abs.replace(/\.ui\.html$/, ".ui.css");
  const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf-8") : "";

  return loadUIModuleFromText(abs, htmlText, cssText, cssPath);
}

/**
 * Load a UI module from already-read HTML + CSS text (used by the .ui single-file
 * component path, which splits the file and passes the parts directly). The
 * disk-reading `loadUIModule` delegates here after reading the files.
 */
export function loadUIModuleFromText(
  htmlPath: string,
  htmlText: string,
  cssText: string,
  cssPathForFonts: string = path.dirname(htmlPath),
): UIModule {
  const abs = path.resolve(htmlPath);
  const cached = modules.get(abs);
  if (cached) return cached;

  const moduleDiagnostics: Diagnostic[] = [];
  const parsed = parseHtmlWithKeyboards(htmlText, moduleDiagnostics);
  const tree = parsed.tree;
  const allScreens = parsed.screens;
  const keyboards = parsed.keyboards;
  // Merge <style> blocks from the HTML with the external CSS, then inline any
  // local @import statements (shared stylesheets like the shadcn preset).
  const styleBlocks = extractStyleBlocks(htmlText);
  const cssBaseDir = path.dirname(cssPathForFonts);
  // Built-in shadcn kit first, user CSS after: user token blocks and recipe
  // overrides win by cascade order. The kit has no @imports of its own.
  const fullCss = SHADCN_KIT_CSS + "\n" + expandCssImports(cssText + "\n" + styleBlocks, cssBaseDir);
  const rules = parseCss(fullCss, moduleDiagnostics);
  // Color displays get the bundled DejaVu faces appended (unless the author
  // registered their own face under the default family) so AA text works out
  // of the box. The UA sheet points at the same family.
  let profileColorFormat: string | undefined;
  try { profileColorFormat = getDisplayProfile().colorFormat; } catch { /* unbound */ }
  const fontFaces = injectDefaultFontFaces(parseFontFaces(fullCss), profileColorFormat);
  const styled = resolveStyles(tree, rules, moduleDiagnostics);
  const allStyledScreens = allScreens.map(s => resolveStyles(s, rules, moduleDiagnostics));
  const fontRoot: StyledNode = { tag: "screen", classes: [], style: {}, children: allStyledScreens };
  const fontAssets = buildUIFontAssets(fontRoot, fontFaces, path.dirname(cssPathForFonts));

  const rawKeyframes = parseKeyframes(fullCss);
  const typeInfo = uiTypeDeclInfoForHtmlPath(abs);
  const mod: UIModule = {
    htmlPath: abs,
    typeDeclPath: typeInfo.dtsPath,
    typeDeclSourceRoot: typeInfo.sourceRoot,
    typeDeclRoot: typeInfo.typesRoot,
    styled,
    allStyledScreens,
    keyboards,
    rules,
    fontFaces,
    fontAssets,
    rawKeyframes,
    diagnostics: moduleDiagnostics,
    mountDiagnostics: [],
  };
  modules.set(abs, mod);

  // Write a generated type declaration so editors and the type-checker see the
  // imported `screen` symbol with precise per-id typing.
  writeTypeDecl(abs, allStyledScreens);

  return mod;
}

/** Count a styled subtree's nodes (pre-order). */
function countNodes(node: StyledNode): number {
  let n = 1;
  for (const c of node.children) n += countNodes(c);
  return n;
}

/** Human-referenceable label for a node: #id when present, else <tag "text">
 *  when it has text, else <tag>. Authors can grep for this in their source
 *  (a bare node index is meaningless). */
function nodeLabel(node: StyledNode): string {
  if (node.id) return `#${node.id}`;
  const text = (node.text ?? "").trim();
  if (text) return `<${node.tag} "${text.slice(0, 20)}">`;
  return `<${node.tag}>`;
}

/** Produce (or return cached) the lowered C++ tables for a module, using the mount viewport. */
export function lowerOnMount(htmlPath: string, opts: LowerOptions): LoweredUI {
  const abs = path.resolve(htmlPath);
  const cached = lowered.get(abs);
  if (cached) return cached;

  const mod = modules.get(abs);
  if (!mod) throw new Error(`Cannot lower unregistered UI module: ${abs}`);
  const htmlBase = path.basename(mod.htmlPath);

  const viewport: Box = { x: 0, y: 0, w: opts.viewport.width, h: opts.viewport.height };

  // Layout all screens (each gets its own Yoga layout pass; boxes concatenated).
  let allBoxes: Box[] = [];
  let allStyled: StyledNode[] = [];
  // Converted images (<img src="*.png"> etc.) contribute their natural size
  // to layout when the author gave no explicit width/height — must land
  // BEFORE arrange. Served from the warm-up cache primed by the transpile
  // graph collector / preview builder before this module loaded.
  applyDecodedImageSizes(mod.allStyledScreens.length > 0 ? mod.allStyledScreens : [mod.styled], path.dirname(abs));
  for (const screen of mod.allStyledScreens.length > 0 ? mod.allStyledScreens : [mod.styled]) {
    const engine = selectEngine(screen);
    const screenBoxes = engine.arrange(screen, viewport, measureWithFonts(mod.fontAssets));
    allBoxes = allBoxes.concat(screenBoxes);
    allStyled.push(screen);
  }

  // Resolve @keyframes from the module's parsed keyframe sets.
  const keyframeSets = buildKeyframeSets(mod.rawKeyframes || [], opts.colorFormat);

  // Load image assets before lowering so imgDataId can be set.

  const imageAssets = loadImageAssets(allStyled.length > 0 ? allStyled : [mod.styled], path.dirname(abs));

  const kfNs = hashlibLike(abs);
  const result = lowerUIToCpp(mod.styled, allBoxes, opts.colorFormat, opts.storage, mod.keyboards, mod.rules, getDisplayProfile(), mod.fontAssets, allStyled, imageAssets.nodeIdToAssetIndex, keyframeSets, kfNs);

  // Layout diagnostics: viewport-overflow (node bottom past the viewport) and
  // text-overflow (node right edge past its parent). Both reference the node by
  // a human-label (#id / <tag "text"> / <tag>) so the author can find it in
  // their source — a bare node index is meaningless. Boxes are pre-order DFS,
  // matching the styled tree walk.
  const layoutDiags: Diagnostic[] = [];
  function walkLayoutDiags(node: StyledNode, nodeBox: Box | undefined, parentBox: Box | undefined, idx: { i: number }, insideScroll: boolean) {
    // A scroll container's content is INTENTIONALLY taller than the viewport —
    // that's the point of scroll. Suppress the viewport-overflow check for the
    // scroll container itself AND its descendants: the container's box is the
    // viewport-sized window, and its children sit below the fold by design.
    // The check still fires for genuine non-scroll clipping elsewhere.
    const isScrollContainer = node.style.overflow === "scroll" || node.style.overflow === "hidden";
    const suppressViewportOverflow = insideScroll || isScrollContainer;
    if (nodeBox) {
      // Viewport-overflow: bottom past the viewport (silently clipped — no
      // scroll on a non-scroll container).
      if (!suppressViewportOverflow && nodeBox.h > 0) {
        const bottom = nodeBox.y + nodeBox.h;
        if (bottom > opts.viewport.height + 1) {  // +1px tolerance
          layoutDiags.push({
            severity: "warning",
            code: "layout-viewport-overflow",
            message: `${nodeLabel(node)} bottom at y=${bottom} exceeds the ${opts.viewport.height}px viewport by ${bottom - opts.viewport.height}px (clipped off-screen).`,
            hint: `Reduce content height, tighten padding/gap, or add overflow:scroll to a container.`,
            source: htmlBase,
          });
        }
      }
      // Text-overflow: a text/button node whose right edge extends past its
      // parent's content right edge (sibling-sum overflow).
      if (parentBox && (node.tag === "text" || node.tag === "button")) {
        const nodeRight = nodeBox.x + nodeBox.w;
        const parentContentRight = parentBox.x + parentBox.w;
        if (nodeRight > parentContentRight + 1) {  // +1px tolerance
          layoutDiags.push({
            severity: "warning",
            code: "layout-text-overflow",
            message: `${nodeLabel(node)} right edge at x=${nodeRight} extends past its parent's right edge at x=${parentContentRight} by ${Math.round(nodeRight - parentContentRight)}px.`,
            hint: `Shorten the text, use white-space:nowrap, or widen the parent.`,
            source: htmlBase,
          });
        }
      }
    }
    for (const child of node.children) {
      const childBox = allBoxes[idx.i];
      idx.i++;
      walkLayoutDiags(child, childBox, nodeBox, idx, isScrollContainer || insideScroll);
    }
  }
  let boxIdx = 1;  // box 0 is the screen itself
  for (const screen of allStyled) {
    walkLayoutDiags(screen, allBoxes[boxIdx - 1], undefined, { i: boxIdx }, false);
    boxIdx += countNodes(screen);
  }
  for (const d of layoutDiags) {
    result.diagnostics.push(d);
    mod.mountDiagnostics.push(d);
  }

  // CSS compatibility report: display-anchored scale summary, ignored alpha,
  // stock-font quantization, viewport-share sanity. Ordinary diagnostics —
  // printed with the rest, upgradeable to errors via --strict-css.
  for (const d of cssCompatDiagnostics(
    allStyled.length > 0 ? allStyled : [mod.styled],
    mod.fontAssets,
    opts.viewport,
    opts.colorFormat,
    htmlBase,
  )) {
    result.diagnostics.push(d);
    mod.mountDiagnostics.push(d);
  }

  // Emit image tables.
  result.imageTables = emitImageTables(imageAssets.assets, opts.colorFormat);
  lowered.set(abs, result);
  return result;
}

export function getUIModule(htmlPath: string): UIModule | undefined {
  return modules.get(path.resolve(htmlPath));
}

export function getLoweredUIModule(htmlPath: string): LoweredUI | undefined {
  return lowered.get(path.resolve(htmlPath));
}

export function hasUIModule(htmlPath: string): boolean {
  return modules.has(path.resolve(htmlPath));
}

/** Stable short per-module namespace for generated symbols (link-level dedup). */
function hashlibLike(absPath: string): string {
  let h = 5381;
  for (let i = 0; i < absPath.length; i++) h = ((h * 33) ^ absPath.charCodeAt(i)) >>> 0;
  return "m" + h.toString(36);
}

/** All loaded UI modules (used by the emitter to inject every mounted tree). */
export function allUIModules(): UIModule[] {
  return [...modules.values()];
}

/** All lowered UI modules (those whose ui.mount has been processed). */
export function allLoweredUIModules(): Array<{ htmlPath: string; lowered: LoweredUI }> {
  return [...lowered.entries()].map(([htmlPath, l]) => ({ htmlPath, lowered: l }));
}

// ── Entry-has-UI flag (gates runtime header + table injection) ──────────────

export function markEntryHasUI(): void {
  entryHasUIFlag = true;
}

export function entryHasUI(): boolean {
  return entryHasUIFlag;
}

export function clearEntryHasUI(): void {
  entryHasUIFlag = false;
}

// ── Type-declaration sibling (.ui.d.html.ts) ────────────────────────────────

function findCuttlefishProjectRoot(filePath: string): string {
  let dir = path.dirname(path.resolve(filePath));
  while (true) {
    if (
      fs.existsSync(path.join(dir, "typecad-hal.config.ts")) ||
      fs.existsSync(path.join(dir, "cuttlefish.config.js")) ||
      fs.existsSync(path.join(dir, "cuttlefish.config.mjs")) ||
      fs.existsSync(path.join(dir, "cuttlefish.config.cjs"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(path.resolve(filePath));
    dir = parent;
  }
}

function isInsidePath(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function walkUIFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "out" || entry.name === "types") {
      continue;
    }

    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkUIFiles(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".ui") || lower.endsWith(".ui.html")) {
      out.push(abs);
    }
  }
}

export function uiTypeDeclInfoForHtmlPath(htmlPath: string): UITypeDeclInfo {
  const abs = path.resolve(htmlPath);
  const projectRoot = findCuttlefishProjectRoot(abs);
  const srcRoot = path.join(projectRoot, "src");
  const sourceRoot = isInsidePath(abs, srcRoot) ? srcRoot : projectRoot;
  const rel = path.relative(sourceRoot, abs);
  const safeRel = rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel
    : path.basename(abs);
  const dtsRel = safeRel.replace(/\.ui\.html$/i, ".ui.d.html.ts");
  const typesRoot = path.join(projectRoot, "types");
  return {
    dtsPath: path.join(typesRoot, dtsRel),
    sourceRoot,
    typesRoot,
  };
}

export function writeUITypeDeclarationFromHtmlText(htmlPath: string, htmlText: string): string {
  const parsed = parseHtmlWithKeyboards(htmlText, []);
  writeTypeDecl(htmlPath, parsed.screens);
  return uiTypeDeclInfoForHtmlPath(htmlPath).dtsPath;
}

export function generateProjectUITypeDeclarations(projectRoot: string): UITypeDeclarationResult {
  const root = path.resolve(projectRoot);
  const srcRoot = path.join(root, "src");
  const files: string[] = [];
  walkUIFiles(srcRoot, files);

  const written: string[] = [];
  const errors: Array<{ filePath: string; error: Error }> = [];
  for (const filePath of files) {
    try {
      const source = fs.readFileSync(filePath, "utf-8");
      if (filePath.toLowerCase().endsWith(".ui")) {
        const parts = splitUiFile(source);
        written.push(writeUITypeDeclarationFromHtmlText(filePath + ".html", parts.html));
      } else {
        written.push(writeUITypeDeclarationFromHtmlText(filePath, source));
      }
    } catch (error) {
      errors.push({
        filePath,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  return { written, errors };
}

function uiElementTypeForTag(tag: string): string {
  switch (tag) {
    case "button": return "ButtonElement";
    case "view":
    case "screen": return "ViewElement";
    case "check": return "CheckElement";
    case "select": return "SelectElement";
    case "radio": return "RadioElement";
    case "progress": return "ProgressElement";
    case "range": return "RangeElement";
    case "input": return "InputElement";
    case "canvas": return "CanvasElement";
    default: return "TextElement";
  }
}

function writeTypeDecl(htmlPath: string, styled: UITypeDeclNode | UITypeDeclNode[]): void {
  // Node16 module resolution with `allowArbitraryExtensions` types a non-JS
  // module `<base>.<ext>` (here `app.ui.html`) via a sibling named
  // `<base>.d.<ext>.ts` (here `app.ui.d.html.ts`). The older `.ui.html.d.ts`
  // name is rejected by Node16 regardless of host hooks — the declaration file
  // MUST follow the `<base>.d.<ext>.ts` convention.
  const { dtsPath } = uiTypeDeclInfoForHtmlPath(htmlPath);
  const roots = Array.isArray(styled) ? styled : [styled];

  // Flat handles (backward-compatible): every element's ref ?? id at top level.
  const flatIds = new Map<string, string>();
  const collectFlat = (n: UITypeDeclNode) => {
    const handle = n.ref ?? n.id;
    if (handle && !flatIds.has(handle)) flatIds.set(handle, n.tag);
    n.children.forEach(collectFlat);
  };
  roots.forEach(collectFlat);

  // Grouped handles: per-screen namespace (screen.groups.<screenId>.<handle>).
  // Only screens with an id produce a group. Relieves naming pressure — two
  // screens can both have id="btn" → screen.groups.home.btn / .forms.btn.
  const groups = new Map<string, Map<string, string>>(); // screenId → (handle → tag)
  for (const root of roots) {
    const screenId = root.id;
    if (!screenId) continue;
    const group = new Map<string, string>();
    const collectGroup = (n: UITypeDeclNode) => {
      // Don't include the screen root itself in its own group.
      if (n !== root) {
        const handle = n.ref ?? n.id;
        if (handle && !group.has(handle)) group.set(handle, n.tag);
      }
      n.children.forEach(collectGroup);
    };
    collectGroup(root);
    if (group.size > 0) groups.set(screenId, group);
  }

  const flatFields = [...flatIds.entries()]
    .map(([id, tag]) => `  ${id}: ${uiElementTypeForTag(tag)};`)
    .join("\n");

  const groupInterfaces: string[] = [];
  const groupFields: string[] = [];
  for (const [screenId, members] of groups) {
    const ifaceName = `${screenId.charAt(0).toUpperCase()}${screenId.slice(1)}ScreenGroup`;
    const memberFields = [...members.entries()]
      .map(([id, tag]) => `  ${id}: ${uiElementTypeForTag(tag)};`)
      .join("\n");
    groupInterfaces.push(`interface ${ifaceName} {\n${memberFields}\n}`);
    groupFields.push(`  ${screenId}: ${ifaceName};`);
  }

  const groupsInterface = groupInterfaces.length > 0
    ? [...groupInterfaces, `interface ScreenGroups {\n${groupFields.join("\n")}\n}`].join("\n")
    : "";
  const groupsField = groupInterfaces.length > 0 ? "  groups: ScreenGroups;" : "";

  const allFields = [flatFields, groupsField].filter(Boolean).join("\n");

  const dts = [
    `// Auto-generated by cuttlefish (UI lowering). Do not edit.`,
    `import type { TextElement, ButtonElement, ViewElement, CheckElement, SelectElement, RadioElement, ProgressElement, RangeElement, InputElement, CanvasElement } from "@typecad/ui";`,
    groupsInterface,
    `export interface ScreenTree {`,
    allFields,
    `}`,
    `export const screen: ScreenTree;`,
  ].filter(Boolean).join("\n");

  fs.mkdirSync(path.dirname(dtsPath), { recursive: true });
  fs.writeFileSync(dtsPath, dts, "utf-8");

  const oldSiblingPath = path.resolve(htmlPath).replace(/\.ui\.html$/i, ".ui.d.html.ts");
  if (oldSiblingPath !== dtsPath && fs.existsSync(oldSiblingPath)) {
    try {
      const existing = fs.readFileSync(oldSiblingPath, "utf-8");
      if (existing.startsWith("// Auto-generated by cuttlefish")) {
        fs.unlinkSync(oldSiblingPath);
      }
    } catch {
      // Best-effort cleanup only; stale generated siblings are harmless.
    }
  }
}

