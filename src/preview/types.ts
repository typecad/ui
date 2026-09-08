import type { UIProgram } from "../ui-engine/model.js";
import type { CSSRule } from "../ui-engine/css-parser.js";
import type { KeyboardTemplate } from "../ui-engine/html-parser.js";

export interface PreviewBindingSpec {
  nodeId: string;
  nodeIndex: number;
  property: string;
  expression: string;
}

export interface PreviewCallbackSpec {
  nodeId: string;
  nodeIndex: number;
  // "rangechange" mirrors the runtime's bind:value write-back event for
  // <range> (ui-element-auto-wire.ts:136); the other four are the standard
  // touch/keyboard event kinds.
  kind: "click" | "hold" | "release" | "change" | "rangechange";
  body: string;
  /** For ui.bindInput callbacks: the parameter name that receives the input's
   *  committed text (the runtime renames the arrow's first param to `text`).
   *  When set, the dispatch path binds the committed string to this name as a
   *  local before running the body. */
  param?: string;
}

export interface PreviewInitialAssignment {
  nodeId: string;
  nodeIndex: number;
  expression: string;
}

export interface PreviewListBindingSpec {
  nodeId: string;
  nodeIndex: number;
  countExpression: string;
  itemExpression: string;
  itemParam?: string;
  tapBody?: string;
  tapParam?: string;
}

export interface PreviewIntervalSpec {
  body: string;
  delayMs: number;
}

export interface PreviewPinControlSpec {
  label: string;
  kind: "watch" | "toggle" | "change" | "press" | "release";
  pin: string;
  nodeId?: string;
  nodeIndex?: number;
  optionCount?: number;
  body?: string;
}

export interface PreviewCanvasBindingSpec {
  nodeId: string;
  nodeIndex: number;
  /** The drawBody source text: `ctx.X(...)` calls the host runtime re-lowers. */
  drawBody: string;
}

export interface PreviewModuleVarSpec {
  name: string;
  /** Initializer source text (without the `=`), e.g. "180" for `let x = 180;`. */
  initializer?: string;
}

export interface PreviewDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
}

export interface PreviewSnapshot {
  projectRoot: string;
  entryFile: string;
  htmlFile: string;
  profileName?: string;
  program: UIProgram;
  keyboardTemplates: KeyboardTemplate[];
  cssRules: CSSRule[];
  uiTreeNames: string[];
  font: number[];
  bindings: PreviewBindingSpec[];
  listBindings: PreviewListBindingSpec[];
  callbacks: PreviewCallbackSpec[];
  initialAssignments: PreviewInitialAssignment[];
  intervals: PreviewIntervalSpec[];
  pinControls: PreviewPinControlSpec[];
  canvasBindings: PreviewCanvasBindingSpec[];
  /** Top-level `let`/`const`/`var` declarations, hoisted like the device does. */
  moduleVars: PreviewModuleVarSpec[];
  diagnostics: PreviewDiagnostic[];
}
