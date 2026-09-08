// ---------------------------------------------------------------------------
// Engine entry point for @typecad/ui.
//
// Cuttlefish dynamically imports this module when UI usage is detected:
//   const engine = await import("@typecad/ui/engine");
//   const hook = await engine.registerTranspilerUI();
//
// registerTranspilerUI() returns an object implementing the TranspilerUIHook
// interface defined in @typecad/cuttlefish. This is the single runtime
// contract between the two packages.
// ---------------------------------------------------------------------------

import type { TranspilerUIHook } from "@typecad/cuttlefish/ui-hook";
import {
  resetUIRegistry, loadUIModule, loadUIModuleFromText, getUIModule,
  hasUIModule, allUIModules, allLoweredUIModules,
  markEntryHasUI, entryHasUI, clearEntryHasUI, lowerOnMount,
  generateProjectUITypeDeclarations,
} from "./ui-engine/ui-registry.js";
import { resolveColor, resolveColorInternal } from "./ui-engine/color.js";
import { emitRuntimeHeader } from "./ui-engine/runtime-header.js";
import { emitCuttlefishGfx } from "./ui-engine/runtime-header/cuttlefish-gfx.js";
import { splitUiFile } from "./ui-engine/ui-file-splitter.js";
import { warmUpImageDecoding } from "./ui-engine/image-decode.js";

export type { TranspilerUIHook };

/**
 * Build and return the TranspilerUIHook — the object cuttlefish core uses
 * to access all UI capabilities (parsing, layout, lowering, emission).
 */
export function registerTranspilerUI(): TranspilerUIHook {
  return {
    resetUIRegistry,
    loadUIModule,
    loadUIModuleFromText,
    getUIModule,
    hasUIModule,
    allUIModules,
    allLoweredUIModules,
    markEntryHasUI,
    entryHasUI,
    clearEntryHasUI,
    lowerOnMount,
    resolveColor,
    resolveColorInternal,
    emitRuntimeHeader,
    emitCuttlefishGfx,
    splitUiFile,
    warmUpImageDecoding,
    generateProjectUITypeDeclarations,
  };
}
