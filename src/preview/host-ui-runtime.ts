import { resolveColor, resolveColor888 } from "../ui-engine/color.js";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "../ui-engine/default-keyboards.js";
import type { CSSProperty, CSSRule } from "../ui-engine/css-parser.js";
import type { UIFontAssetModel, UIFontGlyphModel } from "../ui-engine/font-assets.js";
import type { UIImageAsset } from "../ui-engine/image-assets.js";
import type { KeyboardTemplate, UIKeyTemplate } from "../ui-engine/html-parser.js";
import type { AnimationModel, KeyframeSetModel, UINodeModel, UIProgram, UITransitionModel } from "../ui-engine/model.js";
import { resolveScrollConfig } from "@typecad/cuttlefish/api/shared";
import { easeCurveLerpK } from "../ui-engine/easing.js";
import { layoutText } from "../ui-engine/text-layout.js";
import { blendRgb565, blendRgb888, HostAdafruitGFX } from "./host-gfx.js";
import type {
  PreviewBindingSpec,
  PreviewCallbackSpec,
  PreviewInitialAssignment,
  PreviewIntervalSpec,
  PreviewListBindingSpec,
  PreviewPinControlSpec,
  PreviewCanvasBindingSpec,
  PreviewSnapshot,
} from "./types.js";

const UI_TEXT_BUF = 32;
const UI_TOUCH_DEBOUNCE_MS = 50;
const UI_TOUCH_HOLD_MS = 600;
const UI_DRAG_THRESHOLD = 10;
const UI_SCROLL_EDGE_SNAP_PX = 12;
// Scroll physics (preview = capacitive + full-render tier; mirrors the C++ engine).
const UI_SCROLL_MAX_OVERSCROLL = 40;
const UI_SCROLL_STIFFNESS = 0.5;
const UI_SCROLL_SETTLE_MS = 180;
const UI_KB_REPEAT_MS = 100;
const UI_KB_TEXT_H = 24;
const UI_TRANSITION_SNAP_MS = 100;
const UI_MAX_BUFFERED_PAINT_PIXELS = 20000;

const DEFAULT_KEY_BG = 0x4208;
const DEFAULT_KEY_FG = 0xffff;
const DEFAULT_KEY_BORDER = 0xffff;
const DEFAULT_KB_BG = 0x0000;

type MutableNode = UINodeModel;
type MutableAnimation = AnimationModel & {
  elapsed: number;
  active: boolean;
  lastUpdateMs: number;
};
type ScreenElementProxy = {
  value: number;
  text?: string;
  onClick(): void;
  onHold(): void;
  onRelease(): void;
};
type ScreenProxy = Record<string, ScreenElementProxy>;

interface PreviewKeyStyle {
  bg: number;
  fg: number;
  borderColor: number;
}

interface PreviewKey {
  ch: string;
  special: UIKeyTemplate["special"] | 255;
  style: PreviewKeyStyle;
}

interface PreviewListState extends PreviewListBindingSpec {
  itemCount: number;
  itemHeight: number;
  contentHeight: number;
  // NOTE: scroll no longer lives here — it's on the node (node.scrollY), mirroring
  // the C++ engine. This object now carries only the binding + computed geometry.
}

interface RuntimeOptions {
  onFrame?: (rgba: Uint8ClampedArray) => void;
  onDiagnostics?: (message: string) => void;
}

function clampText(text: unknown): string {
  // Booleans must stringify as 1/0, not "true"/"false": hardware lowers bool
  // signals in text bindings via snprintf("%d") (numericFormat → %d for bool),
  // so the device prints the integer. JS String(true) gives "true", which would
  // diverge from the device for any bool reaching a text buffer (binding value
  // or {expr} interpolation). Coerce here so every text-buffer write agrees.
  if (text === true) return "1".slice(0, UI_TEXT_BUF);
  if (text === false) return "0".slice(0, UI_TEXT_BUF);
  return String(text ?? "").slice(0, UI_TEXT_BUF);
}

/** If `text` is a `ui.signal(<arg>)` initializer, return the source text of
 *  `<arg>` (balanced-paren scanned, so nested calls like `ui.signal(other())`
 *  are preserved). Returns undefined for any other initializer shape. Mirrors
 *  the ir/transformers/variables.ts detection that lowers `const X = ui.signal(v)`
 *  to `int X = v;`. */
function matchSignalInitializer(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/^\s*ui\.signal\s*\(/);
  if (!m) return undefined;
  const argStart = m[0].length; // index just past `ui.signal(`
  const argEnd = findMatchingCloseParen(text, argStart);
  if (argEnd < 0) return undefined;
  // Require the close paren to be the last non-whitespace token so `ui.signal(0) + 1`
  // isn't misread as a plain signal decl.
  if (text.slice(argEnd + 1).trim() !== "") return undefined;
  return text.slice(argStart, argEnd).trim();
}

/** Given `text` and an index `openIdx` pointing at or just after an opening
 *  paren, return the index of the matching `)`. If `text[openIdx]` is already
 *  `(`, scanning starts there; otherwise `openIdx-1` must be `(`. Returns -1 if
 *  no matching close paren is found. */
function findMatchingCloseParen(text: string, openIdx: number): number {
  const start = text[openIdx] === "(" ? openIdx : openIdx - 1;
  if (text[start] !== "(") return -1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Linear color lerp at the ACTIVE depth (module runtimeColorFormat): 888
 *  targets lerp per 8-bit channel; 565 targets lerp per 5/6-bit channel
 *  (device parity — the C++ ui_lerp macro switches the same way). Exported
 *  for tests. */
export function lerpColor(a: number, b: number, k100: number): number {
  if (runtimeColorFormat === "rgb666" || runtimeColorFormat === "rgb888") {
    if (k100 >= 100) return b & 0xffffff;
    const mix = (shift: number): number => {
      const av = (a >> shift) & 0xff;
      const bv = (b >> shift) & 0xff;
      return (av + Math.trunc(((bv - av) * k100) / 100)) & 0xff;
    };
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
  }
  if (k100 >= 100) return b & 0xffff;
  const ar = (a >> 11) & 0x1f;
  const ag = (a >> 5) & 0x3f;
  const ab = a & 0x1f;
  const br = (b >> 11) & 0x1f;
  const bg = (b >> 5) & 0x3f;
  const bb = b & 0x1f;
  const r = ar + Math.trunc(((br - ar) * k100) / 100);
  const g = ag + Math.trunc(((bg - ag) * k100) / 100);
  const bl = ab + Math.trunc(((bb - ab) * k100) / 100);
  return ((r & 0x1f) << 11) | ((g & 0x3f) << 5) | (bl & 0x1f);
}

// Module-level current color format, seeded by PreviewUIRuntime's constructor.
// Lets the free resolveRuntimeColor helper resolve at the target's depth without
// `this` access (keyboard + binding callbacks are module-scope functions).
// rgb666 → 888 (blends keep precision, quantize at the canvas push); else 565.
let runtimeColorFormat: "rgb565" | "rgb666" | "rgb888" | "mono" = "rgb565";

function resolveRuntimeColor(value: unknown): number {
  // rgb666 and rgb888 both store full 888 internally (quantization happens at
  // the push boundary for rgb666; rgb888 carries 888 to the surface).
  const is888 = runtimeColorFormat === "rgb666" || runtimeColorFormat === "rgb888";
  const mask = is888 ? 0xffffff : 0xffff;
  if (typeof value === "number") return value & mask;
  if (typeof value === "string") {
    return (is888 ? resolveColor888(value) : resolveColor(value, "rgb565")) & mask;
  }
  return 0;
}

/** Blend by opacity in the active color depth (888 for rgb666/rgb888, 565 otherwise).
 *  Mirrors the device's UI_COLOR_DEPTH-driven ui_blend macro — the value depth
 *  and the blend math switch together (see Phase 1 counterexample). */
function blendRuntime(fg: number, bg: number, opacity: number): number {
  return (runtimeColorFormat === "rgb666" || runtimeColorFormat === "rgb888")
    ? blendRgb888(fg, bg, opacity)
    : blendRgb565(fg, bg, opacity);
}

/** Halve a color at the active depth (device parity: UI_DIM_MASK — 0x7BEF on
 *  565, 0x7F7F7F per channel on 888/666). The 565-only form channel-shifts
 *  on rgb888 targets. */
function dimRuntimeColor(c: number): number {
  return c & ((runtimeColorFormat === "rgb666" || runtimeColorFormat === "rgb888") ? 0x7f7f7f : 0x7bef);
}

/** Halve a runtime color for HTML-disabled controls — matches the device's
 *  `(c >> 1) & UI_DIM_MASK` (dimRuntimeColor's bare AND barely changes dark
 *  565 colors; the shift gives a real fade on both depths). */
function dimDisabledColor(c: number): number {
  return (c >> 1) & ((runtimeColorFormat === "rgb666" || runtimeColorFormat === "rgb888") ? 0x7f7f7f : 0x7bef);
}

function mergeClassRules(classes: string[] | undefined, rules: CSSRule[]): CSSProperty {
  const merged: CSSProperty = {};
  const classSet = new Set(classes ?? []);
  for (const rule of rules) {
    // Only match single-compound selectors where all simples are classes in the set.
    if (rule.selector.compounds.length !== 1) continue;
    const compound = rule.selector.compounds[0];
    let ok = true;
    for (const s of compound) {
      if (s.kind !== "class" || !classSet.has(s.name)) { ok = false; break; }
    }
    if (ok) Object.assign(merged, rule.properties);
  }
  return merged;
}

function resolveKeyboardBackground(template: KeyboardTemplate, rules: CSSRule[]): number {
  const style = mergeClassRules(template.classes, rules);
  return style.background ? resolveRuntimeColor(style.background) : DEFAULT_KB_BG;
}

function resolveKeyStyle(key: UIKeyTemplate, template: KeyboardTemplate, rules: CSSRule[]): PreviewKeyStyle {
  const style = mergeClassRules([...(template.classes ?? []), ...(key.classes ?? [])], rules);
  return {
    bg: style.background ? resolveRuntimeColor(style.background) : DEFAULT_KEY_BG,
    fg: style.color ? resolveRuntimeColor(style.color) : DEFAULT_KEY_FG,
    borderColor: style.borderColor ? resolveRuntimeColor(style.borderColor) : DEFAULT_KEY_BORDER,
  };
}

const KF_BG = 1;
const KF_FG = 2;
const KF_OPACITY = 4;
const KF_TRANSFORM = 8;
const KF_SIZE = 16;

function cloneProgram(program: UIProgram): { nodes: MutableNode[]; transitions: UITransitionModel[]; animations: MutableAnimation[] } {
  return {
    nodes: program.nodes.map((node) => ({
      ...node,
      box: { ...node.box },
      classes: [...node.classes],
      options: node.options?.map((option) => ({ ...option })),
      screenId: node.screenId ?? 0,
      dirty: false,
      textBuffer: "",
      hasTextBinding: false,
      lastTextWidth: node.kind === "progress" || node.kind === "range" ? -1 : 0,
      lastTextHeight: 0,
      overscrollPx: 0,
      settling: false,
      lastPaintedScrollY: 0,
      lineHeight: node.lineHeight || 0,
      whiteSpaceMode: node.whiteSpaceMode ?? (node.nowrap ? 1 : 0),
      zIndex: node.zIndex ?? 0,
      value: node.value,
    })),
    transitions: (program.transitions ?? []).map((transition) => ({ ...transition, active: false, elapsed: 0 })),
    animations: (program.animations ?? []).map((animation) => ({
      ...animation,
      elapsed: 0,
      active: true,
      lastUpdateMs: 0,
    })),
  };
}

export class PreviewUIRuntime {
  readonly gfx: HostAdafruitGFX;
  readonly screen: ScreenProxy = {};
  private readonly nodes: MutableNode[];
  private readonly transitions: UITransitionModel[];
  private readonly keyframeSets: KeyframeSetModel[];
  private readonly animations: MutableAnimation[];
  private readonly fontAssets: UIFontAssetModel[];
  private readonly imageAssets: UIImageAsset[];
  private readonly bindings: PreviewBindingSpec[];
  private readonly listStates: PreviewListState[];
  private readonly callbacks: PreviewCallbackSpec[];
  private readonly pinControls: PreviewPinControlSpec[];
  private readonly canvasBindings: PreviewCanvasBindingSpec[];
  private readonly intervals: PreviewIntervalSpec[];
  private readonly initialAssignments: PreviewInitialAssignment[];
  /** Module-scoped `let`/`const`/`var` bindings, seeded once and shared (mutably)
   * across every callback body — mirrors the device hoisting them to globals. */
  private readonly moduleScope: Record<string, unknown> = {};
  /** Names declared via `const X = ui.signal(...)` — lowered to plain device
   *  variables on hardware, so the preview stores the bare value (not the `ui`
   *  facade's getter) and rewrites `X()`/`X.set(v)` reads/writes accordingly
   *  (see normalizeScript). Mirrors ir/transformers/variables.ts + ui-callback-
   *  lowering.ts so template interpolations and callbacks see the same slot. */
  private readonly signalNames: Set<string> = new Set();
  private readonly onFrame?: (rgba: Uint8ClampedArray) => void;
  private readonly onDiagnostics?: (message: string) => void;
  private readonly screenCount: number;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private activeScreen = 0;
  private touchState = 0;
  private touchNode = -1;
  // Awaitable tap source (mirrors the device __ui_tap_seq / __ui_tap_node).
  // Incremented on every completed tap (after click/release dispatch) so an
  // `await ui.onTap()` Promise can resolve by polling tapSeq. tapNode records
  // the hit node (-1 = empty space) for per-element awaiters. Public so the
  // onTap shim in build-program.ts can read them.
  tapSeq = 0;
  tapNode = -1;
  // Modeled GPIO levels for ui.watchPin pins. Pins default to HIGH (the device
  // pulls them up via INPUT_PULLUP semantics); watchPin fires on HIGH→LOW. This
  // map lets the autonomous poller AND a deterministic setPinLevel() test hook
  // observe the same state. Public so tests can drive edges without wall-clock
  // waits; the real ~20ms poller in start() mirrors the device's microtask pump.
  private readonly pinLevels: Map<string, 0 | 1> = new Map();
  private touchDownTime = 0;
  private lastTouchTime = -UI_TOUCH_DEBOUNCE_MS;
  private lastReleaseTime = -UI_TOUCH_DEBOUNCE_MS;
  private lastTickTime = Date.now();
  private dragStartX = 0;
  private dragStartY = 0;
  private lastTouchX = 0;
  private lastTouchY = 0;
  private isDragging = false;
  // Unified scroll gesture: one owner per gesture (single hit-scan; lists are
  // scrollable and found by the same scan). Settle-animation state lives here.
  private scrollNode = -1;
  private settleStartMs = 0;
  private settleFromOverscroll = 0;  // settle start value (bounce-back; +top/-bottom)
  private settleFromScrollY = 0;     // settle start value (edge snap; +toward 0, -toward max)
  private rangeNode = -1;
  private keyboardVisible = false;
  /** Modal <select> option list: node index while open, -1 when closed. */
  private selectMenuNode = -1;
  /** True while the select modal overlay needs (re)stamping this frame. */
  private selectMenuDirty = false;
  private keyboardDirty: 0 | 1 | 2 = 0;
  private keyboardTarget = -1;
  private keyboardKeys: PreviewKey[] = [];
  private keyboardRows = 0;
  private keyboardCols = 0;
  private keyboardBg = DEFAULT_KB_BG;
  private keyboardBox = { x: 0, y: 0, w: 0, h: 0 };
  private keyboardBuffer = "";
  private keyboardMaxLen = UI_TEXT_BUF;
  private keyboardShift = false;
  private keyboardBackspaceHeld = false;
  private keyboardBackspaceRepeat = 0;
  private keyboardPressedKey = -1;
  private keyboardRepaintKey = -1;
  private directFrameChanged = false;
  private readonly scrollDragScale: number;

  constructor(private readonly snapshot: PreviewSnapshot, options: RuntimeOptions = {}) {
    const { nodes, transitions, animations } = cloneProgram(snapshot.program);
    // Seed the module-level format so the free resolveRuntimeColor helper (used
    // by keyboard + binding callbacks without `this` access) resolves in the
    // target's depth: 888 for rgb666 (blends keep precision), 565 otherwise.
    runtimeColorFormat = snapshot.program.colorFormat;
    this.nodes = nodes;
    this.transitions = transitions;
    this.keyframeSets = snapshot.program.keyframeSets ?? [];
    this.animations = animations;
    this.fontAssets = snapshot.program.fontAssets ?? [];
    this.imageAssets = snapshot.program.imageAssets ?? [];
    this.bindings = snapshot.bindings;
    this.listStates = (snapshot.listBindings ?? []).map((binding) => ({
      ...binding,
      itemCount: 0,
      itemHeight: 24,
      contentHeight: 0,
    }));
    this.callbacks = snapshot.callbacks;
    this.pinControls = snapshot.pinControls;
    this.canvasBindings = snapshot.canvasBindings ?? [];
    this.intervals = snapshot.intervals;
    this.initialAssignments = snapshot.initialAssignments;
    this.screenCount = Math.max(1, ...this.nodes.map((node) => (node.screenId ?? 0) + 1));
    this.scrollDragScale = resolveScrollConfig(snapshot.program.display ?? {}).dragScale;
    this.onFrame = options.onFrame;
    this.onDiagnostics = options.onDiagnostics;
    this.gfx = new HostAdafruitGFX(snapshot.program.width, snapshot.program.height, new Uint8Array(snapshot.font));
    // Snap draw colors to black/white for mono/e-ink targets (parity with the
    // device's UI_NATIVE_MONO draw-path snap). No-op for color targets.
    this.gfx.setMonoSnap(snapshot.program.colorFormat === "mono");
    // Buffer storage depth tracks the target: 565 panels store packed 565,
    // rgb888 stores packed 888, rgb666 stores 888 and quantizes at the canvas
    // push. Without this, 888-packed colors render channel-shifted (the
    // buffer was historically assumed to always hold 565).
    this.gfx.setStorageMode(
      snapshot.program.colorFormat === "rgb888" ? "rgb888"
        : snapshot.program.colorFormat === "rgb666" ? "rgb666"
          : "rgb565",
    );
    this.createScreenProxy();
  }

  start(): void {
    this.gfx.begin();
    this.gfx.setRotation(this.snapshot.program.display?.rotation ?? 1);
    this.gfx.fillScreen(0x0000);
    this.seedModuleScope();
    this.applyInitialAssignments();
    this.uiInit();
    this.seedDrawersClosed();
    this.tick(16);
    // Device parity: the device's loop() calls ui_tick() every iteration —
    // that is what advances CSS keyframe animations, transitions, and scroll
    // settles. The browser has no loop(), so drive the same tick from a ~20ms
    // poller (the microtask-pump cadence the pin watcher uses). Idle ticks are
    // cheap: drawDirty() finds nothing and no frame is pushed.
    this.timers.push(setInterval(() => this.tick(), 20));
    for (const interval of this.intervals) {
      this.timers.push(setInterval(() => {
        this.runBody(interval.body);
        this.tick();
      }, interval.delayMs));
    }
    // ui.watchPin: poll each watched pin every ~20ms for HIGH→LOW edges,
    // mirroring the device's microtask-pump watcher (no ISRs; natural debounce
    // from the poll interval). Pin levels default to HIGH (INPUT_PULLUP). The
    // same edge check is exposed synchronously via setPinLevel() for tests.
    for (const control of this.pinControls) {
      if (control.kind !== "watch") continue;
      this.pinLevels.set(control.pin, 1);
      this.timers.push(setInterval(() => {
        this.pollWatchPin(control.pin, control.body);
      }, 20));
    }
  }

  /** Drive a GPIO level for a watched pin and synchronously fire the watch
   *  callback on a HIGH→LOW edge. Test hook so edge behavior is deterministic
   *  without wall-clock waits; the real ~20ms poller in start() shares this
   *  path. Mirrors the device's falling-edge contract. */
  setPinLevel(pin: string, level: 0 | 1): void {
    this.pinLevels.set(pin, level);
    const control = this.pinControls.find((c) => c.kind === "watch" && c.pin === pin);
    if (control) this.pollWatchPin(pin, control.body);
  }

  private pollWatchPin(pin: string, body: string | undefined): void {
    if (!body) return;
    // Edge detection lives in the level setter: we only fire when the previous
    // level was HIGH and the current is LOW. Track the "previous" level in a
    // second slot so repeated polls at LOW don't refire.
    const prev = this.pinLevels.get(`__prev_${pin}`) ?? 1;
    const curr = this.pinLevels.get(pin) ?? 1;
    this.pinLevels.set(`__prev_${pin}`, curr);
    if (prev === 1 && curr === 0) {
      this.runBody(body);
      this.tick();
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  tick(deltaMs?: number): void {
    const now = Date.now();
    const delta = deltaMs ?? Math.max(0, now - this.lastTickTime);
    this.lastTickTime = now;
    if (this.debugCapture) this.debugPaintedRects = [];
    this.evaluateBindings();
    this.advanceTransitions(delta);
    this.advanceAnimations(delta);
    this.applyDrawers(delta);
    // Advance any in-flight scroll settle animation (bounce-back / edge-snap).
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].settling) this.advanceScrollSettle(i);
    }
    let changed = this.drawDirty() || this.directFrameChanged;
    this.directFrameChanged = false;
    // Modal <select> list: stamp the overlay whenever the frame beneath it
    // changed (or it was just opened) so redraws never bury it.
    if (this.selectMenuNode >= 0 && (changed || this.selectMenuDirty)) {
      this.drawSelectMenu();
      changed = true;
    }
    if (changed) {
      this.onFrame?.(this.gfx.toRgbaBytes());
    }
  }

  pointerDown(x: number, y: number): void {
    this.handleTouch(x, y);
    this.tick();
  }

  pointerMove(x: number, y: number): void {
    if (this.touchState !== 0) {
      this.handleTouch(x, y);
      this.tick();
    }
  }

  pointerUp(): void {
    this.handleNoTouch();
    this.tick();
  }

  /** Mouse-wheel scroll: a discrete delta applied to the scroll owner under
   *  (x, y) — the same hit-scan a drag uses, without the gesture state
   *  machine. Wheel-down (positive deltaPx) shows later content; any
   *  overscroll from the tick bounces back via the standard settle. */
  wheel(x: number, y: number, deltaPx: number): void {
    const owner = this.findScrollNode(x, y);
    if (owner < 0) return;
    if (this.applyScrollDelta(owner, -Math.trunc(deltaPx))) {
      this.releaseScroll(owner);
    }
    this.tick();
  }

  triggerPin(control: PreviewPinControlSpec): void {
    if (control.kind === "toggle" && control.nodeIndex !== undefined) {
      const node = this.nodes[control.nodeIndex];
      node.value = node.value ? 0 : 1;
      this.markDirty(control.nodeIndex);
      this.runBody(control.body);
    } else if (control.kind === "change" && control.nodeIndex !== undefined) {
      const node = this.nodes[control.nodeIndex];
      const count = Math.max(1, control.optionCount ?? 2);
      node.value = (node.value + 1) % count;
      this.markDirty(control.nodeIndex);
      this.runBody(control.body);
    } else if (control.kind === "press" && control.nodeIndex !== undefined) {
      this.uiOnPress(control.nodeIndex);
    } else if (control.kind === "release" && control.nodeIndex !== undefined) {
      this.uiOnRelease(control.nodeIndex);
    } else if (control.kind === "watch") {
      this.runBody(control.body);
    }
    this.tick();
  }

  private createScreenProxy(): void {
    for (const node of this.nodes) {
      if (!node.id) continue;
      const proxy: ScreenElementProxy = {
        get value() {
          return node.value;
        },
        set value(v: number) {
          node.value = Number(v) || 0;
          node.dirty = true;
        },
        onClick: () => undefined,
        onHold: () => undefined,
        onRelease: () => undefined,
      };
      if (node.kind === "input") {
        Object.defineProperty(proxy, "text", {
          enumerable: true,
          get() {
            return node.textBuffer;
          },
          set(v: string) {
            node.textBuffer = clampText(v);
            node.dirty = true;
          },
        });
      }
      Object.defineProperty(this.screen, node.id, {
        enumerable: true,
        value: proxy,
      });
    }
  }

  private applyInitialAssignments(): void {
    for (const assignment of this.initialAssignments) {
      const value = this.evaluateExpression(assignment.expression);
      this.nodes[assignment.nodeIndex].value = Number(value) || 0;
      this.markDirty(assignment.nodeIndex);
    }
  }

  /** Seed module-scoped variables from their initializers, evaluated once. These
   * live for the lifetime of the runtime and are shared mutably with callback
   * bodies via runBody/evaluateExpression (see moduleVarNames()). */
  private seedModuleScope(): void {
    for (const v of this.snapshot.moduleVars ?? []) {
      if (!/^[$A-Z_a-z][$\w]*$/.test(v.name)) continue;
      // `const X = ui.signal(value)` lowers to a plain device variable on
      // hardware (variables.ts rewrites it to `int X = value;`). Mirror that
      // here: store the bare initial value, not the `ui` facade's getter, and
      // record the name so normalizeScript can rewrite X()/X.set(v) reads/writes
      // into direct variable access. Otherwise a template `${X}` stringifies the
      // getter source ("() => value") instead of the value.
      const signalArg = matchSignalInitializer(v.initializer);
      if (signalArg !== undefined) {
        this.signalNames.add(v.name);
        this.moduleScope[v.name] = signalArg === "" ? 0 : this.evaluateExpression(signalArg);
      } else {
        this.moduleScope[v.name] = v.initializer !== undefined
          ? this.evaluateExpression(v.initializer)
          : undefined;
      }
    }
  }

  private moduleVarNames(): string[] {
    return (this.snapshot.moduleVars ?? [])
      .map((v) => v.name)
      .filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name));
  }

  private uiInit(): void {
    for (const node of this.nodes) node.dirty = true;
    for (const binding of this.bindings) {
      if (binding.property !== "text") continue;
      const node = this.nodes[binding.nodeIndex];
      node.hasTextBinding = true;
      node.textBuffer = clampText(node.text ?? "");
    }
    for (const node of this.nodes) {
      if (node.tag === "select" && node.options && node.options.length > 0) {
        node.hasTextBinding = true;
        node.textBuffer = clampText(node.options[0]?.text ?? node.text ?? "");
      }
    }
    for (const list of this.listStates) {
      this.refreshListState(list);
    }
  }

  private isActiveNode(node: MutableNode): boolean {
    return (node.screenId ?? 0) === this.activeScreen;
  }

  private isEffectivelyVisible(node: MutableNode): boolean {
    if (!node.visible) return false;
    let parent = node.parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      if (!this.nodes[parent].visible) return false;
      parent = this.nodes[parent].parentIndex;
    }
    return true;
  }

  /** Effective stacking z, CSS-style: a non-zero zIndex raises the node AND
   *  its subtree — a z-raised panel forms a stacking context, so its
   *  descendants stack WITH it (above lower-z siblings), never
   *  independently UNDER it (a flat (z, index) sort painted a dialog card
   *  over its own children). 0 = "auto" — keep walking ancestors. */
  private stackingZ(node: MutableNode): number {
    let n: MutableNode | undefined = node;
    while (n) {
      const z = Math.trunc(n.zIndex ?? 0);
      if (z !== 0) return z;
      n = n.parentIndex >= 0 && n.parentIndex < this.nodes.length ? this.nodes[n.parentIndex] : undefined;
    }
    return 0;
  }

  private drawsBefore(a: MutableNode, b: MutableNode): boolean {
    const az = this.stackingZ(a);
    const bz = this.stackingZ(b);
    if (az !== bz) return az < bz;
    return a.index < b.index;
  }

  private compareDrawOrder(a: MutableNode, b: MutableNode): number {
    const az = this.stackingZ(a);
    const bz = this.stackingZ(b);
    if (az !== bz) return az - bz;
    return a.index - b.index;
  }

  private navigate(screenIdx: number): void {
    const next = Math.trunc(Number(screenIdx));
    if (!Number.isFinite(next) || next < 0 || next >= this.screenCount || next === this.activeScreen) return;
    this.activeScreen = next;
    if (this.keyboardVisible) {
      this.keyboardVisible = false;
      this.keyboardDirty = 0;
      this.keyboardTarget = -1;
      this.keyboardPressedKey = -1;
      this.keyboardBackspaceHeld = false;
    }
    this.closeSelectMenu(false);
    this.drawerStates.clear();
    for (const node of this.nodes) {
      const n = node as MutableNode & { __drawerDx?: number; __drawerDy?: number };
      if (n.__drawerDx) n.__drawerDx = 0;
      if (n.__drawerDy) n.__drawerDy = 0;
      if ((n as MutableNode & { drawerSide?: number }).drawerSide !== undefined) {
        n.transformOffsetX = 0;
        n.transformOffsetY = 0;
      }
    }
    this.seedDrawersClosed();
    this.gfx.fillScreen(0x0000);
    for (const node of this.nodes) {
      node.dirty = true;
      if (node.kind === "progress" || node.kind === "range") node.lastTextWidth = -1;
      else node.lastTextWidth = 0;
      node.lastTextHeight = 0;
    }
  }

  private evaluateBindings(): void {
    for (const binding of this.bindings) {
      const node = this.nodes[binding.nodeIndex];
      const value = this.evaluateExpression(binding.expression);
      if (binding.property === "text") {
        const text = clampText(value);
        // A text-bound node draws its buffer (build-time hasTextBinding only
        // covers auto-wire/interpolation synthesis — ui.bind targets set it
        // here so the bound string actually renders).
        node.hasTextBinding = true;
        if (text !== node.textBuffer) {
          node.textBuffer = text;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "background") {
        const next = resolveRuntimeColor(value);
        if (next !== node.bg) {
          node.bg = next;
          node.hasBg = true;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "color") {
        const next = resolveRuntimeColor(value);
        if (next !== node.fg) {
          node.fg = next;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "borderColor") {
        const next = resolveRuntimeColor(value);
        if (next !== node.borderColor) {
          node.borderColor = next;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "visible") {
        const next = Boolean(value);
        if (next !== node.visible) {
          this.setVisible(binding.nodeIndex, next);
        }
      } else if (binding.property === "value") {
        const next = Math.trunc(Number(value) || 0);
        if (next !== node.value) {
          node.value = next;
          this.markDirty(binding.nodeIndex);
        }
      }
    }

    for (const node of this.nodes) {
      if (node.tag !== "select" || !node.options || node.options.length === 0) continue;
      const next = clampText(node.options[node.value]?.text ?? node.options[0]?.text ?? "");
      if (next !== node.textBuffer) {
        node.textBuffer = next;
        this.markDirty(node.index);
      }
    }
    for (const list of this.listStates) {
      this.refreshListState(list);
    }
  }

  private refreshListState(list: PreviewListState): void {
    const node = this.nodes[list.nodeIndex];
    if (!node) return;
    const countValue = this.evaluateExpression(list.countExpression);
    const itemCount = Math.max(0, Math.trunc(Number(countValue) || 0));
    const itemHeight = Math.max(1, Math.trunc(node.listItemHeight || list.itemHeight || 24));
    const contentHeight = itemCount * itemHeight;
    const maxScroll = Math.max(0, contentHeight - node.box.h);
    // Scroll lives on the node now; keep it clamped as the content size changes.
    const nextScrollY = Math.max(0, Math.min(maxScroll, node.scrollY));
    const changed = itemCount !== list.itemCount ||
      itemHeight !== list.itemHeight ||
      contentHeight !== list.contentHeight ||
      nextScrollY !== node.scrollY ||
      node.contentHeight !== contentHeight;
    list.itemCount = itemCount;
    list.itemHeight = itemHeight;
    list.contentHeight = contentHeight;
    node.scrollY = nextScrollY;
    node.contentHeight = contentHeight;
    if (changed) {
      node.lastPaintedScrollY = node.scrollY - Math.max(1, node.box.h);
      this.markDirty(list.nodeIndex);
    }
  }

  private advanceTransitions(deltaMs: number): void {
    for (const transition of this.transitions) {
      if (!transition.active) continue;
      transition.elapsed += deltaMs;
      const k = transition.durationMs <= 0
        ? 100
        : Math.trunc((transition.elapsed * 100) / transition.durationMs);
      const drawK = transition.durationMs > 0 && transition.durationMs <= UI_TRANSITION_SNAP_MS ? 100 : k;
      const value = lerpColor(transition.prevValue, transition.targetValue, drawK);
      if (transition.prop === "color") this.nodes[transition.node].fg = value;
      else this.nodes[transition.node].bg = value;
      this.markDirty(transition.node);
      if (drawK >= 100) transition.active = false;
    }
  }

  private scrollMotionActive(): boolean {
    if (this.scrollNode >= 0 && this.isDragging) return true;
    return this.nodes.some((node) => this.isActiveNode(node) && !!node.settling);
  }

  private keyframeSetHasScrollSensitiveGeometry(setIndex: number): boolean {
    const set = this.keyframeSets[setIndex];
    return !!set?.stops.some((stop) => (stop.props & (KF_TRANSFORM | KF_SIZE)) !== 0);
  }

  private advanceAnimations(deltaMs: number): void {
    const scrollMotionActive = this.scrollMotionActive();
    for (const animation of this.animations) {
      if (!animation.active) continue;
      // Mirrors the C++ engine (runtime-header/tick/transitions-phase.ts,
      // the `screenId != __ui_active_screen` guard in ui_tick's keyframe phase):
      // only advance animations whose node is on the active screen. Otherwise advancing a
      // cross-screen node mutates its geometry and clearCurrentNodePaint/markDirty
      // repaint its parent's background into the *active* screen's framebuffer
      // (e.g. the transform-screen dots bleeding onto home).
      const animNode = this.nodes[animation.node];
      if (animNode && !this.isActiveNode(animNode)) continue;
      if (scrollMotionActive && this.keyframeSetHasScrollSensitiveGeometry(animation.keyframeSet)) continue;
      animation.elapsed += deltaMs;
      let elapsedNoDelay = animation.elapsed;
      if (elapsedNoDelay < animation.delayMs) continue;
      elapsedNoDelay -= animation.delayMs;

      let completing = false;
      if (animation.iterations > 0 && elapsedNoDelay >= animation.iterations * animation.durationMs) {
        elapsedNoDelay = animation.iterations * animation.durationMs;
        completing = true;
      }

      let pct = 100;
      if (!completing && animation.durationMs > 0) {
        pct = Math.trunc(((elapsedNoDelay % animation.durationMs) * 100) / animation.durationMs);
      }

      const set = this.keyframeSets[animation.keyframeSet];
      const node = this.nodes[animation.node];
      if (!set || !node || set.stops.length === 0) continue;

      let lo = 0;
      let hi = set.stops.length - 1;
      for (let i = 0; i < set.stops.length; i++) {
        if (set.stops[i].percent <= pct) lo = i;
        if (set.stops[i].percent >= pct) {
          hi = i;
          break;
        }
      }

      const from = set.stops[lo];
      const to = set.stops[hi];
      const range = to.percent - from.percent;
      // Shape the lerp by the animation's timing function (ease-in-out, etc.).
      // Same control points + algorithm as the C++ ui_ease_lerp_k — preview and
      // device must agree on the curve.
      const k = easeCurveLerpK(
        animation.timingFunction,
        range > 0 ? Math.trunc(((pct - from.percent) * 100) / range) : 0,
      );
      let changed = false;

      if ((from.props & KF_BG) && (to.props & KF_BG)) {
        const next = range > 0 ? lerpColor(from.bg, to.bg, k) : from.bg;
        if (next !== node.bg) {
          node.bg = next;
          node.hasBg = true;
          changed = true;
        }
      }
      if ((from.props & KF_FG) && (to.props & KF_FG)) {
        const next = range > 0 ? lerpColor(from.fg, to.fg, k) : from.fg;
        if (next !== node.fg) {
          node.fg = next;
          changed = true;
        }
      }
      if ((from.props & KF_OPACITY) && (to.props & KF_OPACITY)) {
        const next = range > 0 ? Math.trunc(from.opacity + ((to.opacity - from.opacity) * k) / 100) : from.opacity;
        if (next !== node.opacity) {
          node.opacity = next;
          changed = true;
        }
      }
      let nextTransformX = node.transformOffsetX ?? 0;
      let nextTransformY = node.transformOffsetY ?? 0;
      let nextRotateDeg = node.rotateDeg ?? 0;
      let nextWidth = node.box.w;
      let nextHeight = node.box.h;
      let geometryChanged = false;
      const hasSizeFrame = (from.props & KF_SIZE) && (to.props & KF_SIZE);
      if (hasSizeFrame) {
        nextWidth = range > 0 ? Math.trunc(from.width + ((to.width - from.width) * k) / 100) : from.width;
        nextHeight = range > 0 ? Math.trunc(from.height + ((to.height - from.height) * k) / 100) : from.height;
        nextWidth = Math.max(0, nextWidth);
        nextHeight = Math.max(0, nextHeight);
        if (nextWidth !== node.box.w || nextHeight !== node.box.h) {
          changed = true;
          geometryChanged = true;
        }
      }
      if ((from.props & KF_TRANSFORM) && (to.props & KF_TRANSFORM)) {
        const pxX = range > 0 ? Math.trunc(from.transformOffsetX + ((to.transformOffsetX - from.transformOffsetX) * k) / 100) : from.transformOffsetX;
        const pxY = range > 0 ? Math.trunc(from.transformOffsetY + ((to.transformOffsetY - from.transformOffsetY) * k) / 100) : from.transformOffsetY;
        const pctX = range > 0 ? Math.trunc(from.translatePctX + ((to.translatePctX - from.translatePctX) * k) / 100) : from.translatePctX;
        const pctY = range > 0 ? Math.trunc(from.translatePctY + ((to.translatePctY - from.translatePctY) * k) / 100) : from.translatePctY;
        const scaleX = Math.max(0, range > 0 ? Math.trunc(from.scaleX + ((to.scaleX - from.scaleX) * k) / 100) : from.scaleX);
        const scaleY = Math.max(0, range > 0 ? Math.trunc(from.scaleY + ((to.scaleY - from.scaleY) * k) / 100) : from.scaleY);
        nextRotateDeg = range > 0 ? Math.trunc(from.rotateDeg + ((to.rotateDeg - from.rotateDeg) * k) / 100) : from.rotateDeg;
        let refW = hasSizeFrame ? nextWidth : animation.baseWidth;
        let refH = hasSizeFrame ? nextHeight : animation.baseHeight;
        if (refW <= 0) refW = node.box.w;
        if (refH <= 0) refH = node.box.h;
        const originPxX = Math.trunc((refW * animation.originX) / 100);
        const originPxY = Math.trunc((refH * animation.originY) / 100);
        const scaledW = Math.trunc((refW * scaleX) / 100);
        const scaledH = Math.trunc((refH * scaleY) / 100);
        const scaleOffsetX = originPxX - Math.trunc((originPxX * scaleX) / 100);
        const scaleOffsetY = originPxY - Math.trunc((originPxY * scaleY) / 100);
        nextTransformX = pxX + Math.trunc((refW * pctX) / 100) + scaleOffsetX;
        nextTransformY = pxY + Math.trunc((refH * pctY) / 100) + scaleOffsetY;
        nextWidth = Math.max(0, scaledW);
        nextHeight = Math.max(0, scaledH);
        if (
          nextTransformX !== (node.transformOffsetX ?? 0) ||
          nextTransformY !== (node.transformOffsetY ?? 0) ||
          nextRotateDeg !== (node.rotateDeg ?? 0) ||
          nextWidth !== node.box.w ||
          nextHeight !== node.box.h
        ) {
          changed = true;
          geometryChanged = true;
        }
      }

      if (changed) {
        const throttleRedraw = !geometryChanged &&
          !(completing || animation.elapsed - animation.lastUpdateMs >= 100);
        if (throttleRedraw) {
          if (completing) animation.active = false;
          continue;
        }
        let oldGeometryRect: { x: number; y: number; w: number; h: number } | undefined;
        if (geometryChanged) {
          const rect = this.currentPaintRect(node);
          if (rect.w > 0 && rect.h > 0) oldGeometryRect = rect;
          node.transformOffsetX = nextTransformX;
          node.transformOffsetY = nextTransformY;
          node.rotateDeg = nextRotateDeg;
          node.box.w = nextWidth;
          node.box.h = nextHeight;
        }
        let repairedGeometry = false;
        if (geometryChanged && oldGeometryRect) {
          repairedGeometry = this.tryRepairGeometryFill(node, oldGeometryRect);
        }
        if (geometryChanged && !repairedGeometry) {
          if (oldGeometryRect) this.clearNodePaintRect(node, oldGeometryRect);
          else this.clearCurrentNodePaint(node);
          this.invalidateScrollCanvasForNode(node.index);
        }
        if (!repairedGeometry) this.markDirty(animation.node);
        animation.lastUpdateMs = animation.elapsed;
      }
      if (completing) animation.active = false;
    }
  }

  private drawYForNode(nodeIndex: number): number {
    return this.baseDrawYForNode(nodeIndex) + this.pressedOffsetYForNode(nodeIndex);
  }

  private baseDrawXForNode(nodeIndex: number): number {
    const node = this.nodes[nodeIndex] as MutableNode & { __drawerDx?: number };
    return node.box.x + (node.transformOffsetX ?? 0) + (node.__drawerDx ?? 0);
  }

  private baseDrawYForNode(nodeIndex: number): number {
    const node = this.nodes[nodeIndex] as MutableNode & { __drawerDy?: number };
    let y = node.box.y + (node.transformOffsetY ?? 0) + (node.__drawerDy ?? 0);
    let parent = node.parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      if (this.nodes[parent].scrollable) {
        y -= this.nodes[parent].scrollY;
        // Rubber-band: overscrollPx (+top/-bottom) visibly offsets content past
        // the boundary during drag/settle. Applies to generic containers; lists
        // virtualize and manage their own offset in drawListNode.
        if (!this.nodes[parent].virtualized) y += this.nodes[parent].overscrollPx;
      }
      parent = this.nodes[parent].parentIndex;
    }
    return y;
  }

  private scrollAncestorForNode(nodeIndex: number): number {
    let parent = this.nodes[nodeIndex]?.parentIndex ?? -1;
    while (parent >= 0 && this.nodes[parent]) {
      if (this.nodes[parent].scrollable) return parent;
      parent = this.nodes[parent].parentIndex;
    }
    return -1;
  }

  private pressedOffsetXForNode(nodeIndex: number): number {
    const node = this.nodes[nodeIndex];
    return node.value > 0 ? (node.pressedOffsetX ?? 0) : 0;
  }

  private pressedOffsetYForNode(nodeIndex: number): number {
    const node = this.nodes[nodeIndex];
    return node.value > 0 ? (node.pressedOffsetY ?? 0) : 0;
  }

  private drawXForNode(nodeIndex: number): number {
    return this.baseDrawXForNode(nodeIndex) + this.pressedOffsetXForNode(nodeIndex);
  }

  private parentClearColor(node: MutableNode): number {
    const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
    if (parent) return parent.hasBg ? parent.bg : parent.clearColor;
    return node.clearColor;
  }

  private clearPressOffsetArea(node: MutableNode, baseX: number, baseY: number): void {
    const ox = node.pressedOffsetX ?? 0;
    const oy = node.pressedOffsetY ?? 0;
    if (ox === 0 && oy === 0) return;

    const x0 = Math.min(baseX, baseX + ox);
    const y0 = Math.min(baseY, baseY + oy);
    const x1 = Math.max(baseX + node.box.w, baseX + ox + node.box.w);
    const y1 = Math.max(baseY + node.box.h, baseY + oy + node.box.h);
    // Clip to the node's scroll viewport like every other clear path. During
    // overscroll (rubber-band past the container edge) the box's draw position
    // sits outside the viewport, and the node's own paint was clipped there —
    // an unclipped clear/repair here paints parent background over foreign
    // regions (e.g. the fixed header above the scroll body) and nothing re-
    // dirties that region afterwards, leaving permanent holes.
    const rect = this.intersectClipRect(
      this.scrollClipForNode(node.index),
      { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    );
    if (rect.w <= 0 || rect.h <= 0) return;
    if (this.repairCurrentNodePaintWithParent(node, rect)) return;
    this.gfx.fillRect(rect.x, rect.y, rect.w, rect.h, this.parentClearColor(node));
  }

  private shadowExtents(node: MutableNode): { left: number; top: number; right: number; bottom: number } {
    let left = 0;
    let top = 0;
    let right = 0;
    let bottom = 0;
    const count = Math.min(node.shadowCount ?? 0, 4);
    for (let i = 0; i < count; i++) {
      if (node.shadowInset?.[i]) continue;
      const blur = node.shadowBlur?.[i] || 1;
      const ox = node.shadowOffsetX?.[i] ?? 0;
      const oy = node.shadowOffsetY?.[i] ?? 0;
      left = Math.max(left, blur - ox);
      top = Math.max(top, blur - oy);
      right = Math.max(right, blur + ox);
      bottom = Math.max(bottom, blur + oy);
    }
    return { left, top, right, bottom };
  }

  private rotationQuadrant(deg: number | undefined): 0 | 1 | 2 | 3 {
    let normalized = Math.trunc(deg ?? 0) % 360;
    if (normalized < 0) normalized += 360;
    if (normalized === 90) return 1;
    if (normalized === 180) return 2;
    if (normalized === 270) return 3;
    return 0;
  }

  private canUseQuarterTurnBounds(node: MutableNode): boolean {
    return node.kind === "img" || (node.kind === "fill" && node.gradientEnabled === 0);
  }

  private rotatedFaceSize(node: MutableNode, w: number, h: number): { w: number; h: number } {
    if (!this.canUseQuarterTurnBounds(node)) return { w, h };
    const q = this.rotationQuadrant(node.rotateDeg);
    return q === 1 || q === 3 ? { w: h, h: w } : { w, h };
  }

  private activeDrawClip(): { x: number; y: number; w: number; h: number } {
    return this.gfx.getClipRect() ?? { x: 0, y: 0, w: this.gfx.width, h: this.gfx.height };
  }

  private intersectRect(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): { x: number; y: number; w: number; h: number } | undefined {
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    return x0 < x1 && y0 < y1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
  }

  private drawImageWithFit(asset: UIImageAsset, x: number, y: number, rotateDeg: number | undefined, fitMode: number | undefined, targetW: number, targetH: number): void {
    const srcW = Math.trunc(asset.width);
    const srcH = Math.trunc(asset.height);
    targetW = Math.trunc(targetW);
    targetH = Math.trunc(targetH);
    if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) return;

    let drawW = srcW;
    let drawH = srcH;
    let offX = Math.trunc((targetW - drawW) / 2);
    let offY = Math.trunc((targetH - drawH) / 2);
    const mode = fitMode ?? 1;

    if (mode === 1) {
      drawW = targetW;
      drawH = targetH;
      offX = 0;
      offY = 0;
    } else if (mode === 2 || mode === 3 || mode === 4) {
      const scaleX = Math.max(1, Math.trunc((targetW * 1000) / srcW));
      const scaleY = Math.max(1, Math.trunc((targetH * 1000) / srcH));
      let scale = scaleX;
      if (mode === 2) {
        if (scaleY < scaleX) scale = scaleY;
      } else if (mode === 3) {
        if (scaleY > scaleX) scale = scaleY;
      } else {
        if (scaleY < scaleX) scale = scaleY;
        if (scale > 1000) scale = 1000;
      }
      drawW = Math.max(1, Math.trunc((srcW * scale) / 1000));
      drawH = Math.max(1, Math.trunc((srcH * scale) / 1000));
      if (mode === 3) {
        if (drawW < targetW) drawW = targetW;
        if (drawH < targetH) drawH = targetH;
      }
      offX = Math.trunc((targetW - drawW) / 2);
      offY = Math.trunc((targetH - drawH) / 2);
    }

    const q = this.rotationQuadrant(rotateDeg);
    const clip = this.intersectRect(
      { x, y, w: q === 1 || q === 3 ? targetH : targetW, h: q === 1 || q === 3 ? targetW : targetH },
      this.activeDrawClip(),
    );
    if (!clip) return;
    let txStart = 0;
    let txEnd = targetW;
    let tyStart = 0;
    let tyEnd = targetH;
    if (q === 0) {
      txStart = Math.max(0, Math.min(targetW, clip.x - x));
      txEnd = Math.max(0, Math.min(targetW, clip.x + clip.w - x));
      tyStart = Math.max(0, Math.min(targetH, clip.y - y));
      tyEnd = Math.max(0, Math.min(targetH, clip.y + clip.h - y));
    } else if (q === 1) {
      txStart = Math.max(0, Math.min(targetW, clip.y - y));
      txEnd = Math.max(0, Math.min(targetW, clip.y + clip.h - y));
      tyStart = Math.max(0, Math.min(targetH, x + targetH - (clip.x + clip.w)));
      tyEnd = Math.max(0, Math.min(targetH, x + targetH - clip.x));
    } else if (q === 2) {
      txStart = Math.max(0, Math.min(targetW, x + targetW - (clip.x + clip.w)));
      txEnd = Math.max(0, Math.min(targetW, x + targetW - clip.x));
      tyStart = Math.max(0, Math.min(targetH, y + targetH - (clip.y + clip.h)));
      tyEnd = Math.max(0, Math.min(targetH, y + targetH - clip.y));
    } else {
      txStart = Math.max(0, Math.min(targetW, y + targetW - (clip.y + clip.h)));
      txEnd = Math.max(0, Math.min(targetW, y + targetW - clip.y));
      tyStart = Math.max(0, Math.min(targetH, clip.x - x));
      tyEnd = Math.max(0, Math.min(targetH, clip.x + clip.w - x));
    }
    if (txStart >= txEnd || tyStart >= tyEnd) return;
    for (let ty = tyStart; ty < tyEnd; ty++) {
      const localY = ty - offY;
      if (localY < 0 || localY >= drawH) continue;
      const srcY = Math.max(0, Math.min(srcH - 1, Math.trunc((localY * srcH) / drawH)));
      for (let tx = txStart; tx < txEnd; tx++) {
        const localX = tx - offX;
        if (localX < 0 || localX >= drawW) continue;
        const srcX = Math.max(0, Math.min(srcW - 1, Math.trunc((localX * srcW) / drawW)));
        const color = asset.data[srcY * srcW + srcX] ?? 0;
        let dx = tx;
        let dy = ty;
        if (q === 1) {
          dx = targetH - 1 - ty;
          dy = tx;
        } else if (q === 2) {
          dx = targetW - 1 - tx;
          dy = targetH - 1 - ty;
        } else if (q === 3) {
          dx = ty;
          dy = targetW - 1 - tx;
        }
        this.gfx.drawPixel(x + dx, y + dy, color);
      }
    }
  }

  private drawImageNode(node: MutableNode, drawY: number): void {
    const faceSize = this.rotatedFaceSize(node, node.box.w, node.box.h);
    this.gfx.fillRect(node.box.x, drawY, faceSize.w, faceSize.h, node.hasBg ? node.bg : node.clearColor);
    const assetId = node.imgDataId ?? 255;
    if (assetId < this.imageAssets.length) {
      this.drawImageWithFit(
        this.imageAssets[assetId],
        node.box.x,
        drawY,
        node.rotateDeg,
        node.objectFit,
        node.box.w,
        node.box.h,
      );
    }
    if (node.borderStyle) {
      this.drawRectOutline(
        node.box.x,
        drawY,
        faceSize.w,
        faceSize.h,
        node.borderRadius,
        node.borderStyle,
        node.borderWidth,
        node.borderColor || node.fg,
      );
    }
  }

  private nodePaintRect(node: MutableNode, baseX: number, baseY: number, drawX: number, drawY: number, textW: number, textH: number): { x: number; y: number; w: number; h: number } {
    const shadow = this.shadowExtents(node);
    let faceW = node.box.w;
    let faceH = node.box.h;
    if (node.kind === "text" || node.kind === "check" || node.kind === "radio" || node.kind === "select") {
      if (node.lastTextWidth > faceW) faceW = node.lastTextWidth;
      if ((node.lastTextHeight ?? 0) > faceH) faceH = node.lastTextHeight;
      if (textW > faceW) faceW = textW;
      if (textH > faceH) faceH = textH;
    }
    ({ w: faceW, h: faceH } = this.rotatedFaceSize(node, faceW, faceH));

    let x0 = Math.min(baseX - shadow.left, drawX);
    let y0 = Math.min(baseY - shadow.top, drawY);
    let x1 = Math.max(baseX + faceW + shadow.right, drawX + faceW);
    let y1 = Math.max(baseY + faceH + shadow.bottom, drawY + faceH);
    if (node.outlineStyle && node.outlineWidth > 0) {
      const o = node.outlineWidth;
      x0 = Math.min(x0, drawX - o);
      y0 = Math.min(y0, drawY - o);
      x1 = Math.max(x1, drawX + faceW + o);
      y1 = Math.max(y1, drawY + faceH + o);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private currentPaintRect(node: MutableNode): { x: number; y: number; w: number; h: number } {
    const displayText = node.hasTextBinding ? node.textBuffer : node.text;
    const ts = this.nodeTextSize(node);
    let textMaxW = node.box.w;
    if (node.kind === "text" || node.kind === "button" || node.kind === "select") {
      const insets = this.textInsets(node);
      textMaxW = Math.max(0, node.box.w - insets.left - insets.right);
    }
    if (node.kind === "check" || node.kind === "radio") {
      textMaxW = node.box.w > 22 ? node.box.w - 22 : 0;
    }
    const metrics = this.textLayout(node, displayText, textMaxW, ts);
    let paintTextW = metrics.width;
    let paintTextH = metrics.height;
    if (node.kind === "text" || node.kind === "select") {
      const insets = this.textInsets(node);
      paintTextW += insets.left + insets.right;
      paintTextH += insets.top + insets.bottom;
    }
    if (node.kind === "check" || node.kind === "radio") {
      paintTextW += 22;
      if (paintTextH < 16) paintTextH = 16;
    }
    return this.nodePaintRect(
      node,
      this.baseDrawXForNode(node.index),
      this.baseDrawYForNode(node.index),
      this.drawXForNode(node.index),
      this.drawYForNode(node.index),
      paintTextW,
      paintTextH,
    );
  }

  private currentSubtreePaintRect(node: MutableNode): { x: number; y: number; w: number; h: number } | undefined {
    let rect: { x: number; y: number; w: number; h: number } | undefined;
    for (let i = node.index; i < Math.min(node.subtreeEnd, this.nodes.length); i++) {
      const child = this.nodes[i];
      if (!child || !this.isActiveNode(child) || !this.isEffectivelyVisible(child)) continue;
      const childRect = this.currentPaintRect(child);
      if (childRect.w <= 0 || childRect.h <= 0) continue;
      if (!rect) {
        rect = { ...childRect };
      } else {
        const x0 = Math.min(rect.x, childRect.x);
        const y0 = Math.min(rect.y, childRect.y);
        const x1 = Math.max(rect.x + rect.w, childRect.x + childRect.w);
        const y1 = Math.max(rect.y + rect.h, childRect.y + childRect.h);
        rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    }
    return rect;
  }

  private rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
    return a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;
  }

  private markOverlappingHigherLayersDirty(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (!node || !this.isEffectivelyVisible(node) || !this.isActiveNode(node)) return;
    const rect = this.currentPaintRect(node);
    this.markOverlappingHigherLayersDirtyForRect(nodeIndex, rect);
  }

  private markOverlappingHigherLayersDirtyForRect(nodeIndex: number, rect: { x: number; y: number; w: number; h: number }): void {
    const node = this.nodes[nodeIndex];
    if (!node || !this.isEffectivelyVisible(node) || !this.isActiveNode(node)) return;
    if (rect.w <= 0 || rect.h <= 0) return;
    for (const candidate of this.nodes) {
      if (candidate.index === nodeIndex) continue;
      if (candidate.dirty || !this.isEffectivelyVisible(candidate) || !this.isActiveNode(candidate)) continue;
      if (!this.drawsBefore(node, candidate)) continue;
      const candidateRect = this.currentPaintRect(candidate);
      if (candidateRect.w <= 0 || candidateRect.h <= 0) continue;
      if (this.rectsIntersect(rect, candidateRect)) candidate.dirty = true;
    }
  }

  private repairCurrentNodePaintWithParent(node: MutableNode, rect: { x: number; y: number; w: number; h: number }): boolean {
    if (rect.w <= 0 || rect.h <= 0) return false;
    const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
    if (!parent) return false;

    this.gfx.withClipRect(rect, () => {
      this.gfx.fillRect(rect.x, rect.y, rect.w, rect.h, this.parentClearColor(parent));
      const parentDrawX = this.drawXForNode(parent.index);
      const parentDrawY = this.drawYForNode(parent.index);
      const origParentX = parent.box.x;
      parent.box.x = parentDrawX;
      try {
        let parentFillBg = parent.bg;
        if (parent.opacity < 100) {
          parentFillBg = blendRuntime(parent.bg, this.parentClearColor(parent), parent.opacity);
        }
        if (parent.gradientEnabled > 0) {
          this.drawGradientFill(parent, parentDrawY);
        } else if (parent.borderRadius > 0 && parent.hasBg) {
          this.gfx.fillRoundRect(parent.box.x, parentDrawY, parent.box.w, parent.box.h, parent.borderRadius, parentFillBg);
        } else if (parent.hasBg) {
          this.gfx.fillRect(parent.box.x, parentDrawY, parent.box.w, parent.box.h, parentFillBg);
        }
        if (parent.borderStyle) this.drawNodeBorder(parent, parentDrawX, parentDrawY, parent.borderColor || parent.fg);
        this.drawNodeOutline(parent, parentDrawX, parentDrawY);
      } finally {
        parent.box.x = origParentX;
      }
    });
    return true;
  }

  private clearNodePaintRect(node: MutableNode, rect: { x: number; y: number; w: number; h: number }): void {
    if (rect.w <= 0 || rect.h <= 0) return;
    const clip = this.scrollClipForNode(node.index);
    const repairRect = this.intersectClipRect(clip, rect);
    if (repairRect.w <= 0 || repairRect.h <= 0) return;
    if (this.repairCurrentNodePaintWithParent(node, repairRect)) return;
    this.gfx.withClipRect(repairRect, () => {
      this.gfx.fillRect(repairRect.x, repairRect.y, repairRect.w, repairRect.h, this.parentClearColor(node));
      const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
      if (parent) {
        const parentDrawY = this.drawYForNode(parent.index);
        const parentDrawX = this.drawXForNode(parent.index);
        if (parent.borderStyle) this.drawNodeBorder(parent, parentDrawX, parentDrawY, parent.borderColor || parent.fg);
        this.drawNodeOutline(parent, parentDrawX, parentDrawY);
      }
    });
    this.directFrameChanged = true;
  }

  private clearCurrentNodePaint(node: MutableNode): void {
    const displayText = node.hasTextBinding ? node.textBuffer : node.text;
    const ts = this.nodeTextSize(node);
    let textMaxW = node.box.w;
    if (node.kind === "text" || node.kind === "button" || node.kind === "select") {
      const insets = this.textInsets(node);
      textMaxW = Math.max(0, node.box.w - insets.left - insets.right);
    }
    const metrics = this.textLayout(node, displayText, textMaxW, ts);
    const insets = (node.kind === "text" || node.kind === "select") ? this.textInsets(node) : { left: 0, right: 0, top: 0, bottom: 0 };
    let clearW = metrics.width + insets.left + insets.right;
    let clearH = metrics.height + insets.top + insets.bottom;
    if (node.kind === "check" || node.kind === "radio") {
      clearW += 22;
      if (clearH < 16) clearH = 16;
    }
    const rect = this.nodePaintRect(
      node,
      this.baseDrawXForNode(node.index),
      this.baseDrawYForNode(node.index),
      this.drawXForNode(node.index),
      this.drawYForNode(node.index),
      clearW,
      clearH,
    );
    this.clearNodePaintRect(node, rect);
  }

  private tryRepairGeometryFill(node: MutableNode, oldRect: { x: number; y: number; w: number; h: number }): boolean {
    if (oldRect.w <= 0 || oldRect.h <= 0) return false;
    if (node.kind !== "fill" || !node.hasBg) return false;
    if (node.gradientEnabled !== 0) return false;
    if (node.borderRadius !== 0 || node.borderStyle !== 0 || node.outlineStyle !== 0 || (node.shadowCount ?? 0) !== 0) return false;

    const newRect = this.currentPaintRect(node);
    if (newRect.w <= 0 || newRect.h <= 0) return false;
    const x0 = Math.min(oldRect.x, newRect.x);
    const y0 = Math.min(oldRect.y, newRect.y);
    const x1 = Math.max(oldRect.x + oldRect.w, newRect.x + newRect.w);
    const y1 = Math.max(oldRect.y + oldRect.h, newRect.y + newRect.h);
    let repair = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    repair = this.intersectClipRect(this.scrollClipForNode(node.index), repair);
    if (repair.w <= 0 || repair.h <= 0) {
      this.invalidateScrollCanvasForNode(node.index);
      return true;
    }
    if (repair.w * repair.h > UI_MAX_BUFFERED_PAINT_PIXELS) return false;

    if (!this.repairCurrentNodePaintWithParent(node, repair)) {
      this.gfx.withClipRect(repair, () => {
        this.gfx.fillRect(repair.x, repair.y, repair.w, repair.h, this.parentClearColor(node));
      });
    }
    this.gfx.withClipRect(repair, () => {
      let fillBg = node.bg;
      if (node.opacity < 100) fillBg = blendRuntime(node.bg, this.parentClearColor(node), node.opacity);
      const fillSize = this.rotatedFaceSize(node, node.box.w, node.box.h);
      this.gfx.fillRect(this.drawXForNode(node.index), this.drawYForNode(node.index), fillSize.w, fillSize.h, fillBg);
    });
    this.invalidateScrollCanvasForNode(node.index);
    this.markOverlappingHigherLayersDirtyForRect(node.index, repair);
    this.directFrameChanged = true;
    return true;
  }

  private clearCurrentSubtreePaint(node: MutableNode): void {
    const rect = this.currentSubtreePaintRect(node);
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    const clip = this.scrollClipForNode(node.index);
    const repairRect = this.intersectClipRect(clip, rect);
    if (repairRect.w <= 0 || repairRect.h <= 0) return;
    if (this.repairCurrentNodePaintWithParent(node, repairRect)) return;
    this.gfx.withClipRect(repairRect, () => {
      this.gfx.fillRect(repairRect.x, repairRect.y, repairRect.w, repairRect.h, this.parentClearColor(node));
      const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
      if (parent) {
        const parentDrawY = this.drawYForNode(parent.index);
        const parentDrawX = this.drawXForNode(parent.index);
        if (parent.borderStyle) this.drawNodeBorder(parent, parentDrawX, parentDrawY, parent.borderColor || parent.fg);
        this.drawNodeOutline(parent, parentDrawX, parentDrawY);
      }
    });
  }

  private setVisible(nodeIndex: number, visible: boolean): void {
    const node = this.nodes[nodeIndex];
    if (!node || node.visible === visible) return;

    if (!visible) {
      const subtreeRect = this.currentSubtreePaintRect(node);
      this.clearCurrentSubtreePaint(node);
      for (let i = Math.min(node.subtreeEnd, this.nodes.length) - 1; i >= nodeIndex; i--) {
        const child = this.nodes[i];
        if (!child || !this.isActiveNode(child)) continue;
        child.dirty = false;
      }
      if (subtreeRect) this.markOverlappingHigherLayersDirtyForRect(nodeIndex, subtreeRect);
      node.visible = false;
      this.reflowAfterVisibility(nodeIndex);
      return;
    }

    node.visible = true;
    for (let i = nodeIndex; i < Math.min(node.subtreeEnd, this.nodes.length); i++) {
      const child = this.nodes[i];
      if (!child || !this.isActiveNode(child) || !this.isEffectivelyVisible(child)) continue;
      child.dirty = true;
      this.markOverlappingHigherLayersDirty(i);
    }
    this.reflowAfterVisibility(nodeIndex);
  }

  // ── Visibility reflow (device parity: ui_reflow_visibility) ─────────────
  // Layout is baked at build time; toggling visible alone leaves a collapsed
  // pane's space reserved. Re-stack ancestor flow containers from the baked
  // flowAxis/flowGap/flowFlags metadata, cascading until a container stops
  // changing, then repaint the active screen once.

  private subtreeFlowExtent(c: number, axis: number): number {
    const base = axis === 1 ? this.nodes[c].box.y : this.nodes[c].box.x;
    let maxEnd = base + (axis === 1 ? this.nodes[c].box.h : this.nodes[c].box.w);
    const end = Math.min(this.nodes[c].subtreeEnd, this.nodes.length);
    for (let j = c + 1; j < end; j++) {
      const rel = (axis === 1 ? this.nodes[j].box.y : this.nodes[j].box.x) - base;
      if (rel < 0) continue;
      const jEnd = rel + (axis === 1 ? this.nodes[j].box.h : this.nodes[j].box.w);
      if (jEnd > maxEnd) maxEnd = jEnd;
    }
    return maxEnd - base;
  }

  private shiftSubtreeMain(c: number, axis: number, delta: number): void {
    const end = Math.min(this.nodes[c].subtreeEnd, this.nodes.length);
    for (let j = c; j < end; j++) {
      if (axis === 1) this.nodes[j].box.y += delta;
      else this.nodes[j].box.x += delta;
    }
  }

  private restackFlowContainer(p: number): boolean {
    const axis = this.nodes[p].flowAxis === 2 ? 2 : this.nodes[p].flowAxis === 1 ? 1 : 0;
    if (axis === 0) return false;
    const gap = this.nodes[p].flowGap ?? 0;
    let startSlot = 0;
    let cursor = 0;
    let sawFlow = false;
    let sawVisible = false;
    let changed = false;
    const end = Math.min(this.nodes[p].subtreeEnd, this.nodes.length);
    for (let c = p + 1; c < end; c++) {
      if (this.nodes[c].parentIndex !== p) continue;
      if (((this.nodes[c].flowFlags ?? 0) & 4) !== 0) continue;
      const rel = axis === 1
        ? this.nodes[c].box.y - this.nodes[p].box.y
        : this.nodes[c].box.x - this.nodes[p].box.x;
      if (!sawFlow) { startSlot = rel; sawFlow = true; }
      if (!this.isEffectivelyVisible(this.nodes[c])) continue;
      if (!sawVisible) { cursor = startSlot; sawVisible = true; }
      const shift = cursor - rel;
      if (shift !== 0) {
        this.shiftSubtreeMain(c, axis, shift);
        changed = true;
      }
      cursor += this.subtreeFlowExtent(c, axis) + gap;
    }
    if (!sawVisible) return changed;
    const autoMain = axis === 1
      ? ((this.nodes[p].flowFlags ?? 0) & 1)
      : ((this.nodes[p].flowFlags ?? 0) & 2);
    if (autoMain) {
      let newSize = cursor - gap + (axis === 1 ? this.nodes[p].paddingBottom ?? 0 : this.nodes[p].paddingRight ?? 0);
      if (newSize < 1) newSize = 1;
      const cur = axis === 1 ? this.nodes[p].box.h : this.nodes[p].box.w;
      if (newSize !== cur) {
        if (axis === 1) this.nodes[p].box.h = newSize;
        else this.nodes[p].box.w = newSize;
        changed = true;
      }
    }
    return changed;
  }

  private reflowScrollContent(p: number): void {
    const node = this.nodes[p];
    if (!node.scrollable || node.virtualized) return;
    let maxBottom = node.box.y;
    const end = Math.min(node.subtreeEnd, this.nodes.length);
    for (let j = p + 1; j < end; j++) {
      if (!this.isEffectivelyVisible(this.nodes[j])) continue;
      const bottom = this.nodes[j].box.y + this.nodes[j].box.h;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    const ch = Math.max(maxBottom - node.box.y, node.box.h);
    node.contentHeight = ch;
    const maxScroll = Math.max(0, ch - node.box.h);
    if (node.scrollY > maxScroll) node.scrollY = maxScroll;
    node.lastPaintedScrollY = node.scrollY - (node.box.h > 0 ? node.box.h : 1);
  }

  private reflowAfterVisibility(changedNode: number): void {
    let p = this.nodes[changedNode]?.parentIndex ?? -1;
    let anyChange = false;
    let guard = 0;
    while (p >= 0 && p < this.nodes.length && guard++ < 64) {
      const changedHere = this.restackFlowContainer(p);
      this.reflowScrollContent(p);
      if (!changedHere) break;
      anyChange = true;
      p = this.nodes[p].parentIndex ?? -1;
    }
    if (!anyChange) return;
    for (const node of this.nodes) {
      if ((node.screenId ?? 0) !== this.activeScreen) continue;
      node.dirty = true;
      node.lastTextHeight = 0;
    }
  }

  private classifyDirtyAgainstOpenDrawers(): void {
    for (const [dIdx, dState] of this.drawerStates) {
      if (!dState.open || dState.progress < 1) continue;
      const drawer = this.nodes[dIdx];
      if (!drawer) continue;
      const dX = this.drawXForNode(dIdx);
      const dY = this.drawYForNode(dIdx);
      for (const node of this.nodes) {
        if (!node.dirty) continue;
        if (node.index >= dIdx && node.index < drawer.subtreeEnd) continue;
        if (!this.isActiveNode(node)) continue;
        const nX = this.drawXForNode(node.index);
        const nY = this.drawYForNode(node.index);
        if (nX + node.box.w <= dX || nX >= dX + drawer.box.w ||
            nY + node.box.h <= dY || nY >= dY + drawer.box.h) continue;
        const fullyCovered = nX >= dX && nY >= dY &&
          nX + node.box.w <= dX + drawer.box.w &&
          nY + node.box.h <= dY + drawer.box.h;
        if (fullyCovered && drawer.hasBg && drawer.opacity >= 100) {
          node.dirty = false;
        } else {
          drawer.dirty = true;
          drawer.lastTextHeight = 0;
          for (let c = dIdx + 1; c < drawer.subtreeEnd && c < this.nodes.length; c++) {
            this.nodes[c].dirty = true;
            this.nodes[c].lastTextHeight = 0;
          }
        }
      }
    }
  }

  private scrollClipForNode(nodeIndex: number): { x: number; y: number; w: number; h: number } | undefined {
    let parent = this.nodes[nodeIndex].parentIndex;
    let clip: { x: number; y: number; w: number; h: number } | undefined;
    while (parent >= 0 && this.nodes[parent]) {
      const scrollParent = this.nodes[parent];
      if (scrollParent.scrollable) {
        const next = { x: scrollParent.box.x, y: scrollParent.box.y, w: scrollParent.box.w, h: scrollParent.box.h };
        if (!clip) {
          clip = next;
        } else {
          const x0 = Math.max(clip.x, next.x);
          const y0 = Math.max(clip.y, next.y);
          const x1 = Math.min(clip.x + clip.w, next.x + next.w);
          const y1 = Math.min(clip.y + clip.h, next.y + next.h);
          clip = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
        }
      }
      parent = scrollParent.parentIndex;
    }
    return clip;
  }

  private rectIntersectsClip(node: MutableNode, drawY: number, clip: { x: number; y: number; w: number; h: number }): boolean {
    return node.box.x + node.box.w > clip.x &&
      node.box.x < clip.x + clip.w &&
      drawY + node.box.h > clip.y &&
      drawY < clip.y + clip.h;
  }

  private intersectClipRect(
    a: { x: number; y: number; w: number; h: number } | undefined,
    b: { x: number; y: number; w: number; h: number },
  ): { x: number; y: number; w: number; h: number } {
    if (!a) return b;
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  private clearDirtyScrollViewports(): boolean {
    let changed = false;
    for (const node of this.nodes) {
      if (!this.isActiveNode(node)) continue;
      // Device parity (dirty-draw-phase): generic scroll passes skip
      // VIRTUALIZED nodes — lists own their full draw (rows + scrollbar)
      // in drawListNode. Letting this pass clear a list wipes its rows.
      if (!node.scrollable || node.virtualized || !this.isEffectivelyVisible(node) || node.contentHeight <= node.box.h) continue;
      if (node.dirty) {
        this.markScrollDescendantsDirtyLocal(node.index);
        for (let i = node.index; i < node.subtreeEnd; i++) {
      if (this.nodes[i]?.kind === "progress") this.nodes[i].lastTextWidth = -1;
      else if (this.nodes[i]?.kind === "range") this.nodes[i].lastTextWidth = -1;
      if (this.nodes[i]) this.nodes[i].lastTextHeight = 0;
        }
        this.gfx.fillRect(node.box.x, node.box.y, node.box.w, node.box.h, node.hasBg ? node.bg : node.clearColor);
        changed = true;
      }
    }
    return changed;
  }

  private drawScrollbars(scrollbarDirty: Set<number>): boolean {
    let changed = false;
    for (const node of this.nodes) {
      if (!this.isActiveNode(node)) continue;
      // Device parity (dirty-draw-phase): virtualized lists draw their own
      // scrollbar in drawListNode — drawing here too overdrew it with the
      // old dim and clamped scrollY against the node-level contentHeight.
      if (!node.scrollable || node.virtualized || !this.isEffectivelyVisible(node) || node.contentHeight <= node.box.h) continue;
      if (!scrollbarDirty.has(node.index)) continue;
      const tx = node.box.x + node.box.w - 4;
      const ty = node.box.y;
      const th = node.box.h;
      node.scrollY = Math.max(0, Math.min(node.scrollY, node.contentHeight - th));
      const trackColor = dimRuntimeColor(node.fg);
      this.gfx.fillRect(tx, ty, 3, th, trackColor);
      const thumbH = Math.max(8, Math.trunc((th * th) / node.contentHeight));
      const thumbY = ty + Math.trunc(((node.box.h - thumbH) * node.scrollY) / Math.max(1, node.contentHeight - th));
      this.gfx.fillRect(tx, thumbY, 3, thumbH, node.fg);
      changed = true;
    }
    return changed;
  }

  private nodeTextSize(node: MutableNode): number {
    return Math.max(1, Math.trunc(node.textSize || 2));
  }

  private fontAsset(fontFace: number | undefined): UIFontAssetModel | undefined {
    if (!fontFace) return undefined;
    return this.fontAssets.find((asset) => asset.id === fontFace);
  }

  private fontGlyph(asset: UIFontAssetModel, codepoint: number): UIFontGlyphModel | undefined {
    return asset.glyphs.find((glyph) => glyph.codepoint === codepoint);
  }

  private fontAlpha(asset: UIFontAssetModel, glyph: UIFontGlyphModel, pixelIndex: number): number {
    const nibble = glyph.dataOffset + pixelIndex;
    const byte = asset.alpha[nibble >> 1] ?? 0;
    return (nibble & 1) ? byte & 0x0f : byte >> 4;
  }

  private textWidth(text: string | undefined, size: number, fontFace = 0, letterSpacing = 0): number {
    const displayText = text ?? "";
    const asset = this.fontAsset(fontFace);
    if (!asset) {
      if (!displayText) return 0;
      let width = 0;
      for (const _ch of displayText) width += Math.max(1, Math.trunc(size)) * 6 + Math.trunc(letterSpacing);
      return width;
    }
    let width = 0;
    for (const ch of displayText) {
      const glyph = this.fontGlyph(asset, ch.codePointAt(0) ?? 0);
      width += glyph ? glyph.advance : Math.trunc(asset.lineHeight / 2);
    }
    return width;
  }

  private textHeight(size: number, fontFace = 0): number {
    return this.fontAsset(fontFace)?.lineHeight ?? this.gfx.textHeight(size);
  }

  private textLineHeight(node: MutableNode, size: number): number {
    const lineHeight = Math.trunc(node.lineHeight || 0);
    return lineHeight > 0 ? lineHeight : this.textHeight(size, node.fontFace);
  }

  private textWhiteSpace(node: MutableNode): string {
    switch (node.whiteSpaceMode ?? (node.nowrap ? 1 : 0)) {
      case 1: return "nowrap";
      case 2: return "pre";
      case 3: return "pre-line";
      default: return "normal";
    }
  }

  private textLayout(node: MutableNode, text: string | undefined, maxWidth: number | undefined, size: number) {
    const constrainedWidth = maxWidth !== undefined && maxWidth > 0 ? maxWidth : undefined;
    return layoutText(text ?? "", {
      maxWidth: constrainedWidth,
      whiteSpace: this.textWhiteSpace(node),
      lineHeight: this.textLineHeight(node, size),
      measureText: (value) => this.textWidth(value, size, node.fontFace, node.letterSpacing),
    });
  }

  private clipTextToWidth(text: string, maxWidth: number, size: number, fontFace = 0, letterSpacing = 0): string {
    let out = "";
    let width = 0;
    for (const ch of text) {
      const next = this.textWidth(ch, size, fontFace, letterSpacing);
      if (width + next > maxWidth) break;
      out += ch;
      width += next;
    }
    return out;
  }

  // text-overflow: ellipsis — trim trailing chars until the prefix + "..." fits
  // maxWidth, then append "...". Mirrors the C++ ui_truncate_ellipsis.
  private truncateEllipsis(text: string, maxWidth: number, size: number, fontFace = 0, letterSpacing = 0): string {
    const dotsW = this.textWidth("...", size, fontFace, letterSpacing);
    let prefix = "";
    let width = 0;
    for (const ch of text) {
      const next = this.textWidth(ch, size, fontFace, letterSpacing);
      if (width + next + dotsW > maxWidth) break;
      prefix += ch;
      width += next;
    }
    return prefix.length > 0 ? prefix + "..." : (maxWidth >= dotsW ? "..." : "");
  }

  private drawAssetText(text: string, x: number, y: number, fg: number, bg: number, antialias: boolean | undefined, fontFace = 0): boolean {
    const asset = this.fontAsset(fontFace);
    if (!asset) return false;
    let cursor = x;
    const baseline = y + asset.baseline;
    const clip = this.activeDrawClip();
    for (const ch of text) {
      const glyph = this.fontGlyph(asset, ch.codePointAt(0) ?? 0);
      if (!glyph) {
        cursor += Math.trunc(asset.lineHeight / 2);
        continue;
      }
      const glyphX = cursor + glyph.xOffset;
      const glyphY = baseline + glyph.yOffset;
      if (glyphX + glyph.width <= clip.x || glyphX >= clip.x + clip.w ||
        glyphY + glyph.height <= clip.y || glyphY >= clip.y + clip.h) {
        cursor += glyph.advance;
        continue;
      }
      const gxStart = Math.max(0, clip.x - glyphX);
      const gyStart = Math.max(0, clip.y - glyphY);
      const gxEnd = Math.min(glyph.width, clip.x + clip.w - glyphX);
      const gyEnd = Math.min(glyph.height, clip.y + clip.h - glyphY);
      for (let gy = gyStart; gy < gyEnd; gy++) {
        for (let gx = gxStart; gx < gxEnd; gx++) {
          const alpha = this.fontAlpha(asset, glyph, gy * glyph.width + gx);
          if (alpha === 0) continue;
          const dx = glyphX + gx;
          const dy = glyphY + gy;
          if (antialias) {
            this.gfx.drawPixel(dx, dy, alpha >= 15 ? fg : blendRuntime(fg, bg, Math.trunc((alpha * 100) / 15)));
          } else if (alpha >= 8) {
            this.gfx.drawPixel(dx, dy, fg);
          }
        }
      }
      cursor += glyph.advance;
    }
    return true;
  }

  private drawText(text: string | undefined, x: number, y: number, fg: number, bg: number, size: number, antialias: boolean | undefined, fontFace = 0, letterSpacing = 0): void {
    const displayText = text ?? "";
    if (this.drawAssetText(displayText, x, y, fg, bg, antialias, fontFace)) return;
    if (antialias && letterSpacing === 0 && this.snapshot.program.colorFormat !== "mono" && (fg & 0xffff) !== (bg & 0xffff)) {
      this.gfx.drawAntialiasedText(displayText, x, y, fg, bg, size);
      return;
    }
    this.gfx.setTextColor(fg, bg);
    this.gfx.setTextSize(size);
    this.gfx.setTextWrap(false);
    if (letterSpacing === 0) {
      this.gfx.setCursor(x, y);
      this.gfx.print(displayText);
      return;
    }
    let cursor = x;
    for (const ch of displayText) {
      this.gfx.setCursor(cursor, y);
      this.gfx.print(ch);
      cursor += Math.max(1, Math.trunc(size)) * 6 + Math.trunc(letterSpacing);
    }
  }

  private drawGradientFill(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    if (bw <= 0 || bh <= 0) return;
    const clip = this.intersectRect({ x: bx, y: by, w: bw, h: bh }, this.activeDrawClip());
    if (!clip) return;
    if (node.gradientEnabled === 1) {
      const yStart = clip.y - by;
      const yEnd = clip.y + clip.h - by;
      for (let y = yStart; y < yEnd; y++) {
        const opacity = Math.trunc((y * 100) / (bh > 1 ? bh - 1 : 1));
        this.gfx.drawFastHLine(clip.x, by + y, clip.w, blendRuntime(node.gradientColor1, node.gradientColor2, opacity));
      }
    } else if (node.gradientEnabled === 2) {
      const xStart = clip.x - bx;
      const xEnd = clip.x + clip.w - bx;
      for (let x = xStart; x < xEnd; x++) {
        const opacity = Math.trunc((x * 100) / (bw > 1 ? bw - 1 : 1));
        this.gfx.drawFastVLine(bx + x, clip.y, clip.h, blendRuntime(node.gradientColor1, node.gradientColor2, opacity));
      }
    }
  }

  private drawNodeShadow(node: MutableNode, drawY: number, insetOnly: boolean): void {
    const count = Math.min(node.shadowCount ?? 0, 4);
    if (count <= 0) return;
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    const clearCol = node.clearColor;
    const radius = Math.max(0, Math.trunc(node.borderRadius || 0));

    for (let s = 0; s < count; s++) {
      const inset = !!node.shadowInset?.[s];
      if (insetOnly && !inset) continue;
      if (!insetOnly && inset) continue;
      const shadowCol = node.shadowColor?.[s] ?? 0;
      const ox = Math.trunc(node.shadowOffsetX?.[s] ?? 0);
      const oy = Math.trunc(node.shadowOffsetY?.[s] ?? 0);
      const rawBlur = Math.trunc(node.shadowBlur?.[s] ?? 0);
      const blur = rawBlur === 0 ? 1 : rawBlur;
      const baseAlpha = Math.max(0, Math.min(100, Math.trunc(node.shadowAlpha?.[s] ?? 100)));

      if (inset && rawBlur === 0) {
        const insetBg = node.hasBg ? node.bg : node.clearColor;
        const col = blendRuntime(shadowCol, insetBg, baseAlpha);
        if (oy > 0) this.gfx.fillRect(bx, by, bw, oy, col);
        else if (oy < 0) this.gfx.fillRect(bx, by + bh + oy, bw, -oy, col);
        if (ox > 0) this.gfx.fillRect(bx, by, ox, bh, col);
        else if (ox < 0) this.gfx.fillRect(bx + bw + ox, by, -ox, bh, col);
        if (ox === 0 && oy === 0) this.gfx.drawRect(bx, by, bw, bh, col);
        continue;
      }

      for (let pass = blur; pass >= 1; pass--) {
        const opacity = Math.trunc(baseAlpha / (pass + 1));
        const col = blendRuntime(shadowCol, inset ? (node.hasBg ? node.bg : clearCol) : clearCol, opacity);
        if (inset) {
          const ix = bx + pass + ox;
          const iy = by + pass + oy;
          const iw = bw - 2 * pass;
          const ih = bh - 2 * pass;
          if (iw <= 0 || ih <= 0) continue;
          this.gfx.fillRect(ix, iy, iw, 1, col);
          this.gfx.fillRect(ix, iy + ih - 1, iw, 1, col);
          this.gfx.fillRect(ix, iy, 1, ih, col);
          this.gfx.fillRect(ix + iw - 1, iy, 1, ih, col);
        } else {
          const sx = bx + ox - pass;
          const sy = by + oy - pass;
          const sw = bw + 2 * pass;
          const sh = bh + 2 * pass;
          if (radius > 0) this.gfx.fillRoundRect(sx, sy, sw, sh, radius + pass, col);
          else this.gfx.fillRect(sx, sy, sw, sh, col);
        }
      }
    }
  }

  private drawRectOutline(x: number, y: number, w: number, h: number, radius: number, style: number, width: number, color: number): void {
    if (style === 0 || width <= 0 || w <= 0 || h <= 0) return;
    for (let b = 0; b < width; b++) {
      const rx = x + b;
      const ry = y + b;
      const rw = w - 2 * b;
      const rh = h - 2 * b;
      if (rw <= 0 || rh <= 0) return;
      const r = radius > b ? radius - b : 0;
      if (style === 1) {
        if (r > 0) this.drawClosedRoundRect(rx, ry, rw, rh, r, color);
        else this.gfx.drawRect(rx, ry, rw, rh, color);
      } else {
        for (let dx = 0; dx < rw; dx += 8) {
          const seg = Math.min(4, rw - dx);
          if (seg > 0) {
            this.gfx.drawFastHLine(rx + dx, ry, seg, color);
            this.gfx.drawFastHLine(rx + dx, ry + rh - 1, seg, color);
          }
        }
        for (let dy = 0; dy < rh; dy += 8) {
          const seg = Math.min(4, rh - dy);
          if (seg > 0) {
            this.gfx.drawFastVLine(rx, ry + dy, seg, color);
            this.gfx.drawFastVLine(rx + rw - 1, ry + dy, seg, color);
          }
        }
      }
    }
  }

  private drawClosedRoundRect(x: number, y: number, w: number, h: number, radius: number, color: number): void {
    let r = Math.max(0, Math.trunc(radius));
    if (w <= 0 || h <= 0) return;
    r = Math.min(r, Math.trunc(Math.min(w, h) / 2));
    if (r <= 0) {
      this.gfx.drawRect(x, y, w, h, color);
      return;
    }
    this.gfx.drawRoundRect(x, y, w, h, r, color);
    this.gfx.drawPixel(x + r, y, color);
    this.gfx.drawPixel(x + w - r - 1, y, color);
    this.gfx.drawPixel(x + r, y + h - 1, color);
    this.gfx.drawPixel(x + w - r - 1, y + h - 1, color);
    this.gfx.drawPixel(x, y + r, color);
    this.gfx.drawPixel(x + w - 1, y + r, color);
    this.gfx.drawPixel(x, y + h - r - 1, color);
    this.gfx.drawPixel(x + w - 1, y + h - r - 1, color);
  }

  private drawNodeBorder(node: MutableNode, drawX: number, drawY: number, color: number): void {
    this.drawRectOutline(drawX, drawY, node.box.w, node.box.h, node.borderRadius, node.borderStyle, node.borderWidth, color);
  }

  private drawNodeOutline(node: MutableNode, drawX: number, drawY: number): void {
    if (!node.outlineStyle || !node.outlineWidth) return;
    const w = node.outlineWidth;
    this.drawRectOutline(drawX - w, drawY - w, node.box.w + 2 * w, node.box.h + 2 * w, node.borderRadius + w, node.outlineStyle, w, node.outlineColor);
  }

  // Set dirty=true across a scroll subtree WITHOUT the per-child O(n) overlap
  // repair. During scroll the subtree repaints into a freshly-cleared canvas, so
  // intra-subtree repair is pointless, and scroll children are draw-clipped to
  // the container's viewport box — so a single overlap check at the container
  // (done by markScrollDescendantsDirty) covers all external higher-z neighbors.
  private markScrollDescendantsDirtyLocal(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    for (let i = nodeIndex + 1; i < node.subtreeEnd; i++) {
      if (this.nodes[i]) this.nodes[i].dirty = true;
    }
    this.nodes[nodeIndex].dirty = true;
  }

  private markScrollDescendantsDirty(nodeIndex: number): void {
    this.markScrollDescendantsDirtyLocal(nodeIndex);
    // Single overlap check at the container covers every external higher-z
    // neighbor of the viewport (children are clipped to this box). Drops scroll
    // marking from O(K·n) to O(K + n).
    this.markOverlappingHigherLayersDirty(nodeIndex);
  }

  private markScrollViewDirty(nodeIndex: number): void {
    if (!this.nodes[nodeIndex]) return;
    this.nodes[nodeIndex].dirty = true;
    this.markOverlappingHigherLayersDirty(nodeIndex);
  }

  private invalidateScrollCanvasForNode(_nodeIndex: number): void {
    // Device runtime invalidates its cached shifted scroll canvas here. The
    // preview renderer draws into one framebuffer and has no persistent scroll
    // backing canvas, so the equivalent operation is intentionally empty.
  }

  private drawDirty(): boolean {
    if (this.keyboardVisible) {
      this.keyboardTick(Date.now());
      if (this.keyboardDirty === 0) return false;
      if (this.keyboardDirty === 1) {
        this.drawKeyboard();
      } else {
        this.drawKeyboardTextRow();
        if (this.keyboardRepaintKey >= 0) this.drawKeyboardKey(this.keyboardRepaintKey);
      }
      this.keyboardDirty = 0;
      this.keyboardRepaintKey = -1;
      return true;
    }

    let changed = this.clearDirtyScrollViewports();
    const scrollbarDirty = new Set<number>();
    for (const node of this.nodes) {
      if (this.isActiveNode(node) && this.isEffectivelyVisible(node) && node.scrollable && node.dirty) scrollbarDirty.add(node.index);
    }
    // Open-drawer overlap pre-pass (device parity, the dirty-draw loop's
    // classification): a dirty node under a fully-open opaque drawer paints
    // its clear+redraw over the panel — a bound text behind the drawer erases
    // the drawer's buttons. Fully covered -> nothing of it is visible, drop
    // the dirty flag; partially covered -> re-dirty that drawer's subtree so
    // it re-stamps on top in this same pass (its z sorts it after).
    this.classifyDirtyAgainstOpenDrawers();
    const dirtyNodes = this.nodes
      .filter((node) => {
        if (!node.dirty) return false;
        if (!this.isActiveNode(node)) {
          node.dirty = false;
          return false;
        }
        if (!this.isEffectivelyVisible(node)) {
          node.dirty = false;
          return false;
        }
        return true;
      })
      .sort((a, b) => this.compareDrawOrder(a, b));
    for (const node of dirtyNodes) {
      if (!node.dirty) continue;
      if (!this.isEffectivelyVisible(node) || this.insideClosedDrawer(node.index)) {
        node.dirty = false;
        continue;
      }
      if (!this.isActiveNode(node)) {
        node.dirty = false;
        continue;
      }
      const origBoxX = node.box.x;
      const baseX = this.baseDrawXForNode(node.index);
      const baseY = this.baseDrawYForNode(node.index);
      const drawX = this.drawXForNode(node.index);
      const drawY = this.drawYForNode(node.index);
      node.box.x = drawX;
      const scrollClip = this.scrollClipForNode(node.index);
      if (scrollClip && !this.rectIntersectsClip(node, drawY, scrollClip)) {
        node.box.x = origBoxX;
        node.dirty = false;
        continue;
      }
      this.clearPressOffsetArea(node, baseX, baseY);

      const displayText = node.hasTextBinding ? node.textBuffer : node.text;
      const ts = this.nodeTextSize(node);
      let bColor = node.borderColor || node.fg;
      if (node.opacity < 100) bColor = blendRuntime(bColor, node.clearColor, node.opacity);
      // Opacity background: blend the node's bg toward the backdrop (the parent
      // clear color — what's actually behind the node) so a translucent element
      // fades toward what's behind it. Mirrors the C++ fillBg computation.
      // (node.clearColor is the node's own bg for filled nodes — a no-op blend
      // target — so we use parentClearColor, the real backdrop.)
      let fillBg = node.bg;
      if (node.opacity < 100) fillBg = blendRuntime(node.bg, this.parentClearColor(node), node.opacity);

      this.gfx.withClipRect(scrollClip, () => {
        // Lists draw their outset shadow inside drawListNode, on the
        // full-repaint path only. The shadow rect spans the element, so
        // pre-drawing it here would paint over the live viewport pixels the
        // shift path is about to copy (device parity: the C++ main loop also
        // skips the outset shadow for lists — see node-draw-body.ts).
        if (node.kind !== "list") {
          node.box.x = baseX;
          this.drawNodeShadow(node, baseY, false);
        }
        node.box.x = drawX;
        switch (node.kind) {
          case "fill":
            if (node.gradientEnabled > 0) {
              this.drawGradientFill(node, drawY);
            } else {
              const fillSize = this.rotatedFaceSize(node, node.box.w, node.box.h);
              if (node.borderRadius > 0 && node.hasBg) this.gfx.fillRoundRect(node.box.x, drawY, fillSize.w, fillSize.h, node.borderRadius, fillBg);
              else if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, fillSize.w, fillSize.h, fillBg);
              if (node.borderStyle) this.drawRectOutline(node.box.x, drawY, fillSize.w, fillSize.h, node.borderRadius, node.borderStyle, node.borderWidth, bColor);
            }
            this.drawNodeShadow(node, drawY, true);
            break;
          case "text":
            this.drawTextNode(node, displayText, drawY, ts);
            break;
          case "button":
            this.drawButtonNode(node, displayText, bColor, fillBg, drawY, ts);
            break;
          case "select":
            this.drawSelectNode(node, displayText, bColor, fillBg, drawY, ts);
            break;
          case "check":
            this.drawCheckNode(node, displayText, drawY, ts);
            break;
          case "radio":
            this.drawRadioNode(node, displayText, drawY, ts);
            break;
          case "progress":
            this.drawProgressNode(node, drawY);
            break;
          case "range":
            this.drawRangeNode(node, drawY);
            break;
          case "input":
            this.drawInputNode(node, drawY);
            break;
          case "img":
            this.drawImageNode(node, drawY);
            break;
          case "list":
            this.drawListNode(node, drawY, scrollClip);
            break;
          case "canvas":
            this.drawCanvasNode(node, drawY);
            break;
        }
        if (node.kind === "fill" && this.rotationQuadrant(node.rotateDeg) !== 0 && node.outlineStyle && node.outlineWidth > 0) {
          const w = node.outlineWidth;
          const outlineSize = this.rotatedFaceSize(node, node.box.w, node.box.h);
          this.drawRectOutline(node.box.x - w, drawY - w, outlineSize.w + 2 * w, outlineSize.h + 2 * w, node.borderRadius + w, node.outlineStyle, w, node.outlineColor);
        } else {
          this.drawNodeOutline(node, node.box.x, drawY);
        }
      });
      changed = true;
      node.box.x = origBoxX;
      node.dirty = false;
      if (this.debugCapture) {
        this.debugPaintedRects.push({ x: drawX, y: drawY, w: node.box.w, h: node.box.h });
      }
    }
    return this.drawScrollbars(scrollbarDirty) || changed;
  }

  /** Enable/disable per-frame debug geometry capture (the client overlay
   *  reads it; zero cost while off). */
  setDebugCapture(on: boolean): void {
    this.debugCapture = on;
    if (!on) this.debugPaintedRects = [];
  }

  /** Current-frame debug geometry for the client overlay: every visible node
   *  on the active screen at its CURRENT draw position (transform/press/
   *  drawer/scroll offsets applied), the scroll viewport clips, and the
   *  regions painted this tick (dirty-flash). Coordinates are logical
   *  display pixels, matching the app canvas 1:1. */
  debugInfo(): {
    nodes: Array<{ i: number; id?: string; tag: string; kind: string; x: number; y: number; w: number; h: number; tappable: boolean }>;
    clips: Array<{ x: number; y: number; w: number; h: number }>;
    painted: Array<{ x: number; y: number; w: number; h: number }>;
  } {
    const nodes: Array<{ i: number; id?: string; tag: string; kind: string; x: number; y: number; w: number; h: number; tappable: boolean }> = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!this.isActiveNode(node) || !this.isEffectivelyVisible(node)) continue;
      if (this.insideClosedDrawer(i)) continue;
      nodes.push({
        i,
        id: node.id,
        tag: node.tag,
        kind: String(node.kind),
        x: this.drawXForNode(i),
        y: this.drawYForNode(i),
        w: node.box.w,
        h: node.box.h,
        tappable: this.hasAnyHandler(i),
      });
    }
    const clips: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const node of this.nodes) {
      if (!this.isActiveNode(node) || !node.scrollable) continue;
      clips.push({ x: node.box.x, y: node.box.y, w: node.box.w, h: node.box.h });
    }
    return { nodes, clips, painted: this.debugPaintedRects.slice() };
  }

  /** Inspect-on-tap: topmost node (draw order) whose CURRENT draw box
   *  contains the point — unlike hitTest, containers count too. Returns the
   *  index, or -1. */
  debugHit(tx: number, ty: number): number {
    let best = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!this.isActiveNode(node) || !this.isEffectivelyVisible(node)) continue;
      if (this.insideClosedDrawer(i)) continue;
      const x = this.drawXForNode(i);
      const y = this.drawYForNode(i);
      if (tx >= x && tx < x + node.box.w && ty >= y && ty < y + node.box.h) {
        if (best < 0 || this.drawsBefore(this.nodes[best], node)) best = i;
      }
    }
    return best;
  }

  private lineX(node: MutableNode, lineWidth: number, left: number, maxWidth: number, align = node.textAlign): number {
    if (align === 1) return left + Math.trunc((maxWidth - lineWidth) / 2);
    if (align === 2) return left + maxWidth - lineWidth;
    return left;
  }

  private textInsets(node: MutableNode): { left: number; right: number; top: number; bottom: number } {
    const border = node.borderWidth || 0;
    return {
      left: border + (node.paddingLeft || 0),
      right: border + (node.paddingRight || 0),
      top: border + (node.paddingTop || 0),
      bottom: border + (node.paddingBottom || 0),
    };
  }

  private drawTextLines(node: MutableNode, displayText: string | undefined, left: number, top: number, maxWidth: number, ts: number, fg: number, bg: number, align = node.textAlign): { width: number; height: number } {
    const layout = this.textLayout(node, displayText, maxWidth, ts);
    let y = top;
    const clip = this.activeDrawClip();
    for (const line of layout.lines) {
      if (y + layout.lineHeight <= clip.y || y >= clip.y + clip.h) {
        y += layout.lineHeight;
        continue;
      }
      // text-overflow: when a line is wider than maxWidth, truncate it. Ellipsis
      // (textOverflow truthy) appends "..."; clip (falsy) hard-cuts. Mirrors the
      // C++ ui_draw_wrapped_text overflow branch (ui_truncate_ellipsis/_clip).
      let lineText = line.text;
      if (line.width > maxWidth && maxWidth > 0) {
        if (node.textOverflow) {
          lineText = this.truncateEllipsis(line.text, maxWidth, ts, node.fontFace, node.letterSpacing);
        } else {
          lineText = this.clipTextToWidth(line.text, maxWidth, ts, node.fontFace, node.letterSpacing);
        }
      }
      const lineW = this.textWidth(lineText, ts, node.fontFace, node.letterSpacing);
      const x = this.lineX(node, lineW, left, maxWidth, align);
      if (x + lineW > clip.x && x < clip.x + clip.w) {
        this.drawText(lineText, x, y, fg, bg, ts, node.fontAntialias, node.fontFace, node.letterSpacing);
        if (node.underline) this.gfx.drawFastHLine(x, y + this.textHeight(ts, node.fontFace) - 1, lineW, fg);
      }
      y += layout.lineHeight;
    }
    return { width: layout.width, height: layout.height };
  }

  // Draw a rich-text node from its precomputed run/segment/line geometry (the
  // host twin of the C++ ui_draw_rich_text). Does NOT re-wrap — geometry was
  // baked at transpile time. Iterate segments once, skip lines and segments
  // outside the active clip, and compute each segment's x-origin from textAlign
  // + line width. Segments of different font-sizes align on the line's baseline.
  private drawRichNode(node: MutableNode, drawY: number, ts: number, contentX = node.box.x, contentY = drawY, contentW = node.box.w, boxPainted = false): void {
    if (!node.runLines || !node.runs) return;
    // Clear (mirrors drawTextNode's clear + translucent blend).
    const clearW = Math.max(node.box.w, node.lastTextWidth ?? 0);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0);
    let textClear = node.hasBg ? node.bg : node.clearColor;
    if (node.opacity < 100) {
      const backdrop = this.parentClearColor(node);
      textClear = blendRuntime(node.hasBg ? node.bg : node.clearColor, backdrop, node.opacity);
    }
    if (!boxPainted) this.gfx.fillRect(node.box.x, drawY, clearW, clearH, textClear);

    const drawSegs = (xOffset: number, yOffset: number, fgOverride?: number) => {
      const rl = node.runLines!;
      const runs = node.runs!;
      const clip = this.gfx.getClipRect();
      for (let si = 0; si < rl.segRun.length; si++) {
        const li = rl.segLine[si];
        if (li >= rl.lineY.length) continue;
        const lineTop = contentY + yOffset + rl.lineY[li];
        const lineBottom = lineTop + rl.lineH[li];
        if (clip && (lineBottom <= clip.y || lineTop >= clip.y + clip.h)) continue;
        const lineX = this.lineX(node, rl.lineW[li], contentX + xOffset, contentW);
        const sx = lineX + rl.segX[si];
        if (clip && (sx + rl.segW[si] <= clip.x || sx >= clip.x + clip.w)) continue;
        const run = runs[rl.segRun[si]];
        if (!run) continue;
        const baseline = contentY + yOffset + rl.lineBaseline[li];
        const segY = baseline - (7 * run.textSize);
        const fg = fgOverride ?? run.fg;
        this.drawText(rl.segText[si], sx, segY, fg, textClear, run.textSize, node.fontAntialias, run.fontFace, run.letterSpacing);
        if (run.underline & 1) this.gfx.drawFastHLine(sx, segY + 8 * run.textSize - 1, rl.segW[si], fg);
        if (run.underline & 2) this.gfx.drawFastHLine(sx, segY + 4 * run.textSize, rl.segW[si], fg);
      }
    };
    if (node.textShadowCount > 0) {
      const shadowColor = blendRuntime(node.textShadowColor, textClear, node.textShadowAlpha);
      drawSegs(node.textShadowOffsetX, node.textShadowOffsetY, shadowColor);
    }
    drawSegs(0, 0);
  }

  // Hit-test a tap point (screen coords) against a rich-text node's link runs.
  // Returns the link run's screen index, or -1. Mirrors the C++ ui_rich_link_hit.
  private richLinkHit(nodeIndex: number, tx: number, ty: number): number {
    const node = this.nodes[nodeIndex];
    if (!node.runs || !node.runLines) return -1;
    const drawX = this.drawXForNode(nodeIndex);
    const drawY = this.drawYForNode(nodeIndex);
    const insets = this.textInsets(node);
    const nx = tx - drawX - insets.left;
    const ny = ty - drawY - insets.top;
    const contentW = Math.max(1, node.box.w - insets.left - insets.right);
    for (let si = 0; si < node.runLines.segRun.length; si++) {
      const run = node.runs[node.runLines.segRun[si]];
      if (run.linkTarget < 0) continue;
      const li = node.runLines.segLine[si];
      // Account for center/right alignment the same way draw does.
      const originX = this.lineX(node, node.runLines.lineW[li], 0, contentW);
      const sx = originX + node.runLines.segX[si];
      const sy = node.runLines.lineY[li];
      const sw = node.runLines.segW[si];
      const sh = node.runLines.lineH[li];
      if (nx >= sx && nx < sx + sw && ny >= sy && ny < sy + sh) return run.linkTarget;
    }
    return -1;
  }

  private drawTextNode(node: MutableNode, displayText: string | undefined, drawY: number, ts: number): void {
    const insets = this.textInsets(node);
    const contentX = node.box.x + insets.left;
    const contentY = drawY + insets.top;
    const contentW = Math.max(1, node.box.w - insets.left - insets.right);
    let bColor = node.borderColor || node.fg;
    if (node.opacity < 100) bColor = blendRuntime(bColor, this.parentClearColor(node), node.opacity);
    let fillBg = node.bg;
    if (node.opacity < 100) fillBg = blendRuntime(node.bg, this.parentClearColor(node), node.opacity);
    const textBoxPainted = node.gradientEnabled > 0 || node.hasBg;
    if (node.gradientEnabled > 0) {
      this.drawGradientFill(node, drawY);
    } else if (node.borderRadius > 0 && node.hasBg) {
      this.gfx.fillRoundRect(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, fillBg);
    } else if (node.hasBg) {
      this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, fillBg);
    }
    // Rich-text (inline runs): draw from precomputed geometry instead of the
    // single-string wrapped path.
    if (node.runs && node.runLines) {
      this.drawNodeShadow(node, drawY, true);
      this.drawRichNode(node, drawY, ts, contentX, contentY, contentW, textBoxPainted);
      if (node.borderStyle) this.drawNodeBorder(node, node.box.x, drawY, bColor);
      return;
    }
    const layout = this.textLayout(node, displayText, contentW, ts);
    // overflow:hidden/scroll: cap the clear at the node's own box width so a
    // nowrap line wider than its box doesn't repaint past the edge (mirrors the
    // C++ scrollable clearW cap).
    let clearW = Math.max(node.box.w, node.lastTextWidth + insets.left + insets.right, layout.width + insets.left + insets.right);
    if (node.scrollable) clearW = node.box.w;
    const clearH = Math.max(node.box.h, (node.lastTextHeight ?? 0) + insets.top + insets.bottom, layout.height + insets.top + insets.bottom);
    // Clear + glyph-cell background. When the node is translucent (inherited
    // from an opacity:<1 parent), blend toward the parent's clear color (the
    // backdrop behind the translucent element) so the text area matches the
    // parent's blended fill rather than repainting solid. Mirrors the C++ text
    // clear + textBg blend.
    let textClear = node.hasBg ? node.bg : node.clearColor;
    if (node.opacity < 100) {
      const backdrop = this.parentClearColor(node);
      textClear = blendRuntime(node.hasBg ? node.bg : node.clearColor, backdrop, node.opacity);
    }
    if (!textBoxPainted) this.gfx.fillRect(node.box.x, drawY, clearW, clearH, textClear);
    node.lastTextWidth = layout.width;
    node.lastTextHeight = layout.height;
    this.drawNodeShadow(node, drawY, true);
    if (node.borderStyle) this.drawNodeBorder(node, node.box.x, drawY, bColor);
    if (node.textShadowCount > 0) {
      const shadowColor = blendRuntime(node.textShadowColor, textClear, node.textShadowAlpha);
      this.drawTextLines(
        node,
        displayText,
        contentX + node.textShadowOffsetX,
        contentY + node.textShadowOffsetY,
        contentW,
        ts,
        shadowColor,
        shadowColor,
      );
    }
    this.drawTextLines(node, displayText, contentX, contentY, contentW, ts, node.fg, textClear);
  }

  private listStateForNode(nodeIndex: number): PreviewListState | undefined {
    return this.listStates.find((list) => list.nodeIndex === nodeIndex);
  }

  private shiftListViewport(node: MutableNode, drawY: number, deltaY: number, bg: number): { y: number; h: number } {
    const x = Math.trunc(node.box.x);
    const y = Math.trunc(drawY);
    const w = Math.trunc(node.box.w);
    const h = Math.trunc(node.box.h);
    const shift = Math.abs(Math.trunc(deltaY));
    if (w <= 0 || h <= 0) return { y: 0, h: 0 };
    const borderInset = node.borderStyle ? Math.max(0, Math.trunc(node.borderWidth || 1)) : 0;
    const contentW = w > 4 ? w - 4 : w;
    const copyX = x + borderInset;
    const copyY = y + borderInset;
    const copyW = Math.max(0, contentW - borderInset);
    const copyH = Math.max(0, h - 2 * borderInset);
    if (x < 0 || y < 0 || x + w > this.gfx.width || y + h > this.gfx.height || shift <= 0 || shift >= copyH || copyW <= 0) {
      this.gfx.fillRect(x, y, w, h, bg);
      return { y: 0, h };
    }

    const stride = this.gfx.width;
    const pixels = this.gfx.buffer;
    let exposedY = 0;
    if (deltaY > 0) {
      for (let row = 0; row < copyH - shift; row++) {
        const dst = (copyY + row) * stride + copyX;
        const src = (copyY + row + shift) * stride + copyX;
        pixels.copyWithin(dst, src, src + copyW);
      }
      exposedY = borderInset + copyH - shift;
    } else {
      for (let row = copyH - shift - 1; row >= 0; row--) {
        const dst = (copyY + row + shift) * stride + copyX;
        const src = (copyY + row) * stride + copyX;
        pixels.copyWithin(dst, src, src + copyW);
      }
      exposedY = borderInset;
    }
    this.gfx.fillRect(copyX, y + exposedY, copyW, shift, bg);
    if (w > contentW) this.gfx.fillRect(x + contentW, y, w - contentW, h, bg);
    return { y: exposedY, h: shift };
  }

  private drawListRows(
    node: MutableNode,
    list: PreviewListState,
    drawY: number,
    scrollClip: { x: number; y: number; w: number; h: number } | undefined,
    bg: number,
    repaintY: number,
    repaintH: number,
  ): void {
    if (list.itemCount <= 0 || repaintH <= 0) return;
    const stripClip = this.intersectClipRect(scrollClip, { x: node.box.x, y: drawY + repaintY, w: node.box.w, h: repaintH });
    this.gfx.withClipRect(stripClip, () => {
      const itemHeight = list.itemHeight;
      const ts = this.nodeTextSize(node);
      const textH = this.textHeight(ts, node.fontFace);
      const listScrollY = node.scrollY;
      const first = Math.max(0, Math.trunc((listScrollY + repaintY) / itemHeight));
      const last = Math.min(list.itemCount - 1, Math.trunc((listScrollY + repaintY + repaintH - 1) / itemHeight) + 1);
      for (let row = first; row <= last; row++) {
        const itemY = drawY + row * itemHeight - listScrollY;
        const text = clampText(this.evaluateExpression(list.itemExpression, this.listLocal(list.itemParam, row)));
        this.drawText(
          text,
          node.box.x + 4,
          itemY + Math.trunc((itemHeight - textH) / 2),
          node.fg,
          bg,
          ts,
          node.fontAntialias,
          node.fontFace,
          node.letterSpacing,
        );
      }
    });
  }

  private drawListNode(
    node: MutableNode,
    drawY: number,
    scrollClip: { x: number; y: number; w: number; h: number } | undefined,
  ): void {
    const list = this.listStateForNode(node.index);
    const bg = node.hasBg ? node.bg : node.clearColor;
    if (!list || list.itemHeight <= 0) {
      this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, bg);
      return;
    }

    const deltaY = node.scrollY - node.lastPaintedScrollY;
    const absDelta = Math.abs(deltaY);
    const canShift = deltaY !== 0 && absDelta < node.box.h;
    if (!canShift) {
      // Full repaint: outset shadow at the rest position first, then the bg
      // fill covers its interior overlap. Skipped on the shift path — the
      // shadow rect spans the element and would destroy the pixels about to
      // be shifted (device parity: ui_draw_shadow(i, by, 0) only when
      // !canShiftList, before the canvas push).
      const origX = node.box.x;
      node.box.x = this.baseDrawXForNode(node.index);
      this.drawNodeShadow(node, this.baseDrawYForNode(node.index), false);
      node.box.x = origX;
    }
    const repaint = canShift
      ? this.shiftListViewport(node, drawY, deltaY, bg)
      : (() => {
          this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, bg);
          return { y: 0, h: node.box.h };
        })();

    this.drawListRows(node, list, drawY, scrollClip, bg, repaint.y, repaint.h);

    const listContentH = node.contentHeight;
    if (listContentH > node.box.h) {
      const listClip = this.intersectClipRect(scrollClip, { x: node.box.x, y: drawY, w: node.box.w, h: node.box.h });
      this.gfx.withClipRect(listClip, () => {
        const tx = node.box.x + node.box.w - 4;
        // Halve the track color at the ACTIVE depth (device parity: the
        // runtime's UI_DIM_MASK is 0x7BEF on 565, 0x7F7F7F on 888 — the old
        // 565-only mask channel-shifted the track on rgb888 targets).
        const trackColor = dimRuntimeColor(node.fg);
        this.gfx.fillRect(tx, drawY, 3, node.box.h, trackColor);
        const thumbH = Math.max(8, Math.trunc((node.box.h * node.box.h) / listContentH));
        const maxScroll = Math.max(1, listContentH - node.box.h);
        // Clamp the thumb to the track during overscroll (scrollY stays in range,
        // but overscrollPx can push the visual; the thumb pins to the ends).
        const clampedScrollY = Math.max(0, Math.min(node.scrollY, listContentH - node.box.h));
        const thumbY = drawY + Math.trunc(((node.box.h - thumbH) * clampedScrollY) / maxScroll);
        this.gfx.fillRect(tx, thumbY, 3, thumbH, node.fg);
      });
    }
    let bColor = node.borderColor || node.fg;
    if (node.opacity < 100) bColor = blendRuntime(bColor, node.clearColor, node.opacity);
    this.drawNodeShadow(node, drawY, true);
    if (node.borderStyle) this.drawNodeBorder(node, node.box.x, drawY, bColor);
    node.lastPaintedScrollY = node.scrollY;
  }

  private drawCanvasNode(node: MutableNode, drawY: number): void {
    const binding = this.canvasBindings.find((b) => b.nodeIndex === node.index);
    if (!binding) return;
    this.runCanvasBody(binding.drawBody, node.box.x, drawY, node.canvasW ?? node.box.w, node.canvasH ?? node.box.h);
  }

  /** Lower a canvas drawBody (`ctx.X(...)` source) against the host gfx.
   *  Mirrors the device ctx→ui_display_* rewrite so preview and device match.
   *  Coordinates are translated to the node origin (ox, oy). Only the flat call
   *  sequence is supported — same constraint as bindList item expressions. */
  private runCanvasBody(body: string, ox: number, oy: number, cw: number, ch: number): void {
    const color = (c: string): number => {
      try { return resolveColor(c.replace(/^['"]|['"]$/g, ""), "rgb565"); } catch { return 0xffff; }
    };
    const n = (i: number, args: string[]) => parseInt(args[i], 10) || 0;
    // Resolve each numeric argument: ctx.width/height → canvas dims, integer
    // literals parse directly, anything else (e.g. screen.gauge.value, Math.*,
    // module vars) is evaluated against the screen proxy / module scope. This
    // mirrors the device, which emits these as real C++ expressions evaluated at
    // draw time (`__ui_nodes[i].value`), so the canvas tracks live state.
    const num = (i: number, args: string[]): number => {
      const t = args[i].trim();
      if (t === "ctx.width" || t === "ctx?.width") return cw;
      if (t === "ctx.height" || t === "ctx?.height") return ch;
      const parsed = parseInt(t, 10);
      if (Number.isNaN(parsed)) {
        // Substitute ctx.width/ctx.height with their numeric values so compound
        // expressions like "ctx.height - 3" evaluate correctly. Then try
        // evaluating as a JS expression against module scope.
        const substituted = t
          .replace(/ctx\??\.width/g, String(cw))
          .replace(/ctx\??\.height/g, String(ch));
        if (/^[\d\s+\-*/().]+$/.test(substituted)) {
          // Pure arithmetic — eval safely (no identifiers).
          try { return Math.trunc(Function(`"use strict"; return (${substituted});`)()) || 0; }
          catch { /* fall through */ }
        }
        const value = this.evaluateExpression(substituted);
        return Math.trunc(Number(value)) || 0;
      }
      return parsed || 0;
    };
    const g = this.gfx;
    const re = /ctx\.(fillRect|rect|fillCircle|circle|line|hline|vline|fillRoundRect|roundRect|drawPixel|fillScreen|text)\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const method = m[1];
      const args = m[2].split(",").map((s) => s.trim());
      if (method === "fillRect") g.fillRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), color(args[4]));
      else if (method === "rect") g.drawRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), color(args[4]));
      else if (method === "fillCircle") g.fillCircle(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "circle") g.drawCircle(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "line") g.drawLine(ox + num(0, args), oy + num(1, args), ox + num(2, args), oy + num(3, args), color(args[4]));
      else if (method === "hline") g.drawFastHLine(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "vline") g.drawFastVLine(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "fillRoundRect") g.fillRoundRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), num(4, args), color(args[5]));
      else if (method === "roundRect") g.drawRoundRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), num(4, args), color(args[5]));
      else if (method === "drawPixel") g.drawPixel(ox + num(0, args), oy + num(1, args), color(args[2]));
      else if (method === "fillScreen") g.fillRect(ox, oy, cw, ch, color(args[0]));
      else if (method === "text") {
        g.setCursor(ox + num(0, args), oy + num(1, args));
        if (args.length >= 4) g.setTextColor(color(args[3]));
        g.print(args[2].replace(/^['"`]|['"`]$/g, ""));
      }
    }
    // ctx.rgbBitmap(x, y, data, w, h) — blits an RGB565 pixel array. Handled
    // separately because `data` may be an inline array literal (commas inside
    // brackets) that the generic ([^)]*) regex above can't split. Mirrors the
    // runtime's ui_display_draw_rgb_bitmap lowering (canvas-lowering.ts:94).
    const rgbRe = /ctx\.rgbBitmap\s*\(\s*([^,]+),\s*([^,]+),\s*(\[[^\]]*\]|[$A-Z_a-z][$\w]*)\s*,\s*([^,]+),\s*([^)]+)\)/g;
    let rm: RegExpExecArray | null;
    while ((rm = rgbRe.exec(body)) !== null) {
      const bx = num(0, [rm[1]]);
      const by = num(0, [rm[2]]);
      const dataExpr = rm[3];
      const bw = num(0, [rm[4]]);
      const bh = num(0, [rm[5]]);
      // Evaluate the pixel array against module scope (handles both inline
      // `[r,g,b,...]` literals and variable names).
      let pixels: unknown = undefined;
      try {
        pixels = this.evaluateExpression(`(${dataExpr})`);
      } catch { /* leave undefined; treated as empty below */ }
      if (!Array.isArray(pixels)) continue;
      const px = pixels as number[];
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const i = dy * bw + dx;
          if (i >= px.length) break;
          g.drawPixel(ox + bx + dx, oy + by + dy, Number(px[i]) || 0);
        }
      }
    }
  }
  private drawButtonNode(node: MutableNode, displayText: string | undefined, bColorIn: number, fillBgIn: number, drawY: number, ts: number): void {
    // HTML disabled: halve the drawn colors (web-like faded control;
    // device parity: NODE_BUTTON does the same).
    const bColor = node.disabled ? dimDisabledColor(bColorIn) : bColorIn;
    const fillBg = node.disabled ? dimDisabledColor(fillBgIn) : fillBgIn;
    if (node.borderRadius > 0 && node.hasBg) this.gfx.fillRoundRect(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, fillBg);
    else if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, fillBg);
    this.drawNodeShadow(node, drawY, true);
    if (node.borderStyle) this.drawNodeBorder(node, node.box.x, drawY, bColor);
    const insetL = (node.borderWidth || 0) + (node.paddingLeft || 0);
    const insetR = (node.borderWidth || 0) + (node.paddingRight || 0);
    const insetT = (node.borderWidth || 0) + (node.paddingTop || 0);
    const insetB = (node.borderWidth || 0) + (node.paddingBottom || 0);
    const textX = node.box.x + insetL;
    const textY = drawY + insetT;
    const textW = Math.max(1, node.box.w - insetL - insetR);
    const textH = Math.max(1, node.box.h - insetT - insetB);
    const layout = this.textLayout(node, displayText, textW, ts);
    const top = textY + Math.trunc((textH - layout.height) / 2);
    const glyphBg = node.opacity < 100 ? blendRuntime(node.bg, this.parentClearColor(node), node.opacity) : (node.hasBg ? node.bg : node.clearColor);
    this.drawTextLines(node, displayText, textX, top, textW, ts, node.fg, glyphBg, node.textAlign);
  }

  // <select>: bordered box with its current option text VERTICALLY CENTERED
  // (unlike drawTextNode, which top-aligns). Mirrors the C++ NODE_SELECT case
  // so preview and device agree. The label is dynamic (auto-bound to the
  // selected option), so clear the previous text rect before redrawing.
  private drawSelectNode(node: MutableNode, displayText: string | undefined, bColor: number, fillBg: number, drawY: number, ts: number): void {
    const insets = this.textInsets(node);
    // The right end reserves 14px for the dropdown chevron — the label wraps
    // against the reduced width, never under the chevron.
    const contentW = Math.max(1, node.box.w - insets.left - insets.right - 14);
    const layout = this.textLayout(node, displayText, contentW, ts);
    const clearW = Math.max(node.box.w, node.lastTextWidth ?? 0, layout.width + insets.left + insets.right);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0, layout.height + insets.top + insets.bottom);
    const clearCol = node.hasBg ? node.bg : node.clearColor;
    this.gfx.fillRect(node.box.x, drawY, clearW, clearH, clearCol);
    node.lastTextWidth = layout.width;
    node.lastTextHeight = layout.height;

    if (node.borderRadius > 0 && node.hasBg) this.gfx.fillRoundRect(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, fillBg);
    else if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, fillBg);
    this.drawNodeShadow(node, drawY, true);
    if (node.borderStyle) this.drawNodeBorder(node, node.box.x, drawY, bColor);

    const textX = node.box.x + insets.left;
    const textY = drawY + insets.top;
    // Reserve the right end for the dropdown chevron so the label never
    // collides with it (mirrors NODE_SELECT on device).
    const textW = Math.max(1, node.box.w - insets.left - insets.right - 14);
    const textH = Math.max(1, node.box.h - insets.top - insets.bottom);
    const top = textY + Math.trunc((textH - layout.height) / 2);
    const glyphBg = node.opacity < 100 ? blendRuntime(node.bg, this.parentClearColor(node), node.opacity) : (node.hasBg ? node.bg : node.clearColor);
    this.drawTextLines(node, displayText, textX, top, textW, ts, node.fg, glyphBg, node.textAlign);
    // Dropdown chevron: a small solid ▾ at the right end — the affordance
    // that the control opens/cycles options.
    const chX = node.box.x + node.box.w - insets.right - 11;
    const chY = drawY + Math.trunc((node.box.h - 5) / 2);
    this.gfx.fillRect(chX, chY, 9, 1, node.fg);
    this.gfx.fillRect(chX + 1, chY + 1, 7, 1, node.fg);
    this.gfx.fillRect(chX + 2, chY + 2, 5, 1, node.fg);
    this.gfx.fillRect(chX + 3, chY + 3, 3, 1, node.fg);
    this.gfx.fillRect(chX + 4, chY + 4, 1, 1, node.fg);
  }

  private drawCheckNode(node: MutableNode, displayText: string | undefined, drawY: number, ts: number): void {
    const layout = this.textLayout(node, displayText, Math.max(0, node.box.w - 22), ts);
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0, layout.height);
    // border-radius > 0 (kit .switch pills): clear the full text rect to the
    // backdrop, then paint the rounded box. Device parity: NODE_CHECK does the
    // same via ui_display_fill_round_rect. The :checked pair (kit wires it to
    // --primary/--primary-foreground) swaps the TRACK color when on.
    const onFill = node.value && node.checkedBg >= 0 ? node.checkedBg : node.bg;
    if (node.borderRadius > 0 && node.hasBg) {
      this.gfx.fillRect(node.box.x, drawY, clearW, clearH, this.parentClearColor(node));
      this.gfx.fillRoundRect(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, onFill);
    } else {
      this.gfx.fillRect(node.box.x, drawY, clearW, clearH, node.hasBg ? node.bg : node.clearColor);
    }
    node.lastTextWidth = 22 + layout.width;
    node.lastTextHeight = Math.max(layout.height, 16);

    // Pills inset the 16px indicator from the left edge so the knob doesn't
    // touch the rounded end; plain checkboxes keep it flush (unchanged look).
    // The knob SLIDES with state — left when off, right when on — the switch
    // affordance (static jump; no travel animation).
    const knobSlide = node.borderRadius > 0 ? Math.max(0, node.box.w - 16 - 6) : 0;
    const cbX = (node.borderRadius > 0 ? node.box.x + 3 : node.box.x) + (node.value ? knobSlide : 0);
    // Vertically center the 16px indicator within the box so a tall
    // (touch-friendly) checkbox doesn't pin the indicator to the top.
    // (box.h - 16) / 2 is 0 for the default 16px-tall box.
    const checkOff = Math.max(0, ((node.box.h - 16) / 2) | 0);
    const cbY = drawY + checkOff;
    if (node.value) {
      if (node.borderRadius > 0) {
        // Switch pill: the knob stays a knob — a solid circle when on, no
        // checkbox square + checkmark. Same geometry as the radio indicator.
        // The knob carries the :checked color (primary-foreground).
        this.gfx.fillCircle(cbX + 8, cbY + 8, 7, node.checkedFg >= 0 ? node.checkedFg : node.fg);
      } else {
        // Checked face carries the :checked background (primary), the
        // checkmark its color (primary-foreground).
        this.gfx.fillRect(cbX, cbY, 16, 16, node.checkedBg >= 0 ? node.checkedBg : node.fg);
        const inv = node.checkedFg >= 0 ? node.checkedFg : (node.hasBg ? node.bg : node.clearColor);
        this.gfx.drawLine(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
        this.gfx.drawLine(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
        this.gfx.drawLine(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
        this.gfx.drawLine(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
        this.gfx.drawLine(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
        this.gfx.drawLine(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
      }
    } else if (node.borderRadius > 0) {
      // Off-state pill: hollow circular knob outline on the track.
      this.gfx.drawCircle(cbX + 8, cbY + 8, 7, node.fg);
    } else {
      this.gfx.drawRect(cbX, cbY, 16, 16, node.fg);
    }
    this.drawTextLines(node, displayText, node.box.x + 22, drawY + checkOff, Math.max(0, node.box.w - 22), ts, node.fg, node.hasBg ? node.bg : node.clearColor, 0);
  }

  private drawRadioNode(node: MutableNode, displayText: string | undefined, drawY: number, ts: number): void {
    const layout = this.textLayout(node, displayText, Math.max(0, node.box.w - 22), ts);
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0, layout.height);
    this.gfx.fillRect(node.box.x, drawY, clearW, clearH, node.hasBg ? node.bg : node.clearColor);
    node.lastTextWidth = 22 + layout.width;
    node.lastTextHeight = Math.max(layout.height, 16);

    const cbX = node.box.x;
    // Vertically center the 16px indicator within the box (see drawCheckNode).
    const radioOff = Math.max(0, ((node.box.h - 16) / 2) | 0);
    const cbY = drawY + radioOff;
    if (node.value) {
      // The selected ring carries the :checked background (primary).
      this.gfx.fillCircle(cbX + 8, cbY + 8, 7, node.checkedBg >= 0 ? node.checkedBg : node.fg);
      this.gfx.fillCircle(cbX + 8, cbY + 8, 3, node.hasBg ? node.bg : node.clearColor);
    } else {
      this.gfx.drawCircle(cbX + 8, cbY + 8, 7, node.fg);
    }
    this.drawTextLines(node, displayText, node.box.x + 22, drawY + radioOff, Math.max(0, node.box.w - 22), ts, node.fg, node.hasBg ? node.bg : node.clearColor, 0);
  }

  private drawProgressNode(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    const bgCol = node.hasBg ? node.bg : node.clearColor;
    const fgCol = node.fg;
    const pct = Math.max(0, Math.min(100, node.value));
    const fillW = Math.trunc(((bw - 2) * pct) / 100);
    const prevW = node.lastTextWidth;

    if (prevW < 0) {
      this.gfx.drawRect(bx, by, bw, bh, fgCol);
      this.gfx.fillRect(bx + 1, by + 1, bw - 2, bh - 2, bgCol);
      if (fillW > 0) this.gfx.fillRect(bx + 1, by + 1, fillW, bh - 2, fgCol);
    } else if (fillW > prevW) {
      this.gfx.fillRect(bx + 1 + prevW, by + 1, fillW - prevW, bh - 2, fgCol);
    } else if (fillW < prevW) {
      this.gfx.fillRect(bx + 1 + fillW, by + 1, prevW - fillW, bh - 2, bgCol);
    }

    node.lastTextWidth = fillW;
  }

  private drawRangeNode(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    const fgCol = node.fg;
    const bgCol = node.hasBg ? node.bg : node.clearColor;
    const dimFg = dimRuntimeColor(fgCol);
    const trackY = by + Math.trunc(bh / 2);
    const rangeMin = node.rangeMin;
    const rangeMax = node.rangeMax;
    const range = rangeMax > rangeMin ? rangeMax - rangeMin : 100;
    const value = Math.max(rangeMin, Math.min(rangeMax, node.value)) - rangeMin;
    const fillW = Math.trunc(((bw - 8) * value) / range);
    const prevFillW = node.lastTextWidth;
    let newThumbX = bx + 4 + fillW - 3;

    if (prevFillW < 0) {
      this.gfx.drawFastHLine(bx, trackY, bw, dimFg);
      this.gfx.drawFastHLine(bx + 4, trackY, fillW, fgCol);
    } else {
      const prevThumbX = bx + 4 + prevFillW - 3;
      let left = Math.min(prevThumbX, newThumbX);
      let right = Math.max(prevThumbX + 6, newThumbX + 6);
      left = Math.max(left, bx);
      right = Math.min(right, bx + bw);
      this.gfx.fillRect(left, trackY - 5, right - left, 10, bgCol);
      const fillEnd = bx + 4 + fillW;
      if (right <= fillEnd) {
        this.gfx.drawFastHLine(left, trackY, right - left, fgCol);
      } else if (left >= fillEnd) {
        this.gfx.drawFastHLine(left, trackY, right - left, dimFg);
      } else {
        this.gfx.drawFastHLine(left, trackY, fillEnd - left, fgCol);
        this.gfx.drawFastHLine(fillEnd, trackY, right - fillEnd, dimFg);
      }
    }

    newThumbX = Math.max(bx + 1, Math.min(bx + bw - 7, newThumbX));
    this.gfx.fillRect(newThumbX, trackY - 5, 6, 10, fgCol);
    node.lastTextWidth = fillW;
  }

  private drawInputNode(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    // HTML disabled: halve the drawn colors (web-like faded control;
    // device parity: NODE_INPUT does the same).
    const dis = node.disabled === true;
    const bgCol = node.hasBg ? (dis ? dimDisabledColor(node.bg) : node.bg) : (dis ? dimDisabledColor(node.clearColor) : node.clearColor);
    const fgCol = dis ? dimDisabledColor(node.fg) : node.fg;
    const border = dis ? dimDisabledColor(node.borderColor || node.fg) : (node.borderColor || fgCol);
    const borderStyle = node.borderStyle || 1;
    const borderWidth = node.borderWidth || 1;
    const displayText = node.textBuffer || node.placeholder || node.text || "";
    const textColor = node.textBuffer ? fgCol : dimRuntimeColor(fgCol);
    const ts = this.nodeTextSize(node);
    const clippedText = this.clipTextToWidth(displayText, Math.max(0, bw - 8), ts, node.fontFace, node.letterSpacing);

    if (node.borderRadius > 0) this.gfx.fillRoundRect(bx, by, bw, bh, node.borderRadius, bgCol);
    else this.gfx.fillRect(bx, by, bw, bh, bgCol);
    this.drawRectOutline(bx, by, bw, bh, node.borderRadius, borderStyle, borderWidth, border);
    this.drawText(clippedText, bx + 4, by + Math.trunc((bh - this.textHeight(ts, node.fontFace)) / 2), textColor, bgCol, ts, node.fontAntialias, node.fontFace, node.letterSpacing);
  }

  private hitTest(tx: number, ty: number): number {
    // Phase 1 — the event target: the TOPMOST node containing the tap
    // (stacking order), regardless of handlers. Filtering for
    // handler-bearing nodes here let a tap fall through SIBLING layers — a
    // modal card (no handler) over a click-to-close scrim (handler) sent
    // every card tap to the scrim, so any tap dismissed the dialog. The DOM
    // rule: the click targets the topmost element, then bubbles to
    // ANCESTORS only — never sideways to a covered sibling.
    let target = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!this.isEffectivelyVisible(node)) continue;
      if (!this.isActiveNode(node)) continue;
      if (this.insideClosedDrawer(i)) continue;
      // HTML disabled: not a tap target (device parity: ui_hit_test skips it).
      if (node.disabled) continue;
      const drawX = this.drawXForNode(i);
      const drawY = this.drawYForNode(i);
      if (tx >= drawX && tx < drawX + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        // The node's box contains the tap. For nodes inside a scroll container,
        // the tap point (not the whole box) must lie within the visible
        // viewport: a tall paragraph whose box overflows below the fold can
        // still have a tappable link segment in its visible portion.
        const clip = this.scrollClipForNode(i);
        if (clip && (tx < clip.x || tx >= clip.x + clip.w || ty < clip.y || ty >= clip.y + clip.h)) continue;
        if (target < 0 || this.drawsBefore(this.nodes[target], node)) target = i;
      }
    }
    // Phase 2 — bubbling: from the target up through its ancestors.
    // Interactive kinds match even with no JS handler wired (:pressed/
    // transition feedback); otherwise the first handler-bearing ancestor.
    let n = target;
    while (n >= 0) {
      const node = this.nodes[n];
      if (this.hasAnyHandler(n)) return n;
      if (node.parentIndex < 0 || node.parentIndex >= this.nodes.length) break;
      n = node.parentIndex;
    }
    return -1;
  }

  // Unified scroll hit-scan: one pass over scrollable nodes. Lists are
  // scrollable (UA rule) and their contentHeight is seeded on the node by
  // refreshListState, so this single scan finds the owning container — list or
  // generic — topmost first.
  private findScrollNode(tx: number, ty: number): number {
    let best = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!this.isActiveNode(node)) continue;
      if (!node.scrollable || !this.isEffectivelyVisible(node) || node.contentHeight <= node.box.h) continue;
      const drawX = this.drawXForNode(i);
      const drawY = this.drawYForNode(i);
      if (tx >= drawX && tx < drawX + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        if (best < 0 || this.drawsBefore(this.nodes[best], node)) best = i;
      }
    }
    return best;
  }

  private hasAnyHandler(nodeIndex: number): boolean {
    const node = this.nodes[nodeIndex];
    if (node.kind === "list") return true;
    if (node.kind === "range") return true;
    if (node.kind === "input") return true;
    if (node.kind === "button") return true;  // pressable for :pressed/transition feedback even with no JS onClick
    if (node.tag === "check" || node.tag === "select" || node.tag === "radio") return true;
    return this.callbacks.some((callback) => callback.nodeIndex === nodeIndex);
  }

  private updateRangeValue(nodeIndex: number, tx: number): void {
    const node = this.nodes[nodeIndex];
    const rangeMin = node.rangeMin;
    const rangeMax = node.rangeMax;
    const range = rangeMax > rangeMin ? rangeMax - rangeMin : 100;
    const usable = Math.max(1, node.box.w - 8);
    const relX = tx - this.drawXForNode(nodeIndex) - 4;
    const next = Math.max(rangeMin, Math.min(rangeMax, rangeMin + Math.trunc((relX * range) / usable)));
    if (next !== node.value) {
      node.value = next;
      this.markDirty(nodeIndex);
      // Mirror the runtime: a <range> value change fires a "rangechange" event
      // (ui-element-auto-wire.ts records bind:value write-backs under this
      // kind). Must dispatch synchronously here, BEFORE the next tick's
      // evaluateBindings read-half clobbers node.value back to the stale signal
      // value — firing it now lets the write-back update the signal first.
      this.dispatch("rangechange", nodeIndex);
    }
  }

  // ── Scroll engine: Input layer ────────────────────────────────────────────
  // Preview is the capacitive tier → passthrough 1:1 (no deadband).
  private smoothDragDelta(dy: number): number {
    return Math.round(dy * this.scrollDragScale);
  }

  private scrollMax(nodeIndex: number): number {
    const node = this.nodes[nodeIndex];
    if (!node) return 0;
    return Math.max(0, node.contentHeight - node.box.h);
  }

  // Rubber-band excursion for d cumulative pixels dragged past a boundary.
  private overscrollFor(d: number): number {
    if (d <= 0) return 0;
    return Math.min(UI_SCROLL_MAX_OVERSCROLL, Math.round((UI_SCROLL_MAX_OVERSCROLL * d) / (d + UI_SCROLL_STIFFNESS)));
  }

  // ── Scroll engine: Physics layer ──────────────────────────────────────────
  // 1:1 in-bounds; rubber-band at edges; scrollY stays in [0, maxScroll] while
  // overscrollPx tracks the elastic excursion. Mirrors the C++ engine exactly.
  private applyScrollDelta(nodeIndex: number, dy: number): boolean {
    const node = this.nodes[nodeIndex];
    if (!node) return false;
    const maxS = this.scrollMax(nodeIndex);
    const sy = node.scrollY;
    const nextY = sy - dy;
    const prevOv = node.overscrollPx;
    let nextOv = prevOv;
    if (nextY < 0) {
      node.scrollY = 0;
      const draggedPast = dy - sy;
      const cum = Math.max(0, prevOv + draggedPast);
      nextOv = this.overscrollFor(cum);
    } else if (nextY > maxS) {
      node.scrollY = maxS;
      const draggedPast = nextY - maxS;
      const cum = (prevOv < 0 ? -prevOv : 0) + draggedPast;
      nextOv = -this.overscrollFor(cum);
    } else {
      node.scrollY = nextY;
      nextOv = 0;
    }
    node.overscrollPx = nextOv;
    const changed = node.scrollY !== sy || nextOv !== prevOv;
    if (changed) this.markScrollDescendantsDirty(nodeIndex);
    return changed;
  }

  // On release: arm a bounded settle — bounce overscroll back to 0, or edge-snap
  // scrollY within edgeSnapPx. The animation runs in advanceScrollSettle (tick).
  private releaseScroll(nodeIndex: number): boolean {
    const node = this.nodes[nodeIndex];
    if (!node) return false;
    if (node.overscrollPx !== 0) {
      node.settling = true;
      this.settleFromOverscroll = node.overscrollPx;
      this.settleFromScrollY = 0;
      this.settleStartMs = Date.now();
      return true;
    }
    const sy = node.scrollY;
    const maxS = this.scrollMax(nodeIndex);
    if (sy > 0 && sy <= UI_SCROLL_EDGE_SNAP_PX) {
      node.settling = true;
      this.settleFromScrollY = sy;
      this.settleFromOverscroll = 0;
      this.settleStartMs = Date.now();
      return true;
    }
    if (maxS > 0 && sy < maxS && sy >= maxS - UI_SCROLL_EDGE_SNAP_PX) {
      node.settling = true;
      this.settleFromScrollY = sy - maxS;
      this.settleFromOverscroll = 0;
      this.settleStartMs = Date.now();
      return true;
    }
    return false;
  }

  // Advance the settle animation for one node (ease-out, bounded ~180ms).
  private advanceScrollSettle(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (!node || !node.settling) return;
    const elapsed = Date.now() - this.settleStartMs;
    const t = elapsed >= UI_SCROLL_SETTLE_MS ? 1 : elapsed / UI_SCROLL_SETTLE_MS;
    const k = 1 - (1 - t) * (1 - t);  // ease-out
    if (node.overscrollPx !== 0) {
      const from = this.settleFromOverscroll;
      node.overscrollPx = Math.round(from - from * k);
      if (t >= 1) node.overscrollPx = 0;
    } else if (this.settleFromScrollY !== 0) {
      const from = this.settleFromScrollY;
      const maxS = this.scrollMax(nodeIndex);
      if (from > 0) {
        node.scrollY = Math.round(from - from * k);
        if (t >= 1) node.scrollY = 0;
      } else {
        const target = maxS;
        node.scrollY = Math.round(target + (from * (1 - k)));
        if (t >= 1) node.scrollY = target;
      }
    }
    if (t >= 1) node.settling = false;
    this.markScrollDescendantsDirty(nodeIndex);
  }

  private dispatchListTap(nodeIndex: number, tx: number, ty: number): void {
    const node = this.nodes[nodeIndex];
    const list = this.listStateForNode(nodeIndex);
    if (!node || !list || !list.tapBody) return;
    const drawY = this.drawYForNode(nodeIndex);
    const row = Math.trunc((ty - drawY + node.scrollY) / Math.max(1, list.itemHeight));
    if (row < 0 || row >= list.itemCount) return;
    this.runBody(list.tapBody, this.listLocal(list.tapParam, row));
  }

  private handleTouch(tx: number, ty: number): void {
    const now = Date.now();
    this.lastTouchX = tx;
    this.lastTouchY = ty;
    if (this.keyboardVisible) {
      if (this.touchState === 0) {
        if (now - this.lastTouchTime < UI_TOUCH_DEBOUNCE_MS) return;
        this.touchState = 1;
        this.touchDownTime = now;
        this.keyboardHandleTouch(tx, ty);
      }
      this.lastTouchTime = now;
      return;
    }
    // Modal <select> list: route taps to the option rows; swallow normal
    // hit-testing/scrolling while open (device parity: ui_touch_up).
    if (this.selectMenuNode >= 0) {
      if (this.touchState === 0 && now - this.lastTouchTime >= UI_TOUCH_DEBOUNCE_MS) {
        this.touchState = 1;
        this.touchDownTime = now;
      }
      this.lastTouchTime = now;
      return;
    }

    if (this.touchState === 0) {
      if (now - this.lastTouchTime < UI_TOUCH_DEBOUNCE_MS) return;
      const node = this.hitTest(tx, ty);
      this.touchNode = node;
      this.touchState = 1;
      this.touchDownTime = now;
      this.dragStartX = tx;
      this.dragStartY = ty;
      this.isDragging = false;
      // Unified scroll owner: one hit-scan covers containers and lists.
      this.scrollNode = this.findScrollNode(tx, ty);
      this.rangeNode = node >= 0 && this.nodes[node].kind === "range" ? node : -1;
      if (this.rangeNode >= 0) {
        // Range owns this gesture. Do not let vertical touch jitter also scroll
        // the containing view, which would dirty and repaint the whole viewport.
        this.scrollNode = -1;
      }
      if (node >= 0) {
        let handledTouchTarget = false;
        if (this.nodes[node].kind === "button") {
          this.setPressed(node, true);
          handledTouchTarget = true;
        }
        if (this.nodes[node].kind === "range") {
          this.updateRangeValue(node, tx);
          handledTouchTarget = true;
        }
        const touchStartsScrollableView = this.scrollNode >= 0 && node === this.scrollNode;
        if (!handledTouchTarget && !touchStartsScrollableView) this.markDirty(node);
      }
    } else {
      if (this.rangeNode < 0 && !this.isDragging && this.scrollNode >= 0 && Math.abs(ty - this.dragStartY) >= UI_DRAG_THRESHOLD) {
        this.isDragging = true;
      }
      // Unified scroll drag: immediate-apply each frame via the physics layer
      // (1:1 in-bounds, rubber-band at edges). No accumulator, no cadence gate.
      if (this.rangeNode < 0 && this.isDragging && this.scrollNode >= 0) {
        const rawDy = ty - this.dragStartY;
        if (rawDy !== 0) {
          const dy = this.smoothDragDelta(rawDy);
          if (dy !== 0) {
            this.applyScrollDelta(this.scrollNode, dy);
            this.dragStartX = tx;
            this.dragStartY = ty;
          }
        }
      } else if (this.rangeNode >= 0 && Math.abs(tx - this.dragStartX) >= UI_DRAG_THRESHOLD) {
        this.updateRangeValue(this.rangeNode, tx);
      } else if (this.touchState === 1 && this.touchNode >= 0 && now - this.touchDownTime >= UI_TOUCH_HOLD_MS) {
        this.touchState = 2;
        this.dispatch("hold", this.touchNode);
      }
    }
    this.lastTouchTime = now;
  }

  private handleNoTouch(): void {
    if (this.touchState === 0) return;
    const now = Date.now();
    if (now - this.lastReleaseTime < UI_TOUCH_DEBOUNCE_MS) return;
    if (this.keyboardVisible) {
      this.keyboardHandleTap();
      this.touchState = 0;
      this.touchNode = -1;
      this.isDragging = false;
      this.scrollNode = -1;
      this.rangeNode = -1;
      this.lastReleaseTime = now;
      return;
    }
    if (this.selectMenuNode >= 0) {
      this.selectMenuHandleTouch(this.lastTouchX, this.lastTouchY);
      this.touchState = 0;
      this.touchNode = -1;
      this.isDragging = false;
      this.scrollNode = -1;
      this.rangeNode = -1;
      this.lastReleaseTime = now;
      return;
    }

    const elapsed = now - this.touchDownTime;
    const node = this.touchNode;
    // Release the scroll owner: arm a bounded settle (bounce-back / edge-snap).
    // No fling — motion ends with the finger; the settle is the only post-lift
    // motion and terminates within UI_SCROLL_SETTLE_MS.
    if (this.scrollNode >= 0) {
      this.releaseScroll(this.scrollNode);
    }
    if (node >= 0 && !this.isDragging) {
      if (elapsed < UI_TOUCH_HOLD_MS) {
        if (this.nodes[node].kind === "list") this.dispatchListTap(node, this.lastTouchX, this.lastTouchY);
        this.dispatchBuiltInClick(node);
        this.dispatch("click", node);
        // Rich-text inline link: if the tapped node has link runs, navigate to
        // the target screen of the link segment the tap landed on.
        const richTarget = this.richLinkHit(node, this.lastTouchX, this.lastTouchY);
        if (richTarget >= 0) this.navigate(richTarget);
      }
      this.dispatch("release", node);
      if (this.nodes[node].kind === "button") this.setPressed(node, false);
      this.markDirty(node);
    }
    // Open drawers close on outside taps (shadcn drawer behavior). Taps
    // inside an open drawer hit its controls normally.
    for (const [idx, state] of this.drawerStates) {
      if (!state.open || state.progress < 1) continue;
      const drawer = this.nodes[idx];
      const dx = this.drawXForNode(idx);
      const dy = this.drawYForNode(idx);
      if (this.lastTouchX < dx || this.lastTouchX >= dx + drawer.box.w ||
          this.lastTouchY < dy || this.lastTouchY >= dy + drawer.box.h) {
        state.open = false;
      }
    }

    // Resume any `await ui.onTap()` awaiter. Runs for EVERY completed tap —
    // including empty-space taps (node == -1) and holds released above — so
    // "wake on any touch" works. After the click/release dispatch so onClick
    // fires first (matches the device runtime, "both fire").
    this.tapSeq++;
    this.tapNode = node;
    this.touchState = 0;
    this.touchNode = -1;
    this.isDragging = false;
    this.scrollNode = -1;
    this.rangeNode = -1;
    this.lastReleaseTime = now;
  }

  private dispatchBuiltInClick(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (node.tag === "check") {
      node.value = node.value > 0 ? 0 : 1;
      this.markDirty(nodeIndex);
    } else if (node.tag === "select") {
      // Tap opens a modal option list (device parity: ui_select_menu_open);
      // selecting a row in the modal sets the value.
      this.openSelectMenu(nodeIndex);
    } else if (node.tag === "radio") {
      for (const candidate of this.nodes) {
        if (!this.isActiveNode(candidate)) continue;
        if (candidate.tag === "radio" && candidate.name && candidate.name === node.name) {
          candidate.value = 0;
          this.markDirty(candidate.index);
        }
      }
      node.value = 1;
      this.markDirty(nodeIndex);
    } else if (node.kind === "input") {
      this.keyboardOpen(nodeIndex);
    }
  }

  private keyboardTemplateForNode(node: MutableNode): KeyboardTemplate {
    if (node.keyboard) {
      const custom = this.snapshot.keyboardTemplates?.find((template) => template.id === node.keyboard);
      if (custom) return custom;
    }
    return node.inputType === "number" ? DEFAULT_NUMBER_KEYBOARD : DEFAULT_ALPHA_KEYBOARD;
  }

  // ── <drawer>: slide-in panel modals ─────────────────────────────────────
  // Drawers are author-styled absolute panels (position/left/top/width/height
  // in CSS); the runtime slides the subtree in from the configured edge via
  // per-node transform offsets, hides the subtree while closed, and closes on
  // outside taps. Sliding mutates offsets + dirties the subtree exactly like
  // the keyframe transform path, so all existing clear/repair machinery runs.

  /** node index -> { open, progress } for every <drawer>; absent = closed. */
  private readonly drawerStates = new Map<number, { open: boolean; progress: number }>();

  // ── Debug overlay data (preview-only; the client canvas draws the boxes) ──
  /** True while the client wants per-frame debug geometry + paint rects. */
  private debugCapture = false;
  /** Node paint rects drawn during this tick (cleared at tick start). */
  private debugPaintedRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** Drawer animation step per tick (~180ms full slide). */
  /** <toast> auto-close windows, keyed by drawer slot node index. */
  private readonly toastElapsed = new Map<number, number>();

  private applyDrawers(deltaMs: number): void {
    // <toast duration>: once fully open, count up and auto-close.
    for (const [idx, state] of this.drawerStates) {
      const node = this.nodes[idx] as MutableNode & { toastDuration?: number };
      const duration = node.toastDuration ?? 0;
      if (duration > 0 && state.open && state.progress === 1) {
        const elapsed = (this.toastElapsed.get(idx) ?? 0) + deltaMs;
        if (elapsed >= duration) {
          state.open = false;
          this.toastElapsed.delete(idx);
        } else {
          this.toastElapsed.set(idx, elapsed);
        }
      } else if (!state.open) {
        this.toastElapsed.delete(idx);
      }
    }
    for (const [idx, state] of this.drawerStates) {
      const target = state.open ? 1 : 0;
      if (state.progress === target) continue;
      const step = Math.min(1, deltaMs / 180);
      const next = state.progress + Math.sign(target - state.progress) * Math.min(step, Math.abs(target - state.progress));
      this.setDrawerProgress(idx, next);
      if (next === 0 && !state.open) this.drawerStates.delete(idx);
    }
  }

  private drawerNodeById(id: string): MutableNode | undefined {
    return this.nodes.find((n) => ((n as unknown as { drawerSide?: number }).drawerSide ?? -1) >= 0 && n.id === id);
  }

  private drawerOpen(id: string): void {
    const node = this.drawerNodeById(id);
    if (!node) return;
    this.toastElapsed.delete(node.index);  // <toast>: restart the auto-close window
    if (!this.drawerStates.has(node.index)) {
      this.drawerStates.set(node.index, { open: true, progress: 0 });
      this.setDrawerProgress(node.index, 0);
    } else {
      this.drawerStates.get(node.index)!.open = true;
    }
  }

  private drawerClose(id?: string): void {
    if (id !== undefined) {
      const node = this.drawerNodeById(id);
      if (node) {
        const st = this.drawerStates.get(node.index);
        if (st) st.open = false;
      }
      return;
    }
    for (const st of this.drawerStates.values()) st.open = false;
  }

  /** Slide extent for a drawer or toast: the panel must clear the display
   *  edge completely — its own height parks a bottom:0 panel's top row at
   *  the fold (a visible sliver after close). Centered dialogs don't slide. */
  private drawerExtent(node: MutableNode): number {
    const n = node as MutableNode & { drawerSide?: number };
    const side = n.drawerSide ?? 0;
    const extent = side === 2 || side === 3 ? node.box.w : node.box.h;
    if (side === 4) return 0;
    // Rest position (box minus ancestor scroll; transform offsets hold the
    // current slide), then clear the display edge along the travel axis.
    let restX = node.box.x;
    let restY = node.box.y;
    let parent = node.parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      const pn = this.nodes[parent] as MutableNode;
      if (pn.scrollable) restY -= pn.scrollY;
      parent = pn.parentIndex;
    }
    const need = side === 0 ? this.snapshot.program.height - restY
      : side === 1 ? restY + node.box.h
      : side === 2 ? restX + node.box.w
      : this.snapshot.program.width - restX;
    return Math.max(extent, need);
  }

  /** Apply a slide progress to the drawer subtree: offsets shift from the
   *  edge; the subtree is hidden at 0. Erases the previous frame's region via
   *  the standard subtree clear + marks descendants dirty (same contract as
   *  animated transform changes). */
  private setDrawerProgress(nodeIndex: number, progress: number): void {
    const state = this.drawerStates.get(nodeIndex);
    if (!state) return;
    const node = this.nodes[nodeIndex];
    const side = (node as unknown as { drawerSide?: number }).drawerSide ?? 0;
    const travel = Math.round((1 - progress) * this.drawerExtent(node));
    const dx = side === 2 ? -travel : side === 3 ? travel : 0;
    const dy = side === 1 ? -travel : side === 0 ? travel : 0;
    // Erase the subtree's current paint before moving it. The clear fills
    // with the parent background only — everything the drawer COVERED
    // (siblings underneath) must repaint too, so mark every active-screen
    // node outside the drawer subtree dirty. Full-screen redraw per slide
    // frame is the same contract as the select modal's close path.
    const rect = this.currentSubtreePaintRect(node);
    if (rect) this.clearNodePaintRect(node, rect);
    for (const n of this.nodes) {
      if (!this.isActiveNode(n) || n.index >= node.index && n.index < node.subtreeEnd) continue;
      if (this.insideClosedDrawer(n.index)) continue;
      n.dirty = true;
    }
    for (let i = node.index; i < node.subtreeEnd; i++) {
      const n = this.nodes[i];
      if (!this.isActiveNode(n)) continue;
      n.transformOffsetX = i === node.index ? dx : n.transformOffsetX;
      n.transformOffsetY = i === node.index ? dy : n.transformOffsetY;
      if (i !== node.index) {
        // Descendants keep a private offset delta (they don't inherit the
        // drawer's transformOffset), so store the slide delta per node.
        (n as unknown as { __drawerDx?: number }).__drawerDx = dx;
        (n as unknown as { __drawerDy?: number }).__drawerDy = dy;
      }
      n.dirty = true;
    }
    state.progress = progress;
    this.directFrameChanged = true;
  }

  /** True while the node sits inside a fully-closed drawer (skip in draws and
   *  hit tests). Drawers with no state entry are closed. */
  private insideClosedDrawer(nodeIndex: number): boolean {
    // Centered overlay roots (<dialog>, side 4) hide via the closed-state
    // gate: their travel is 0, so offsets can't move them off-panel. Edge
    // drawer/toast roots keep offset-only hiding (the bottom peek).
    const self = this.nodes[nodeIndex] as MutableNode & { drawerSide?: number };
    if ((self.drawerSide ?? -1) === 4) {
      const st = this.drawerStates.get(nodeIndex);
      return !st || (!st.open && st.progress === 0);
    }
    for (const [idx, state] of this.drawerStates) {
      const drawer = this.nodes[idx];
      if (nodeIndex >= drawer.index && nodeIndex < drawer.subtreeEnd && state.progress === 0 && !state.open) return true;
    }
    return this.drawerAncestorClosed(nodeIndex);
  }

  /** Walk ancestors: any drawer ancestor without an open/animating state. */
  private drawerAncestorClosed(nodeIndex: number): boolean {
    let parent = this.nodes[nodeIndex]?.parentIndex ?? -1;
    while (parent >= 0 && this.nodes[parent]) {
      const n = this.nodes[parent] as MutableNode & { drawerSide?: number };
      if ((n.drawerSide ?? -1) >= 0) {
        const st = this.drawerStates.get(parent);
        return !st || (!st.open && st.progress === 0);
      }
      parent = this.nodes[parent].parentIndex;
    }
    return false;
  }

  /** Apply the closed slide offsets to every drawer subtree (initial seed and
   *  post-navigate reset) so closed drawers never paint at rest position. */
  private seedDrawersClosed(): void {
    for (const n of this.nodes) {
      const node = n as MutableNode & { drawerSide?: number };
      if ((node.drawerSide ?? -1) < 0) continue;
      if (this.drawerStates.has(node.index)) continue;
      const side = node.drawerSide ?? 0;
      const travel = this.drawerExtent(node);
      const dx = side === 2 ? -travel : side === 3 ? travel : 0;
      const dy = side === 1 ? -travel : side === 0 ? travel : 0;
      node.transformOffsetX = (node.transformOffsetX ?? 0) + dx;
      node.transformOffsetY = (node.transformOffsetY ?? 0) + dy;
      for (let i = node.index + 1; i < node.subtreeEnd; i++) {
        const d = this.nodes[i] as MutableNode & { __drawerDx?: number; __drawerDy?: number };
        d.__drawerDx = dx;
        d.__drawerDy = dy;
        d.dirty = false;
      }
    }
  }

  /** Shared geometry of the select modal: a centered list panel sized to
   *  the options (capped to ~60% of the screen height). Rows are option
   *  text, the current one inverted (fill = select bg, text = inverted). */
  private selectMenuGeometry(): { x: number; y: number; w: number; rowH: number; rows: number } {
    const node = this.nodes[this.selectMenuNode];
    const options = node.options ?? [];
    const rowH = 22;
    const rows = options.length;
    // Anchor to the select itself: same left edge and width, so the modal
    // reads as the control's own dropdown (never overhangs toward a
    // scrollbar). Clamp to the screen for selects that extend past it.
    let x = node.box.x;
    let w = Math.max(node.box.w, 120);
    if (x + w > this.gfx.width) w = this.gfx.width - x;
    if (x < 0) x = 0;
    const h = Math.min(Math.trunc(this.gfx.height * 0.6), rows * rowH + 8);
    const y = Math.trunc((this.gfx.height - h) / 2);
    return { x, y, w, rowH, rows };
  }

  private openSelectMenu(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (!node.options || node.options.length === 0) return;
    this.selectMenuNode = nodeIndex;
    this.selectMenuDirty = true;
  }

  /** Close the modal. When `repaint`, mark the whole tree dirty so the
   *  overlay is erased by a full redraw (navigate() clears the screen
   *  itself, so it passes false). */
  private closeSelectMenu(repaint: boolean): void {
    if (this.selectMenuNode < 0) return;
    this.selectMenuNode = -1;
    this.selectMenuDirty = false;
    if (repaint) {
      for (const node of this.nodes) node.dirty = true;
    }
  }

  /** Stamp the modal overlay on top of the current framebuffer. Idempotent
   *  per frame — the close path full-repaints beneath it. */
  private drawSelectMenu(): void {
    if (this.selectMenuNode < 0) return;
    const node = this.nodes[this.selectMenuNode];
    if (!node.options || node.options.length === 0) return;
    const { x, y, w, rowH, rows } = this.selectMenuGeometry();
    const h = Math.min(Math.trunc(this.gfx.height * 0.6), rows * rowH + 8);
    // Themed panel: the select's own radius/border/bg — the modal reads as
    // the control's popover, matching the surrounding UI (shadcn tokens on
    // the .select class flow through: radius, border color, background).
    const radius = Math.min(node.borderRadius || 6, Math.trunc(Math.min(w, h) / 2));
    const panel = this.selectMenuPanelColor();
    const borderCol = node.borderColor || node.fg;
    this.gfx.fillRoundRect(x, y, w, h, radius, panel);
    this.gfx.drawRoundRect(x, y, w, h, radius, borderCol);
    const ts = this.nodeTextSize(node);
    const rowInset = Math.max(2, Math.trunc(radius / 2));
    // The selected row carries the :checked pair (the kit wires it to
    // --accent/--accent-foreground, shadcn's SelectItem selected state).
    const rowBg = node.checkedBg >= 0 ? node.checkedBg : node.fg;
    const rowFg = node.checkedFg >= 0 ? node.checkedFg : panel;
    for (let r = 0; r < rows; r++) {
      const ry = y + 4 + r * rowH;
      const current = r === node.value;
      if (current) {
        this.gfx.fillRoundRect(x + rowInset, ry, w - 2 * rowInset, rowH, Math.min(radius, 6), rowBg);
      }
      const text = clampText(node.options[r]?.text ?? "");
      const fg = current ? rowFg : node.fg;
      this.drawText(text, x + 22, ry + Math.trunc((rowH - 8 * ts) / 2), fg, panel, ts, node.fontAntialias, node.fontFace, 0);
      if (current) {
        // Check mark on the current row (the checked pair's color).
        const cx = x + 7;
        const cy = ry + Math.trunc(rowH / 2);
        this.gfx.drawLine(cx, cy, cx + 3, cy + 3, rowFg);
        this.gfx.drawLine(cx + 3, cy + 3, cx + 8, cy - 4, rowFg);
      }
    }
    this.selectMenuDirty = false;
  }

  /** Panel fill: the select's effective background, falling back to a
   *  near-black card on unstyled selects. */
  private selectMenuPanelColor(): number {
    const node = this.nodes[this.selectMenuNode];
    return node.hasBg ? node.bg : node.clearColor;
  }

  /** Route a tap while the modal is open: a row selects + closes; anything
   *  else just closes (dismiss on outside tap). */
  private selectMenuHandleTouch(tx: number, ty: number): void {
    const node = this.nodes[this.selectMenuNode];
    if (!node.options) {
      this.closeSelectMenu(true);
      return;
    }
    const { x, y, w, rowH, rows } = this.selectMenuGeometry();
    const h = Math.min(Math.trunc(this.gfx.height * 0.6), rows * rowH + 8);
    if (tx >= x && tx < x + w && ty >= y && ty < y + h) {
      const row = Math.trunc((ty - y - 4) / rowH);
      if (row >= 0 && row < rows) {
        node.value = row;
        node.hasTextBinding = true;
        node.textBuffer = clampText(node.options[row]?.text ?? "");
        this.markDirty(node.index);
      }
    }
    this.closeSelectMenu(true);
  }

  private keyboardOpen(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    const template = this.keyboardTemplateForNode(node);
    const cols = template.rows.length > 0 ? Math.max(...template.rows.map((row) => row.length)) : 0;
    this.keyboardTarget = nodeIndex;
    this.keyboardBuffer = clampText(node.textBuffer);
    this.keyboardMaxLen = Math.max(1, Math.min(node.maxlen || UI_TEXT_BUF, UI_TEXT_BUF));
    this.keyboardShift = false;
    this.keyboardBackspaceHeld = false;
    this.keyboardPressedKey = -1;
    this.keyboardRepaintKey = -1;
    this.keyboardRows = template.rows.length;
    this.keyboardCols = Math.max(1, cols);
    this.keyboardBg = resolveKeyboardBackground(template, this.snapshot.cssRules ?? []);
    this.keyboardKeys = [];

    for (const row of template.rows) {
      for (const key of row) {
        this.keyboardKeys.push({
          ch: key.ch,
          special: key.special,
          style: resolveKeyStyle(key, template, this.snapshot.cssRules ?? []),
        });
      }
      for (let p = row.length; p < this.keyboardCols; p++) {
        this.keyboardKeys.push({
          ch: " ",
          special: 255,
          style: { bg: DEFAULT_KEY_BG, fg: DEFAULT_KEY_FG, borderColor: DEFAULT_KEY_BORDER },
        });
      }
    }

    this.keyboardComputeBox();
    this.keyboardVisible = true;
    this.keyboardDirty = 1;
  }

  private keyboardClose(): void {
    if (this.keyboardTarget >= 0) {
      const node = this.nodes[this.keyboardTarget];
      node.textBuffer = clampText(this.keyboardBuffer).slice(0, this.keyboardMaxLen);
      this.markDirty(this.keyboardTarget);
      // Pass the committed text as a `text` local so ui.bindInput callbacks
      // (which declare it as their param) see the same value the device passes
      // to the lowered C++ callback.
      this.dispatch("change", this.keyboardTarget, { text: node.textBuffer });
    }
    // Capture the keyboard box before clearing visibility — it identifies the
    // screen region the opaque overlay covered and that now needs restoring.
    const kbBox = this.keyboardBox;
    this.keyboardVisible = false;
    this.keyboardDirty = 0;
    this.keyboardTarget = -1;
    this.keyboardPressedKey = -1;
    this.keyboardBackspaceHeld = false;
    // The <screen> root's paint rect spans the whole display, so it always
    // intersects kbBox. Routing it through markDirty would cascade via
    // markOverlappingHigherLayersDirty into marking every node on the active
    // screen dirty (its rect overlaps everything), which is the full-screen
    // flash this function exists to avoid. Repaint just the keyboard-box
    // slice of its background directly instead.
    const screenRoot = this.nodes.find((n) => n.parentIndex < 0 && n.screenId === this.activeScreen);
    if (screenRoot) {
      const rootBg = screenRoot.hasBg ? screenRoot.bg : screenRoot.clearColor;
      this.gfx.fillRect(kbBox.x, kbBox.y, kbBox.w, kbBox.h, rootBg);
    }
    // Repaint everything else the keyboard overlay actually overwrote: nodes
    // whose paint rect intersects the keyboard box, plus the edited input
    // itself (already marked above). markDirty handles overlap repair +
    // scroll clipping — safe here since these nodes are bounded in size,
    // unlike the screen root.
    for (const node of this.nodes) {
      if (screenRoot && node.index === screenRoot.index) continue;
      const rect = this.currentPaintRect(node);
      if (rect.w > 0 && rect.h > 0 && this.rectsIntersect(rect, kbBox)) {
        this.markDirty(node.index);
      }
    }
  }

  private keyboardComputeBox(): void {
    const isNumber = this.keyboardCols <= 4;
    const h = Math.trunc(this.snapshot.program.height * (isNumber ? 60 : 75) / 100);
    const w = isNumber ? Math.trunc(this.snapshot.program.width * 50 / 100) : this.snapshot.program.width;
    this.keyboardBox = {
      x: isNumber ? Math.trunc((this.snapshot.program.width - w) / 2) : 0,
      y: this.snapshot.program.height - h,
      w,
      h,
    };
  }

  private keyboardKeyRect(index: number): { x: number; y: number; w: number; h: number } {
    const col = index % this.keyboardCols;
    const row = Math.trunc(index / this.keyboardCols);
    const keysH = Math.max(1, this.keyboardBox.h - UI_KB_TEXT_H);
    return {
      x: this.keyboardBox.x + Math.trunc((col * this.keyboardBox.w) / this.keyboardCols),
      y: this.keyboardBox.y + UI_KB_TEXT_H + Math.trunc((row * keysH) / Math.max(1, this.keyboardRows)),
      w: Math.trunc(this.keyboardBox.w / this.keyboardCols),
      h: Math.trunc(keysH / Math.max(1, this.keyboardRows)),
    };
  }

  private keyboardHandleTouch(tx: number, ty: number): void {
    this.keyboardPressedKey = -1;
    for (let i = 0; i < this.keyboardKeys.length; i++) {
      const key = this.keyboardKeys[i];
      if (key.special === 255) continue;
      const rect = this.keyboardKeyRect(i);
      if (tx < rect.x || tx >= rect.x + rect.w || ty < rect.y || ty >= rect.y + rect.h) continue;
      this.keyboardPressedKey = i;
      this.keyboardRepaintKey = i;
      this.keyboardDirty = 2;
      if (key.special === 2) {
        this.keyboardBackspaceHeld = true;
        this.keyboardBackspaceRepeat = Date.now();
        this.keyboardDelete();
      }
      return;
    }
  }

  private keyboardHandleTap(): void {
    const keyIndex = this.keyboardPressedKey;
    this.keyboardBackspaceHeld = false;
    if (keyIndex < 0) return;
    const key = this.keyboardKeys[keyIndex];
    this.keyboardPressedKey = -1;

    switch (key.special) {
      case 0: {
        const wasShift = this.keyboardShift;
        let ch = key.ch.slice(0, 1);
        if (this.keyboardShift && ch >= "a" && ch <= "z") ch = ch.toUpperCase();
        this.keyboardInsert(ch);
        this.keyboardShift = false;
        this.keyboardRepaintKey = wasShift ? -1 : keyIndex;
        this.keyboardDirty = wasShift ? 1 : 2;
        break;
      }
      case 1:
        this.keyboardShift = !this.keyboardShift;
        this.keyboardDirty = 1;
        break;
      case 2:
        this.keyboardRepaintKey = keyIndex;
        this.keyboardDirty = 2;
        break;
      case 3:
        this.keyboardClose();
        break;
      case 4:
        this.keyboardSwapPage();
        break;
    }
  }

  private keyboardInsert(ch: string): void {
    if (!ch || this.keyboardBuffer.length >= this.keyboardMaxLen) return;
    this.keyboardBuffer = clampText(this.keyboardBuffer + ch).slice(0, this.keyboardMaxLen);
  }

  private keyboardDelete(): void {
    if (this.keyboardBuffer.length === 0) return;
    this.keyboardBuffer = this.keyboardBuffer.slice(0, -1);
  }

  private keyboardTick(now: number): void {
    if (!this.keyboardBackspaceHeld) return;
    if (now - this.keyboardBackspaceRepeat < UI_KB_REPEAT_MS) return;
    this.keyboardDelete();
    this.keyboardBackspaceRepeat = now;
    this.keyboardRepaintKey = this.keyboardPressedKey;
    this.keyboardDirty = 2;
  }

  private keyboardSwapPage(): void {
    const previousTarget = this.keyboardTarget;
    const template = this.keyboardCols <= 4 ? DEFAULT_ALPHA_KEYBOARD : DEFAULT_NUMBER_KEYBOARD;
    const cols = Math.max(...template.rows.map((row) => row.length));
    this.keyboardRows = template.rows.length;
    this.keyboardCols = Math.max(1, cols);
    this.keyboardBg = resolveKeyboardBackground(template, this.snapshot.cssRules ?? []);
    this.keyboardKeys = [];
    for (const row of template.rows) {
      for (const key of row) {
        this.keyboardKeys.push({
          ch: key.ch,
          special: key.special,
          style: resolveKeyStyle(key, template, this.snapshot.cssRules ?? []),
        });
      }
      for (let p = row.length; p < this.keyboardCols; p++) {
        this.keyboardKeys.push({
          ch: " ",
          special: 255,
          style: { bg: DEFAULT_KEY_BG, fg: DEFAULT_KEY_FG, borderColor: DEFAULT_KEY_BORDER },
        });
      }
    }
    this.keyboardTarget = previousTarget;
    this.keyboardComputeBox();
    this.keyboardDirty = 1;
  }

  private keyboardLabel(key: PreviewKey): string {
    switch (key.special) {
      case 1: return "SHIFT";
      case 2: return "DEL";
      case 3: return "OK";
      case 4: return this.keyboardCols <= 4 ? "ABC" : "123";
      default: {
        const ch = key.ch.slice(0, 1);
        return this.keyboardShift && ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch;
      }
    }
  }

  private drawKeyboardTextRow(): void {
    this.gfx.fillRect(this.keyboardBox.x, this.keyboardBox.y, this.keyboardBox.w, UI_KB_TEXT_H, this.keyboardBg);
    this.gfx.setCursor(this.keyboardBox.x + 4, this.keyboardBox.y + 4);
    this.gfx.setTextColor(0xffff, this.keyboardBg);
    this.gfx.setTextSize(2);
    this.gfx.print(this.keyboardBuffer);
    this.gfx.print("_");
  }

  private drawKeyboardKey(index: number): void {
    const key = this.keyboardKeys[index];
    if (!key || key.special === 255) return;
    const rect = this.keyboardKeyRect(index);
    let bg = key.style.bg;
    let fg = key.style.fg;
    if (key.special === 1 && this.keyboardShift && index !== this.keyboardPressedKey) bg = 0xbdf7;
    if (index === this.keyboardPressedKey) {
      const previousBg = bg;
      bg = fg;
      fg = previousBg;
    }

    this.gfx.fillRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2), bg);
    this.gfx.drawRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2), key.style.borderColor);
    const label = this.keyboardLabel(key);
    this.gfx.setCursor(rect.x + Math.max(2, Math.trunc((rect.w - label.length * 6) / 2)), rect.y + Math.trunc(rect.h / 2) - 4);
    this.gfx.setTextColor(fg, bg);
    this.gfx.setTextSize(1);
    this.gfx.print(label);
  }

  private drawKeyboard(): void {
    this.gfx.fillRect(this.keyboardBox.x, this.keyboardBox.y, this.keyboardBox.w, this.keyboardBox.h, this.keyboardBg);
    this.drawKeyboardTextRow();
    for (let i = 0; i < this.keyboardKeys.length; i++) {
      this.drawKeyboardKey(i);
    }
  }

  private dispatch(kind: "click" | "hold" | "release" | "change" | "rangechange", nodeIndex: number, locals?: Record<string, unknown>): void {
    for (const callback of this.callbacks) {
      if (callback.nodeIndex === nodeIndex && callback.kind === kind) {
        // A ui.bindInput callback declares a param that receives the input's
        // committed text (mirrors the runtime renaming the arrow's first param
        // to `text`). Bind it as a local under the author's chosen name so the
        // body references resolve.
        let merged = locals;
        if (callback.param && locals?.text !== undefined) {
          merged = { ...locals, [callback.param]: locals.text };
        }
        this.runBody(callback.body, merged);
      }
    }
  }

  private setPressed(nodeIndex: number, pressed: boolean): void {
    const node = this.nodes[nodeIndex];
    node.value = pressed ? 1 : 0;
    this.markDirty(nodeIndex);
    for (const transition of this.transitions) {
      if (transition.node !== nodeIndex) continue;
      transition.prevValue = transition.prop === "color" ? node.fg : node.bg;
      transition.targetValue = pressed ? transition.pressedTarget : transition.baseTarget;
      transition.elapsed = 0;
      transition.active = true;
    }
  }

  private uiOnPress(nodeIndex: number): void {
    this.setPressed(nodeIndex, true);
  }

  private uiOnRelease(nodeIndex: number): void {
    this.setPressed(nodeIndex, false);
  }

  private markDirty(nodeIndex: number): void {
    if (!this.nodes[nodeIndex]) return;
    this.nodes[nodeIndex].dirty = true;
    this.markOverlappingHigherLayersDirty(nodeIndex);
  }

  private scriptTreeNames(): string[] {
    const validIdentifier = /^[$A-Z_a-z][$\w]*$/;
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of this.snapshot.uiTreeNames ?? []) {
      if (!validIdentifier.test(name) || name === "screen" || name === "ui" || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  private normalizeScript(text: string): string {
    let out = text
      .replace(/\(([$A-Z_a-z][$\w]*)\s+as\s+any\)/g, "$1")
      .replace(/\b([$A-Z_a-z][$\w]*)\s+as\s+any\b/g, "$1")
      .replace(/\b([$A-Z_a-z][$\w]*)\s+as\s+const\b/g, "$1");
    // Signals lower to plain device variables on hardware, so the author-facing
    // getter/setter syntax must be rewritten to plain reads/writes here too
    // (mirrors ir/transformers/ui-callback-lowering.ts):
    //   sig.set(EXPR) → (sig = EXPR)   (write — balanced-paren scan preserves
    //                                   nested parens/calls in EXPR)
    //   sig()        → sig             (read)
    // Run this before the module-var rewrite below so the bare `sig` it leaves
    // behind is then turned into `moduleScope.sig`, giving the same slot the
    // interpolation/binding path reads.
    out = this.rewriteSignalAccesses(out);
    // Rewrite bare references to module-scoped variables into moduleScope.NAME
    // so reads/writes hit the shared mutable binding (mirrors the device hoisting
    // them to globals). Skip property accesses (foo.bar) so `screen.gauge.value`
    // etc. are untouched — and skip STRING/TEMPLATE LITERAL CONTENTS: prose like
    // "taps inside:" inside a template literal contains the identifier `taps`
    // as a whole word and must not be rewritten (only ${...} segments of
    // templates are code).
    const names = this.moduleVarNames();
    if (names.length) {
      const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const re = new RegExp(`(?<![\\w.$])\\b(${alt})\\b(?!\\s*:)`, "g");
      out = this.rewriteOutsideLiterals(out, re);
    }
    return out;
  }

  /** Apply `re` to code segments only: skip '..'/".." literal contents, and
   *  inside `..` templates recurse into ${...} interpolations (their
   *  expressions are code; the literal text between them is not). */
  private rewriteOutsideLiterals(text: string, re: RegExp): string {
    let out = "";
    let code = "";
    let i = 0;
    const flush = () => { out += code.replace(re, "moduleScope.$1"); code = ""; };
    while (i < text.length) {
      const ch = text[i];
      if (ch === "'" || ch === '"') {
        flush();
        let j = i + 1;
        while (j < text.length && text[j] !== ch) {
          if (text[j] === "\\") j++;
          j++;
        }
        out += text.slice(i, Math.min(j + 1, text.length));
        i = j + 1;
        continue;
      }
      if (ch === "`") {
        flush();
        // Emit the template piece by piece: literal runs verbatim (never
        // rewritten), ${...} interpolations recursed as code.
        out += "`";
        let j = i + 1;
        while (j < text.length && text[j] !== "`") {
          if (text[j] === "\\") { out += text.slice(j, j + 2); j += 2; continue; }
          if (text[j] === "$" && text[j + 1] === "{") {
            let depth = 1;
            let k = j + 2;
            while (k < text.length && depth > 0) {
              if (text[k] === "{") depth++;
              else if (text[k] === "}") depth--;
              k++;
            }
            out += "${" + this.rewriteOutsideLiterals(text.slice(j + 2, k - 1), re) + "}";
            j = k;
            continue;
          }
          out += text[j];
          j++;
        }
        if (j < text.length) out += "`";
        i = j + 1;
        continue;
      }
      code += ch;
      i++;
    }
    flush();
    return out;
  }

  /** Rewrite signal getter/setter syntax to plain variable reads/writes. See
   *  normalizeScript for the lowering contract; this is the preview counterpart
   *  of ui-callback-lowering.ts's rules 2 and 3. */
  private rewriteSignalAccesses(text: string): string {
    if (this.signalNames.size === 0) return text;
    let out = text;
    for (const name of this.signalNames) {
      // sig.set(EXPR) → (sig = EXPR). Scan for `name.set(` then capture the
      // balanced paren region so nested calls (e.g. `count.set(count() + 1)`)
      // are preserved intact. Replace in place; loop because a body may have
      // multiple writes to the same signal.
      const setMarker = `${name}.set(`;
      let searchFrom = 0;
      for (;;) {
        const idx = out.indexOf(setMarker, searchFrom);
        if (idx < 0) break;
        // Only rewrite when `name` is a standalone token (not `foo.name.set(`).
        const prev = out[idx - 1];
        if (prev && /[\w$]/.test(prev)) { searchFrom = idx + setMarker.length; continue; }
        const argStart = idx + setMarker.length;
        const argEnd = findMatchingCloseParen(out, argStart);
        if (argEnd < 0) break;
        const argText = out.slice(argStart, argEnd);
        const replacement = `(${name} = ${argText})`;
        out = out.slice(0, idx) + replacement + out.slice(argEnd + 1);
        // Restart scanning from the replacement; indices shifted.
        searchFrom = idx + replacement.length;
      }
      // sig() → sig. Match `name(` only when name is a standalone token; the
      // empty arg list mirrors the runtime read lowering.
      out = out.replace(
        new RegExp(`(?<![\\w.$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(\\)`, "g"),
        name,
      );
    }
    return out;
  }

  private scriptValues(aliases: string[], locals: Record<string, unknown> = {}): unknown[] {
    return [this.screen, this.createUiFacade(), this.moduleScope, ...aliases.map(() => this.screen), ...Object.values(locals)];
  }

  private listLocal(param: string | undefined, row: number): Record<string, unknown> {
    return param ? { [param]: row } : {};
  }

  private evaluateExpression(expression: string | undefined, locals: Record<string, unknown> = {}): unknown {
    if (!expression) return undefined;
    const aliases = this.scriptTreeNames();
    const localNames = Object.keys(locals).filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name));
    const localValues = Object.fromEntries(localNames.map((name) => [name, locals[name]]));
    const normalized = this.normalizeScript(expression);
    try {
      return Function("screen", "ui", "moduleScope", ...aliases, ...localNames, `"use strict"; return (${normalized});`)(...this.scriptValues(aliases, localValues));
    } catch (error) {
      this.onDiagnostics?.(`Preview expression failed: ${expression} (${error instanceof Error ? error.message : String(error)})`);
      return undefined;
    }
  }

  private runBody(body: string | undefined, locals: Record<string, unknown> = {}): void {
    if (!body) return;
    const aliases = this.scriptTreeNames();
    const localNames = Object.keys(locals).filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name));
    const localValues = Object.fromEntries(localNames.map((name) => [name, locals[name]]));
    const normalized = this.normalizeScript(body);
    try {
      Function("screen", "ui", "moduleScope", ...aliases, ...localNames, `"use strict"; ${normalized}`)(...this.scriptValues(aliases, localValues));
    } catch (error) {
      this.onDiagnostics?.(`Preview callback failed: ${body} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  private createUiFacade(): {
    signal<T>(initial: T): (() => T) & { set(next: T): void };
    navigate(screenIdx: number): void;
    window: { setTitle(title: string): void; setIcon(path: string): void };
    drawer: { open(id: string): void; close(id?: string): void };
    dialog: { open(id: string): void; close(id?: string): void };
    toast(id: string): void;
  } {
    return {
      signal<T>(initial: T) {
        let value = initial;
        const fn = (() => value) as (() => T) & { set(next: T): void };
        fn.set = (next: T) => { value = next; };
        return fn;
      },
      navigate: (screenIdx: number) => this.navigate(screenIdx),
      // Device parity with the SDL-only ui.window.* lowering
      // (ui_window_set_title / ui_window_set_icon). In the preview, setTitle
      // updates the browser tab title when a DOM is present (Node tests have
      // none); setIcon has no browser equivalent and no-ops, matching the
      // hardware targets' no-op.
      window: {
        setTitle: (title: string): void => {
          const doc = (globalThis as { document?: { title: string } }).document;
          if (doc) doc.title = String(title);
        },
        setIcon: (_path: string): void => { /* no browser equivalent */ },
      },
      // <drawer> controls: open by element id, close by id or all open
      // drawers. Device parity with ui_drawer_open / ui_drawer_close.
      drawer: {
        open: (id: string): void => this.drawerOpen(id),
        close: (id?: string): void => this.drawerClose(id),
      },
      // <dialog>/<toast> controls: same slot machinery as drawers (a dialog
      // is a centered drawer, a toast auto-closes via its duration attr).
      dialog: {
        open: (id: string): void => this.drawerOpen(id),
        close: (id?: string): void => this.drawerClose(id),
      },
      toast: (id: string): void => this.drawerOpen(id),
    };
  }
}
