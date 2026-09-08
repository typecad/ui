// Slice of the C++ runtime header (original source lines 1449-1547).
// Canvas push/draw helpers, buffered scroll canvas push, scrollbar direct.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitCanvasScrollbar(): string {
  return `
static inline void ui_push_canvas_rect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  UI_COLOR_T* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  // The canvas is viewport-sized: buffer row 0 = the first row of the viewport.
  // The display destination is (x, y) but the source buffer starts at (0, 0).
  // When a full-screen framebuffer is the active draw target, composite into it
  // via __ui_gfx (so the single bulk push at frame end captures everything).
  // Otherwise write straight to the display in one SPI transaction.
  if (__ui_fb) {
    // The framebuffer is the composition target. Track this publish so a
    // geometry repair or scroll-canvas repair that does not leave a node dirty
    // still reaches the panel during the frame-end flush.
    ui_fb_add_rect(x, y, w, h);
    if (w == stride) {
      ui_display_draw_rgb_bitmap(x, y, pixels, w, h);
      return;
    }
    for (int16_t row = 0; row < h; row++) {
      ui_display_draw_rgb_bitmap(x, y + row, pixels + static_cast<int32_t>(row) * stride, w, 1);
    }
    return;
  }
  display_startWrite();
  display_setAddrWindow(x, y, w, h);
  if (w == stride) {
    // Full-width: contiguous in buffer, single write.
    display_writePixels(pixels, static_cast<uint32_t>(w) * h);
    display_endWrite();
    return;
  }
  for (int16_t row = 0; row < h; row++) {
    display_writePixels(pixels + static_cast<int32_t>(row) * stride, w);
  }
  display_endWrite();
}

static inline void ui_draw_canvas_rect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  UI_COLOR_T* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  if (w == stride && h == display_canvasHeight(canvas)) {
    ui_display_draw_rgb_bitmap(x, y, pixels, w, h);
    return;
  }
  for (int16_t row = 0; row < h; row++) {
    ui_display_draw_rgb_bitmap(x, y + row, pixels + static_cast<int32_t>(row) * stride, w, 1);
  }
}

static inline void ui_push_buffered_scroll_canvas(CuttlefishCanvas16* bufferedScrollCanvas,
                                                  CuttlefishCanvas16* bufferedScrollRepaintCanvas,
                                                  int16_t bufferedScrollNode,
                                                  int16_t bufferedScrollVX,
                                                  int16_t bufferedScrollVY,
                                                  int16_t bufferedScrollRepaintY,
                                                  int16_t bufferedScrollRepaintH,
                                                  CuttlefishDisplayTarget* drawTarget) {
  if (bufferedScrollNode < 0 || !bufferedScrollCanvas || !display_canvasBuffer(bufferedScrollCanvas)) return;
  // Draw scrollbar into the canvas (canvas-local coords: 0,0 = viewport top-left).
  ui_display_set_target(bufferedScrollCanvas);
  int16_t si = bufferedScrollNode;
  int16_t vw = __ui_nodes[si].box.w;
  int16_t vh = __ui_nodes[si].box.h;
  if (bufferedScrollRepaintCanvas && bufferedScrollRepaintH > 0) {
    ui_draw_canvas_rect(bufferedScrollRepaintCanvas, 0, bufferedScrollRepaintY, vw, bufferedScrollRepaintH);
  }
  int16_t tx = vw - 4;
  uint16_t thumbH = static_cast<uint32_t>(vh) * vh / __ui_nodes[si].contentHeight;
  if (thumbH < 8) thumbH = 8;
  // Clamp to vh so (vh - thumbH) below can't underflow on a degenerate sub-8px
  // viewport (which would cast a negative value to a huge uint32_t and place the
  // thumb off-screen). Matches the guard in ui_render_scroll_bands.
  if (thumbH > static_cast<uint16_t>(vh)) thumbH = static_cast<uint16_t>(vh);
  int16_t maxScroll = __ui_nodes[si].contentHeight - vh;
  uint16_t thumbY = static_cast<uint32_t>(vh - thumbH) * __ui_nodes[si].scrollY / (maxScroll > 0 ? maxScroll : 1);
  UI_COLOR_T dimFg = (UI_COLOR_T)((__ui_nodes[si].fg >> 1) & UI_DIM_MASK);
  // Track covers the FULL reserved gutter (4px) so child decorations that
  // poke past the content area (e.g. outset shadows, offset up to +6px)
  // can't leave 1px ticks in the uncovered edge column. Thumb stays 3px.
  ui_display_fill_rect(tx, 0, 4, vh, dimFg);
  ui_display_fill_rect(tx, thumbY, 3, thumbH, __ui_nodes[si].fg);
  // Record the scrollY this canvas now reflects, so the next scroll frame can
  // compute its shift delta (Mode B) from scrollY - lastPaintedScrollY.
  __ui_nodes[si].lastPaintedScrollY = __ui_nodes[si].scrollY;
  // Push the canvas to the draw target at the viewport position (the
  // framebuffer when active, else the display directly).
  ui_display_set_target(drawTarget);
  ui_push_canvas_rect(bufferedScrollCanvas,
    bufferedScrollVX, bufferedScrollVY,
    vw, vh);
}

// Draw a scroll container's scrollbar directly on the display (Mode C).
static inline void ui_draw_scrollbar_direct(int16_t si, int16_t vox, int16_t voy) {
  if (si < 0 || si >= static_cast<int16_t>(__ui_node_count)) return;
  int16_t vw = __ui_nodes[si].box.w;
  int16_t vh = __ui_nodes[si].box.h;
  if (__ui_nodes[si].contentHeight <= vh) return;
  int16_t tx = vox + vw - 4;
  uint16_t thumbH = static_cast<uint32_t>(vh) * vh / __ui_nodes[si].contentHeight;
  if (thumbH < 8) thumbH = 8;
  // Clamp to vh so (vh - thumbH) below can't underflow on a degenerate sub-8px
  // viewport (which would cast a negative value to a huge uint32_t and place the
  // thumb off-screen). Matches the guard in ui_render_scroll_bands.
  if (thumbH > static_cast<uint16_t>(vh)) thumbH = static_cast<uint16_t>(vh);
  int16_t maxScroll = __ui_nodes[si].contentHeight - vh;
  uint16_t thumbY = static_cast<uint32_t>(vh - thumbH) * __ui_nodes[si].scrollY / (maxScroll > 0 ? maxScroll : 1);
  UI_COLOR_T dimFg = (UI_COLOR_T)((__ui_nodes[si].fg >> 1) & UI_DIM_MASK);
  // Full 4px gutter track (see the Mode B variant above).
  ui_display_fill_rect(tx, voy, 4, vh, dimFg);
  ui_display_fill_rect(tx, static_cast<int16_t>(voy + thumbY), 3, thumbH, __ui_nodes[si].fg);
}

// Per-node dirty marker (called by press handlers and binding evaluation).`;
}
