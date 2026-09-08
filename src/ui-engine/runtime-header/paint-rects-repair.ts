// Slice of the C++ runtime header (original source lines 1895-2441).
// Paint rects, overlapping layers dirty, buffer decisions, seed/repair, scroll-clip tests, clipped primitives, clear/repair, set_visible.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitPaintRectsRepair(): string {
  return `
static inline void ui_node_paint_rect(uint16_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH, UIRect* out) {
  int16_t shadowL, shadowT, shadowR, shadowB;
  ui_shadow_extents(nodeIdx, &shadowL, &shadowT, &shadowR, &shadowB);

  int16_t faceW = __ui_nodes[nodeIdx].box.w;
  int16_t faceH = __ui_nodes[nodeIdx].box.h;
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT || __ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO || __ui_nodes[nodeIdx].kind == NODE_SELECT) {
    if (__ui_nodes[nodeIdx].lastTextWidth > faceW) faceW = __ui_nodes[nodeIdx].lastTextWidth;
    if (__ui_nodes[nodeIdx].lastTextHeight > faceH) faceH = __ui_nodes[nodeIdx].lastTextHeight;
    if (static_cast<int16_t>(textW) > faceW) faceW = static_cast<int16_t>(textW);
    if (static_cast<int16_t>(textH) > faceH) faceH = static_cast<int16_t>(textH);
  }
  int16_t unrotatedFaceW = faceW;
  int16_t unrotatedFaceH = faceH;
  faceW = ui_rotated_face_w(nodeIdx, unrotatedFaceW, unrotatedFaceH);
  faceH = ui_rotated_face_h(nodeIdx, unrotatedFaceW, unrotatedFaceH);

  int16_t shadowX0 = baseX - shadowL;
  int16_t shadowY0 = baseY - shadowT;
  int16_t shadowX1 = baseX + faceW + shadowR;
  int16_t shadowY1 = baseY + faceH + shadowB;
  int16_t faceX0 = drawX;
  int16_t faceY0 = drawY;
  int16_t faceX1 = drawX + faceW;
  int16_t faceY1 = drawY + faceH;
  int16_t x0 = shadowX0 < faceX0 ? shadowX0 : faceX0;
  int16_t y0 = shadowY0 < faceY0 ? shadowY0 : faceY0;
  int16_t x1 = shadowX1 > faceX1 ? shadowX1 : faceX1;
  int16_t y1 = shadowY1 > faceY1 ? shadowY1 : faceY1;
  if (__ui_nodes[nodeIdx].outlineStyle != 0 && __ui_nodes[nodeIdx].outlineWidth > 0) {
    int16_t o = __ui_nodes[nodeIdx].outlineWidth;
    ui_expand_rect(&x0, &y0, &x1, &y1, drawX - o, drawY - o, drawX + faceW + o, drawY + faceH + o);
  }
  out->x = x0;
  out->y = y0;
  out->w = x1 - x0;
  out->h = y1 - y0;
}

static inline void ui_node_current_paint_rect(uint16_t nodeIdx, UIRect* out) {
  uint16_t tw = 0;
  uint16_t th = 0;
  uint16_t textMaxW = ui_node_text_max_width(nodeIdx);
  ui_node_text_layout_metrics(nodeIdx, textMaxW, &tw, &th);
  if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    tw += 22;
    if (th < 16) th = 16;
  }
  ui_node_paint_rect(nodeIdx,
    ui_base_draw_x_for_node(nodeIdx),
    ui_base_draw_y_for_node(nodeIdx),
    ui_draw_x_for_node(nodeIdx),
    ui_draw_y_for_node(nodeIdx),
    tw,
    th,
    out);
}

static inline uint8_t ui_subtree_current_paint_rect(uint16_t nodeIdx, UIRect* out) {
  if (nodeIdx >= __ui_node_count) return 0;
  int16_t end = __ui_nodes[nodeIdx].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  uint8_t hasRect = 0;
  int16_t x0 = 0;
  int16_t y0 = 0;
  int16_t x1 = 0;
  int16_t y1 = 0;
  for (uint16_t c = nodeIdx; c < end; c++) {
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_is_effectively_visible(c)) continue;
    UIRect r;
    ui_node_current_paint_rect(c, &r);
    if (r.w <= 0 || r.h <= 0) continue;
    if (!hasRect) {
      x0 = r.x;
      y0 = r.y;
      x1 = r.x + r.w;
      y1 = r.y + r.h;
      hasRect = 1;
    } else {
      ui_expand_rect(&x0, &y0, &x1, &y1, r.x, r.y, r.x + r.w, r.y + r.h);
    }
  }
  if (!hasRect) return 0;
  out->x = x0;
  out->y = y0;
  out->w = x1 - x0;
  out->h = y1 - y0;
  return 1;
}

static inline void ui_mark_overlapping_higher_layers_dirty(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  if (!ui_is_effectively_visible(nodeIdx)) return;
  if (__ui_nodes[nodeIdx].screenId != __ui_active_screen) return;
  UIRect r;
  ui_node_current_paint_rect(nodeIdx, &r);
  ui_mark_overlapping_higher_layers_dirty_for_rect(nodeIdx, &r);
}

static inline void ui_mark_overlapping_higher_layers_dirty_for_rect(uint16_t nodeIdx, const UIRect* r) {
  if (nodeIdx >= __ui_node_count || !r) return;
  if (!ui_is_effectively_visible(nodeIdx)) return;
  if (__ui_nodes[nodeIdx].screenId != __ui_active_screen) return;
  if (r->w <= 0 || r->h <= 0) return;
  for (uint16_t c = 0; c < __ui_node_count; c++) {
    if (c == nodeIdx) continue;
    if (__ui_nodes[c].dirty) continue;
    if (!ui_is_effectively_visible(c)) continue;
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_node_draws_before(nodeIdx, c)) continue;
    UIRect cr;
    ui_node_current_paint_rect(c, &cr);
    if (cr.w <= 0 || cr.h <= 0) continue;
    if (ui_rects_intersect(r->x, r->y, r->w, r->h, cr.x, cr.y, cr.w, cr.h)) {
      __ui_nodes[c].dirty = 1;
      // Repainting a container erases everything drawn inside it — its own
      // descendants. Mark them too, or the ladder redraws the container face
      // alone and wipes its children: a press under a dialog marked the scrim
      // and card dirty (overlapping higher layers) but not the card's title/
      // buttons, and their solo repaint erased the just-composed dialog. The
      // dirty pass clears flags for invisible descendants, and scroll-subtree
      // children route through the scroll defer as usual.
      for (uint16_t k = c + 1; k < __ui_nodes[c].subtreeEnd && k < __ui_node_count; k++) {
        if (__ui_nodes[k].screenId != __ui_active_screen) continue;
        __ui_nodes[k].dirty = 1;
      }
    }
  }
}

static inline void ui_clear_press_offset_area(uint16_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH) {
  if (__ui_nodes[nodeIdx].pressedOffsetX == 0 && __ui_nodes[nodeIdx].pressedOffsetY == 0) return;
  UIRect r;
  ui_node_paint_rect(nodeIdx, baseX, baseY, drawX, drawY, textW, textH, &r);
  int16_t x0 = r.x;
  int16_t y0 = r.y;
  int16_t x1 = r.x + r.w;
  int16_t y1 = r.y + r.h;
  if (ui_display_is_default_target() && ui_repair_current_node_paint_with_parent(nodeIdx, &r)) return;
  ui_display_fill_rect(x0, y0, x1 - x0, y1 - y0, ui_parent_clear_color(nodeIdx));
}

// Generated-font / AA text and images draw per-pixel when sent straight to SPI.
// Prefer the RAM paint canvas for these kinds (within the pixel budget).
// NOTE: ALL NODE_TEXT is treated as pixel-heavy. Even the classic GFX bitmap
// font renders via drawPixel per font pixel, and on an SPI TFT each drawPixel
// is a full set_window+RAMWR SPI transaction (~30us) — a single 460x8 text band
// costs >100ms direct-drawn. Forcing every text node through the paint canvas
// turns that into one RAM render + one SPI push (~3ms). AA/generated-font text
// additionally requires getPixel readback for coverage blending, which is only
// correct against a RAM target.
static inline uint8_t ui_pixel_heavy_node(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_IMG) return 1;
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT) return 1;
  if (__ui_nodes[nodeIdx].kind == NODE_SELECT) return 1;
  return 0;
}

static inline uint8_t ui_should_buffer_paint(uint16_t nodeIdx, int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_LIST) return 0;
  // <canvas> elements batch via __ui_node_canvas when drawing to the display.
  if (__ui_nodes[nodeIdx].kind == NODE_CANVAS) return 0;
  // NO hard pixel cap here: oversized paint rects route to the band renderer
  // via preferBand (UI_BAND_PREFER_PIXELS), and the repair canvas is never
  // attempted above that threshold either. A cap here pushed just-over-budget
  // repaints (a 452x48 full-width button is 21696px) onto the direct
  // clear-then-redraw path — the visible button press flash.
  if (ui_pixel_heavy_node(nodeIdx)) return 1;
  if (__ui_nodes[nodeIdx].kind == NODE_FILL &&
      __ui_nodes[nodeIdx].hasBg &&
      __ui_nodes[nodeIdx].gradientEnabled == 0 &&
      __ui_nodes[nodeIdx].borderRadius == 0 &&
      __ui_nodes[nodeIdx].borderStyle == 0 &&
      __ui_nodes[nodeIdx].outlineStyle == 0 &&
      __ui_nodes[nodeIdx].shadowCount == 0) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_FILL &&
      !__ui_nodes[nodeIdx].hasBg &&
      __ui_nodes[nodeIdx].borderStyle == 0 &&
      __ui_nodes[nodeIdx].outlineStyle == 0 &&
      __ui_nodes[nodeIdx].shadowCount == 0) return 0;
  return 1;
}

static inline void ui_seed_paint_canvas_for_node(uint16_t nodeIdx, CuttlefishCanvas16* canvas, int16_t canvasX, int16_t canvasY, int16_t bandTop) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  uint16_t p = __ui_nodes[nodeIdx].parent;
  if (p == UI_NO_PARENT || p >= __ui_node_count) {
    display_canvasFillScreen(canvas, __ui_nodes[nodeIdx].clearColor);
    return;
  }

  uint16_t parentDecorated =
    (__ui_nodes[p].hasBg && (__ui_nodes[p].borderRadius > 0 || __ui_nodes[p].gradientEnabled > 0)) ||
    __ui_nodes[p].borderStyle != 0 ||
    __ui_nodes[p].outlineStyle != 0;
  if (!parentDecorated) {
    display_canvasFillScreen(canvas, ui_parent_clear_color(nodeIdx));
    return;
  }

  display_canvasFillScreen(canvas, ui_parent_clear_color(p));
  int16_t parentDrawX = ui_draw_x_for_node(p);
  int16_t parentDrawY = ui_draw_y_for_node(p);
  int16_t origParentX = __ui_nodes[p].box.x;
  CuttlefishDisplayTarget* previousGfx = ui_display_get_target();
  ui_display_set_target(canvas);
  __ui_nodes[p].box.x = parentDrawX - canvasX;
  // Shift the parent's draw Y up by bandTop so the band canvas shows the
  // correct slice of the parent fill/border for this band's Y range. bandTop=0
  // (the main-loop caller) is a no-op shift. canvasY already carries the paint
  // rect's display-space origin; bandTop further offsets within the rect.
  int16_t localY = parentDrawY - canvasY - bandTop;

  // Parent fill color: blended toward the parent's backdrop when the parent is
  // translucent (matching the main NODE_FILL draw, which uses fillBg). Without
  // this, scroll repair seeds the canvas with the parent's RAW bg while the
  // main draw used the blended color → shearing on translucent nodes during scroll.
  UI_COLOR_T parentFillBg = __ui_nodes[p].bg;
  if (__ui_nodes[p].opacity < 100) {
    parentFillBg = ui_blend(__ui_nodes[p].bg, ui_parent_clear_color(p), __ui_nodes[p].opacity);
  }

  if (__ui_nodes[p].gradientEnabled > 0) {
    ui_draw_gradient_fill(p, localY);
  } else if (__ui_nodes[p].borderRadius > 0 && __ui_nodes[p].hasBg) {
    ui_display_fill_round_rect(__ui_nodes[p].box.x, localY, __ui_nodes[p].box.w, __ui_nodes[p].box.h,
      __ui_nodes[p].borderRadius, parentFillBg);
  } else if (__ui_nodes[p].hasBg) {
    ui_display_fill_rect(__ui_nodes[p].box.x, localY, __ui_nodes[p].box.w, __ui_nodes[p].box.h, parentFillBg);
  }
  if (__ui_nodes[p].borderStyle != 0) {
    UI_COLOR_T bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
    ui_draw_node_border(p, __ui_nodes[p].box.x, localY, bColor);
  }
  ui_draw_node_outline(p, __ui_nodes[p].box.x, localY);

  __ui_nodes[p].box.x = origParentX;
  ui_display_set_target(previousGfx);
}

static inline uint8_t ui_repair_current_node_paint_with_parent(uint16_t nodeIdx, UIRect* r) {
  if (!r || r->w <= 0 || r->h <= 0) return 0;
  if (static_cast<uint32_t>(r->w) * static_cast<uint32_t>(r->h) > UI_MAX_BUFFERED_PAINT_PIXELS) return 0;
  CuttlefishCanvas16* repairCanvas = ui_get_repair_canvas(r->w, r->h);
  if (!repairCanvas) return 0;
  ui_seed_paint_canvas_for_node(nodeIdx, repairCanvas, r->x, r->y, 0);
  // During a retained-framebuffer tick, publish the repair into the RAM
  // composition surface. Sending it to the live panel here creates the visible
  // erase/redraw flash seen on animated transforms.
  if (__ui_fb) ui_display_set_target((CuttlefishDisplayTarget*)__ui_fb);
  else ui_display_use_default_target();
  ui_push_canvas_rect(repairCanvas, r->x, r->y, r->w, r->h);
  ui_display_use_default_target();
  return 1;
}

static inline uint8_t ui_is_rect_clipped_by_scroll(uint16_t nodeIdx, int16_t drawX, int16_t drawY, int16_t drawW, int16_t drawH) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) {
      if (drawX < __ui_nodes[p].box.x ||
          drawX + drawW > __ui_nodes[p].box.x + __ui_nodes[p].box.w ||
          drawY < __ui_nodes[p].box.y ||
          drawY + drawH > __ui_nodes[p].box.y + __ui_nodes[p].box.h) {
        return 1;
      }
    }
    p = __ui_nodes[p].parent;
  }
  return 0;
}

static inline uint8_t ui_is_clipped_by_scroll(uint16_t nodeIdx, int16_t drawX, int16_t drawY) {
  return ui_is_rect_clipped_by_scroll(nodeIdx, drawX, drawY, __ui_nodes[nodeIdx].box.w, __ui_nodes[nodeIdx].box.h);
}

// Point-in-viewport test for hit-testing. A tap point is tappable if it lies
// within EVERY scrollable ancestor's viewport (logical AND, matching the
// preview's intersected scroll clip). This differs from ui_is_clipped_by_scroll,
// which tests the node's whole bounding box — a tall node (e.g. a wrapped
// rich-text paragraph) can overflow below the fold yet have a tappable link in
// its visible portion. Use this in the hit-test path; keep the whole-box check
// for draw culling, where a partially-visible node still needs repainting.
static inline uint8_t ui_is_point_clipped_by_scroll(uint16_t nodeIdx, int16_t px, int16_t py) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) {
      if (px < __ui_nodes[p].box.x ||
          px >= __ui_nodes[p].box.x + __ui_nodes[p].box.w ||
          py < __ui_nodes[p].box.y ||
          py >= __ui_nodes[p].box.y + __ui_nodes[p].box.h) {
        return 1;
      }
    }
    p = __ui_nodes[p].parent;
  }
  return 0;
}

static inline uint8_t ui_clip_rect_to_rect(UIRect* r, const UIRect* clip) {
  int16_t x0 = r->x > clip->x ? r->x : clip->x;
  int16_t y0 = r->y > clip->y ? r->y : clip->y;
  int16_t x1 = r->x + r->w < clip->x + clip->w ? r->x + r->w : clip->x + clip->w;
  int16_t y1 = r->y + r->h < clip->y + clip->h ? r->y + r->h : clip->y + clip->h;
  if (x1 <= x0 || y1 <= y0) return 0;
  r->x = x0;
  r->y = y0;
  r->w = x1 - x0;
  r->h = y1 - y0;
  return 1;
}

static inline void ui_fill_rect_clipped(int16_t x, int16_t y, int16_t w, int16_t h, const UIRect* clip, UI_COLOR_T color) {
  UIRect r = { x, y, w, h };
  if (!ui_clip_rect_to_rect(&r, clip)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, color);
}

static inline void ui_hline_clipped(int16_t x, int16_t y, int16_t w, const UIRect* clip, UI_COLOR_T color) {
  if (w <= 0 || y < clip->y || y >= clip->y + clip->h) return;
  int16_t x0 = x > clip->x ? x : clip->x;
  int16_t x1 = x + w < clip->x + clip->w ? x + w : clip->x + clip->w;
  if (x1 <= x0) return;
  ui_display_draw_fast_hline(x0, y, x1 - x0, color);
}

static inline void ui_vline_clipped(int16_t x, int16_t y, int16_t h, const UIRect* clip, UI_COLOR_T color) {
  if (h <= 0 || x < clip->x || x >= clip->x + clip->w) return;
  int16_t y0 = y > clip->y ? y : clip->y;
  int16_t y1 = y + h < clip->y + clip->h ? y + h : clip->y + clip->h;
  if (y1 <= y0) return;
  ui_display_draw_fast_vline(x, y0, y1 - y0, color);
}

static inline void ui_draw_rect_outline_clipped(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t style, uint8_t width, const UIRect* clip, UI_COLOR_T color) {
  if (style == 0 || width == 0 || w <= 0 || h <= 0) return;
  for (uint8_t b = 0; b < width; b++) {
    int16_t rx = x + b;
    int16_t ry = y + b;
    int16_t rw = w - 2 * b;
    int16_t rh = h - 2 * b;
    if (rw <= 0 || rh <= 0) return;
    if (style == 1) {
      ui_hline_clipped(rx, ry, rw, clip, color);
      ui_hline_clipped(rx, ry + rh - 1, rw, clip, color);
      ui_vline_clipped(rx, ry, rh, clip, color);
      ui_vline_clipped(rx + rw - 1, ry, rh, clip, color);
    } else {
      for (int16_t dx = 0; dx < rw; dx += 8) {
        int16_t seg = (dx + 4 <= rw) ? 4 : (rw - dx);
        ui_hline_clipped(rx + dx, ry, seg, clip, color);
        ui_hline_clipped(rx + dx, ry + rh - 1, seg, clip, color);
      }
      for (int16_t dy = 0; dy < rh; dy += 8) {
        int16_t seg = (dy + 4 <= rh) ? 4 : (rh - dy);
        ui_vline_clipped(rx, ry + dy, seg, clip, color);
        ui_vline_clipped(rx + rw - 1, ry + dy, seg, clip, color);
      }
    }
  }
}

static inline void ui_draw_node_decoration_clipped(uint16_t nodeIdx, int16_t drawY, const UIRect* clip) {
  if (nodeIdx >= __ui_node_count) return;
  if (__ui_nodes[nodeIdx].borderStyle != 0) {
    UI_COLOR_T bColor = __ui_nodes[nodeIdx].borderColor ? __ui_nodes[nodeIdx].borderColor : __ui_nodes[nodeIdx].fg;
    int16_t x = __ui_nodes[nodeIdx].box.x;
    int16_t y = drawY;
    int16_t w = __ui_nodes[nodeIdx].box.w;
    int16_t h = __ui_nodes[nodeIdx].box.h;
    if (__ui_nodes[nodeIdx].borderRadius > 0) {
      if (x >= clip->x && y >= clip->y && x + w <= clip->x + clip->w && y + h <= clip->y + clip->h) {
        ui_draw_node_border(nodeIdx, x, drawY, bColor);
      }
    } else {
      ui_draw_rect_outline_clipped(x, y, w, h,
        __ui_nodes[nodeIdx].borderStyle, __ui_nodes[nodeIdx].borderWidth, clip, bColor);
    }
  }
  if (__ui_nodes[nodeIdx].outlineStyle != 0 && __ui_nodes[nodeIdx].outlineWidth > 0) {
    uint8_t w = __ui_nodes[nodeIdx].outlineWidth;
    int16_t x = __ui_nodes[nodeIdx].box.x - w;
    int16_t y = drawY - w;
    int16_t ow = __ui_nodes[nodeIdx].box.w + 2 * w;
    int16_t oh = __ui_nodes[nodeIdx].box.h + 2 * w;
    if (__ui_nodes[nodeIdx].borderRadius > 0) {
      if (x >= clip->x && y >= clip->y && x + ow <= clip->x + clip->w && y + oh <= clip->y + clip->h) {
        ui_draw_node_outline(nodeIdx, __ui_nodes[nodeIdx].box.x, drawY);
      }
    } else {
      ui_draw_rect_outline_clipped(x, y, ow, oh,
        __ui_nodes[nodeIdx].outlineStyle, w, clip, __ui_nodes[nodeIdx].outlineColor);
    }
  }
}

static inline void ui_clear_node_paint_rect(uint16_t nodeIdx, const UIRect* paintRect) {
  if (nodeIdx >= __ui_node_count || !paintRect || paintRect->w <= 0 || paintRect->h <= 0) return;
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  UIRect r = *paintRect;
  if (__ui_fb) ui_display_set_target((CuttlefishDisplayTarget*)__ui_fb);
  else ui_display_use_default_target();
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[scrollParent].box.x,
      __ui_nodes[scrollParent].box.y,
      __ui_nodes[scrollParent].box.w,
      __ui_nodes[scrollParent].box.h
    };
    UIRect clipped = r;
    if (!ui_clip_rect_to_rect(&clipped, &clip)) return;
    if (ui_repair_current_node_paint_with_parent(nodeIdx, &clipped)) return;
    ui_fill_rect_clipped(clipped.x, clipped.y, clipped.w, clipped.h, &clip, ui_parent_clear_color(nodeIdx));
    uint16_t p = __ui_nodes[nodeIdx].parent;
    if (p != UI_NO_PARENT && p < __ui_node_count) {
      ui_draw_node_decoration_clipped(p, ui_draw_y_for_node(p), &clip);
    }
    return;
  }
  if (ui_is_rect_clipped_by_scroll(nodeIdx, r.x, r.y, r.w, r.h)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, ui_parent_clear_color(nodeIdx));
  uint16_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    int16_t parentDrawY = ui_draw_y_for_node(p);
    if (__ui_nodes[p].borderStyle != 0) {
      UI_COLOR_T bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
      ui_draw_node_border(p, ui_draw_x_for_node(p), parentDrawY, bColor);
    }
    ui_draw_node_outline(p, ui_draw_x_for_node(p), parentDrawY);
  }
}

static inline void ui_clear_current_node_paint(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  uint16_t tw = 0;
  uint16_t th = 0;
  uint16_t textMaxW = ui_node_text_max_width(nodeIdx);
  ui_node_text_layout_metrics(nodeIdx, textMaxW, &tw, &th);
  if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) tw += 22;
  int16_t baseDrawX = ui_base_draw_x_for_node(nodeIdx);
  int16_t baseDrawY = ui_base_draw_y_for_node(nodeIdx);
  int16_t drawX = ui_draw_x_for_node(nodeIdx);
  int16_t drawY = ui_draw_y_for_node(nodeIdx);
  UIRect r;
  ui_node_paint_rect(nodeIdx, baseDrawX, baseDrawY, drawX, drawY, tw, th, &r);
  ui_clear_node_paint_rect(nodeIdx, &r);
}

static inline uint8_t ui_try_repair_geometry_fill(uint16_t nodeIdx, const UIRect* oldRect) {
  if (nodeIdx >= __ui_node_count || !oldRect || oldRect->w <= 0 || oldRect->h <= 0) return 0;
  if (__ui_nodes[nodeIdx].kind != NODE_FILL) return 0;
  if (!__ui_nodes[nodeIdx].hasBg) return 0;
  if (__ui_nodes[nodeIdx].gradientEnabled != 0) return 0;
  // borderRadius is NOT a bail-out: rounded fills (pill badges, keyframe
  // boxes) repair through the same union bitmap — the corner arcs draw into
  // the seeded backdrop. Rejecting them forced every geometry keyframe on a
  // rounded box onto the direct clear→redraw fallback, which tears on SPI
  // TFTs at animation frame rate. Border/outline/shadow chrome still bails:
  // the repair body below doesn't render it.
  if (__ui_nodes[nodeIdx].borderStyle != 0 ||
      __ui_nodes[nodeIdx].outlineStyle != 0 ||
      __ui_nodes[nodeIdx].shadowCount != 0) return 0;

  UIRect newRect;
  ui_node_current_paint_rect(nodeIdx, &newRect);
  if (newRect.w <= 0 || newRect.h <= 0) return 0;
  int16_t x0 = oldRect->x < newRect.x ? oldRect->x : newRect.x;
  int16_t y0 = oldRect->y < newRect.y ? oldRect->y : newRect.y;
  int16_t x1 = oldRect->x + oldRect->w > newRect.x + newRect.w ? oldRect->x + oldRect->w : newRect.x + newRect.w;
  int16_t y1 = oldRect->y + oldRect->h > newRect.y + newRect.h ? oldRect->y + oldRect->h : newRect.y + newRect.h;
  UIRect repair = { x0, y0, static_cast<int16_t>(x1 - x0), static_cast<int16_t>(y1 - y0) };
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[scrollParent].box.x,
      __ui_nodes[scrollParent].box.y,
      __ui_nodes[scrollParent].box.w,
      __ui_nodes[scrollParent].box.h
    };
    if (!ui_clip_rect_to_rect(&repair, &clip)) {
      ui_invalidate_scroll_canvas_for_node(nodeIdx);
      return 1;
    }
  } else if (ui_is_rect_clipped_by_scroll(nodeIdx, repair.x, repair.y, repair.w, repair.h)) {
    return 0;
  }
  if (repair.w <= 0 || repair.h <= 0) return 0;
  if (static_cast<uint32_t>(repair.w) * static_cast<uint32_t>(repair.h) > UI_MAX_BUFFERED_PAINT_PIXELS) return 0;
  CuttlefishCanvas16* repairCanvas = ui_get_repair_canvas(repair.w, repair.h);
  if (!repairCanvas) return 0;

  ui_seed_paint_canvas_for_node(nodeIdx, repairCanvas, repair.x, repair.y, 0);
  CuttlefishDisplayTarget* previousGfx = ui_display_get_target();
  ui_display_set_target(repairCanvas);
  UI_COLOR_T fillBg = __ui_nodes[nodeIdx].bg;
  if (__ui_nodes[nodeIdx].opacity < 100) {
    fillBg = ui_blend(__ui_nodes[nodeIdx].bg, ui_parent_clear_color(nodeIdx), __ui_nodes[nodeIdx].opacity);
  }
  int16_t drawX = ui_draw_x_for_node(nodeIdx) - repair.x;
  int16_t drawY = ui_draw_y_for_node(nodeIdx) - repair.y;
  int16_t fillW = ui_rotated_face_w(nodeIdx, __ui_nodes[nodeIdx].box.w, __ui_nodes[nodeIdx].box.h);
  int16_t fillH = ui_rotated_face_h(nodeIdx, __ui_nodes[nodeIdx].box.w, __ui_nodes[nodeIdx].box.h);
  if (__ui_nodes[nodeIdx].borderRadius > 0) {
    ui_display_fill_round_rect(drawX, drawY, fillW, fillH,
      __ui_nodes[nodeIdx].borderRadius, fillBg);
  } else {
    ui_display_fill_rect(drawX, drawY, fillW, fillH, fillBg);
  }
  ui_display_set_target(previousGfx);
  // Keep geometry repair off the physical panel when a retained framebuffer is
  // active; the final dirty-bounds publish will send the old+new union once.
  if (__ui_fb) ui_display_set_target((CuttlefishDisplayTarget*)__ui_fb);
  else ui_display_use_default_target();
  ui_push_canvas_rect(repairCanvas, repair.x, repair.y, repair.w, repair.h);
  ui_display_use_default_target();
  if (scrollParent >= 0) ui_invalidate_scroll_canvas_for_node(nodeIdx);
  ui_mark_overlapping_higher_layers_dirty_for_rect(nodeIdx, &repair);
  return 1;
}

static inline void ui_clear_subtree_current_paint(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  UIRect r;
  if (!ui_subtree_current_paint_rect(nodeIdx, &r)) return;
  ui_display_use_default_target();
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[scrollParent].box.x,
      __ui_nodes[scrollParent].box.y,
      __ui_nodes[scrollParent].box.w,
      __ui_nodes[scrollParent].box.h
    };
    UIRect clipped = r;
    if (!ui_clip_rect_to_rect(&clipped, &clip)) return;
    if (ui_repair_current_node_paint_with_parent(nodeIdx, &clipped)) return;
    ui_fill_rect_clipped(clipped.x, clipped.y, clipped.w, clipped.h, &clip, ui_parent_clear_color(nodeIdx));
    uint16_t p = __ui_nodes[nodeIdx].parent;
    if (p != UI_NO_PARENT && p < __ui_node_count) {
      ui_draw_node_decoration_clipped(p, ui_draw_y_for_node(p), &clip);
    }
    return;
  }
  if (ui_repair_current_node_paint_with_parent(nodeIdx, &r)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, ui_parent_clear_color(nodeIdx));
  uint16_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    int16_t parentDrawY = ui_draw_y_for_node(p);
    if (__ui_nodes[p].borderStyle != 0) {
      UI_COLOR_T bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
      ui_draw_node_border(p, ui_draw_x_for_node(p), parentDrawY, bColor);
    }
    ui_draw_node_outline(p, ui_draw_x_for_node(p), parentDrawY);
  }
}

// ── Visibility reflow ──────────────────────────────────────────────────────
// Layout runs at build time (yoga); a hidden subtree keeps its baked boxes,
// so toggling the visible flag alone leaves a collapsed pane's space
// reserved (an accordion card sized for its open state shows empty space
// when closed). When a node's visibility changes, the runtime re-stacks each
// ancestor flow container's in-flow children along the emitted axis
// (flowAxis/flowGap/flowFlags metadata) and re-sizes content-sized
// containers, cascading upward until a container stops changing. Preview
// parity: the preview's layout engine excludes hidden nodes from flow on
// every frame.

// Outer extent of c's subtree along the flow axis, relative to c's own
// origin. Descendants positioned above c's origin (overlays) don't count.
static int16_t ui_subtree_flow_extent(uint16_t c, uint8_t axis) {
  int16_t base = axis == 1 ? __ui_nodes[c].box.y : __ui_nodes[c].box.x;
  int16_t maxEnd = static_cast<int16_t>(base + (axis == 1 ? __ui_nodes[c].box.h : __ui_nodes[c].box.w));
  uint16_t end = __ui_nodes[c].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t j = c + 1; j < end; j++) {
    int16_t off = axis == 1 ? __ui_nodes[j].box.y : __ui_nodes[j].box.x;
    int16_t rel = static_cast<int16_t>(off - base);
    if (rel < 0) continue;
    int16_t jEnd = static_cast<int16_t>(rel + (axis == 1 ? __ui_nodes[j].box.h : __ui_nodes[j].box.w));
    if (jEnd > maxEnd) maxEnd = jEnd;
  }
  return static_cast<int16_t>(maxEnd - base);
}

static void ui_shift_subtree_main(uint16_t c, uint8_t axis, int16_t delta) {
  uint16_t end = __ui_nodes[c].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t j = c; j < end; j++) {
    if (axis == 1) __ui_nodes[j].box.y = static_cast<int16_t>(__ui_nodes[j].box.y + delta);
    else __ui_nodes[j].box.x = static_cast<int16_t>(__ui_nodes[j].box.x + delta);
  }
}

// Re-stack p's in-flow children from the first in-flow child's slot (hidden
// children take no space). Returns 1 when a child moved or p's content-sized
// main dimension changed.
static uint8_t ui_restack_flow_container(uint16_t p) {
  if (p >= __ui_node_count) return 0;
  uint8_t axis = __ui_nodes[p].flowAxis == 2 ? 2U : (__ui_nodes[p].flowAxis == 1 ? 1U : 0U);
  if (axis == 0) return 0;
  int16_t gap = static_cast<int16_t>(__ui_nodes[p].flowGap);
  int16_t startSlot = 0;
  int16_t cursor = 0;
  uint8_t sawFlowChild = 0;
  uint8_t sawVisibleChild = 0;
  uint8_t changed = 0;
  uint16_t end = __ui_nodes[p].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t c = p + 1; c < end; c++) {
    if (__ui_nodes[c].parent != p) continue;
    if ((__ui_nodes[c].flowFlags & 0x4U) != 0U) continue;  // out-of-flow child
    int16_t rel = axis == 1
      ? static_cast<int16_t>(__ui_nodes[c].box.y - __ui_nodes[p].box.y)
      : static_cast<int16_t>(__ui_nodes[c].box.x - __ui_nodes[p].box.x);
    // The first in-flow child's slot anchors the stack (padding + its
    // margins); a hidden first child must not drag the anchor down.
    if (sawFlowChild == 0U) { startSlot = rel; sawFlowChild = 1; }
    if (!ui_is_effectively_visible(c)) continue;  // collapsed: takes no space
    if (sawVisibleChild == 0U) { cursor = startSlot; sawVisibleChild = 1; }
    int16_t shift = static_cast<int16_t>(cursor - rel);
    if (shift != 0) {
      ui_shift_subtree_main(c, axis, shift);
      changed = 1;
    }
    cursor = static_cast<int16_t>(cursor + ui_subtree_flow_extent(c, axis) + gap);
  }
  if (sawVisibleChild == 0U) return changed;
  // A content-sized main dimension follows the stack: children's offsets
  // already include the leading padding; trailing padding completes the box.
  uint8_t autoMain = axis == 1
    ? static_cast<uint8_t>(__ui_nodes[p].flowFlags & 0x1U)
    : static_cast<uint8_t>(__ui_nodes[p].flowFlags & 0x2U);
  if (autoMain != 0U) {
    int16_t contentEnd = static_cast<int16_t>(cursor - gap);
    int16_t padMain = axis == 1
      ? static_cast<int16_t>(__ui_nodes[p].paddingBottom)
      : static_cast<int16_t>(__ui_nodes[p].paddingRight);
    int16_t newSize = static_cast<int16_t>(contentEnd + padMain);
    if (newSize < 1) newSize = 1;
    int16_t curSize = axis == 1 ? static_cast<int16_t>(__ui_nodes[p].box.h) : static_cast<int16_t>(__ui_nodes[p].box.w);
    if (newSize != curSize) {
      if (axis == 1) __ui_nodes[p].box.h = newSize;
      else __ui_nodes[p].box.w = newSize;
      changed = 1;
    }
  }
  return changed;
}

// Recompute a scrollable container's contentHeight over its visible subtree
// (mirrors the build-time computation), clamp the scroll offset, and force
// the next paint to reseed the container canvas.
static void ui_reflow_scroll_content(uint16_t p) {
  if (!__ui_nodes[p].scrollable || __ui_nodes[p].virtualized) return;
  int16_t maxBottom = static_cast<int16_t>(__ui_nodes[p].box.y);
  uint16_t end = __ui_nodes[p].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t j = p + 1; j < end; j++) {
    if (!ui_is_effectively_visible(j)) continue;
    int16_t bottom = static_cast<int16_t>(__ui_nodes[j].box.y + __ui_nodes[j].box.h);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  int16_t ch = static_cast<int16_t>(maxBottom - __ui_nodes[p].box.y);
  if (ch < static_cast<int16_t>(__ui_nodes[p].box.h)) ch = static_cast<int16_t>(__ui_nodes[p].box.h);
  __ui_nodes[p].contentHeight = ch;
  int16_t maxScroll = static_cast<int16_t>(ch - __ui_nodes[p].box.h);
  if (maxScroll < 0) maxScroll = 0;
  if (__ui_nodes[p].scrollY > maxScroll) __ui_nodes[p].scrollY = maxScroll;
  __ui_nodes[p].lastPaintedScrollY = static_cast<int16_t>(
    __ui_nodes[p].scrollY - (__ui_nodes[p].box.h > 0 ? __ui_nodes[p].box.h : 1));
}

// Called after a node's visible flag changed: re-stack ancestor flow
// containers bottom-up, then repaint the active screen once.
static void ui_reflow_visibility(uint16_t changedNode) {
  if (changedNode >= __ui_node_count) return;
  uint8_t anyChange = 0;
  uint16_t p = __ui_nodes[changedNode].parent;
  uint16_t guard = 0;
  while (p != UI_NO_PARENT && p < __ui_node_count && guard < 64U) {
    guard++;
    uint8_t changedHere = ui_restack_flow_container(p);
    ui_reflow_scroll_content(p);
    if (changedHere == 0U) break;  // nothing moved and the size held: ancestors unaffected
    anyChange = 1;
    p = __ui_nodes[p].parent;
  }
  if (anyChange == 0U) return;
  // One full active-screen repaint — the same contract as navigation; a
  // visibility collapse is a discrete user event, not an animation.
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    __ui_nodes[i].dirty = 1;
    __ui_nodes[i].lastTextHeight = 0;
  }
}

static inline void ui_set_visible(uint16_t nodeIdx, uint8_t visible) {
  if (nodeIdx >= __ui_node_count) return;
  visible = visible ? 1 : 0;
  if (__ui_nodes[nodeIdx].visible == visible) return;

  if (!visible) {
    // Clear the whole subtree in one clipped repair. This removes child pixels
    // even when the container itself is transparent, without separate display
    // writes for each descendant.
    UIRect subtreeRect;
    uint8_t hasSubtreeRect = ui_subtree_current_paint_rect(nodeIdx, &subtreeRect);
    ui_clear_subtree_current_paint(nodeIdx);
    int16_t end = __ui_nodes[nodeIdx].subtreeEnd;
    if (end > __ui_node_count) end = __ui_node_count;
    for (int16_t c = end - 1; c >= static_cast<int16_t>(nodeIdx); c--) {
      if (__ui_nodes[c].screenId != __ui_active_screen) continue;
      __ui_nodes[c].dirty = 0;
    }
    if (hasSubtreeRect) ui_mark_overlapping_higher_layers_dirty_for_rect(nodeIdx, &subtreeRect);
    __ui_nodes[nodeIdx].visible = 0;
    ui_reflow_visibility(nodeIdx);
    return;
  }

  __ui_nodes[nodeIdx].visible = 1;
  int16_t end = __ui_nodes[nodeIdx].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t c = nodeIdx; c < end; c++) {
    if (__ui_nodes[c].screenId == __ui_active_screen && ui_is_effectively_visible(c)) {
      __ui_nodes[c].dirty = 1;
      ui_mark_overlapping_higher_layers_dirty(c);
    }
  }
  ui_reflow_visibility(nodeIdx);
}
`;
}
