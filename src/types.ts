// ---------------------------------------------------------------------------
// Element types — the shape of typed `.ui.html` imports.
//
// Every interactive element has a `.value` property that is both readable
// and writable. Writing updates the display; reading returns the current
// state. Pin input (onToggle/onPress/onChange) auto-updates `.value`.
//
// The press/release methods are for the :pressed transition state.
// ---------------------------------------------------------------------------

/** Base interface: all elements have a readable/writable .value. */
export interface UIElement {
  /** The element's state. check: 0/1, button: 0/1, select: 0..N, text: number.
   *  Reading returns the current state; writing updates the display. */
  value: number;
  /** Fires on short tap (touch down + up within 600ms). */
  onClick(callback?: () => void): void;
  /** Fires on long press (touch held ≥600ms). */
  onHold(callback?: () => void): void;
  /** Fires when finger lifts off the element. */
  onRelease(callback?: () => void): void;
}

/** GPIO edge handlers for :pressed transitions. */
export interface PressBinding {
  onPress(pin: number | string): void;
  onRelease(pin: number | string): void;
}

export type TextElement = UIElement & PressBinding & {
  readonly __kind: "text";
  onChange(pin: number, optionCount: number, onChange?: () => void): void;
};
export type ButtonElement = UIElement & PressBinding & { readonly __kind: "button" };
export type ViewElement = UIElement & {
  readonly __kind: "view";
  onToggle(pin: number, onChange?: () => void): void;
  onChange(pin: number, optionCount: number, onChange?: () => void): void;
};

/** A checkbox element. .value is 0 (unchecked) or 1 (checked). */
export interface CheckElement extends UIElement {
  readonly __kind: "check";
  /** Watch a GPIO pin for falling edges. Flips .value automatically.
   *  Optional callback runs after the flip. */
  onToggle(pin: number, onChange?: () => void): void;
}

/** A selector element. .value cycles 0..N-1 on tap. Text auto-shows the option. */
export interface SelectElement extends UIElement {
  readonly __kind: "select";
}

/** A radio element. .value is 0 (unselected) or 1 (selected).
 *  Radios with the same name attribute are mutually exclusive. */
export interface RadioElement extends UIElement {
  readonly __kind: "radio";
}

/** A progress bar. .value is 0-100 (percentage filled). Read-only display. */
export interface ProgressElement extends UIElement {
  readonly __kind: "progress";
}

/** A slider/range. .value is between min and max (default 0-100).
 *  Drag the thumb or write .value to change it. */
export interface RangeElement extends UIElement {
  readonly __kind: "range";
  /** Fires whenever .value changes during a drag. Read screen.elem.value
   *  inside the callback to get the new value. */
  onChange(callback?: () => void): void;
}

/** A text input. .text is the string value; tap opens the on-screen keyboard. */
export interface InputElement extends UIElement {
  readonly __kind: "input";
  /** The current text value. Reading returns the string; writing updates the display. */
  text: string;
  /** Fires when the text changes (after the keyboard commits). */
  onChange(callback?: () => void): void;
}

/** Drawing context handed to a ui.drawCanvas callback. Each method maps to a
 *  display graphics primitive; coordinates are canvas-relative ((0,0) = element
 *  top-left) and drawing is auto-clipped to the buffer. Color args are CSS color
 *  strings resolved to RGB565 at transpile time. */
export interface CanvasCtx {
  /** Read-only canvas buffer dimensions (px). */
  readonly width: number;
  readonly height: number;
  drawPixel(x: number, y: number, color: string): void;
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  fillRoundRect(x: number, y: number, w: number, h: number, r: number, color: string): void;
  roundRect(x: number, y: number, w: number, h: number, r: number, color: string): void;
  line(x0: number, y0: number, x1: number, y1: number, color: string): void;
  hline(x: number, y: number, w: number, color: string): void;
  vline(x: number, y: number, h: number, color: string): void;
  fillCircle(x: number, y: number, r: number, color: string): void;
  circle(x: number, y: number, r: number, color: string): void;
  rgbBitmap(x: number, y: number, data: number[], w: number, h: number): void;
  text(x: number, y: number, str: string, color?: string): void;
  fillScreen(color: string): void;
}

/** A user-drawn canvas. Contents are drawn by a ui.drawCanvas callback each
 *  frame using the display shim primitives (fillRect, line, circle, text, ...).
 *  Coordinates are canvas-relative ((0,0) = top-left); drawing is auto-clipped. */
export interface CanvasElement extends UIElement {
  readonly __kind: "canvas";
}

/**
 * Loose index signature used as the *fallback* type before the transpiler
 * emits the precise per-file `.d.ts`. The cuttlefish transpiler generates a
 * concrete `ScreenTree` for each `.ui.html` file with named fields matching
 * the `id` attributes in the source (e.g. `screen.counter`, `screen.btn`),
 * which is what editor autocomplete and type-checking actually use.
 *
 * Do NOT tighten this to a literal union or remove the index signature —
 * concrete generated interfaces are structurally assignable to this loose
 * shape, and `ui.mount(tree: unknown)` accepts it. The index signature only
 * needs to *permit* the call; the transpiler validates the real structure.
 */
export interface ScreenTree {
  [id: string]: TextElement | ButtonElement | ViewElement | CheckElement | SelectElement | RadioElement | ProgressElement | RangeElement | InputElement | CanvasElement;
}
