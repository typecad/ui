// Slice of the C++ runtime header (original source lines 452-621).
// Mixed slice: nav/touch/scroll/draw-order/kb state vars, image/keyframe/list/canvas/input binding structs, ease, fade. Kept contiguous to preserve byte-identity.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitStateBindingsNav(): string {
  return `

// ── Multi-screen navigation ─────────────────────────────────────────────────
// Touch/scroll/keyboard state reset by navigation.
static uint8_t __ui_touch_state = 0;
static int16_t __ui_touch_node = -1;  // int16: node index can exceed 127
// Unified scroll gesture: one owning scroll container per gesture, one baseline.
// overscrollPx/settling live on the node; only the settle-animation state is here.
static int16_t __ui_scroll_node = -1;            // owning scroll container (int16: node index can exceed 127)
// Per-node flag: 1 if the scroll-container loop successfully allocated a Mode B
// canvas for this node on a recent frame. ui_apply_scroll_delta gates scrolling
// on this — containers whose canvas won't fit (fragmented heap / no PSRAM) are
// frozen-but-not-torn rather than allowed to scroll with unclipped children.
// Sized at runtime via __ui_node_count; defaults to all-zero (lock until proven).
static uint8_t* __ui_scroll_canvas_ok = nullptr;
// Precomputed draw order (lower z-index first, then source index). Built once in
// ui_init; zIndex is static after mount so this stays valid for the app lifetime.
static uint16_t* __ui_draw_order = nullptr;
// Scroll-container node indices (built once in ui_init). Includes lists for
// hit-testing; the generic scroll compositor filters virtualized lists out.
static uint16_t* __ui_scroll_owners = nullptr;
static uint16_t __ui_scroll_owner_count = 0;
// Set when neither a viewport nor a band canvas can be allocated. The current
// pixels are retained and future drag deltas are rejected rather than exposing
// a direct per-primitive SPI fallback (which tears).
static uint8_t* __ui_scroll_render_locked = nullptr;
struct UIScrollPaintCandidate {
  uint16_t node;
  int16_t screenY;
  int16_t faceH;
  // Absolute clip bounds for the screen-band compositor: scrolled children
  // clip to their scroll viewport (CSS overflow). Unclipped candidates use
  // the full i16 range. The scroll-band renderer ignores these (its canvas
  // IS the viewport) and only sets node/screenY/faceH.
  int16_t clipTop;
  int16_t clipBottom;
  int16_t clipLeft;
  int16_t clipRight;
};
static UIScrollPaintCandidate* __ui_scroll_candidates = nullptr;
static uint16_t __ui_scroll_candidate_count = 0;
// First NODE_FILL on the active screen (for framebuffer bg seed).
static uint16_t __ui_active_screen_bg_node = 0xFFFF;
static uint32_t __ui_settle_start_ms = 0;        // when the active settle animation began
static int16_t __ui_settle_from_overscroll = 0;  // settle start value (bounce-back)
static int16_t __ui_settle_from_scrollY = 0;     // settle start value (edge snap; sign: +toward 0, -toward max)
static uint16_t __ui_settle_node = 0xFFFF;       // node owning the active settle; only one settles at a time
static uint8_t __ui_kb_visible = 0;

static uint8_t __ui_active_screen = 0;   // which screen is visible/interactive
extern const uint16_t __ui_screen_count;  // total number of screens (emitted by lowering)

// ── Image assets ────────────────────────────────────────────────────────────
struct UIImage { uint16_t w; uint16_t h; const UI_COLOR_T* data; };
extern const UIImage __ui_images[];
extern const uint16_t __ui_image_count;

// ── @keyframes animations ───────────────────────────────────────────────────
struct UIKeyframeStop {
  uint8_t percent;
  uint8_t props; // bitmask: 1=background, 2=color, 4=opacity, 8=transform, 16=size
  uint32_t bg;
  uint32_t fg;
  uint8_t opacity;
  int16_t transformOffsetX;
  int16_t transformOffsetY;
  int16_t translatePctX;
  int16_t translatePctY;
  int16_t scaleX;
  int16_t scaleY;
  int16_t rotateDeg;
  int16_t width;
  int16_t height;
};
#define UI_KF_BG 1
#define UI_KF_FG 2
#define UI_KF_OPACITY 4
#define UI_KF_TRANSFORM 8
#define UI_KF_SIZE 16
struct UIKeyframeSet {
  uint8_t stopCount;
  const UIKeyframeStop* stops;
};
struct UIAnimation {
  uint16_t node;
  uint8_t keyframeSet;
  uint16_t durationMs;
  uint16_t delayMs;
  int16_t iterations;
  int16_t baseWidth;
  int16_t baseHeight;
  int8_t originX;
  int8_t originY;
  uint8_t timingFunction;  // UI_TIMING_* — applied to the lerp factor between stops
  uint32_t elapsed;
  uint8_t active;
  uint32_t lastUpdateMs;  // throttle: only redraw every ~100ms to avoid tearing
};
// animation-timing-function codes (kept in sync with model.ts TIMING_*).
#define UI_TIMING_LINEAR 0
#define UI_TIMING_EASE_IN_OUT 1
#define UI_TIMING_EASE 2
#define UI_TIMING_EASE_IN 3
#define UI_TIMING_EASE_OUT 4

// Apply an easing curve to a 0..100 linear lerp factor. Pure integer math
// (no floats on device). Uses Newton-Raphson to solve the cubic-bezier x axis
// for the input k, then returns the bezier's y — identical algorithm + control
// points to easeCurveLerpK in model.ts so preview and device agree.
// Control points are /1000 fixed point; bezierX/Y(t) = 3(1-t)²t·c1 + 3(1-t)t²·c2 + t³.
static inline uint8_t ui_ease_lerp_k(uint8_t timing, uint8_t k) {
  if (timing == UI_TIMING_LINEAR || k == 0) return k;
  if (k >= 100) return 100;
  int32_t x1, y1, x2, y2;
  switch (timing) {
    case UI_TIMING_EASE_IN_OUT: x1 = 420; y1 = 0;   x2 = 580; y2 = 1000; break;
    case UI_TIMING_EASE:        x1 = 250; y1 = 100; x2 = 250; y2 = 1000; break;
    case UI_TIMING_EASE_IN:     x1 = 420; y1 = 0;   x2 = 1000; y2 = 1000; break;
    case UI_TIMING_EASE_OUT:    x1 = 0;   y1 = 0;   x2 = 580; y2 = 1000; break;
    default: return k;
  }
  // Control points are /1000 (0..1000 == 0..1). t is parametric, also /1000.
  // X(t) = 3(1-t)²t·x1 + 3(1-t)t²·x2 + t³. Solve X(t)=targetX for t by bisection,
  // then return Y(t). Bisection (not Newton-Raphson): Newton diverges for curves
  // whose x-derivative is ~0 near an endpoint (ease-out: x1=0), snapping the dot
  // to the wrong stop. X(t) is monotonic for valid CSS points, so bisection always
  // converges. Products of four /1000 values are /1e12; t³ is /1e9 (×1000 to align).
  // int64 accumulation avoids overflow (3e12 > INT32_MAX). Identical algorithm +
  // control points to easeCurveLerpK in model.ts — preview and device must agree.
  int32_t targetX = static_cast<int32_t>(k) * 10;          // input on the /1000 x axis
  int32_t lo = 0, hi = 1000;
  for (uint8_t i = 0; i < 14; i++) {
    int32_t t = (lo + hi) >> 1;
    int32_t mt = 1000 - t;
    int64_t termX1 = static_cast<int64_t>(3) * mt * mt * t * x1;   // /1e12
    int64_t termX2 = static_cast<int64_t>(3) * mt * t * t * x2;    // /1e12
    int64_t termX3 = static_cast<int64_t>(t) * t * t * 1000;       // /1e12 (t³ was /1e9)
    int32_t X = static_cast<int32_t>((termX1 + termX2 + termX3) / 1000000000LL);  // back to /1000
    if (X < targetX) lo = t; else hi = t;
  }
  int32_t t = (lo + hi) >> 1;
  int32_t mt = 1000 - t;
  int64_t termY1 = static_cast<int64_t>(3) * mt * mt * t * y1;
  int64_t termY2 = static_cast<int64_t>(3) * mt * t * t * y2;
  int64_t termY3 = static_cast<int64_t>(t) * t * t * 1000;
  int32_t Y = static_cast<int32_t>((termY1 + termY2 + termY3) / 1000000000LL);  // /1000
  return static_cast<uint8_t>(Y / 10);  // back to /100
}
extern const UIKeyframeSet __ui_keyframe_sets[];
extern const uint16_t __ui_keyframe_set_count;
extern UIAnimation __ui_anims[];
extern const uint16_t __ui_anim_count;

// ── List bindings ───────────────────────────────────────────────────────────
struct UIListBinding {
  uint16_t node;
  uint16_t (*countFn)(void);
  void (*itemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*tapFn)(uint16_t idx);  // optional: called when an item is tapped
};
extern UIListBinding __ui_list_bindings[];
extern const uint16_t __ui_list_binding_count;

// ── Canvas bindings (ui.drawCanvas) ─────────────────────────────────────────
// Each canvas node's user-supplied draw function. Called each frame with the
// node's offscreen CuttlefishCanvas16 set as the active draw target, so the
// lowered callback body draws via the same ui_display_* wrappers as everything.
struct UICanvasBinding {
  uint16_t node;
  void (*fn)(CuttlefishCanvas16* canvas);
};
extern UICanvasBinding __ui_canvas_bindings[];
extern const uint16_t __ui_canvas_binding_count;

// ── Input bindings (two-way) ─────────────────────────────────────────────────
// ui.bindInput(node, cb) — cb fires with the node's current text whenever the
// bound <input>'s textBuffer changes (e.g. user typed via on-screen keyboard).
// lastSeen holds the previously-observed text so the runtime can detect change.
struct UIInputBinding {
  uint16_t node;
  void (*cb)(const char* text);
  char lastSeen[UI_TEXT_BUF + 1];
};
extern UIInputBinding __ui_input_bindings[];
extern const uint16_t __ui_input_binding_count;

// List bindings are now carried ON each node (listCountFn/listItemFn/listTapFn).
// The UIListBinding table below is still emitted by the lowering for the
// node-initializer to read at static-init time; the runtime never indexes it.
`;
}
