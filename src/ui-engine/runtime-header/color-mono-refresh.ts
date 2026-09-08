// Slice of the C++ runtime header (original source lines 304-451).
// lerp/blend fwd-decls, color-depth selection, mono snap, per-frame refresh dispatch.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitColorMonoRefresh(): string {
  return `

// ── Color depth → blend/lerp selection ───────────────────────────────────────
// UI_COLOR_DEPTH is emitted by the UI emitter from the display profile's
// colorFormat (565 for TFT byte-identity, 888 for rgb666+). The value depth
// and the blend math MUST switch together: on 565, node fields hold 565 values
// and ui_blend565 is correct; on 888, node fields hold 888 values and
// ui_blend888 is correct. Forward-declare the four functions and define the
// ui_blend/UI_LERP_COLOR macros here (before any call site) so they resolve
// everywhere; the function bodies are defined later in this header.
#ifndef UI_COLOR_DEPTH
#define UI_COLOR_DEPTH 565
#endif
// Color value type tracks the depth: 888 holds 24-bit RGB (R<<16|G<<8|B),
// 565 holds 16-bit. Draw wrappers and locals use UI_COLOR_T so 888 is not
// narrowed before reaching the HAL. Under 565/mono this is uint16_t and the
// emitted code is byte-identical with the pre-widening runtime.
#if UI_COLOR_DEPTH == 888
  #ifndef UI_COLOR_T
    #define UI_COLOR_T uint32_t
  #endif
  #ifndef UI_DIM_MASK
    #define UI_DIM_MASK 0x7F7F7Fu   // halve each 8-bit channel independently
  #endif
#else
  #ifndef UI_COLOR_T
    #define UI_COLOR_T uint16_t
  #endif
  #ifndef UI_DIM_MASK
    #define UI_DIM_MASK 0x7BEFu     // 565 dim mask (top bit clear per channel)
  #endif
#endif
static inline uint16_t ui_blend565(uint16_t fg, uint16_t bg, uint8_t opacity);
static inline uint32_t ui_blend888(uint32_t fg, uint32_t bg, uint8_t opacity);
static inline uint16_t lerp_color(uint16_t a, uint16_t b, uint8_t k100);
static inline uint32_t lerp_color_888(uint32_t a, uint32_t b, uint8_t k100);
#if UI_COLOR_DEPTH == 888
  #define ui_blend(fg, bg, op)        ui_blend888(static_cast<uint32_t>(fg), static_cast<uint32_t>(bg), (op))
  #define UI_LERP_COLOR(a, b, k)      lerp_color_888(static_cast<uint32_t>(a), static_cast<uint32_t>(b), (k))
#else
  #define ui_blend(fg, bg, op)        ui_blend565(static_cast<uint16_t>(fg), static_cast<uint16_t>(bg), (op))
  #define UI_LERP_COLOR(a, b, k)      lerp_color(static_cast<uint16_t>(a), static_cast<uint16_t>(b), (k))
#endif

// ── 1-bit mono snap (UI_NATIVE_MONO) ─────────────────────────────────────────
// On a B&W e-ink panel, any color value must resolve to black or white. Node
// fields are pre-snapped at transpile, but blended/lerped runtime values
// (opacity, shadows, gradients) need a defensive snap in the draw path. The
// macro is a no-op on color targets so TFT output is byte-identical.
#ifdef UI_NATIVE_MONO
// Snap an RGB888 value to 1-bit mono (white/black) by luminance.
static inline uint32_t ui_snap_mono(uint32_t c) {
  uint8_t r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  // Match the transpile-time toMono threshold: (0.299r + 0.587g + 0.114b)/255 >= 0.27.
  // Integer form: 299r+587g+114b >= 68850 (= 0.27*255*1000). Verified 0 mismatches.
  return (static_cast<uint32_t>(299 * r + 587 * g + 114 * b) >= 68850u) ? 0xffffffu : 0x000000u;
}
// Snap an RGB565 value to 1-bit mono. Mono panels run at UI_COLOR_DEPTH 565, so
// node fields hold 565 values; reconstruct 8-bit channels then apply the threshold.
// Pre-snapped values (0x0000/0x0001/0xffff) pass through directly — the
// transpiler resolves #ffffff/#000000 to 0x0001/0x0000 on mono targets.
static inline uint16_t ui_snap_mono565(uint16_t c) {
  if (c == 0x0000u) return 0x0000u;
  if (c == 0x0001u || c == 0xffffu) return 0xffffu;
  uint8_t r5 = (c >> 11) & 0x1f, g6 = (c >> 5) & 0x3f, b5 = c & 0x1f;
  uint8_t r = (r5 << 3) | (r5 >> 2), g = (g6 << 2) | (g6 >> 4), b = (b5 << 3) | (b5 >> 2);
  return (static_cast<uint32_t>(299 * r + 587 * g + 114 * b) >= 68850u) ? 0xffffu : 0x0000u;
}
#define UI_MAYBE_SNAP_MONO(c)    (ui_snap_mono(static_cast<uint32_t>(c)))
#define UI_MAYBE_SNAP_MONO565(c) (ui_snap_mono565(static_cast<uint16_t>(c)))
#else
#define UI_MAYBE_SNAP_MONO(c)    (c)
#define UI_MAYBE_SNAP_MONO565(c) (c)
#endif

// ── Per-frame refresh dispatch ──────────────────────────────────────────────
// Three mutually-exclusive compile-time paths, in priority order:
//   1. UI_REQUIRES_BACKING_STORE (e-ink): dirty-rect accumulator + partial refresh.
//   2. UI_BATCH_SPI_WRITES (TFT immediate): one startWrite/endWrite per frame.
//   3. default (SDL native host): no-ops.
// Exactly one branch ever compiles — the emitter's guards ensure the first two
// are never both defined (UI_REQUIRES_BACKING_STORE ⟹ requiresBackingStore,
// UI_BATCH_SPI_WRITES ⟹ immediate && !requiresBackingStore).
#if defined(UI_REQUIRES_BACKING_STORE)
  // e-ink / deferred-partial: dirty-rect accumulator. Each painted node reports
  // its paint rect; at frame end the union is refreshed as one partial update
  // via display_partial_refresh.
  #define UI_REFRESH_MAX_RECTS 16
  struct UIRect16 { int16_t x, y, w, h; };
  static UIRect16 __ui_refresh_rects[UI_REFRESH_MAX_RECTS];
  static uint8_t __ui_refresh_rect_n = 0;
  static inline void ui_refresh_begin_frame() { __ui_refresh_rect_n = 0; }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) {
    if (w <= 0 || h <= 0) return;
    if (__ui_refresh_rect_n < UI_REFRESH_MAX_RECTS) {
      __ui_refresh_rects[__ui_refresh_rect_n].x = x;
      __ui_refresh_rects[__ui_refresh_rect_n].y = y;
      __ui_refresh_rects[__ui_refresh_rect_n].w = w;
      __ui_refresh_rects[__ui_refresh_rect_n].h = h;
      __ui_refresh_rect_n++;
    }
    // TODO Phase 5: coalesce overlapping rects into a tighter union; cap by
    // refresh budget; trigger a periodic full refresh for ghost clearing.
  }
  // Union all accumulated rects and issue one partial refresh of the bounding
  // region via the shim's display_partial_refresh entry point.
  static inline void ui_refresh_flush() {
    if (__ui_refresh_rect_n == 0) return;
    int16_t x0 = 32767, y0 = 32767, x1 = -32768, y1 = -32768;
    for (uint8_t i = 0; i < __ui_refresh_rect_n; i++) {
      const UIRect16& r = __ui_refresh_rects[i];
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      int16_t rx1 = static_cast<int16_t>(r.x + r.w), ry1 = static_cast<int16_t>(r.y + r.h);
      if (rx1 > x1) x1 = rx1;
      if (ry1 > y1) y1 = ry1;
    }
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > display_width()) x1 = display_width();
    if (y1 > display_height()) y1 = display_height();
    if (x1 > x0 && y1 > y0) {
      display_partial_refresh(x0, y0, static_cast<int16_t>(x1 - x0), static_cast<int16_t>(y1 - y0));
    }
  }
#elif defined(UI_BATCH_SPI_WRITES)
  // TFT immediate-refresh batching (CURRENTLY UNUSED — see note below).
  // Wraps the frame's draws in ONE SPI transaction so all per-node writes share
  // a single CS-asserted burst. add_rect is a no-op: TFT has no partial-refresh
  // concept; the per-node draws already target the right pixels.
  //
  // NOTE: this branch is left in place but the emitter does NOT define
  // UI_BATCH_SPI_WRITES by default. The design assumed Adafruit_SPITFT's
  // startWrite/endWrite are reference-counted (nested calls = no-op for CS),
  // but the Adafruit_GFX version in this repo is NOT — every endWrite raises
  // CS unconditionally. So an outer frame startWrite gets closed by the first
  // inner draw's endWrite → black screen. Re-enable only after either (a)
  // upgrading to a ref-counted Adafruit_GFX or (b) adding a runtime flag the
  // inner draw primitives check to skip their own startWrite/endWrite.
  // See docs/superpowers/specs/2026-07-06-tft-spi-write-batching-design.md.
  static inline void ui_refresh_begin_frame() { display_startWrite(); }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) { (void)x; (void)y; (void)w; (void)h; }
  static inline void ui_refresh_flush() { display_endWrite(); }
#else
  // No batching (e.g. SDL native host render): true no-ops.
  #define ui_refresh_begin_frame()  ((void)0)
  #define ui_refresh_add_rect(x, y, w, h) ((void)0)
  #define ui_refresh_flush()        ((void)0)
#endif`;
}
