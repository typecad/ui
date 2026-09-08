// Slice of the C++ runtime header (original source lines 1548-1710).
// mark_dirty, subtree dirty, scroll direct prepare/compositor, scroll view dirty/overlap/invalidate.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitDirtyScrollMutators(): string {
  return `
static inline void ui_mark_dirty(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  __ui_nodes[nodeIdx].dirty = 1;
  if (ui_is_effectively_visible(nodeIdx) &&
      __ui_nodes[nodeIdx].screenId == __ui_active_screen) {
    UIRect r;
    ui_node_current_paint_rect(nodeIdx, &r);
    if (r.w <= 0 || r.h <= 0) {
      ui_mark_overlapping_higher_layers_dirty(nodeIdx);
      return;
    }
    uint16_t p = __ui_nodes[nodeIdx].parent;
    while (p != UI_NO_PARENT && p < __ui_node_count) {
      if (__ui_nodes[p].scrollable &&
          !__ui_nodes[p].virtualized &&
          __ui_nodes[p].contentHeight > __ui_nodes[p].box.h) {
        UIRect clip = {
          __ui_nodes[p].box.x,
          __ui_nodes[p].box.y,
          __ui_nodes[p].box.w,
          __ui_nodes[p].box.h
        };
        if (!ui_rects_intersect(r.x, r.y, r.w, r.h, clip.x, clip.y, clip.w, clip.h)) {
          __ui_nodes[nodeIdx].dirty = 0;
          return;
        }
        if (r.x < clip.x ||
            r.x + r.w > clip.x + clip.w ||
            r.y < clip.y ||
            r.y + r.h > clip.y + clip.h) {
          ui_mark_scroll_view_dirty(p);
          return;
        }
        // Fully inside the viewport: leave the CHILD dirty. The dirty loop's
        // scroll defer lets fully-contained children repaint through their own
        // buffered paint (one atomic push; the retained scroll canvas is
        // invalidated after the draw). Promoting here recomposed the whole
        // viewport per dirty tick — fine for a rare :pressed button, but with
        // keyframe animations marking children (and their overlapping higher
        // layers) at frame rate it turned every animation frame into a
        // full-viewport canvas push — constant tearing on no-TE SPI panels.
      }
      p = __ui_nodes[p].parent;
    }
  }
  ui_mark_overlapping_higher_layers_dirty(nodeIdx);
}

// Set dirty=1 across a scroll subtree WITHOUT the per-child O(n) overlap repair.
// During scroll the subtree repaints into a freshly-cleared off-screen canvas, so
// intra-subtree overlap repair is pointless, and scroll children are draw-clipped
// to the container's viewport box — so all external higher-z neighbors of the
// viewport are covered by ONE overlap check at the container's paint rect (done by
// the caller). This drops scroll marking from O(K·n) to O(K + n).
static inline void ui_mark_subtree_dirty_local(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  for (uint16_t c = scrollNode + 1; c < __ui_nodes[scrollNode].subtreeEnd; c++) {
    __ui_nodes[c].dirty = 1;
  }
  __ui_nodes[scrollNode].dirty = 1;
}

// Mode C strip-only: direct-partial scroll when no viewport canvas fits and the
// scroll delta is small. Fills only the exposed strip on the display, then marks
// only the descendants that intersect that strip dirty for direct draw — mirroring
// the Mode B canvas repair path. Never clears the whole viewport, and never marks
// the whole subtree dirty (AGENTS.md: keep scroll drag invalidation small — a
// 1-pixel drag must not repaint every visible child).
static inline void ui_scroll_direct_prepare(uint16_t s, int16_t* outVX, int16_t* outVY) {
  int16_t vw = __ui_nodes[s].box.w;
  int16_t vh = __ui_nodes[s].box.h;
  int16_t vox = __ui_nodes[s].box.x;
  int16_t voy = __ui_nodes[s].box.y;
  UI_COLOR_T scrollBg = __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor;
  int16_t deltaY = __ui_nodes[s].scrollY - __ui_nodes[s].lastPaintedScrollY;
  int16_t absDelta = deltaY < 0 ? -deltaY : deltaY;
  int16_t stripY = deltaY > 0 ? static_cast<int16_t>(vh - absDelta) : 0;
  ui_display_fill_rect(vox, static_cast<int16_t>(voy + stripY), vw, absDelta, scrollBg);
  // Only descendants whose paint rect intersects the exposed strip need
  // repainting; the rest keep their last-painted pixels (the strip background
  // fill already covered the vacated band). Clear stale dirty flags on the
  // others so a flag set by a prior frame (or a sibling promotion) doesn't
  // trigger a needless repaint.
  UIRect exposed = { vox, static_cast<int16_t>(voy + stripY), vw, absDelta };
  for (uint16_t c = s + 1; c < __ui_nodes[s].subtreeEnd; c++) {
    if (!ui_is_effectively_visible(c) || __ui_nodes[c].screenId != __ui_active_screen) {
      __ui_nodes[c].dirty = 0;
      continue;
    }
    UIRect cr;
    ui_node_current_paint_rect(c, &cr);
    if (cr.w > 0 && cr.h > 0 &&
        ui_rects_intersect(cr.x, cr.y, cr.w, cr.h, exposed.x, exposed.y, exposed.w, exposed.h)) {
      __ui_nodes[c].dirty = 1;
      if (__ui_nodes[c].kind == NODE_PROGRESS || __ui_nodes[c].kind == NODE_RANGE) {
        __ui_nodes[c].lastTextWidth = -1;
      }
      __ui_nodes[c].lastTextHeight = 0;
    } else {
      __ui_nodes[c].dirty = 0;
    }
  }
  __ui_nodes[s].dirty = 0;
  if (outVX) *outVX = vox;
  if (outVY) *outVY = voy;
}

// Nearest overflow scroll container owning nodeIdx (or nodeIdx itself).
static inline int16_t ui_overflow_scroll_compositor(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return -1;
  if (__ui_nodes[nodeIdx].scrollable && !__ui_nodes[nodeIdx].virtualized &&
      __ui_nodes[nodeIdx].contentHeight > __ui_nodes[nodeIdx].box.h) {
    return static_cast<int16_t>(nodeIdx);
  }
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable && !__ui_nodes[p].virtualized &&
        __ui_nodes[p].contentHeight > __ui_nodes[p].box.h) {
      return static_cast<int16_t>(p);
    }
    p = __ui_nodes[p].parent;
  }
  return -1;
}

static inline void ui_mark_scroll_view_overlaps_dirty(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  if (!ui_is_effectively_visible(scrollNode)) return;
  if (__ui_nodes[scrollNode].screenId != __ui_active_screen) return;
  UIRect r;
  ui_node_current_paint_rect(scrollNode, &r);
  if (r.w <= 0 || r.h <= 0) return;
  for (uint16_t c = 0; c < __ui_node_count; c++) {
    if (c == scrollNode) continue;
    if (c > scrollNode && c < __ui_nodes[scrollNode].subtreeEnd) continue;
    if (__ui_nodes[c].dirty) continue;
    if (!ui_is_effectively_visible(c)) continue;
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_node_draws_before(scrollNode, c)) continue;
    UIRect cr;
    ui_node_current_paint_rect(c, &cr);
    if (cr.w <= 0 || cr.h <= 0) continue;
    if (ui_rects_intersect(r.x, r.y, r.w, r.h, cr.x, cr.y, cr.w, cr.h)) {
      __ui_nodes[c].dirty = 1;
    }
  }
}

static inline void ui_mark_scroll_subtree_dirty(uint16_t scrollNode) {
  ui_mark_subtree_dirty_local(scrollNode);
  // Single overlap check at the container's paint rect covers every external
  // higher-z neighbor of the viewport. The container index is the right one to
  // pass: scroll content lives within the container's stacking context, so
  // ui_node_draws_before(scrollNode, c) selects exactly the external layers that
  // should be repaired when the viewport is repainted.
  ui_mark_overlapping_higher_layers_dirty(scrollNode);
}

static inline void ui_mark_scroll_view_dirty(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  __ui_nodes[scrollNode].dirty = 1;
  ui_mark_scroll_view_overlaps_dirty(scrollNode);
}

static inline int16_t ui_scroll_ancestor_for_node(uint16_t nodeIdx) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) return static_cast<int16_t>(p);
    p = __ui_nodes[p].parent;
  }
  return -1;
}

static inline void ui_invalidate_scroll_canvas_for_node(uint16_t nodeIdx) {
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  if (scrollParent < 0) return;
  if (__ui_nodes[scrollParent].virtualized) return;
  if (__ui_nodes[scrollParent].contentHeight <= __ui_nodes[scrollParent].box.h) return;
  int16_t span = __ui_nodes[scrollParent].box.h > 0 ? __ui_nodes[scrollParent].box.h : 1;
  __ui_nodes[scrollParent].lastPaintedScrollY = __ui_nodes[scrollParent].scrollY - span;
}
`;
}
