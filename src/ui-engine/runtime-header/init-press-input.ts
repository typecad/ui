// Slice of the C++ runtime header (original source lines 2442-2561).
// ui_init, press/release entry points, pin-watch polling.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitInitPressInput(): string {
  return `
// Initial draw: mark all nodes dirty so the first ui_tick renders everything.
// Called once in setup() before the loop begins.
// Also seed each text-bound node's buffer from its flash literal so the first
// strcmp in ui_tick has a valid baseline (no spurious redraw on frame 1).
static inline void ui_init(void) {
  // Discover <drawer> panels and seed them closed (full-travel offsets, so a
  // closed drawer never paints at its rest position).
  ui_drawer_discover();
  // Allocate the per-node scroll-canvas-OK flag array (once; __ui_node_count
  // is a compile-time constant known by this point). calloc zeroes it — all
  // containers start locked until the scroll-container loop proves their
  // canvas fits.
  if (!__ui_scroll_canvas_ok && __ui_node_count > 0) {
    __ui_scroll_canvas_ok = new (std::nothrow) uint8_t[__ui_node_count]();
  }
  if (!__ui_scroll_render_locked && __ui_node_count > 0) {
    __ui_scroll_render_locked = new (std::nothrow) uint8_t[__ui_node_count]();
  }
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
    __ui_nodes[i].lastTextHeight = 0;
    __ui_nodes[i].layoutCacheKey = 0;
    if (__ui_nodes[i].scrollable) {
      // Force the first scroll-canvas composition to seed every pixel. After
      // that, a dirty child can be repaired in place without repainting the
      // entire viewport.
      __ui_nodes[i].lastPaintedScrollY = static_cast<int16_t>(
        __ui_nodes[i].scrollY - (__ui_nodes[i].box.h > 0 ? __ui_nodes[i].box.h : 1));
    }
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) {
      __ui_nodes[i].lastTextWidth = -1;
    }
  }
  for (uint16_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      uint16_t n = __ui_bindings[i].node;
      __ui_nodes[n].hasTextBinding = 1;
      strncpy(__ui_nodes[n].textBuffer, __ui_nodes[n].text ? __ui_nodes[n].text : "", UI_TEXT_BUF);
      __ui_nodes[n].textBuffer[UI_TEXT_BUF] = '\\0';
    } else if (__ui_bindings[i].fn) {
      // Prime numeric binding caches once at setup; the first tick can then skip
      // redundant assignments and dirty propagation when values are unchanged.
      __ui_bindings[i].lastValue = __ui_bindings[i].fn();
      __ui_bindings[i].initialized = 1;
    }
  }
  // Seed virtualized-list runtime state. The fn pointers can't be baked into
  // the static node initializer: ui.bindList is resolved AFTER ui.mount lowers
  // the HTML, so the lowering can't see the binding yet. Instead the lowering
  // emits the UIListBinding table (the binding's fn bodies) and ui_init copies
  // the pointers onto each <list> node here, then computes the initial count
  // and contentHeight so the first paint and the scroll clamp bound are correct.
  for (uint16_t b = 0; b < __ui_list_binding_count; b++) {
    uint16_t n = __ui_list_bindings[b].node;
    if (n >= __ui_node_count || !__ui_nodes[n].virtualized) continue;
    __ui_nodes[n].listCountFn = __ui_list_bindings[b].countFn;
    __ui_nodes[n].listItemFn = __ui_list_bindings[b].itemFn;
    __ui_nodes[n].listTapFn = __ui_list_bindings[b].tapFn;
  }
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].virtualized || !__ui_nodes[i].listCountFn) continue;
    uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
    uint16_t cnt = __ui_nodes[i].listCountFn();
    __ui_nodes[i].listCount = cnt;
    __ui_nodes[i].contentHeight = static_cast<int16_t>(static_cast<uint32_t>(cnt) * ih);
    __ui_nodes[i].scrollY = 0;
    __ui_nodes[i].overscrollPx = 0;
    __ui_nodes[i].settling = 0;
    __ui_nodes[i].lastPaintedScrollY = -(__ui_nodes[i].box.h > 0 ? __ui_nodes[i].box.h : 1);
  }
  ui_build_draw_order();
  ui_build_scroll_owner_table();
  ui_refresh_active_screen_bg_node();
  if (!__ui_scroll_candidates && __ui_node_count > 0) {
    __ui_scroll_candidates = new (std::nothrow) UIScrollPaintCandidate[__ui_node_count];
  }
}

// Debounce: ignore press/release events within 50ms of the last edge.
// Mechanical switches bounce (multiple edges in ~5-20ms); without this, the
// transition gets armed/interrupted dozens of times per physical press.
static volatile uint32_t __ui_last_edge_time = 0;
#define UI_DEBOUNCE_MS 50

static inline void ui_set_pressed(uint16_t nodeIdx, uint8_t pressed) {
  __ui_nodes[nodeIdx].value = pressed ? 1 : 0;
  ui_mark_dirty(nodeIdx);
  for (uint16_t i = 0; i < __ui_trans_count; i++) {
    if (__ui_trans[i].node == nodeIdx) {
      __ui_trans[i].prevValue = __ui_trans[i].prop == PROP_FG ? __ui_nodes[nodeIdx].fg : __ui_nodes[nodeIdx].bg;
      __ui_trans[i].targetValue = pressed ? __ui_trans[i].pressedTarget : __ui_trans[i].baseTarget;
      __ui_trans[i].elapsed = 0;
      __ui_trans[i].active = 1;
    }
  }
}

// Press / release entry points that node.onPress(pin) lowers to.
// On press, arm transitions toward the :pressed target color; on release,
// arm them back toward the base color (interrupt-and-re-lerp from current).
static inline void ui_on_press(uint16_t nodeIdx) {
  uint32_t now = __tc_now_ms();
  if (now - __ui_last_edge_time < UI_DEBOUNCE_MS) return;
  __ui_last_edge_time = now;
  ui_set_pressed(nodeIdx, 1);
}
static inline void ui_on_release(uint16_t nodeIdx) {
  uint32_t now = __tc_now_ms();
  if (now - __ui_last_edge_time < UI_DEBOUNCE_MS) return;
  __ui_last_edge_time = now;
  ui_set_pressed(nodeIdx, 0);
}

// Pin-watch callback type: void fn(void)
using PinWatchCallback = void (*)(void);

struct UIPinWatch {
  uint8_t pin;
  uint8_t lastState;   // for edge detection
  PinWatchCallback cb; // fires on falling edge
};

// Populated by the emit layer from ui.watchPin() calls.
extern UIPinWatch __ui_pin_watches[];
extern const uint16_t __ui_pin_watch_count;

// Poll all configured pin-watchers. Called at the start of ui_tick each frame.
// Detects falling edges with natural debounce from the ~16ms frame rate.
static inline void ui_poll_inputs() {
  for (uint16_t i = 0; i < __ui_pin_watch_count; i++) {
    uint8_t val = digitalRead(__ui_pin_watches[i].pin);
    if (val == LOW && __ui_pin_watches[i].lastState == HIGH) {
      if (__ui_pin_watches[i].cb) __ui_pin_watches[i].cb();
    }
    __ui_pin_watches[i].lastState = val;
  }
}
`;
}
