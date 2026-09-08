// ---------------------------------------------------------------------------
// Slice of the C++ runtime header. Defines the CuttlefishGFX class — the
// shared geometry/canvas/text base used by native display adapters that
// instantiate CuttlefishGFX by value. NOT emitted on macro-alias paths
// (Adafruit `CuttlefishCanvas16==GFXcanvas16`, SDL
// `CuttlefishCanvas16==SdlGfxCanvas`), which own the canvas type.
//
// ──── BSD-3-Clause attribution ────────────────────────────────────────────
// The geometry algorithm implementations emitted by this slice (drawLine,
// drawCircle, drawCircleHelper, fillCircleHelper, drawRoundRect,
// fillRoundRect, drawTriangle, fillTriangle, drawChar, and the glyph loop
// in write()) are ported from Adafruit's Adafruit_GFX library:
//
//   Adafruit_GFX.cpp / Adafruit_GFX.h
//   Copyright (c) 2013 Adafruit Industries. All rights reserved.
//   Licensed under BSD-3-Clause.
//   Upstream: https://github.com/adafruit/Adafruit-GFX-Library
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// - Redistributions of source code must retain the above copyright notice,
//   this list of conditions and the following disclaimer.
// - Redistributions in binary form must reproduce the above copyright notice,
//   this list of conditions and the following disclaimer in the documentation
//   and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
// ──── End BSD-3-Clause attribution ────────────────────────────────────────
//
// Pixel output of the ported algorithms is byte-for-byte identical to
// Adafruit_GFX because the runtime's text layout and the AGENTS.md
// scroll/canvas invariants depend on it.
//
// AGENTS.md rendering guardrails: canvas ops reuse persistent buffers,
// use memmove-shift repair strips for scroll (handled in scroll slices that
// consume getBuffer()), never allocate per-frame.
// ---------------------------------------------------------------------------

import { renderGlcdfontArray } from "@typecad/cuttlefish/api/shared";

export function emitCuttlefishGfx(active: boolean): string {
  if (!active) return "";

  // The font array (shared with the SDL adapter).
  const fontArray = renderGlcdfontArray("cuttlefish_glcdfont", "unsigned char");

  return `
// ── CuttlefishGFX (native display GFX base) ────────────────────────────────
// Emitted only for native adapters that instantiate CuttlefishGFX by value;
// suppressed on macro-alias paths (Adafruit CuttlefishCanvas16==GFXcanvas16,
// SDL CuttlefishCanvas16==SdlGfxCanvas). Gated in ui-emitter.ts.
#ifndef CUTTLEFISH_GFX_DEFINED
#define CUTTLEFISH_GFX_DEFINED

#include <stdint.h>
#include <cstdlib>
#include <cstring>
#include <new>  // std::nothrow for canvas buffer allocation

// ── Panel-ops interface ────────────────────────────────────────────────────
// Each native adapter fills a CuttlefishPanelOps with function pointers that
// drive its specific bus + panel. CuttlefishGFX calls through these; it never
// touches hardware directly. Pointers marked "may be nullptr" must be null-
// checked by callers.
struct CuttlefishPanelOps {
  void (*startWrite)(void* ctx);      // assert CS, take bus lock (may be nullptr)
  void (*endWrite)(void* ctx);        // release CS / bus lock (may be nullptr)
  void (*setAddrWindow)(void* ctx, int16_t x, int16_t y, int16_t w, int16_t h);
  void (*writePixels)(void* ctx, const uint16_t* px, uint32_t n);
  void (*writePixel)(void* ctx, int16_t x, int16_t y, uint16_t c);  // direct mode
  void (*fillRect)(void* ctx, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c);
  int16_t (*width)(void* ctx);
  int16_t (*height)(void* ctx);
  // For SSD1309/SSD1680 only — flush a backing-store buffer to the panel.
  // May be nullptr on direct-mode panels.
  void (*flush)(void* ctx, int16_t x, int16_t y, int16_t w, int16_t h);
};

// ── Color snap (mono displays) ─────────────────────────────────────────────
// Same logic as the Adafruit SSD1309 adapter: any nonzero 565 → white.
static inline uint16_t ssd_mono(uint16_t c) { return c ? 0xFFFFu : 0x0000u; }

// ── 5x7 font (Adafruit glcdfont, BSD-3-Clause — see file header) ──────────
// 256 glyphs × 5 bytes per glyph. Indexed as cuttlefish_glcdfont[ch * 5 + col].
${fontArray}

// ── CuttlefishGFX base class ───────────────────────────────────────────────
class CuttlefishGFX {
 public:
  CuttlefishGFX(const CuttlefishPanelOps* ops, void* ctx)
    : ops_(ops), ctx_(ctx),
      cursor_x_(0), cursor_y_(0),
      textcolor_(0xFFFFu), textbgcolor_(0x0000u),
      textsize_(1), wrap_(true) {}
  virtual ~CuttlefishGFX() {}

  // Geometry — match Adafruit_GFX signatures exactly.
  virtual void drawPixel(int16_t x, int16_t y, uint16_t color);
  virtual void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
  virtual void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color);
  virtual void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color);
  virtual void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  virtual void drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  virtual void fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  virtual void drawCircle(int16_t x, int16_t y, int16_t r, uint16_t color);
  virtual void fillCircle(int16_t x, int16_t y, int16_t r, uint16_t color);
  virtual void drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color);
  virtual void fillTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color);

  // Bitmaps — match Adafruit_GFX signatures.
  virtual void drawRGBBitmap(int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h);

  // Text
  virtual void drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t size);
  virtual void write(uint8_t c);
  void print(const char* s) { while (*s) write(static_cast<uint8_t>(*s++)); }
  void setCursor(int16_t x, int16_t y) { cursor_x_ = x; cursor_y_ = y; }
  void setTextColor(uint16_t c) { textcolor_ = c; }
  void setTextColor(uint16_t c, uint16_t bg) { textcolor_ = c; textbgcolor_ = bg; }
  void setTextSize(uint8_t s) { textsize_ = (s > 0) ? s : 1; }
  void setTextWrap(bool w) { wrap_ = w; }

  // virtual so CuttlefishCanvas16/Mono overrides route through their stored
  // canvas dimensions instead of trying to deref the null ops_.
  virtual int16_t width() const { return (ops_ && ops_->width) ? ops_->width(ctx_) : 0; }
  virtual int16_t height() const { return (ops_ && ops_->height) ? ops_->height(ctx_) : 0; }
  int16_t getCursorX() const { return cursor_x_; }
  int16_t getCursorY() const { return cursor_y_; }

  // Adafruit circle helpers — public because drawRoundRect/fillRoundRect call them.
  void drawCircleHelper(int16_t x, int16_t y, int16_t r, uint8_t cornername, uint16_t color);
  void fillCircleHelper(int16_t x, int16_t y, int16_t r, uint8_t cornername, int16_t delta, uint16_t color);

 protected:
  const CuttlefishPanelOps* ops_;
  void* ctx_;
  int16_t cursor_x_, cursor_y_;
  uint16_t textcolor_, textbgcolor_;
  uint8_t textsize_;
  bool wrap_;
};

// ── RGB565 canvas (offscreen; for AA text + scroll compositing) ─────────────
// Mirrors Adafruit_GFXcanvas16. Allocates w*h*2 bytes; consumer must free via
// display_deleteCanvas (the runtime reuses persistent canvas slots — see
// AGENTS.md: __ui_container_canvas, __ui_repair_canvas, __ui_list_canvas,
// __ui_node_canvas).
class CuttlefishCanvas16 final : public CuttlefishGFX {
 public:
  // Noncopyable (owns a heap buffer; a value-copy would double-free).
  CuttlefishCanvas16(const CuttlefishCanvas16&) = delete;
  CuttlefishCanvas16& operator=(const CuttlefishCanvas16&) = delete;
  // Owns its buffer: mallocs w*h*2 bytes and frees it in the dtor.
  CuttlefishCanvas16(int16_t w, int16_t h);
  // Adopts an externally-allocated buffer (e.g. PSRAM via display_createCanvasPsram).
  // If takeOwnership is true, the dtor frees the buffer with free() (works for both
  // SRAM malloc and the ESP unified heap, which includes PSRAM). If false, the
  // caller owns the buffer's lifetime.
  CuttlefishCanvas16(int16_t w, int16_t h, uint16_t* externalBuffer, uint8_t takeOwnership = 0);
  virtual ~CuttlefishCanvas16();
  virtual void drawPixel(int16_t x, int16_t y, uint16_t color);
  virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  // Override width()/height() — the base implementation reads ops_->width,
  // which is null for canvases (constructed with CuttlefishGFX(nullptr, nullptr)).
  // Without these overrides, any code path that calls width()/height() on a
  // canvas target (text wrapping, scroll clipping, ui_display_target_bounds)
  // dereferences null.
  virtual int16_t width() const { return canvas_w_; }
  virtual int16_t height() const { return canvas_h_; }
  uint16_t* getBuffer() const { return buffer_; }
  uint16_t getPixel(int16_t x, int16_t y) const;
  void fillScreen(uint16_t color) { fillRect(0, 0, canvas_w_, canvas_h_, color); }
  int16_t canvasWidth() const { return canvas_w_; }
  int16_t canvasHeight() const { return canvas_h_; }
 private:
  uint16_t* buffer_;
  int16_t canvas_w_, canvas_h_;
  uint8_t owns_buffer_;  // 1 = dtor frees buffer_ (malloc'd), 0 = externally owned
};

// ── 1-bit mono canvas (SSD1309/SSD1680 backing stores) ──────────────────────
// Mirrors Adafruit_GFXcanvasMono. (w+7)/8 bytes per row. The buffer is the
// panel backing store on SSD1309 — flush via display_partial_refresh.
class CuttlefishCanvasMono final : public CuttlefishGFX {
 public:
  CuttlefishCanvasMono(const CuttlefishCanvasMono&) = delete;
  CuttlefishCanvasMono& operator=(const CuttlefishCanvasMono&) = delete;
  CuttlefishCanvasMono(int16_t w, int16_t h);
  virtual ~CuttlefishCanvasMono();
  virtual void drawPixel(int16_t x, int16_t y, uint16_t color);
  virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  // Override width()/height() — see CuttlefishCanvas16 for rationale.
  virtual int16_t width() const { return canvas_w_; }
  virtual int16_t height() const { return canvas_h_; }
  uint8_t* getBuffer() const { return buffer_; }
  uint16_t getPixel(int16_t x, int16_t y) const;
  void fillScreen(uint16_t color) { fillRect(0, 0, canvas_w_, canvas_h_, color); }
  int16_t canvasWidth() const { return canvas_w_; }
  int16_t canvasHeight() const { return canvas_h_; }
 private:
  uint8_t* buffer_;  // (w+7)/8 bytes per row × h rows
  int16_t canvas_w_, canvas_h_;
};

// ───────────────────────────────────────────────────────────────────────────
// Implementations. Ported verbatim from Adafruit_GFX.cpp.
// ───────────────────────────────────────────────────────────────────────────

void CuttlefishGFX::drawPixel(int16_t x, int16_t y, uint16_t color) {
  // Dispatch through ops_->writePixel when present (live panel); otherwise
  // rely on subclasses (CuttlefishCanvas16/Mono) overriding drawPixel to
  // write into their buffers. The null check on ops_ is required because
  // canvases construct their base with CuttlefishGFX(nullptr, nullptr).
  if (ops_ && ops_->writePixel) ops_->writePixel(ctx_, x, y, color);
}

void CuttlefishGFX::drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) {
  // Dispatch through the virtual fillRect so canvases (which override it)
  // route into their buffer. Do NOT call the panel op directly here —
  // canvases construct their base with a null panel-ops struct.
  fillRect(x, y, 1, h, color);
}

void CuttlefishGFX::drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) {
  fillRect(x, y, w, 1, color);
}

void CuttlefishGFX::drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  drawFastHLine(x, y, w, color);
  drawFastHLine(x, y + h - 1, w, color);
  drawFastVLine(x, y, h, color);
  drawFastVLine(x + w - 1, y, h, color);
}

void CuttlefishGFX::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  // Live panel fast-path: bypass the per-pixel virtual call and ask the
  // panel to fill directly. Canvases override this method to write into
  // their buffer (so they never reach this base path).
  if (ops_ && ops_->fillRect) ops_->fillRect(ctx_, x, y, w, h, color);
}

// Bresenham line — Adafruit_GFX.cpp drawLine, unchanged.
void CuttlefishGFX::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
  int16_t steep = abs(y1 - y0) > abs(x1 - x0);
  if (steep) {
    int16_t t = x0; x0 = y0; y0 = t;
    t = x1; x1 = y1; y1 = t;
  }
  if (x0 > x1) {
    int16_t t = x0; x0 = x1; x1 = t;
    t = y0; y0 = y1; y1 = t;
  }
  int16_t dx = x1 - x0, dy = abs(y1 - y0);
  int16_t err = dx / 2;
  int16_t ystep = (y0 < y1) ? 1 : -1;
  for (; x0 <= x1; x0++) {
    if (steep) drawPixel(y0, x0, color);
    else       drawPixel(x0, y0, color);
    err -= dy;
    if (err < 0) { y0 += ystep; err += dx; }
  }
}

// Midpoint circle — Adafruit_GFX.cpp drawCircle, unchanged.
void CuttlefishGFX::drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
  if (r <= 0) { drawPixel(x0, y0, color); return; }
  int16_t f = 1 - r, ddF_x = 1, ddF_y = -2 * r;
  int16_t x = 0, y = r;
  drawPixel(x0,     y0 + r, color);
  drawPixel(x0,     y0 - r, color);
  drawPixel(x0 + r, y0,     color);
  drawPixel(x0 - r, y0,     color);
  while (x < y) {
    if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
    x++;    ddF_x += 2; f += ddF_x;
    drawPixel(x0 + x, y0 + y, color);
    drawPixel(x0 - x, y0 + y, color);
    drawPixel(x0 + x, y0 - y, color);
    drawPixel(x0 - x, y0 - y, color);
    drawPixel(x0 + y, y0 + x, color);
    drawPixel(x0 - y, y0 + x, color);
    drawPixel(x0 + y, y0 - x, color);
    drawPixel(x0 - y, y0 - x, color);
  }
}

void CuttlefishGFX::drawCircleHelper(int16_t x0, int16_t y0, int16_t r, uint8_t cornername, uint16_t color) {
  if (r <= 0) return;
  int16_t f = 1 - r, ddF_x = 1, ddF_y = -2 * r;
  int16_t x = 0, y = r;
  while (x < y) {
    if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
    x++;    ddF_x += 2; f += ddF_x;
    if (cornername & 0x4) {
      drawPixel(x0 + x, y0 + y, color);
      drawPixel(x0 + y, y0 + x, color);
    }
    if (cornername & 0x2) {
      drawPixel(x0 + x, y0 - y, color);
      drawPixel(x0 + y, y0 - x, color);
    }
    if (cornername & 0x8) {
      drawPixel(x0 - y, y0 + x, color);
      drawPixel(x0 - x, y0 + y, color);
    }
    if (cornername & 0x1) {
      drawPixel(x0 - y, y0 - x, color);
      drawPixel(x0 - x, y0 - y, color);
    }
  }
}

void CuttlefishGFX::fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
  if (r <= 0) { drawPixel(x0, y0, color); return; }
  drawFastVLine(x0, y0 - r, 2 * r + 1, color);
  fillCircleHelper(x0, y0, r, 3, 0, color);
}

void CuttlefishGFX::fillCircleHelper(int16_t x0, int16_t y0, int16_t r, uint8_t cornername, int16_t delta, uint16_t color) {
  if (r <= 0) return;
  int16_t f = 1 - r, ddF_x = 1, ddF_y = -2 * r;
  int16_t x = 0, y = r;
  while (x < y) {
    if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
    x++;    ddF_x += 2; f += ddF_x;
    if (cornername & 0x1) {
      drawFastVLine(x0 + x, y0 - y, 2 * y + 1 + delta, color);
      drawFastVLine(x0 + y, y0 - x, 2 * x + 1 + delta, color);
    }
    if (cornername & 0x2) {
      drawFastVLine(x0 - x, y0 - y, 2 * y + 1 + delta, color);
      drawFastVLine(x0 - y, y0 - x, 2 * x + 1 + delta, color);
    }
  }
}

void CuttlefishGFX::drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  if (w <= 0 || h <= 0) return;
  if (r <= 0) {
    drawRect(x, y, w, h, color);
    return;
  }
  // CSS border-radius semantics: radii larger than half the shorter side
  // collapse to a pill/box (the preview host-gfx clamps identically). Kit
  // styles lower border-radius:9999px to r=255; without this clamp the
  // corner arcs overgrow the box instead of forming a true pill.
  const int16_t halfMin = static_cast<int16_t>((w < h ? w : h) / 2);
  if (r > halfMin) r = halfMin;
  drawFastHLine(x + r,     y,         w - 2 * r, color); // Top
  drawFastHLine(x + r,     y + h - 1, w - 2 * r, color); // Bottom
  drawFastVLine(x,         y + r,     h - 2 * r, color); // Left
  drawFastVLine(x + w - 1, y + r,     h - 2 * r, color); // Right
  drawCircleHelper(x + r,         y + r,         r, 1, color);
  drawCircleHelper(x + w - r - 1, y + r,         r, 2, color);
  drawCircleHelper(x + w - r - 1, y + h - r - 1, r, 4, color);
  drawCircleHelper(x + r,         y + h - r - 1, r, 8, color);
}

void CuttlefishGFX::fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  if (w <= 0 || h <= 0) return;
  if (r <= 0) {
    fillRect(x, y, w, h, color);
    return;
  }
  const int16_t halfMin = static_cast<int16_t>((w < h ? w : h) / 2);
  if (r > halfMin) r = halfMin;
  fillRect(x + r, y, w - 2 * r, h, color);
  // h - 2*r - 1 stays unclamped: for a perfect pill (h == 2r) it is -1 and the
  // helper's +1+delta lands the arc lines exactly on the box (the preview
  // host-gfx passes the same unclamped value).
  fillCircleHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, color);
  fillCircleHelper(x + r,         y + r, r, 2, h - 2 * r - 1, color);
}

void CuttlefishGFX::drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color) {
  drawLine(x0, y0, x1, y1, color);
  drawLine(x1, y1, x2, y2, color);
  drawLine(x2, y2, x0, y0, color);
}

void CuttlefishGFX::fillTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color) {
  int16_t a, b, y, last;
  // Sort coordinates by Y order ascending.
  if (y0 > y1) { int16_t t = y0; y0 = y1; y1 = t; t = x0; x0 = x1; x1 = t; }
  if (y1 > y2) { int16_t t = y1; y1 = y2; y2 = t; t = x1; x1 = x2; x2 = t; }
  if (y0 > y1) { int16_t t = y0; y0 = y1; y1 = t; t = x0; x0 = x1; x1 = t; }
  if (y0 == y2) { drawFastHLine(x0, y0, x1 - x0, color); return; }
  int16_t dx01 = x1 - x0, dy01 = y1 - y0;
  int16_t dx02 = x2 - x0, dy02 = y2 - y0;
  int16_t dx12 = x2 - x1, dy12 = y2 - y1;
  int32_t sa = 0, sb = 0;
  last = (y1 == y2) ? y1 : y1 - 1;
  for (y = y0; y <= last; y++) {
    a = x0 + sa / dy01;
    b = x0 + sb / dy02;
    sa += dx01;
    sb += dx02;
    if (a > b) { int16_t t = a; a = b; b = t; }
    drawFastHLine(a, y, b - a + 1, color);
  }
  sa = static_cast<int32_t>(dx12) * (last - y1);
  sb = static_cast<int32_t>(dx02) * (last - y0);
  for (; y <= y2; y++) {
    a = x1 + sa / dy12;
    b = x0 + sb / dy02;
    sa += dx12;
    sb += dx02;
    if (a > b) { int16_t t = a; a = b; b = t; }
    drawFastHLine(a, y, b - a + 1, color);
  }
}

// RGB565 bitmap — Adafruit_GFX.cpp drawRGBBitmap, adapted to call writePixel
// through the panel ops (no memory-backed variant; the Adafruit mem-version
// is unused by the cuttlefish runtime).
void CuttlefishGFX::drawRGBBitmap(int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {
  if (!bitmap || w <= 0 || h <= 0) return;
  for (int16_t j = 0; j < h; j++) {
    for (int16_t i = 0; i < w; i++) {
      drawPixel(x + i, y + j, bitmap[static_cast<int32_t>(j) * w + i]);
    }
  }
}

// Glyph rendering — Adafruit_GFX.cpp drawChar, unchanged algorithm.
void CuttlefishGFX::drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t size) {
  if ((x >= width())            || // Clip right
      (y >= height())           || // Clip bottom
      ((x + 5 * size - 1) < 0)  || // Clip left
      ((y + 8 * size - 1) < 0))    // Clip top
    return;
  if (c >= 176) c++; // Adafruit '±' fixup
  for (int8_t i = 0; i < 5; i++) {
    uint8_t line = cuttlefish_glcdfont[static_cast<size_t>(c) * 5 + i];
    for (int8_t j = 0; j < 8; j++, line >>= 1) {
      if (line & 1) {
        if (size == 1) drawPixel(x + i, y + j, color);
        else           fillRect(x + i * size, y + j * size, size, size, color);
      } else if (bg != color) {
        if (size == 1) drawPixel(x + i, y + j, bg);
        else           fillRect(x + i * size, y + j * size, size, size, bg);
      }
    }
  }
  if (bg != color) {
    if (size == 1) drawFastVLine(x + 5, y, 8, bg);
    else           fillRect(x + 5 * size, y, size, 8 * size, bg);
  }
}

void CuttlefishGFX::write(uint8_t c) {
  if (c == '\\n') {
    cursor_x_ = 0;
    cursor_y_ += textsize_ * 8;
  } else if (c != '\\r') {
    int16_t w = 6 * textsize_;
    if (wrap_ && ((cursor_x_ + w) > width())) {
      cursor_x_ = 0;
      cursor_y_ += textsize_ * 8;
    }
    drawChar(cursor_x_, cursor_y_, c, textcolor_, textbgcolor_, textsize_);
    cursor_x_ += w;
  }
}

// ── Canvas implementations ─────────────────────────────────────────────────

CuttlefishCanvas16::CuttlefishCanvas16(int16_t w, int16_t h)
  : CuttlefishGFX(nullptr, nullptr),
    buffer_(nullptr), canvas_w_(w), canvas_h_(h), owns_buffer_(1) {
  if ((w > 0) && (h > 0)) {
    size_t bytes = static_cast<size_t>(w) * static_cast<size_t>(h) * sizeof(uint16_t);
    // malloc (not new): on targets with CONFIG_REQUIRES_FULL_LIBCPP but without
    // CONFIG_CPP_EXCEPTIONS, operator new throws std::bad_alloc on OOM and the
    // nothrow wrapper's internal catch can't unwind → std::terminate → abort.
    // malloc returns NULL on failure with no exception path, which is exactly
    // what the canvas-failure self-heal logic expects.
    buffer_ = static_cast<uint16_t*>(malloc(bytes));
    if (buffer_) memset(buffer_, 0, bytes);
  }
}

CuttlefishCanvas16::CuttlefishCanvas16(int16_t w, int16_t h, uint16_t* externalBuffer, uint8_t takeOwnership)
  : CuttlefishGFX(nullptr, nullptr),
    buffer_(externalBuffer), canvas_w_(w), canvas_h_(h), owns_buffer_(takeOwnership) {
  // Zero the buffer so the canvas starts clean whether or not we own it.
  if (externalBuffer && (w > 0) && (h > 0)) {
    memset(externalBuffer, 0, static_cast<size_t>(w) * static_cast<size_t>(h) * sizeof(uint16_t));
  }
}

CuttlefishCanvas16::~CuttlefishCanvas16() {
  if (buffer_ && owns_buffer_) free(buffer_);
}

void CuttlefishCanvas16::drawPixel(int16_t x, int16_t y, uint16_t color) {
  if (!buffer_) return;
  if ((x < 0) || (y < 0) || (x >= canvas_w_) || (y >= canvas_h_)) return;
  buffer_[static_cast<size_t>(y) * static_cast<size_t>(canvas_w_) + static_cast<size_t>(x)] = color;
}

void CuttlefishCanvas16::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  if (!buffer_) return;
  int16_t x1 = (x < 0) ? 0 : x;
  int16_t y1 = (y < 0) ? 0 : y;
  int16_t x2 = x + w; if (x2 > canvas_w_) x2 = canvas_w_;
  int16_t y2 = y + h; if (y2 > canvas_h_) y2 = canvas_h_;
  // Cull before the inner loop (AGENTS.md: clip before expensive work).
  if (x2 <= x1 || y2 <= y1) return;
  for (int16_t j = y1; j < y2; j++) {
    uint16_t* row = buffer_ + static_cast<size_t>(j) * static_cast<size_t>(canvas_w_);
    for (int16_t i = x1; i < x2; i++) row[i] = color;
  }
}

uint16_t CuttlefishCanvas16::getPixel(int16_t x, int16_t y) const {
  if (!buffer_ || (x < 0) || (y < 0) || (x >= canvas_w_) || (y >= canvas_h_)) return 0;
  return buffer_[static_cast<size_t>(y) * static_cast<size_t>(canvas_w_) + static_cast<size_t>(x)];
}

CuttlefishCanvasMono::CuttlefishCanvasMono(int16_t w, int16_t h)
  : CuttlefishGFX(nullptr, nullptr),
    buffer_(nullptr), canvas_w_(w), canvas_h_(h) {
  if ((w > 0) && (h > 0)) {
    size_t row_bytes = (static_cast<size_t>(w) + 7u) / 8u;
    size_t bytes = row_bytes * static_cast<size_t>(h);
    buffer_ = static_cast<uint8_t*>(malloc(bytes));
    if (buffer_) memset(buffer_, 0, bytes);
  }
}

CuttlefishCanvasMono::~CuttlefishCanvasMono() {
  if (buffer_) free(buffer_);
}

void CuttlefishCanvasMono::drawPixel(int16_t x, int16_t y, uint16_t color) {
  if (!buffer_) return;
  if ((x < 0) || (y < 0) || (x >= canvas_w_) || (y >= canvas_h_)) return;
  size_t row_bytes = (static_cast<size_t>(canvas_w_) + 7u) / 8u;
  uint8_t* row = buffer_ + static_cast<size_t>(y) * row_bytes;
  uint8_t mask = 0x80u >> (x & 7);
  if (color) row[x >> 3] |= mask;
  else       row[x >> 3] &= ~mask;
}

void CuttlefishCanvasMono::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  if (!buffer_) return;
  int16_t x1 = (x < 0) ? 0 : x;
  int16_t y1 = (y < 0) ? 0 : y;
  int16_t x2 = x + w; if (x2 > canvas_w_) x2 = canvas_w_;
  int16_t y2 = y + h; if (y2 > canvas_h_) y2 = canvas_h_;
  if (x2 <= x1 || y2 <= y1) return;
  uint8_t fill = color ? 0xFFu : 0x00u;
  for (int16_t j = y1; j < y2; j++) {
    for (int16_t i = x1; i < x2; i++) {
      size_t row_bytes = (static_cast<size_t>(canvas_w_) + 7u) / 8u;
      uint8_t* row = buffer_ + static_cast<size_t>(j) * row_bytes;
      uint8_t mask = 0x80u >> (i & 7);
      if (color) row[i >> 3] |= mask;
      else       row[i >> 3] &= ~mask;
    }
  }
  (void)fill;
}

uint16_t CuttlefishCanvasMono::getPixel(int16_t x, int16_t y) const {
  if (!buffer_ || (x < 0) || (y < 0) || (x >= canvas_w_) || (y >= canvas_h_)) return 0;
  size_t row_bytes = (static_cast<size_t>(canvas_w_) + 7u) / 8u;
  const uint8_t* row = buffer_ + static_cast<size_t>(y) * row_bytes;
  return (row[x >> 3] & (0x80u >> (x & 7))) ? 0xFFFFu : 0x0000u;
}

#endif // CUTTLEFISH_GFX_DEFINED
`;
}
