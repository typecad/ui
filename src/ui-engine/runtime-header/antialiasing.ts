// Slice of the C++ runtime header (original source lines 5299-5433).
// AA subsystem: begin/push/pixel/line/circle/fill.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitAntialiasing(): string {
  return `
  ui_refresh_flush();
}

// ── Antialiasing subsystem (offscreen canvas + coverage blending) ──────────
// Enabled via #define UI_AA 1 (from display profile antialias:true).
// Shapes are rendered to a GFXcanvas16, edges blended via getPixel read-back,
// then pushed to the display. The ILI9341 has no efficient SPI read-back, so
// all blending happens in RAM.
#ifdef UI_AA
#include <math.h>  // fabs, floor, ceil, sqrtf for AA coverage math

// AA is only useful on RAM-backed targets. Direct SPI targets have no safe
// read/modify/write surface for coverage blending; callers still get the
// regular primitive path instead of an allocation plus many tiny pushes.
static inline uint8_t ui_aa_target_is_ram() {
  return !ui_display_is_default_target();
}

// Get (or allocate) a canvas sized to the element being drawn.
static inline CuttlefishCanvas16* ui_aa_begin(int16_t w, int16_t h, UI_COLOR_T bg) {
  if (w <= 0 || h <= 0 || !ui_aa_target_is_ram()) return nullptr;
  if (!__ui_aa_canvas || display_canvasWidth(__ui_aa_canvas) < w || display_canvasHeight(__ui_aa_canvas) < h) {
    display_deleteCanvas(__ui_aa_canvas);
    __ui_aa_canvas = display_createCanvas(w > 0 ? w : 1, h > 0 ? h : 1);
  }
  if (!__ui_aa_canvas || !display_canvasBuffer(__ui_aa_canvas)) return nullptr;
  display_canvasFillScreen(__ui_aa_canvas, bg);
  return __ui_aa_canvas;
 }

// Push the canvas rect to the display at (dx, dy).
static inline void ui_aa_push(CuttlefishCanvas16* c, int16_t dx, int16_t dy) {
  if (!c || !display_canvasBuffer(c)) return;
  int16_t w = display_canvasWidth(c), h = display_canvasHeight(c);
  // Push via __ui_gfx so the AA output goes to the scroll canvas when active,
  // or the display directly when not. Row-by-row drawRGBBitmap (no transparent
  // alpha — the AA canvas already has the blended pixels).
  for (int16_t row = 0; row < h; row++) {
    ui_display_draw_rgb_bitmap(dx, dy + row, display_canvasBuffer(c) + static_cast<int32_t>(row) * w, w, 1);
  }
}

// Blend a pixel at integer coords with a coverage fraction (0-255).
static inline void ui_aa_pixel(CuttlefishCanvas16* c, int16_t x, int16_t y, UI_COLOR_T color, uint8_t cov) {
  if (!c || !display_canvasBuffer(c)) return;
  if (cov == 0) return;
  if (x < 0 || y < 0 || x >= display_canvasWidth(c) || y >= display_canvasHeight(c)) return;
  if (cov >= 255) { display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, color); return; }
  UI_COLOR_T bg = display_canvasGetPixel(c, x, y);
  uint8_t op = static_cast<uint8_t>(static_cast<uint16_t>(cov) * 100 / 255);
  display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, ui_blend(color, bg, op));
}

// Xiaolin Wu antialiased line. Coordinates are in canvas-local space.
static inline void ui_aa_line(CuttlefishCanvas16* c, float x0, float y0, float x1, float y1, UI_COLOR_T color) {
  if (!c || !display_canvasBuffer(c)) return;
  auto ipart = [](float f) { return static_cast<int16_t>(f); };
  auto round_f = [](float f) { return static_cast<int16_t>(f + 0.5f); };
  auto fpart = [](float f) { return f - static_cast<float>(static_cast<int16_t>(f)); };
  auto rfpart = [&](float f) { return 1.0f - fpart(f); };

  bool steep = fabs(y1 - y0) > fabs(x1 - x0);
  if (steep) { float t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
  if (x0 > x1) { float t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }

  float dx = x1 - x0, dy = y1 - y0;
  float gradient = (dx == 0) ? 1.0f : dy / dx;

  // Handle first endpoint.
  float xend = static_cast<float>(round_f(x0));
  float yend = y0 + gradient * (xend - x0);
  float xgap = rfpart(x0);
  int16_t xpx1 = static_cast<int16_t>(xend);
  int16_t ypx1 = ipart(yend);
  if (steep) {
    ui_aa_pixel(c, ypx1, xpx1, color, static_cast<uint8_t>(rfpart(yend) * xgap * 255));
    ui_aa_pixel(c, ypx1 + 1, xpx1, color, static_cast<uint8_t>(fpart(yend) * xgap * 255));
  } else {
    ui_aa_pixel(c, xpx1, ypx1, color, static_cast<uint8_t>(rfpart(yend) * xgap * 255));
    ui_aa_pixel(c, xpx1, ypx1 + 1, color, static_cast<uint8_t>(fpart(yend) * xgap * 255));
  }
  float intery = yend + gradient;

  // Main loop.
  for (int16_t x = xpx1 + 1; x <= static_cast<int16_t>(round_f(x1)) - 1; x++) {
    if (steep) {
      ui_aa_pixel(c, ipart(intery), x, color, static_cast<uint8_t>(rfpart(intery) * 255));
      ui_aa_pixel(c, ipart(intery) + 1, x, color, static_cast<uint8_t>(fpart(intery) * 255));
    } else {
      ui_aa_pixel(c, x, ipart(intery), color, static_cast<uint8_t>(rfpart(intery) * 255));
      ui_aa_pixel(c, x, ipart(intery) + 1, color, static_cast<uint8_t>(fpart(intery) * 255));
    }
    intery += gradient;
  }
}

// Antialiased circle outline. cx,cy,r are in canvas-local space.
static inline void ui_aa_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color) {
  if (!c || !display_canvasBuffer(c)) return;
  if (r <= 0) return;
  // Walk each scanline from top to bottom of the bounding box.
  int16_t y0 = static_cast<int16_t>(floor(cy - r));
  int16_t y1 = static_cast<int16_t>(ceil(cy + r));
  for (int16_t y = y0; y <= y1; y++) {
    float dy = static_cast<float>(y) - cy;
    float dx = r * r - dy * dy;
    if (dx < 0) continue;
    float halfW = sqrtf(dx);
    float leftX = static_cast<float>(cx) - halfW;
    float rightX = static_cast<float>(cx) + halfW;
    // Left edge: blend two pixels at the coverage split.
    int16_t lx = static_cast<int16_t>(floor(leftX));
    float lfrac = leftX - lx;
    ui_aa_pixel(c, lx, y, color, static_cast<uint8_t>((1.0f - lfrac) * 255));
    ui_aa_pixel(c, lx + 1, y, color, 0);  // interior starts here (drawn solid below)
    // Right edge.
    int16_t rx = static_cast<int16_t>(floor(rightX));
    float rfrac = rightX - rx;
    ui_aa_pixel(c, rx, y, color, static_cast<uint8_t>(rfrac * 255));
    ui_aa_pixel(c, rx + 1, y, color, 0);
    // Solid fill between edges (skip the edge pixels already blended).
    for (int16_t x = lx + 1; x < rx; x++) {
      if (x >= 0 && x < display_canvasWidth(c)) display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, color);
    }
  }
}

// Antialiased filled circle.
static inline void ui_aa_fill_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color) {
  if (!c || !display_canvasBuffer(c)) return;
  if (r <= 0) return;
  int16_t y0 = static_cast<int16_t>(floor(cy - r));
  int16_t y1 = static_cast<int16_t>(ceil(cy + r));
  for (int16_t y = y0; y <= y1; y++) {
    float dy = static_cast<float>(y) - cy;
    float dx = r * r - dy * dy;
    if (dx < 0) continue;
    float halfW = sqrtf(dx);
    float leftX = static_cast<float>(cx) - halfW;
    float rightX = static_cast<float>(cx) + halfW;
    int16_t lx = static_cast<int16_t>(floor(leftX));
    int16_t rx = static_cast<int16_t>(ceil(rightX));
    // Blend left edge.
    ui_aa_pixel(c, lx, y, color, static_cast<uint8_t>((1.0f - (leftX - lx)) * 255));
    // Blend right edge.
    ui_aa_pixel(c, rx, y, color, static_cast<uint8_t>((rightX - (rx - 1)) * 255));
    // Solid interior.
    for (int16_t x = lx + 1; x < rx; x++) {
      if (x >= 0 && x < display_canvasWidth(c) && y >= 0 && y < display_canvasHeight(c)) display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, color);
    }
  }
}

#endif // UI_AA
`;
}
