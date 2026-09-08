// Slice of the C++ runtime header (original source lines 1000-1154).
// Scroll input + physics layer, framebuffer get/push.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitScrollPhysics(): string {
  return `
// ── Scroll engine: Input layer ───────────────────────────────────────────────
// raw touch sample → smoothed delta (dy). Capacitive: passthrough 1:1.
// Resistive: deadband suppresses sub-N-px jitter (steady drag still 1:1).
// 'none' tier compiles drag scroll out entirely.

static inline int16_t ui_scroll_scale_dy(int16_t dy) {
  int32_t scaled = static_cast<int32_t>(dy) * static_cast<int32_t>(UI_SCROLL_DRAG_SCALE_X10);
  return static_cast<int16_t>(scaled >= 0 ? (scaled + 5) / 10 : (scaled - 5) / 10);
}

static inline int16_t ui_scroll_smooth_dy(int16_t dy) {
#if UI_SCROLL_INPUT_TIER_CAPACITIVE
  return ui_scroll_scale_dy(dy);
#elif UI_SCROLL_INPUT_TIER_RESISTIVE
  int16_t db = static_cast<int16_t>(UI_SCROLL_DEADBAND_PX);
  if (dy >= -db && dy <= db) {
    // Deadband: kill per-sample jitter around zero. Steady drag (|dy|>db) below
    // passes through unchanged, so steady-state is 1:1 (spec Q1).
    return 0;
  }
  return ui_scroll_scale_dy(dy);
#else
  (void)dy;
  return 0;
#endif
}

// ── Scroll engine: Physics layer ─────────────────────────────────────────────
// 1:1 in bounds; rubber-band at edges; bounce-back/snap on release. No fling.
// On constrained render tiers (no elastic), overscroll is hard-clamped away.

static inline int16_t ui_scroll_max(int16_t node) {
  if (node < 0) return 0;
  int16_t m = __ui_nodes[node].contentHeight - __ui_nodes[node].box.h;
  return m < 0 ? 0 : m;
}

// Rubber-band excursion for d cumulative pixels dragged past a boundary.
// r = maxOverscroll * d / (d + stiffness). stiffness held as X10 fixed-point.
static inline int16_t ui_scroll_overscroll_for(int16_t d) {
  if (d <= 0) return 0;
  int16_t maxOv = static_cast<int16_t>(UI_SCROLL_MAX_OVERSCROLL);
  int16_t stiffX10 = static_cast<int16_t>(UI_SCROLL_STIFFNESS_X10);
  if (stiffX10 <= 0) stiffX10 = 1;
  int32_t r = (static_cast<int32_t>(maxOv) * static_cast<int32_t>(d)) / (static_cast<int32_t>(d) + static_cast<int32_t>(stiffX10));
  return r > maxOv ? maxOv : static_cast<int16_t>(r);
}

// Apply a smoothed drag delta to the owning scroll node. Returns 1 if the view
// changed (needs redraw). Sets overscrollPx for rubber-band excursions; scrollY
// itself never leaves [0, maxScroll] so the committed position stays valid.
static inline uint8_t ui_apply_scroll_delta(int16_t node, int16_t dy) {
  if (node < 0 || dy == 0) return 0;
  if (__ui_scroll_render_locked && __ui_scroll_render_locked[node]) return 0;
  int16_t sy = __ui_nodes[node].scrollY;
  int16_t maxS = ui_scroll_max(node);
  int16_t nextY = sy - dy;
  int16_t prevOv = __ui_nodes[node].overscrollPx;
  int16_t nextOv = prevOv;
  if (nextY < 0) {
    __ui_nodes[node].scrollY = 0;
    // Cumulative drag past the top boundary since crossing it.
    int16_t draggedPast = dy - sy;            // how far past 0 this delta pushed
    int16_t cum = prevOv + draggedPast;
    if (cum < 0) cum = 0;
#if UI_SCROLL_ELASTIC
    nextOv = ui_scroll_overscroll_for(cum);
#else
    nextOv = 0;
#endif
  } else if (nextY > maxS) {
    __ui_nodes[node].scrollY = maxS;
    int16_t draggedPast = nextY - maxS;
    int16_t cum = (prevOv < 0 ? -prevOv : 0) + draggedPast;  // prevOv<0 = bottom
    if (cum < 0) cum = 0;
#if UI_SCROLL_ELASTIC
    nextOv = -ui_scroll_overscroll_for(cum);   // negative = bottom overshoot
#else
    nextOv = 0;
#endif
  } else {
    __ui_nodes[node].scrollY = nextY;
    nextOv = 0;                                 // returned in-bounds → reset
  }
  __ui_nodes[node].overscrollPx = nextOv;
  uint8_t changed = (__ui_nodes[node].scrollY != sy) || (nextOv != prevOv);
  if (changed) ui_mark_scroll_view_dirty(static_cast<uint16_t>(node));
  return changed;
}

// On release: arm a bounded settle animation — bounce overscroll back to 0, or
// edge-snap scrollY within edgeSnapPx. The animation runs in ui_tick.
static inline uint8_t ui_scroll_release(int16_t node) {
  if (node < 0) return 0;
  uint8_t changed = 0;
  // Only one settle animation owns the shared start state. If another node is
  // still mid-settle, snap it to its end state so its stale animation can't
  // consume this release's start values.
  if (__ui_settle_node != 0xFFFFu && __ui_settle_node != static_cast<uint16_t>(node) &&
      __ui_settle_node < __ui_node_count && __ui_nodes[__ui_settle_node].settling) {
    __ui_nodes[__ui_settle_node].overscrollPx = 0;
    if (__ui_settle_from_scrollY > 0) {
      __ui_nodes[__ui_settle_node].scrollY = 0;
    } else if (__ui_settle_from_scrollY < 0) {
      __ui_nodes[__ui_settle_node].scrollY = ui_scroll_max(static_cast<int16_t>(__ui_settle_node));
    }
    __ui_nodes[__ui_settle_node].settling = 0;
    ui_mark_scroll_view_dirty(__ui_settle_node);
  }
  if (__ui_nodes[node].overscrollPx != 0) {
    __ui_nodes[node].settling = 1;
    __ui_settle_from_overscroll = __ui_nodes[node].overscrollPx;
    __ui_settle_from_scrollY = 0;
    __ui_settle_start_ms = __tc_now_ms();
    changed = 1;
  } else {
    int16_t sy = __ui_nodes[node].scrollY;
    int16_t maxS = ui_scroll_max(node);
    int16_t snap = static_cast<int16_t>(UI_SCROLL_EDGE_SNAP_PX);
    if (sy > 0 && sy <= snap) {
      __ui_nodes[node].settling = 1;
      __ui_settle_from_scrollY = sy;            // positive → snap toward 0
      __ui_settle_from_overscroll = 0;
      __ui_settle_start_ms = __tc_now_ms();
      changed = 1;
    } else if (maxS > 0 && sy < maxS && sy >= maxS - snap) {
      __ui_nodes[node].settling = 1;
      __ui_settle_from_scrollY = sy - maxS;     // negative → snap toward max
      __ui_settle_from_overscroll = 0;
      __ui_settle_start_ms = __tc_now_ms();
      changed = 1;
    }
  }
  __ui_settle_node = static_cast<uint16_t>(node);
  return changed;
}

// Advance the settle animation for a node (called from ui_tick). Ease-out over
// UI_SCROLL_SETTLE_MS, terminating at the boundary. Bounded — always ends.
static inline void ui_scroll_advance_settle(uint16_t node, uint16_t deltaMs) {
  (void)deltaMs;
  if (node >= __ui_node_count || !__ui_nodes[node].settling) return;
  // The settle start state belongs to __ui_settle_node only; a settling flag
  // on any other node is stale (superseded by a newer release) — drop it.
  if (node != __ui_settle_node) {
    __ui_nodes[node].settling = 0;
    return;
  }
  uint32_t elapsed = __tc_now_ms() - __ui_settle_start_ms;
  uint16_t dur = static_cast<uint16_t>(UI_SCROLL_SETTLE_MS);
  // ease-out: k = 1 - (1 - t)^2, t in [0,1]
  uint32_t t = elapsed >= dur ? 100 : (elapsed * 100) / dur;
  uint32_t k = 100 - ((100 - t) * (100 - t)) / 100;
  if (__ui_nodes[node].overscrollPx != 0) {
    int16_t from = __ui_settle_from_overscroll;
    __ui_nodes[node].overscrollPx = static_cast<int16_t>(from - static_cast<int32_t>(from * k) / 100);
    if (t >= 100) __ui_nodes[node].overscrollPx = 0;
  } else if (__ui_settle_from_scrollY != 0) {
    int16_t from = __ui_settle_from_scrollY;   // +toward 0, -toward max
    int16_t maxS = ui_scroll_max(node);
    if (from > 0) {
      __ui_nodes[node].scrollY = static_cast<int16_t>(from - static_cast<int32_t>(from * k) / 100);
      if (t >= 100) __ui_nodes[node].scrollY = 0;
    } else {  // from < 0: snap toward maxS
      int16_t target = maxS;
      __ui_nodes[node].scrollY = target + static_cast<int16_t>(static_cast<int32_t>(from) * (100 - k) / 100);
      if (t >= 100) __ui_nodes[node].scrollY = target;
    }
  }
  if (t >= 100) {
    __ui_nodes[node].settling = 0;
    __ui_settle_node = 0xFFFF;
  }
  ui_mark_scroll_view_dirty(node);
}
`;
}
