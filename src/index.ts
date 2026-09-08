// ---------------------------------------------------------------------------
// @typecad/ui — public authoring API.
//
// These functions are compile-time constructs: the transpiler intercepts
// ui.mount / ui.signal / ui.bind and lowers them to device variables and
// binding-table entries. They have no runtime implementation in the emitted
// C++; their bodies exist only so TypeScript authoring type-checks.
// ---------------------------------------------------------------------------

export type { ScreenTree, TextElement, ButtonElement, ViewElement, PressBinding, CheckElement, SelectElement, RadioElement, ProgressElement, RangeElement, InputElement, CanvasElement, CanvasCtx } from "./types.js";
import type { ScreenTree, CanvasCtx } from "./types.js";

/** Allowed signal value types. The transpiler lowers each of these to a C++
 *  scalar: `number` → int/double, `string` → const char*, `boolean` → bool.
 *  Other types (objects, arrays, null) are rejected at type-check time by
 *  Signal<T extends SignalValue> and at build time by the `ui-signal-initializer`
 *  diagnostic. */
export type SignalValue = number | string | boolean;

/** A reactive signal whose value lives on the device. */
export interface Signal<T extends SignalValue> {
  (): T;
  set(value: T): void;
}

export interface MountOptions {
  /** Display driver id (must be in the framework's supportedDisplayDrivers()). */
  display?: string;
  /** Bus identifier, e.g. "SPI" or "Wire". */
  bus?: string;
  /** Chip-select pin. */
  cs?: number;
  /** Data/command pin. */
  dc?: number;
  /** Reset pin. */
  rst?: number;
  /** Rotation override. Defaults to the project display profile. */
  rotation?: number;
  /** Backlight pin override. Defaults to the project display profile. */
  backlight?: number;
  /** SPI frequency override. Defaults to the project display profile. */
  spiFrequency?: number;
  /** I2C address override for I2C displays. Defaults to the project display profile. */
  address?: number;
  /** Reset pin override for I2C displays. Defaults to the project display profile. */
  reset?: number;
}

/**
 * Mount a baked UI tree to the display configured in `typecad-hal.config.ts`.
 * Optional overrides are available for advanced cases, but ordinary apps should
 * keep hardware setup in the project config and call `ui.mount(screen)`.
 *
 * Validates the driver against the active framework at transpile time
 * (fail-fast). The tree is lowered to a static C++ node table; this call lowers
 * to display.init + the first-frame draw.
 *
 * `tree` is typed loosely (a record of element handles) so the concrete
 * ScreenTree interface generated per .ui.html file — which has concrete named
 * fields rather than an index signature — is assignable. The transpiler
 * intercepts the call structurally; the type only needs to permit it.
 */
export declare function mount(tree: unknown, opts?: MountOptions): void;

/**
 * Declare a reactive signal. Lowers to a plain device variable + dirty flag.
 *
 * Accepts `number`, `string`, or `boolean` literals. Literal values are widened
 * to their primitive type so `ui.signal(0)` returns `Signal<number>` (and
 * `.set(1)` works), not `Signal<0>`. Other types (objects, arrays, null) are
 * rejected at type-check time and at build time with a `ui-signal-initializer`
 * diagnostic.
 */
export declare function signal(initial: number): Signal<number>;
export declare function signal(initial: string): Signal<string>;
export declare function signal(initial: boolean): Signal<boolean>;

/**
 * Bind a node property to a computed value, re-evaluated each tick. When the
 * value changes, the node is marked dirty and (for transition-able properties)
 * the transition is armed.
 */
export declare function bind<K extends string>(
  node: unknown,
  property: K,
  compute: () => unknown,
): void;

/**
 * Subscribe to changes on an `<input>` element's text. The callback fires after
 * the on-screen keyboard commits, with the new text. Use it to push keyboard
 * input back into app state.
 *
 *   let ssid = '';
 *   ui.bindInput(screen.ssid, (text) => { ssid = text; });
 */
export declare function bindInput(node: unknown, onText: (text: string) => void): void;

/**
 * Watch a GPIO pin for falling edges (button press). The callback runs as an
 * async task in the existing microtask pump — no ISRs, natural debounce from
 * the ~20ms poll interval. Safe to write to signals inside the callback.
 *
 *   ui.watchPin(4, () => { count.set(count() + 1); });
 */
export declare function watchPin(pin: number, onFalling: () => void): void;

/**
 * Bind a `<list>` element to dynamic data via two callbacks.
 *
 *   ui.bindList(screen.myList,
 *     () => itemCount,          // total number of items
 *     (i) => `Item ${i}`        // text for item at index i
 *   );
 *
 * The list virtualizes: only visible items are rendered. Scroll by dragging.
 * The count function is called each frame; if the count changes, the list
 * refreshes automatically.
 */
export declare function bindList(
  node: unknown,
  countFn: () => number,
  itemFn: (index: number) => string,
  onTap?: (index: number) => void,
): void;

/**
 * Await the next tap. Must be used inside an `async` function.
 *
 *   async function screensaver() {
 *     while (true) {
 *       await ui.onTap();       // resume on the next tap, anywhere
 *       backlightOn();
 *     }
 *   }
 *
 * With no argument it resumes on the next tap on the screen (including empty
 * space — useful for "wake on any touch"). Pass an element to resume only when
 * that element is tapped:
 *
 *   await ui.onTap(screen.btn);
 *
 * A tap fires BOTH the tapped element's onClick handler AND resumes any
 * `await ui.onTap()` awaiter. Returns a Promise<void>; it is a resume signal,
 * not a value — there is nothing to read from it.
 */
export declare function onTap(node?: unknown): Promise<void>;

/**
 * Register a draw callback for a `<canvas>` element. The callback runs every
 * frame and receives a `ctx` whose methods map to the display graphics
 * primitives. Coordinates are canvas-relative ((0,0) = top-left of the element);
 * drawing is clipped to the canvas buffer.
 *
 *   ui.drawCanvas(screen.spark, (ctx) => {
 *     ctx.fillScreen('black');
 *     ctx.line(0, ctx.height / 2, ctx.width, ctx.height / 2, 'limegreen');
 *     ctx.fillCircle(needleX, 20, 3, 'red');
 *     ctx.text(4, 12, `${temp}°`, 'white');
 *   });
 *
 * Color arguments are CSS color strings resolved to RGB565 at transpile time.
 * `ctx.width` / `ctx.height` are the canvas buffer dimensions.
 */
export declare function drawCanvas(node: unknown, callback: (ctx: CanvasCtx) => void): void;

/**
 * Native desktop (SDL) window controls. These are no-ops on hardware targets
 * (Arduino/AVR/ESP32 have no window); on the SDL target they map to the
 * underlying SDL window calls. The initial title/icon come from
 * `typecad-hal.config.ts` (`display.title` / `display.icon`); these methods
 * change them at runtime.
 */
export interface WindowApi {
  /** Set the OS window title. Native SDL only; no-op on hardware. */
  setTitle(title: string): void;
  /**
   * Set the window/taskbar icon from an image file path. Native SDL only.
   * Note: runtime icon changes require SDL_image; prefer the `display.icon`
   * config option for the common case (loaded once at launch).
   */
  setIcon(path: string): void;
}

// ---------------------------------------------------------------------------
// Runtime fallback.
//
// Every function above is a compile-time construct: the @typecad/cuttlefish
// transpiler intercepts `ui.mount` / `ui.signal` / `ui.bind` / ... calls and
// lowers them to device variables and binding-table entries, so these bodies
// never run on the device. But the package still has to be importable from
// plain Node (editor language servers, the test runner, tooling) without
// crashing, and a forgotten build step should fail loudly rather than silently
// no-op. Each fallback throws an explicit "compile-time construct" error.
//
// The signatures intentionally match the `export declare function` contracts
// above so the public type surface is unchanged.
// ---------------------------------------------------------------------------

const COMPILE_TIME_ERROR = () => {
  throw new Error(
    "@typecad/ui: this function is a compile-time construct. It must be " +
      "lowered by the @typecad/cuttlefish transpiler at build time, not " +
      "called at runtime.",
  );
};

export const ui: {
  mount: typeof mount;
  signal: typeof signal;
  bind: typeof bind;
  bindInput: typeof bindInput;
  bindList: typeof bindList;
  watchPin: typeof watchPin;
  onTap: typeof onTap;
  drawCanvas: typeof drawCanvas;
  window: WindowApi;
} = {
  mount: COMPILE_TIME_ERROR,
  signal: COMPILE_TIME_ERROR,
  bind: COMPILE_TIME_ERROR,
  bindInput: COMPILE_TIME_ERROR,
  bindList: COMPILE_TIME_ERROR,
  watchPin: COMPILE_TIME_ERROR,
  onTap: COMPILE_TIME_ERROR,
  drawCanvas: COMPILE_TIME_ERROR,
  window: {
    setTitle: COMPILE_TIME_ERROR,
    setIcon: COMPILE_TIME_ERROR,
  },
};
export default ui;
