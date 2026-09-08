import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { DisplayProfile } from "@typecad/cuttlefish/api/shared";
import { effectiveDisplaySize, resolveDisplayProfile, GLCDFONT_BYTES } from "@typecad/cuttlefish/api/shared";
import { ResolvedTypecadConfig } from "@typecad/cuttlefish/config-loader";
import { parseCss, parseFontFaces, parseKeyframes } from "../ui-engine/css-parser.js";
import { expandCssImports } from "../ui-engine/css-imports.js";
import { injectDefaultFontFaces } from "../ui-engine/default-font.js";
import { extractStyleBlocks, parseHtmlWithKeyboards } from "../ui-engine/html-parser.js";
import { splitUiFile } from "../ui-engine/ui-file-splitter.js";
import { buildUIFontAssets } from "../ui-engine/font-assets.js";
import { loadImageAssets, applyDecodedImageSizes } from "../ui-engine/image-assets.js";
import { warmUpImageDecoding } from "../ui-engine/image-decode.js";
import { SHADCN_KIT_CSS } from "../ui-engine/shadcn-kit.js";
import { buildKeyframeSets } from "../ui-engine/keyframes.js";
import { measure, measureWithFonts, type Box } from "../ui-engine/layout-engine.js";
import { lowerUIToModel } from "../ui-engine/model.js";
import { selectEngine } from "../ui-engine/select-engine.js";
import { resolveStyles, type StyledNode } from "../ui-engine/style-resolver.js";
import { getThemeClass, setThemeClass } from "@typecad/cuttlefish/stores/theme-store";
import type {
  PreviewBindingSpec,
  PreviewCallbackSpec,
  PreviewDiagnostic,
  PreviewInitialAssignment,
  PreviewIntervalSpec,
  PreviewListBindingSpec,
  PreviewPinControlSpec,
  PreviewCanvasBindingSpec,
  PreviewModuleVarSpec,
  PreviewSnapshot,
} from "./types.js";

export interface BuildPreviewSnapshotOptions {
  config: ResolvedTypecadConfig;
  projectRoot: string;
}

interface UIModuleImport {
  treeName: string;
  htmlPath: string;
}

function nodeIndexById(programNodes: Array<{ id?: string }>, id: string): number | undefined {
  const found = programNodes.find((node) => node.id === id);
  return found?.id ? programNodes.indexOf(found) : undefined;
}

/** Convert a `{expr}` interpolation text into a TS template-literal expression
 *  string the preview can evaluate. E.g. `taps: {count}` → `` `taps: ${count}` ``.
 *  Mirrors lowerInterpolationText's scanning but produces a JS expression rather
 *  than a snprintf format string. Returns undefined when there's no interpolation.
 *
 *  Each interpolation is wrapped in a boolean→number coercion because hardware
 *  lowers HTML `{expr}` interpolations via snprintf("%d") (numericFormat default;
 *  see lowerInterpolationText), so a bool prints as 1/0 on the device. JS
 *  `${true}` would otherwise stringify as "true". The coercion is a no-op for
 *  numbers and strings (Number("x") is NaN, but the HTML {expr} path is
 *  documented numeric-only — string-signal interpolation belongs to the
 *  ui.bind path, which has type information). */
function interpolationToExpression(raw: string): string | undefined {
  const parts: string[] = [];
  let hasInterp = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < raw.length && depth > 0) {
        if (raw[j] === "{") depth++;
        else if (raw[j] === "}") depth--;
        if (depth === 0) break;
        j++;
      }
      const content = raw.slice(i + 1, j);
      if (depth === 0 && content.length > 0 && !content.includes("{")) {
        hasInterp = true;
        // Coerce via Number(): HTML {expr} interpolations lower to snprintf
        // "%d" on hardware (numericFormat default), so bool→1/0 and the numeric
        // value passes through unchanged. Number(5)===5, Number(true)===1.
        parts.push("${Number(" + content.trim() + ")}");
        i = j + 1;
        continue;
      }
    }
    // Literal text — escape backticks and ${ in the literal parts.
    parts.push(ch === "`" ? "\\`" : (ch === "$" && raw[i + 1] === "{") ? "\\${" : ch);
    i++;
  }
  if (!hasInterp) return undefined;
  return "`" + parts.join("") + "`";
}

/** Warn about interactive nodes the preview cannot wire because they lack an
 *  id: on:* handlers, bind:* bindings, and {expr} interpolations all resolve
 *  their node by id in the preview (the device build auto-wires them without
 *  one). Without this the element renders but never reacts. */
function warnUnnamedInteractiveNodes(trees: StyledNode[], diagnostics: PreviewDiagnostic[]): void {
  const walk = (node: StyledNode): void => {
    if (!node.id) {
      const features: string[] = [];
      if (node.events && Object.keys(node.events).length > 0) features.push(`on:${Object.keys(node.events).join("/on:")}`);
      if (node.bind && Object.keys(node.bind).length > 0) features.push(`bind:${Object.keys(node.bind).join("/bind:")}`);
      if (node.hasInterpolation) features.push("{expr} interpolation");
      // Images key their loaded asset by node id too (image-assets.ts skips
      // id-less <img src> silently) — warn so empty frames are explainable.
      if (node.tag === "img" && (node as unknown as { src?: string }).src) features.push("img src");
      if (features.length > 0) {
        diagnostics.push({
          severity: "warning",
          message: `<${node.tag}> uses ${features.join(", ")} but has no id — the preview loads/wires these by id, so the element renders empty or inert. Add an id, e.g. <${node.tag} id="${node.tag}1"> (the device build behaves the same).`,
        });
      }
    }
    node.children?.forEach(walk);
  };
  trees.forEach(walk);
}

/** Walk styled trees for {expr} interpolation nodes and synthesize preview text
 *  bindings (mirroring the runtime's auto-wire synthesis). Each produces a
 *  PreviewBindingSpec whose expression is a template-literal the preview evals. */
function collectInterpolationBindings(
  trees: StyledNode[],
  programNodes: Array<{ id?: string }>,
): PreviewBindingSpec[] {
  const out: PreviewBindingSpec[] = [];
  const walk = (node: StyledNode): void => {
    if (node.hasInterpolation && node.text) {
      const expression = interpolationToExpression(node.text);
      if (expression) {
        // Resolve nodeIndex by id; interpolation nodes may lack an id (when the
        // text references a signal directly), but the demo keeps the id for CSS.
        const nodeIndex = node.id ? nodeIndexById(programNodes, node.id) : undefined;
        if (nodeIndex !== undefined) {
          out.push({ nodeId: node.id ?? `__interp_${nodeIndex}`, nodeIndex, property: "text", expression });
        }
      }
    }
    node.children?.forEach(walk);
  };
  trees.forEach(walk);
  return out;
}

/** Walk styled trees for on:* declarative event handlers and synthesize preview
 *  callback specs. Each on:click="saveSettings" becomes the named function's
 *  body when the source is available, so preview callbacks execute the same
 *  author code the device emits as a standalone function. */
function collectEventCallbacks(
  trees: StyledNode[],
  programNodes: Array<{ id?: string }>,
  namedFunctionBodies: Map<string, string>,
): PreviewCallbackSpec[] {
  const out: PreviewCallbackSpec[] = [];
  const walk = (node: StyledNode): void => {
    if (node.events) {
      const nodeIndex = node.id ? nodeIndexById(programNodes, node.id) : undefined;
      if (nodeIndex !== undefined) {
        for (const kind of ["click", "hold", "release", "change"] as const) {
          const fn = node.events[kind];
          if (fn) {
            out.push({ nodeId: node.id ?? `__event_${nodeIndex}`, nodeIndex, kind, body: namedFunctionBodies.get(fn) ?? `${fn}()` });
          }
        }
      }
    }
    node.children?.forEach(walk);
  };
  trees.forEach(walk);
  return out;
}

/** Walk styled trees for bind:* declarative two-way bindings. Returns the READ
 *  half (signal → node) as preview bindings AND the WRITE half (node → signal)
 *  as preview callbacks. bind:text write-back fires on the keyboard-commit
 *  "change" dispatch (keyboardClose → dispatch("change", target)); the callback
 *  body reads the committed text via screen.<id>.text and calls signal.set.
 *  bind:value write-back fires on the check "click" or range "rangechange"
 *  event — matching the runtime kinds in ui-element-auto-wire.ts:136 so the
 *  preview dispatches them on the same gestures the device does. */
function collectBindBindings(
  trees: StyledNode[],
  programNodes: Array<{ id?: string }>,
): { bindings: PreviewBindingSpec[]; callbacks: PreviewCallbackSpec[] } {
  const bindings: PreviewBindingSpec[] = [];
  const callbacks: PreviewCallbackSpec[] = [];
  const walk = (node: StyledNode): void => {
    if (node.bind) {
      const nodeIndex = node.id ? nodeIndexById(programNodes, node.id) : undefined;
      if (nodeIndex !== undefined && node.id) {
        if (node.bind.text) {
          // Read: signal → input text.
          bindings.push({ nodeId: node.id, nodeIndex, property: "text", expression: node.bind.text });
          // Write: keyboard commit → signal.set(committed text).
          callbacks.push({ nodeId: node.id, nodeIndex, kind: "change", body: `${node.bind.text}.set(screen.${node.id}.text)` });
        }
        if (node.bind.value) {
          // Read: signal → node value.
          bindings.push({ nodeId: node.id, nodeIndex, property: "value", expression: node.bind.value });
          // Write: range drag (rangechange) / check toggle (click) → signal.set(value).
          // Kinds must match the runtime so the preview fires on the same gesture.
          const valueKind = node.tag === "check" ? "click" : "rangechange";
          callbacks.push({ nodeId: node.id, nodeIndex, kind: valueKind, body: `${node.bind.value}.set(screen.${node.id}.value)` });
        }
      }
    }
    node.children?.forEach(walk);
  };
  trees.forEach(walk);
  return { bindings, callbacks };
}

async function loadProfileRegistry(frameworkPackage: string | undefined): Promise<Map<string, DisplayProfile>> {
  const registry = new Map<string, DisplayProfile>();
  if (!frameworkPackage) return registry;
  // Every framework package exports its named profiles as BUILT_IN_PROFILES
  // in the shared DisplayProfile shape (Arduino: the displays modules; Zephyr:
  // the display barrel, mapped from its DT-binding descriptors). Try each
  // known entry point — the miss is expected per framework — so this loader
  // stays layout-agnostic and profile names resolve identically here and via
  // the strategy's getProfileRegistry() (which transpile.ts uses).
  for (const modPath of [frameworkPackage + "/displays/ili9341-spi", frameworkPackage + "/display"]) {
    const mod = await import(modPath).catch(() => null);
    const profiles = (mod as { BUILT_IN_PROFILES?: Record<string, DisplayProfile> } | null)?.BUILT_IN_PROFILES;
    if (profiles) {
      for (const [key, value] of Object.entries(profiles)) {
        registry.set(key, value);
      }
      break;
    }
  }
  return registry;
}

/** Load the stock 5x7 GFX font for the preview runtime. A project-local
 *  Adafruit_GFX copy wins (byte-identical to what the firmware compiles
 *  against); otherwise fall back to the table bundled in
 *  @typecad/cuttlefish (api/shared glcdfont.ts) so stock-font text renders
 *  without a vendored library. */
export function loadFont(projectRoot: string, diagnostics: PreviewDiagnostic[]): number[] {
  const fontPath = path.join(projectRoot, "lib", "Adafruit_GFX_Library", "glcdfont.c");
  if (!fs.existsSync(fontPath)) {
    return GLCDFONT_BYTES.slice(0, 1280);
  }
  const source = fs.readFileSync(fontPath, "utf-8");
  const match = /font\[\]\s+PROGMEM\s*=\s*\{([\s\S]*?)\};/.exec(source);
  const body = match?.[1] ?? source;
  const bytes = [...body.matchAll(/0x([0-9a-fA-F]{1,2})/g)].map((m) => parseInt(m[1], 16));
  if (bytes.length < 1280) {
    diagnostics.push({
      severity: "warning",
      message: `Parsed ${bytes.length} font bytes from ${fontPath}; expected 1280.`,
    });
  }
  return bytes.slice(0, 1280);
}

function callbackBodyText(cb: ts.Expression | undefined, source: ts.SourceFile): string {
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return "";
  if (ts.isExpression(cb.body)) return `${cb.body.getText(source)};`;
  return cb.body.statements.map((statement) => statement.getText(source)).join("\n");
}

function collectNamedFunctionBodies(source: ts.SourceFile): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    bodies.set(statement.name.text, statement.body.statements.map((s) => s.getText(source)).join("\n"));
  }
  return bodies;
}

function callbackExpressionText(cb: ts.Expression | undefined, source: ts.SourceFile): string | undefined {
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return undefined;
  if (ts.isExpression(cb.body)) return cb.body.getText(source);
  for (const statement of cb.body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression.getText(source);
    }
  }
  return undefined;
}

function callbackFirstParamName(cb: ts.Expression | undefined): string | undefined {
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return undefined;
  const param = cb.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return undefined;
  return param.name.text;
}

function numericArgText(arg: ts.Expression | undefined, source: ts.SourceFile, fallback: string): string {
  if (!arg) return fallback;
  if (ts.isNumericLiteral(arg)) return arg.text;
  if (ts.isIdentifier(arg)) return arg.text;
  return arg.getText(source);
}

function readTreeElement(expr: ts.Expression): { treeName: string; elemId: string } | undefined {
  if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.expression)) return undefined;
  return { treeName: expr.expression.text, elemId: expr.name.text };
}

function readTreeElementMethod(call: ts.CallExpression): { treeName: string; elemId: string; method: string } | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  const receiver = call.expression.expression;
  const element = readTreeElement(receiver);
  return element ? { ...element, method } : undefined;
}

function findUIModuleImports(
  source: ts.SourceFile,
  entryDir: string,
  diagnostics: PreviewDiagnostic[],
): UIModuleImport[] {
  const imports: UIModuleImport[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.endsWith(".ui.html")) {
      if (statement.importClause?.name) {
        imports.push({
          treeName: statement.importClause.name.text,
          htmlPath: path.resolve(entryDir, specifier),
        });
      }
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          imports.push({
            treeName: element.name.text,
            htmlPath: path.resolve(entryDir, specifier),
          });
        }
      }
    } else if (specifier.includes("/lib/") || specifier.startsWith("../lib/") || specifier.startsWith("./lib/")) {
      diagnostics.push({
        severity: "info",
        message: `Preview is stubbing embedded-only import "${specifier}".`,
      });
    }
  }
  return imports;
}

function themeCssPath(displayThemeCss: string | undefined, htmlPath: string, configDir: string): string {
  if (!displayThemeCss) return htmlPath.replace(/\.ui\.html$/, ".ui.css");
  return path.isAbsolute(displayThemeCss)
    ? displayThemeCss
    : path.resolve(configDir, displayThemeCss);
}

function collectHrefCallbacks(
  screens: StyledNode[],
  programNodes: Array<{ id?: string }>,
): PreviewCallbackSpec[] {
  const screenIds = new Map<string, number>();
  screens.forEach((screen, index) => {
    if (screen.id) screenIds.set(screen.id, index);
  });

  const callbacks: PreviewCallbackSpec[] = [];

  // Walk in document order with a running index, matching how lowerUIToModel
  // assigns node indices (flatten(): index = cursor.i++ for every node, depth-
  // first). The cursor advances by each subtree's size, so a child's index is
  // always (parent + 1 + sum of earlier siblings' subtree sizes). This lets us
  // resolve id-less <a href> links the same way the device does
  // (ui-element-auto-wire.ts wires any node with href, id or not).
  const visit = (node: StyledNode, nodeIndex: number): number => {
    if (node.href) {
      const target = node.href.startsWith("#") ? node.href.slice(1) : node.href;
      const targetScreen = screenIds.get(target);
      if (targetScreen !== undefined && nodeIndex < programNodes.length) {
        callbacks.push({
          nodeId: node.id ?? `__ui_link${nodeIndex}_nav`,
          nodeIndex,
          kind: "click",
          body: `ui.navigate(${targetScreen});`,
        });
      }
    } else if (node.runs?.some(r => r.href)) {
      // Run-bearing link node (inline <a href> inside a paragraph). The link
      // targets are resolved into the model at lower time; the preview tap path
      // calls richLinkHit to pick the target. Register a no-op click callback so
      // the node is hit-testable.
      if (nodeIndex < programNodes.length) {
        callbacks.push({
          nodeId: node.id ?? `__ui_richlink${nodeIndex}_nav`,
          nodeIndex,
          kind: "click",
          body: `/* rich-text link; target resolved by richLinkHit */`,
        });
      }
    }
    let nextIndex = nodeIndex + 1;
    for (const child of node.children) nextIndex = visit(child, nextIndex);
    return nextIndex;
  };

  // Each screen is a contiguous subtree in the flattened node table; find where
  // screen i starts (first node with that screenId) and walk its styled tree.
  for (let i = 0; i < screens.length; i++) {
    const startIndex = programNodes.findIndex((n) => (n as { screenId?: number }).screenId === i);
    if (startIndex >= 0) visit(screens[i], startIndex);
  }
  return callbacks;
}

function extractAuthorSpecs(
  source: ts.SourceFile,
  uiImports: UIModuleImport[],
  programNodes: Array<{ id?: string; tag?: string; kind?: string; options?: Array<{ text: string; value: string }> }>,
): {
  bindings: PreviewBindingSpec[];
  listBindings: PreviewListBindingSpec[];
  callbacks: PreviewCallbackSpec[];
  initialAssignments: PreviewInitialAssignment[];
  intervals: PreviewIntervalSpec[];
  pinControls: PreviewPinControlSpec[];
  canvasBindings: PreviewCanvasBindingSpec[];
  moduleVars: PreviewModuleVarSpec[];
  diagnostics: PreviewDiagnostic[];
} {
  const diagnostics: PreviewDiagnostic[] = [];
  const importedTrees = new Set(uiImports.map((imp) => imp.treeName));
  const bindings: PreviewBindingSpec[] = [];
  const listBindings: PreviewListBindingSpec[] = [];
  const callbacks: PreviewCallbackSpec[] = [];
  const initialAssignments: PreviewInitialAssignment[] = [];
  const intervals: PreviewIntervalSpec[] = [];
  const pinControls: PreviewPinControlSpec[] = [];
  const canvasBindings: PreviewCanvasBindingSpec[] = [];
  const moduleVars: PreviewModuleVarSpec[] = [];

  const resolveNode = (treeName: string, elemId: string): number | undefined => {
    if (!importedTrees.has(treeName)) return undefined;
    const idx = nodeIndexById(programNodes, elemId);
    if (idx === undefined) {
      diagnostics.push({ severity: "warning", message: `Preview could not find UI element "${treeName}.${elemId}".` });
    }
    return idx;
  };

  for (const statement of source.statements) {
    // Top-level `let`/`const`/`var` declarations become module-scoped bindings
    // the device hoists to C++ globals. Capture each declared name + initializer
    // so callback bodies (setInterval, onClick, ui.bind, ...) that reference them
    // resolve at preview runtime instead of throwing ReferenceError.
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          moduleVars.push({
            name: decl.name.text,
            initializer: decl.initializer ? decl.initializer.getText(source) : undefined,
          });
        }
      }
      continue;
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      const expr = statement.expression;
      if (
        expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(expr.left) &&
        expr.left.name.text === "value"
      ) {
        const element = readTreeElement(expr.left.expression);
        if (element) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            initialAssignments.push({
              nodeId: element.elemId,
              nodeIndex,
              expression: expr.right.getText(source),
            });
          }
        }
      }
      continue;
    }

    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;

    if (ts.isIdentifier(call.expression) && call.expression.text === "setInterval") {
      const delay = call.arguments[1] && ts.isNumericLiteral(call.arguments[1])
        ? Number(call.arguments[1].text)
        : 0;
      intervals.push({ body: callbackBodyText(call.arguments[0], source), delayMs: delay });
      continue;
    }

    if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression)) {
      const objectName = call.expression.expression.text;
      const method = call.expression.name.text;
      if (objectName === "ui" && method === "bind") {
        const elementArg = call.arguments[0];
        const propArg = call.arguments[1];
        const fnArg = call.arguments[2];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        const property = propArg && ts.isStringLiteral(propArg) ? propArg.text : "text";
        const expression = callbackExpressionText(fnArg, source);
        if (element && expression) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            bindings.push({ nodeId: element.elemId, nodeIndex, property, expression });
          }
        }
        continue;
      }
      if (objectName === "ui" && method === "bindList") {
        const elementArg = call.arguments[0];
        const countArg = call.arguments[1];
        const itemArg = call.arguments[2];
        const tapArg = call.arguments[3];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        const countExpression = callbackExpressionText(countArg, source);
        const itemExpression = callbackExpressionText(itemArg, source);
        if (element && countExpression && itemExpression) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            listBindings.push({
              nodeId: element.elemId,
              nodeIndex,
              countExpression,
              itemExpression,
              itemParam: callbackFirstParamName(itemArg),
              tapBody: tapArg ? callbackBodyText(tapArg, source) : undefined,
              tapParam: callbackFirstParamName(tapArg),
            });
          }
        }
        continue;
      }
      if (objectName === "ui" && method === "bindInput") {
        // ui.bindInput(node, cb): cb fires with the input's committed text on
        // keyboard close. Collect as a "change" callback (the keyboard-commit
        // dispatch kind) and record the cb's first param so the dispatch path
        // can bind the text to it as a local. Mirrors resolveBindInputCall,
        // which renames the arrow's param to `text` in the lowered C++.
        const elementArg = call.arguments[0];
        const cbArg = call.arguments[1];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        if (element && cbArg && (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg))) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            const param = callbackFirstParamName(cbArg);
            callbacks.push({
              nodeId: element.elemId,
              nodeIndex,
              kind: "change",
              body: callbackBodyText(cbArg, source),
              // The runtime renames the param to `text`; record the author's
              // name so we can bind the committed text under whichever name the
              // body actually references. If absent, default to `text`.
              param: param ?? "text",
            });
          }
        }
        continue;
      }
      if (objectName === "ui" && method === "drawCanvas") {
        const elementArg = call.arguments[0];
        const cbArg = call.arguments[1];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        if (element && cbArg && (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg))) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            canvasBindings.push({
              nodeId: element.elemId,
              nodeIndex,
              drawBody: callbackBodyText(cbArg, source),
            });
          }
        }
        continue;
      }
      if (objectName === "ui" && method === "watchPin") {
        const pin = numericArgText(call.arguments[0], source, "0");
        pinControls.push({
          label: `ui.watchPin(${pin})`,
          kind: "watch",
          pin,
          body: callbackBodyText(call.arguments[1], source),
        });
      }
    }

    const elementMethod = readTreeElementMethod(call);
    if (!elementMethod) continue;
    const nodeIndex = resolveNode(elementMethod.treeName, elementMethod.elemId);
    if (nodeIndex === undefined) continue;

    if (elementMethod.method === "onClick" || elementMethod.method === "onHold" || elementMethod.method === "onRelease") {
      callbacks.push({
        nodeId: elementMethod.elemId,
        nodeIndex,
        kind: elementMethod.method === "onClick" ? "click" : elementMethod.method === "onHold" ? "hold" : "release",
        body: callbackBodyText(call.arguments[0], source),
      });
    } else if (elementMethod.method === "onToggle") {
      const pin = numericArgText(call.arguments[0], source, "0");
      pinControls.push({
        label: `${elementMethod.elemId}.onToggle(${pin})`,
        kind: "toggle",
        pin,
        nodeId: elementMethod.elemId,
        nodeIndex,
        body: callbackBodyText(call.arguments[1], source),
      });
    } else if (elementMethod.method === "onChange") {
      const nodeInfo = programNodes[nodeIndex];
      if (nodeInfo?.tag === "input" || nodeInfo?.kind === "input") {
        callbacks.push({
          nodeId: elementMethod.elemId,
          nodeIndex,
          kind: "change",
          body: callbackBodyText(call.arguments[0], source),
        });
        continue;
      }
      const pin = numericArgText(call.arguments[0], source, "0");
      const count = call.arguments[1] && ts.isNumericLiteral(call.arguments[1])
        ? Number(call.arguments[1].text)
        : Math.max(programNodes[nodeIndex].options?.length ?? 0, 2);
      pinControls.push({
        label: `${elementMethod.elemId}.onChange(${pin})`,
        kind: "change",
        pin,
        nodeId: elementMethod.elemId,
        nodeIndex,
        optionCount: count,
        body: callbackBodyText(call.arguments[2], source),
      });
    } else if (elementMethod.method === "onPress" || elementMethod.method === "onRelease") {
      const pin = numericArgText(call.arguments[0], source, "0");
      pinControls.push({
        label: `${elementMethod.elemId}.${elementMethod.method}(${pin})`,
        kind: elementMethod.method === "onPress" ? "press" : "release",
        pin,
        nodeId: elementMethod.elemId,
        nodeIndex,
      });
    }
  }

  return { bindings, listBindings, callbacks, initialAssignments, intervals, pinControls, canvasBindings, moduleVars, diagnostics };
}

export async function buildPreviewSnapshot(options: BuildPreviewSnapshotOptions): Promise<PreviewSnapshot> {
  const { config, projectRoot } = options;
  const diagnostics: PreviewDiagnostic[] = [];
  const configDir = path.dirname(config.configPath);
  if (!config.entry) {
    throw new Error(`typecad-hal preview requires an entry field in ${config.configPath}`);
  }

  const entryFile = path.resolve(configDir, config.entry);
  const entrySource = fs.readFileSync(entryFile, "utf-8");
  const entryDir = path.dirname(entryFile);
  const entryExt = path.extname(entryFile).toLowerCase();

  let sourceFile: ts.SourceFile;
  let htmlText: string;
  let cssText: string;
  let cssFileDir: string;     // directory @imports inside cssText resolve from
  let htmlFilePath: string;   // the effective .ui.html path (real or synthetic)
  let uiImports: UIModuleImport[];

  if (entryExt === ".ui") {
    // .ui single-file component: split into script/style/template.
    const parts = splitUiFile(entrySource);
    const baseName = path.basename(entryFile, ".ui");
    htmlFilePath = entryFile + ".html";  // synthetic .ui.html path
    // Inject the implicit screen import so the script's `screen` reference
    // resolves during preview-expression evaluation.
    const scriptWithImport = `import { screen } from './${baseName}.ui.html';\n` + parts.script;
    sourceFile = ts.createSourceFile(entryFile, scriptWithImport, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    htmlText = parts.html;
    cssText = parts.style;
    cssFileDir = entryDir;
    uiImports = [{ treeName: "screen", htmlPath: htmlFilePath }];
  } else {
    sourceFile = ts.createSourceFile(entryFile, entrySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    uiImports = findUIModuleImports(sourceFile, entryDir, diagnostics);
    const firstImport = uiImports[0];
    if (!firstImport) {
      throw new Error(`Preview could not find a .ui.html import in ${entryFile}`);
    }
    if (uiImports.length > 1) {
      diagnostics.push({
        severity: "warning",
        message: "Preview v1 renders the first imported UI tree only.",
      });
    }
    htmlFilePath = firstImport.htmlPath;
    htmlText = fs.readFileSync(firstImport.htmlPath, "utf-8");
    const cssPath = themeCssPath(config.display?.themeCss, firstImport.htmlPath, configDir);
    cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf-8") : "";
    cssFileDir = path.dirname(cssPath);
  }

  const registry = await loadProfileRegistry(config.framework);
  const resolved = resolveDisplayProfile(config.display ?? { profile: "ili9341-spi" }, registry);
  const profile = resolved.profile;
  const displaySize = effectiveDisplaySize(profile);
  const parsedHtml = parseHtmlWithKeyboards(htmlText);
  // @import parity with the CLI build (loadUIModuleFromText in ui-registry.ts
  // expands imports before parsing). Without this, `@import "./styles/shadcn.css"`
  // in a .ui <style> stays literal in the preview, the kit's tokens never load,
  // and model lowering rejects the raw var() color strings. The sidecar css and
  // the html style blocks can live in different directories, so each part
  // expands against its own base.
  // Built-in shadcn kit first (device parity with ui-registry): user token
  // blocks and recipe overrides win by cascade order.
  const fullCss =
    SHADCN_KIT_CSS + "\n" +
    expandCssImports(cssText, cssFileDir) + "\n" +
    expandCssImports(extractStyleBlocks(htmlText), path.dirname(htmlFilePath));
  const cssRules = (() => {
    const previousThemeClass = getThemeClass();
    setThemeClass(config.display?.themeClass ?? null);
    try {
      return parseCss(fullCss);
    } finally {
      setThemeClass(previousThemeClass);
    }
  })();
  // Default-font parity with the CLI build (ui-registry.ts / transpile-ui.ts
  // both inject the bundled DejaVu faces before planning font assets). Without
  // this the UA root's font-family: "DejaVu Sans" resolves to no face and the
  // preview falls back to the smoothed 5x7 — the device renders real AA glyphs.
  const fontFaces = injectDefaultFontFaces(parseFontFaces(fullCss), profile.colorFormat);
  const rawKeyframes = parseKeyframes(fullCss);
  const styled = resolveStyles(parsedHtml.tree, cssRules);
  const allStyledScreens = parsedHtml.screens.map((screen) => resolveStyles(screen, cssRules));
  const fontRoot: StyledNode = { tag: "screen", classes: [], style: {}, children: allStyledScreens };
  // Script-side ui.bind(..., 'text', ...) targets render runtime strings the
  // static template can't predict — collect their ids so font planning widens
  // those faces to the fallback charset (markup {expr} and bind:text are
  // detected from the tree inside the planner).
  const dynamicTextIds = new Set<string>();
  const bindTextRe = /ui\.bind\(\s*screen\.([A-Za-z_$][\w$]*)\s*,\s*["']text["']/g;
  for (const m of sourceFile.text.matchAll(bindTextRe)) dynamicTextIds.add(m[1]);
  const fontAssets = buildUIFontAssets(fontRoot, fontFaces, path.dirname(htmlFilePath), dynamicTextIds);
  // Prime the image-conversion cache (<img src="*.png|jpg|ico|…"> decodes
  // here) and give id-less-size img nodes their natural geometry before the
  // synchronous layout + asset pass below.
  await warmUpImageDecoding(htmlText, path.dirname(htmlFilePath), { maxW: displaySize.width, maxH: displaySize.height });
  applyDecodedImageSizes(allStyledScreens.length > 0 ? allStyledScreens : [styled], path.dirname(htmlFilePath));
  const viewport: Box = { x: 0, y: 0, w: displaySize.width, h: displaySize.height };
  const boxes = allStyledScreens.flatMap((screen) => {
    const engine = selectEngine(screen);
    return engine.arrange(screen, viewport, measureWithFonts(fontAssets));
  });
  const keyframeSets = buildKeyframeSets(rawKeyframes, profile.colorFormat);
  const imageAssets = loadImageAssets(allStyledScreens.length > 0 ? allStyledScreens : [styled], path.dirname(htmlFilePath));
  const program = lowerUIToModel(styled, boxes, profile.colorFormat, profile, fontAssets, allStyledScreens, imageAssets.nodeIdToAssetIndex, keyframeSets, imageAssets.assets);
  const specs = extractAuthorSpecs(sourceFile, uiImports, program.nodes);
  const hrefCallbacks = collectHrefCallbacks(allStyledScreens, program.nodes);
  // on:*/bind:*/{expr} features resolve their node by id — the device build
  // auto-wires id-less nodes, but the preview's binding/callback tables key on
  // id, so an unnamed interactive node is silently inert here. Make that
  // visible instead of a dead button.
  warnUnnamedInteractiveNodes(allStyledScreens, diagnostics);
  // {expr} interpolation bindings synthesized from the HTML (mirrors the runtime's
  // auto-wire synthesis). Authors write `taps: {count}` in markup; this collects
  // them so the preview evaluates the template-literal expression each frame.
  const interpolationBindings = collectInterpolationBindings(
    allStyledScreens.length > 0 ? allStyledScreens : [styled],
    program.nodes,
  );
  // on:* declarative event handlers from markup → preview callbacks (named fn).
  const eventCallbacks = collectEventCallbacks(
    allStyledScreens.length > 0 ? allStyledScreens : [styled],
    program.nodes,
    collectNamedFunctionBodies(sourceFile),
  );
  // bind:* declarative two-way bindings: read (signal → node) + write-back
  // (node → signal via change callbacks).
  const bindResult = collectBindBindings(
    allStyledScreens.length > 0 ? allStyledScreens : [styled],
    program.nodes,
  );

  return {
    projectRoot,
    entryFile,
    htmlFile: htmlFilePath,
    profileName: typeof config.display?.profile === "string" ? config.display.profile : undefined,
    program,
    keyboardTemplates: parsedHtml.keyboards,
    cssRules,
    uiTreeNames: [...new Set(uiImports.map((imp) => imp.treeName))],
    font: loadFont(projectRoot, diagnostics),
    bindings: [...specs.bindings, ...interpolationBindings, ...bindResult.bindings],
    listBindings: specs.listBindings,
    callbacks: [...hrefCallbacks, ...specs.callbacks, ...eventCallbacks, ...bindResult.callbacks],
    initialAssignments: specs.initialAssignments,
    intervals: specs.intervals,
    pinControls: specs.pinControls,
    canvasBindings: specs.canvasBindings,
    moduleVars: specs.moduleVars,
    diagnostics: [...diagnostics, ...specs.diagnostics],
  };
}
