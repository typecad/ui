// Slice of the C++ runtime header (original source lines 1711-1894).
// rects_intersect, visibility, draw order, owner table, screen bg, coordinate helpers, shadow extents, expand_rect.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitPaintOrderCoords(): string {
  return `
static inline uint8_t ui_rects_intersect(int16_t ax, int16_t ay, int16_t aw, int16_t ah,
                                         int16_t bx, int16_t by, int16_t bw, int16_t bh) {
  return ax + aw > bx && ax < bx + bw && ay + ah > by && ay < by + bh;
}

static inline uint8_t ui_is_effectively_visible(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return 0;
  if (!__ui_nodes[nodeIdx].visible) return 0;
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (!__ui_nodes[p].visible) return 0;
    p = __ui_nodes[p].parent;
  }
  // Centered overlay panels (<dialog>): offsets cannot hide the panel or its
  // subtree (travel is 0 by design), so the closed state gates visibility
  // directly — the root via its own slot, descendants via a side-4 ancestor
  // walk. Without the ancestor walk, dialog children (scrim, card, buttons)
  // have drawerSide -1 and no offsets: they painted while the dialog was
  // closed (an "Are you sure?" card on screen entry, buttons that close an
  // already-closed slot and appear dead). Edge drawers (<drawer>, <toast
  // side>) keep offset-only hiding — the bottom "peek" of an edge-anchored
  // panel must stay visible.
  if (__ui_nodes[nodeIdx].drawerSide == 4) {
    int8_t centerSlot = __ui_drawer_slot_of(nodeIdx);
    if (centerSlot < 0 || (!__ui_drawer_open[centerSlot] && __ui_drawer_progress[centerSlot] == 0)) return 0;
  } else {
    uint16_t a = __ui_nodes[nodeIdx].parent;
    while (a != UI_NO_PARENT && a < __ui_node_count) {
      if (__ui_nodes[a].drawerSide == 4) {
        int8_t centerSlot = __ui_drawer_slot_of(a);
        if (centerSlot < 0 || (!__ui_drawer_open[centerSlot] && __ui_drawer_progress[centerSlot] == 0)) return 0;
        break;
      }
      a = __ui_nodes[a].parent;
    }
  }
  // No closed-drawer gating here for edge drawers: they hide by transform
  // offsets alone (seeded at full travel by ui_drawer_discover), so the
  // bottom "peek" of a bottom-anchored panel stays visible.
  return 1;
}

// Effective stacking z, CSS-style: a non-zero zIndex raises the node AND its
// subtree — a z-raised panel forms a stacking context, so its descendants
// stack WITH it (above lower-z siblings), never independently UNDER it. A
// flat (zIndex, index) sort painted a dialog's scrim (z30) and card (z31)
// over the card's own z0 children (title/description/buttons): the band
// compositor erased the content it had just drawn (only the topmost child
// survived), and hit-testing saw the card as "topmost" so its buttons could
// never receive taps. 0 = "auto" (no context) — keep walking ancestors.
static inline int16_t ui_stacking_z(uint16_t nodeIdx) {
  uint16_t n = nodeIdx;
  while (n != UI_NO_PARENT && n < __ui_node_count) {
    if (__ui_nodes[n].zIndex != 0) return __ui_nodes[n].zIndex;
    n = __ui_nodes[n].parent;
  }
  return 0;
}

static inline uint8_t ui_node_draws_before(uint16_t a, uint16_t b) {
  int16_t za = ui_stacking_z(a);
  int16_t zb = ui_stacking_z(b);
  if (za != zb) return za < zb;
  // Same stacking level: source order. Sibling stacking contexts occupy
  // disjoint index ranges, so this also keeps a context's subtree contiguous.
  return a < b;
}

// Sort node indices once at startup so the dirty draw pass is O(N) instead of
// re-scanning all nodes for every dirty repaint (O(D·N)).
static inline void ui_build_draw_order() {
  if (__ui_draw_order || __ui_node_count == 0) return;
  __ui_draw_order = new (std::nothrow) uint16_t[__ui_node_count];
  if (!__ui_draw_order) return;
  for (uint16_t i = 0; i < __ui_node_count; i++) __ui_draw_order[i] = i;
  for (uint16_t a = 1; a < __ui_node_count; a++) {
    uint16_t key = __ui_draw_order[a];
    int16_t j = static_cast<int16_t>(a) - 1;
    while (j >= 0 && ui_node_draws_before(key, __ui_draw_order[j])) {
      __ui_draw_order[j + 1] = __ui_draw_order[j];
      j--;
    }
    __ui_draw_order[j + 1] = key;
  }
}

// Index scroll containers once so touch/wheel ownership doesn't scan unrelated
// nodes each frame.
static inline void ui_build_scroll_owner_table() {
  if (__ui_scroll_owners || __ui_node_count == 0) return;
  uint16_t count = 0;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].scrollable) count++;
  }
  __ui_scroll_owner_count = count;
  if (!count) return;
  __ui_scroll_owners = new (std::nothrow) uint16_t[count];
  if (!__ui_scroll_owners) {
    __ui_scroll_owner_count = 0;
    return;
  }
  uint16_t w = 0;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].scrollable) {
      __ui_scroll_owners[w++] = i;
    }
  }
}

static inline void ui_refresh_active_screen_bg_node() {
  __ui_active_screen_bg_node = 0xFFFF;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].screenId == __ui_active_screen && __ui_nodes[i].kind == NODE_FILL) {
      __ui_active_screen_bg_node = i;
      return;
    }
  }
}

static inline uint8_t ui_scroll_subtree_has_dirty(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return 0;
  uint16_t end = __ui_nodes[scrollNode].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t c = scrollNode + 1; c < end; c++) {
    if (__ui_nodes[c].dirty &&
        ui_is_effectively_visible(c) &&
        __ui_nodes[c].screenId == __ui_active_screen) {
      return 1;
    }
  }
  return 0;
}

static inline uint8_t ui_is_ancestor_of(uint16_t candidate, uint16_t nodeIdx) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (p == candidate) return 1;
    p = __ui_nodes[p].parent;
  }
  return 0;
}

static inline int16_t ui_pressed_offset_x_for_node(uint16_t nodeIdx) {
  return __ui_nodes[nodeIdx].value > 0 ? __ui_nodes[nodeIdx].pressedOffsetX : 0;
}

static inline int16_t ui_pressed_offset_y_for_node(uint16_t nodeIdx) {
  return __ui_nodes[nodeIdx].value > 0 ? __ui_nodes[nodeIdx].pressedOffsetY : 0;
}

static inline int16_t ui_base_draw_x_for_node(uint16_t nodeIdx) {
  return __ui_nodes[nodeIdx].box.x + __ui_nodes[nodeIdx].transformOffsetX;
}

static inline int16_t ui_draw_x_for_node(uint16_t nodeIdx) {
  return ui_base_draw_x_for_node(nodeIdx) + ui_pressed_offset_x_for_node(nodeIdx);
}

static inline int16_t ui_base_draw_y_for_node(uint16_t nodeIdx) {
  int16_t y = __ui_nodes[nodeIdx].box.y + __ui_nodes[nodeIdx].transformOffsetY;
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) y -= __ui_nodes[p].scrollY;
    p = __ui_nodes[p].parent;
  }
  return y;
}

static inline int16_t ui_draw_y_for_node(uint16_t nodeIdx) {
  return ui_base_draw_y_for_node(nodeIdx) + ui_pressed_offset_y_for_node(nodeIdx);
}

// Find the scrollable container (list or generic scroll view) whose box contains
// a point, on the active screen, with content overflowing the viewport. Mirrors
// the touch path's scroll-scan (ui_touch_down) so the wheel handler finds the
// SAME owner a drag would — robust against the cursor resting on a non-child
// node (text, a sibling, padding) where the hit-test + ancestor-walk approach
// misses. Returns the topmost such node by draw order, or -1 if none.
static inline int16_t ui_scroll_node_at(int16_t tx, int16_t ty) {
  int16_t bestScroll = -1;
  if (__ui_scroll_owners) {
    for (uint16_t oi = 0; oi < __ui_scroll_owner_count; oi++) {
      uint16_t i = __ui_scroll_owners[oi];
      if (!ui_is_effectively_visible(i)) continue;
      if (__ui_nodes[i].screenId != __ui_active_screen) continue;
      if (__ui_nodes[i].contentHeight <= __ui_nodes[i].box.h) continue;
      int16_t drawX = ui_draw_x_for_node(i);
      int16_t drawY = ui_draw_y_for_node(i);
      if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
          ty >= drawY && ty < drawY + __ui_nodes[i].box.h &&
          (bestScroll < 0 || ui_node_draws_before(static_cast<uint16_t>(bestScroll), i))) {
        bestScroll = static_cast<int16_t>(i);
      }
    }
  } else {
    for (uint16_t i = 0; i < __ui_node_count; i++) {
      if (!__ui_nodes[i].scrollable || !ui_is_effectively_visible(i)) continue;
      if (__ui_nodes[i].screenId != __ui_active_screen) continue;
      if (__ui_nodes[i].contentHeight <= __ui_nodes[i].box.h) continue;
      int16_t drawX = ui_draw_x_for_node(i);
      int16_t drawY = ui_draw_y_for_node(i);
      if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
          ty >= drawY && ty < drawY + __ui_nodes[i].box.h &&
          (bestScroll < 0 || ui_node_draws_before(static_cast<uint16_t>(bestScroll), i))) {
        bestScroll = static_cast<int16_t>(i);
      }
    }
  }
  return bestScroll;
}

// Resolve the actual backdrop for a node by walking painted ancestors. A direct
// parent may be transparent; using its clearColor there can blend against the
// wrong layer when siblings or an opaque grandparent are behind the node.
static inline UI_COLOR_T ui_parent_clear_color(uint16_t nodeIdx) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].hasBg) {
      UI_COLOR_T backdrop = __ui_nodes[p].bg;
      if (__ui_nodes[p].opacity < 100) {
        uint16_t pp = __ui_nodes[p].parent;
        UI_COLOR_T under = __ui_nodes[p].clearColor;
        if (pp != UI_NO_PARENT && pp < __ui_node_count) under = ui_parent_clear_color(p);
        backdrop = ui_blend(backdrop, under, __ui_nodes[p].opacity);
      }
      return backdrop;
    }
    p = __ui_nodes[p].parent;
  }
  return __ui_nodes[nodeIdx].clearColor;
}

static inline void ui_shadow_extents(uint16_t nodeIdx, int16_t* left, int16_t* top, int16_t* right, int16_t* bottom) {
  *left = 0; *top = 0; *right = 0; *bottom = 0;
  for (uint8_t s = 0; s < __ui_nodes[nodeIdx].shadowCount && s < 4; s++) {
    if (__ui_nodes[nodeIdx].shadowInset[s]) continue;
    int16_t blur = __ui_nodes[nodeIdx].shadowBlur[s];
    if (blur == 0) blur = 1;
    int16_t ox = __ui_nodes[nodeIdx].shadowOffsetX[s];
    int16_t oy = __ui_nodes[nodeIdx].shadowOffsetY[s];
    int16_t l = blur - ox;
    int16_t t = blur - oy;
    int16_t r = blur + ox;
    int16_t b = blur + oy;
    if (l > *left) *left = l;
    if (t > *top) *top = t;
    if (r > *right) *right = r;
    if (b > *bottom) *bottom = b;
  }
}

static inline void ui_expand_rect(int16_t* x0, int16_t* y0, int16_t* x1, int16_t* y1,
                                  int16_t rx0, int16_t ry0, int16_t rx1, int16_t ry1) {
  if (rx0 < *x0) *x0 = rx0;
  if (ry0 < *y0) *y0 = ry0;
  if (rx1 > *x1) *x1 = rx1;
  if (ry1 > *y1) *y1 = ry1;
}
`;
}
