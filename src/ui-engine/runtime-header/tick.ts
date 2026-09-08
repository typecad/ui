// ui_tick (original source lines 3930-5298) split into 5 contiguous phase slices.
// The phases tile 3930-5298 with no gaps; concatenation reproduces the original
// byte-for-byte. No wrapper logic — just ordered concatenation.
import { emitTickBindingsPhase } from "./tick/bindings-phase.js";
import { emitTickTransitionsPhase } from "./tick/transitions-phase.js";
import { emitTickDirtyDrawPhase } from "./tick/dirty-draw-phase.js";
import { emitTickScrollCanvasPhase } from "./tick/scroll-canvas-phase.js";
import { emitTickFlushPhase } from "./tick/flush-phase.js";

export function emitTick(): string {
  return [
    emitTickBindingsPhase(),
    emitTickTransitionsPhase(),
    emitTickDirtyDrawPhase(),
    emitTickScrollCanvasPhase(),
    emitTickFlushPhase(),
  ].join("");
}
