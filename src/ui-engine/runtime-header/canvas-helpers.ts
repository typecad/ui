// Slice of the C++ runtime header (original source lines 753-901).
// Persistent canvas release/create/get/shift/repair helpers.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitCanvasHelpers(): string {
  return `
// heap. Called from ui_navigate. Safe with null pointers.
static inline void ui_release_canvas_state() {
  display_deleteCanvas(__ui_container_canvas); __ui_container_canvas = nullptr;
  display_deleteCanvas(__ui_list_canvas);      __ui_list_canvas = nullptr;
  __ui_list_canvas_node = -1;
  display_deleteCanvas(__ui_node_canvas);      __ui_node_canvas = nullptr;
  display_deleteCanvas(__ui_repair_canvas);    __ui_repair_canvas = nullptr;
  display_deleteCanvas(__ui_band_canvas);      __ui_band_canvas = nullptr;
  display_deleteCanvas(__ui_kb_canvas);        __ui_kb_canvas = nullptr;
}

// Lazily allocate/reuse a viewport-sized canvas for a scroll container. Resizes
// when the container's box changes; returns null if allocation fails (caller
// falls back to Mode C direct redraw). Only used on full render tiers.
// Prefers PSRAM when available (ESP32 + BOARD_HAS_PSRAM + psramFound) so large
// viewport canvases (e.g. 116KB+ for a full-width scroll region on a 480x320
// panel) don't exhaust internal SRAM. Falls back to internal SRAM otherwise.
static inline CuttlefishCanvas16* ui_create_canvas_best(int16_t w, int16_t h) {
#if defined(ESP32) && defined(BOARD_HAS_PSRAM)
  if (psramFound()) {
    CuttlefishCanvas16* c = display_createCanvasPsram(w, h);
    if (c && display_canvasBuffer(c)) {
      static uint8_t psram_logged = 0;
      if (!psram_logged) {
        psram_logged = 1;
#if defined(ESP32) && defined(ARDUINO)
        Serial.printf("[psram] canvas %dx%d allocated in PSRAM (free=%u)\\n", w, h, ESP.getFreePsram());
#else
        printf("[psram] canvas %dx%d allocated in PSRAM\\n", w, h);
#endif
      }
      return c;
    }
    // Object allocated but its pixel buffer failed — free the object before
    // falling through to SRAM so it isn't leaked.
    display_deleteCanvas(c);
    // PSRAM allocation failed (rare — fragmented PSRAM) → fall through to SRAM.
  }
#endif
  return display_createCanvas(w, h);
}

static inline CuttlefishCanvas16* ui_get_container_canvas(int16_t w, int16_t h) {
  // Intentionally returns nullptr: scroll containers always use the band
  // renderer (ui_render_scroll_bands), not the Mode B viewport canvas.
  // Mode B holds the whole viewport in one large canvas and pushes it in a
  // single transaction every frame — on SPI TFTs that full-viewport push
  // (especially from PSRAM) visibly flashes on child state changes like a
  // button press. The band renderer composites into a small ~10KB SRAM canvas
  // strip-by-strip, pushing each band only after it's complete — tear-free and
  // flash-free regardless of target memory. PSRAM still benefits the other
  // canvases (list, keyboard, repair); only the scroll viewport deliberately
  // bypasses it for visual quality.
  (void)w; (void)h;
  return nullptr;
}

// Shift the canvas buffer vertically by deltaY (cheap memmove of existing
// pixels), then fill the exposed band with bg. Reports the exposed band via
// *exposedY/*exposedH so the caller can redraw only that strip (Mode B).
static inline void ui_shift_container_canvas(CuttlefishCanvas16* canvas, int16_t deltaY, UI_COLOR_T bg,
                                             int16_t* exposedY, int16_t* exposedH) {
  if (exposedY) *exposedY = 0;
  if (exposedH) *exposedH = 0;
  if (!canvas || !display_canvasBuffer(canvas)) return;
  int16_t w = display_canvasWidth(canvas);
  int16_t h = display_canvasHeight(canvas);
  int16_t shift = deltaY < 0 ? -deltaY : deltaY;
  if (shift <= 0 || shift >= h) {
    display_canvasFillScreen(canvas, bg);
    if (exposedY) *exposedY = 0;
    if (exposedH) *exposedH = h;
    return;
  }
  UI_COLOR_T* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  // Reserve the rightmost 4px gutter so the memmove never smears scrollbar
  // pixels; the gutter is repainted separately by ui_draw_scrollbar.
  int16_t contentW = w > 4 ? w - 4 : w;
  // deltaY > 0: scrollY increased → finger moved up → content moves up.
  // Cached rows shift toward LOWER indices; the exposed band is at the BOTTOM.
  // deltaY < 0: content moves down → rows shift toward higher indices; exposed
  // band at the TOP. (Matches the proven pre-rewrite direction.)
  if (deltaY > 0) {
    for (int16_t row = 0; row < h - shift; row++) {
      memmove(pixels + static_cast<int32_t>(row) * stride,
              pixels + static_cast<int32_t>(row + shift) * stride,
              static_cast<size_t>(contentW) * sizeof(UI_COLOR_T));
    }
    if (exposedY) *exposedY = h - shift;
  } else {
    for (int16_t row = h - shift - 1; row >= 0; row--) {
      memmove(pixels + static_cast<int32_t>(row + shift) * stride,
              pixels + static_cast<int32_t>(row) * stride,
              static_cast<size_t>(contentW) * sizeof(UI_COLOR_T));
    }
    if (exposedY) *exposedY = 0;
  }
  int16_t fillY = deltaY > 0 ? h - shift : 0;
  display_canvasFillRect(canvas, 0, fillY, contentW, shift, bg);
  if (w > contentW) {
    display_canvasFillRect(canvas, contentW, 0, w - contentW, h, bg);
  }
  if (exposedH) *exposedH = shift;
}

// Repair canvas: parent-seeded background repaints + exposed-strip redraws.
// Reused across navigations when size matches; reallocated on exact-size
// mismatch (a reused larger canvas would keep its old stride, corrupting the
// pushed pixels — see the inline comment below).
static inline CuttlefishCanvas16* ui_get_repair_canvas(int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return nullptr;
  // Reallocate when size differs at all (not just when growing). A reused
  // larger canvas keeps its old stride, and ui_push_canvas_rect uses that
  // stride for row offsets — a mismatch with the caller's expected (w,h)
  // corrupts the pushed pixels. Exact-size reallocation guarantees stride == w.
  if (!__ui_repair_canvas || !display_canvasBuffer(__ui_repair_canvas) ||
      display_canvasWidth(__ui_repair_canvas) != w ||
      display_canvasHeight(__ui_repair_canvas) != h) {
    display_deleteCanvas(__ui_repair_canvas);
    __ui_repair_canvas = ui_create_canvas_best(w, h);
  }
  return (__ui_repair_canvas && display_canvasBuffer(__ui_repair_canvas))
    ? __ui_repair_canvas : nullptr;
}`;
}
