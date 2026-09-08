// Slice of the C++ runtime header (original source lines 1155-1448).
// Tail of framebuffer block + image rotation/fit/scaled/rotated drawing.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitImageDrawing(): string {
  return `
// ── Full-screen framebuffer (opt-in PSRAM composition path) ──────────────────
// Composes a complete frame off-screen so navigation and dirty-node updates do
// not expose intermediate clears/primitive writes. The panel still receives a
// sequential SPI transfer; without a TE/vblank signal this is a strong tearing
// reduction, not a strict hardware-level tear-free guarantee.
static CuttlefishCanvas16* __ui_fb = nullptr;
static uint8_t __ui_fb_tried = 0;  // 0 = not yet attempted, 1 = alloc attempted
// Dirty bounds for the retained framebuffer. A local touch update should not
// retransmit the entire panel: the full-frame burst is long enough to look like
// a brightness dip on SPI TFTs even though the framebuffer itself is coherent.
static uint8_t __ui_fb_dirty = 0;
static int16_t __ui_fb_dirty_x0 = 0;
static int16_t __ui_fb_dirty_y0 = 0;
static int16_t __ui_fb_dirty_x1 = 0;
static int16_t __ui_fb_dirty_y1 = 0;

static inline void ui_fb_begin_frame() {
  __ui_fb_dirty = 0;
  __ui_fb_dirty_x0 = display_width();
  __ui_fb_dirty_y0 = display_height();
  __ui_fb_dirty_x1 = 0;
  __ui_fb_dirty_y1 = 0;
}

static inline void ui_fb_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return;
  int16_t x0 = x < 0 ? 0 : x;
  int16_t y0 = y < 0 ? 0 : y;
  int16_t x1 = x + w;
  int16_t y1 = y + h;
  int16_t dw = display_width();
  int16_t dh = display_height();
  if (x1 > dw) x1 = dw;
  if (y1 > dh) y1 = dh;
  if (x0 >= x1 || y0 >= y1) return;
  if (!__ui_fb_dirty) {
    __ui_fb_dirty_x0 = x0;
    __ui_fb_dirty_y0 = y0;
    __ui_fb_dirty_x1 = x1;
    __ui_fb_dirty_y1 = y1;
    __ui_fb_dirty = 1;
    return;
  }
  if (x0 < __ui_fb_dirty_x0) __ui_fb_dirty_x0 = x0;
  if (y0 < __ui_fb_dirty_y0) __ui_fb_dirty_y0 = y0;
  if (x1 > __ui_fb_dirty_x1) __ui_fb_dirty_x1 = x1;
  if (y1 > __ui_fb_dirty_y1) __ui_fb_dirty_y1 = y1;
}

// Get the framebuffer, allocating once (in PSRAM when available). Returns null
// when PSRAM is absent or the allocation failed — callers fall back to direct.
static inline CuttlefishCanvas16* ui_get_framebuffer() {
  if (__ui_fb_tried) return __ui_fb;  // one-time attempt; null means "none"
  __ui_fb_tried = 1;
#if UI_USE_FULL_FRAMEBUFFER && defined(ESP32) && defined(BOARD_HAS_PSRAM)
  if (psramFound()) {
    int16_t fw = display_width();
    int16_t fh = display_height();
    // GFXcanvas16 uses ps_malloc when ESP32 PSRAM malloc is hooked in via the
    // Arduino core; the allocation succeeds only if PSRAM is really present.
    __ui_fb = display_createCanvasPsram(fw, fh);
    if (!__ui_fb || !display_canvasBuffer(__ui_fb)) {
      // Allocation failed (PSRAM too small / not really mapped) — give up.
      __ui_fb = nullptr;
    }
  }
#endif
  return __ui_fb;
}

// Push only the changed framebuffer bounds. Rows are sent separately when the
// dirty union is narrower than the framebuffer because the source canvas has a
// wider stride than the panel window. Each row is complete before it reaches
// the panel, and the display adapter can synchronize each window to scanline.
static inline void ui_push_framebuffer() {
  if (!__ui_fb || !display_canvasBuffer(__ui_fb) || !__ui_fb_dirty) return;
  int16_t fw = display_canvasWidth(__ui_fb);
  int16_t fh = display_canvasHeight(__ui_fb);
  int16_t x = __ui_fb_dirty_x0;
  int16_t y = __ui_fb_dirty_y0;
  int16_t w = static_cast<int16_t>(__ui_fb_dirty_x1 - x);
  int16_t h = static_cast<int16_t>(__ui_fb_dirty_y1 - y);
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x >= fw || y >= fh) return;
  if (x + w > fw) w = static_cast<int16_t>(fw - x);
  if (y + h > fh) h = static_cast<int16_t>(fh - y);
  // Use the panel's native bulk-pixel path, not drawRGBBitmap(). The native
  // CuttlefishGFX implementation of drawRGBBitmap is intentionally generic and
  // emits one writePixel transaction per pixel; using it for a retained-frame
  // flush turns a small local update into hundreds of visible SPI flashes.
  UI_COLOR_T* pixels = display_canvasBuffer(__ui_fb);
  display_startWrite();
  if (x == 0 && w == fw) {
    // Full-width rows are contiguous and can use one bulk write.
    display_setAddrWindow(x, y, w, h);
    display_writePixels(pixels + static_cast<int32_t>(y) * fw,
      static_cast<uint32_t>(w) * h);
  } else {
    // Narrow dirty bounds require one row at a time because the source stride
    // is fw while each destination window is only w pixels wide.
    for (int16_t row = 0; row < h; row++) {
      display_setAddrWindow(x, static_cast<int16_t>(y + row), w, 1);
      display_writePixels(
        pixels + static_cast<int32_t>(y + row) * fw + x,
        static_cast<uint32_t>(w));
    }
  }
  display_endWrite();
}

static inline uint8_t ui_rotation_quadrant(int16_t deg) {
  int16_t normalized = deg % 360;
  if (normalized < 0) normalized += 360;
  if (normalized == 90) return 1;
  if (normalized == 180) return 2;
  if (normalized == 270) return 3;
  return 0;
}

static inline int16_t ui_rotated_face_w(uint16_t nodeIdx, int16_t w, int16_t h) {
  if (__ui_nodes[nodeIdx].kind != NODE_IMG &&
      !(__ui_nodes[nodeIdx].kind == NODE_FILL && __ui_nodes[nodeIdx].gradientEnabled == 0)) return w;
  uint8_t q = ui_rotation_quadrant(__ui_nodes[nodeIdx].rotateDeg);
  return (q == 1 || q == 3) ? h : w;
}

static inline int16_t ui_rotated_face_h(uint16_t nodeIdx, int16_t w, int16_t h) {
  if (__ui_nodes[nodeIdx].kind != NODE_IMG &&
      !(__ui_nodes[nodeIdx].kind == NODE_FILL && __ui_nodes[nodeIdx].gradientEnabled == 0)) return h;
  uint8_t q = ui_rotation_quadrant(__ui_nodes[nodeIdx].rotateDeg);
  return (q == 1 || q == 3) ? w : h;
}

// Draw image with object-fit: 0=none, 1=fill, 2=contain, 3=cover, 4=scale-down.
// The sampler is bounded to the target box first, then quarter-turn rotated.
// This keeps cover cropped inside the element instead of overpainting siblings.
static inline void ui_draw_image_with_fit(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                          uint8_t fitMode, int16_t targetW, int16_t targetH) {
  if (!img || !img->data || img->w == 0 || img->h == 0 || targetW <= 0 || targetH <= 0) return;
  int16_t srcW = img->w, srcH = img->h;
  int16_t drawW = srcW, drawH = srcH;
  int16_t offX = (targetW - drawW) / 2;
  int16_t offY = (targetH - drawH) / 2;

  if (fitMode == 1) {
    drawW = targetW;
    drawH = targetH;
    offX = 0;
    offY = 0;
  } else if (fitMode == 2 || fitMode == 3 || fitMode == 4) {
    int32_t scaleX = (static_cast<int32_t>(targetW) * 1000) / srcW;
    int32_t scaleY = (static_cast<int32_t>(targetH) * 1000) / srcH;
    if (scaleX < 1) scaleX = 1;
    if (scaleY < 1) scaleY = 1;
    int32_t scale = scaleX;
    if (fitMode == 2) {
      if (scaleY < scaleX) scale = scaleY;
    } else if (fitMode == 3) {
      if (scaleY > scaleX) scale = scaleY;
    } else {
      if (scaleY < scaleX) scale = scaleY;
      if (scale > 1000) scale = 1000;
    }
    drawW = static_cast<int16_t>(static_cast<int32_t>(srcW) * scale / 1000);
    drawH = static_cast<int16_t>(static_cast<int32_t>(srcH) * scale / 1000);
    if (drawW < 1) drawW = 1;
    if (drawH < 1) drawH = 1;
    if (fitMode == 3) {
      if (drawW < targetW) drawW = targetW;
      if (drawH < targetH) drawH = targetH;
    }
    offX = (targetW - drawW) / 2;
    offY = (targetH - drawH) / 2;
  }

  uint8_t q = ui_rotation_quadrant(rotateDeg);
  int16_t clipX = x;
  int16_t clipY = y;
  int16_t clipW = (q == 1 || q == 3) ? targetH : targetW;
  int16_t clipH = (q == 1 || q == 3) ? targetW : targetH;
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  int16_t txStart = 0, txEnd = targetW, tyStart = 0, tyEnd = targetH;
  if (q == 0) {
    txStart = ui_clamp_i16(static_cast<int16_t>(clipX - x), 0, targetW);
    txEnd = ui_clamp_i16(static_cast<int16_t>(clipX + clipW - x), 0, targetW);
    tyStart = ui_clamp_i16(static_cast<int16_t>(clipY - y), 0, targetH);
    tyEnd = ui_clamp_i16(static_cast<int16_t>(clipY + clipH - y), 0, targetH);
  } else if (q == 1) {
    txStart = ui_clamp_i16(static_cast<int16_t>(clipY - y), 0, targetW);
    txEnd = ui_clamp_i16(static_cast<int16_t>(clipY + clipH - y), 0, targetW);
    tyStart = ui_clamp_i16(static_cast<int16_t>(x + targetH - (clipX + clipW)), 0, targetH);
    tyEnd = ui_clamp_i16(static_cast<int16_t>(x + targetH - clipX), 0, targetH);
  } else if (q == 2) {
    txStart = ui_clamp_i16(static_cast<int16_t>(x + targetW - (clipX + clipW)), 0, targetW);
    txEnd = ui_clamp_i16(static_cast<int16_t>(x + targetW - clipX), 0, targetW);
    tyStart = ui_clamp_i16(static_cast<int16_t>(y + targetH - (clipY + clipH)), 0, targetH);
    tyEnd = ui_clamp_i16(static_cast<int16_t>(y + targetH - clipY), 0, targetH);
  } else {
    txStart = ui_clamp_i16(static_cast<int16_t>(y + targetW - (clipY + clipH)), 0, targetW);
    txEnd = ui_clamp_i16(static_cast<int16_t>(y + targetW - clipY), 0, targetW);
    tyStart = ui_clamp_i16(static_cast<int16_t>(clipX - x), 0, targetH);
    tyEnd = ui_clamp_i16(static_cast<int16_t>(clipX + clipW - x), 0, targetH);
  }
  if (txStart >= txEnd || tyStart >= tyEnd) return;
  for (int16_t ty = tyStart; ty < tyEnd; ty++) {
    int16_t localY = ty - offY;
    if (localY < 0 || localY >= drawH) continue;
    int16_t srcY = (static_cast<int32_t>(localY) * srcH) / drawH;
    if (srcY < 0) srcY = 0;
    if (srcY >= srcH) srcY = srcH - 1;
    for (int16_t tx = txStart; tx < txEnd; tx++) {
      int16_t localX = tx - offX;
      if (localX < 0 || localX >= drawW) continue;
      int16_t srcX = (static_cast<int32_t>(localX) * srcW) / drawW;
      if (srcX < 0) srcX = 0;
      if (srcX >= srcW) srcX = srcW - 1;
      UI_COLOR_T color = img->data[static_cast<int32_t>(srcY) * srcW + srcX];
      int16_t dx = tx;
      int16_t dy = ty;
      if (q == 1) {
        dx = targetH - 1 - ty;
        dy = tx;
      } else if (q == 2) {
        dx = targetW - 1 - tx;
        dy = targetH - 1 - ty;
      } else if (q == 3) {
        dx = ty;
        dy = targetW - 1 - tx;
      }
      ui_display_draw_pixel(x + dx, y + dy, color);
    }
  }
}

static inline void ui_draw_scaled_image(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                        int16_t drawW, int16_t drawH) {
  if (!img || !img->data || img->w == 0 || img->h == 0 || drawW <= 0 || drawH <= 0) return;
  uint8_t q = ui_rotation_quadrant(rotateDeg);
  int16_t clipX = x;
  int16_t clipY = y;
  int16_t clipW = (q == 1 || q == 3) ? drawH : drawW;
  int16_t clipH = (q == 1 || q == 3) ? drawW : drawH;
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  int16_t dxStart = 0, dxEnd = drawW, dyStart = 0, dyEnd = drawH;
  if (q == 0) {
    dxStart = ui_clamp_i16(static_cast<int16_t>(clipX - x), 0, drawW);
    dxEnd = ui_clamp_i16(static_cast<int16_t>(clipX + clipW - x), 0, drawW);
    dyStart = ui_clamp_i16(static_cast<int16_t>(clipY - y), 0, drawH);
    dyEnd = ui_clamp_i16(static_cast<int16_t>(clipY + clipH - y), 0, drawH);
  } else if (q == 1) {
    dxStart = ui_clamp_i16(static_cast<int16_t>(clipY - y), 0, drawW);
    dxEnd = ui_clamp_i16(static_cast<int16_t>(clipY + clipH - y), 0, drawW);
    dyStart = ui_clamp_i16(static_cast<int16_t>(x + drawH - (clipX + clipW)), 0, drawH);
    dyEnd = ui_clamp_i16(static_cast<int16_t>(x + drawH - clipX), 0, drawH);
  } else if (q == 2) {
    dxStart = ui_clamp_i16(static_cast<int16_t>(x + drawW - (clipX + clipW)), 0, drawW);
    dxEnd = ui_clamp_i16(static_cast<int16_t>(x + drawW - clipX), 0, drawW);
    dyStart = ui_clamp_i16(static_cast<int16_t>(y + drawH - (clipY + clipH)), 0, drawH);
    dyEnd = ui_clamp_i16(static_cast<int16_t>(y + drawH - clipY), 0, drawH);
  } else {
    dxStart = ui_clamp_i16(static_cast<int16_t>(y + drawW - (clipY + clipH)), 0, drawW);
    dxEnd = ui_clamp_i16(static_cast<int16_t>(y + drawW - clipY), 0, drawW);
    dyStart = ui_clamp_i16(static_cast<int16_t>(clipX - x), 0, drawH);
    dyEnd = ui_clamp_i16(static_cast<int16_t>(clipX + clipW - x), 0, drawH);
  }
  if (dxStart >= dxEnd || dyStart >= dyEnd) return;
  if (q == 0) {
    // Simple case: no rotation, draw with scaling
    if (drawW == img->w && drawH == img->h) {
      int16_t rows = static_cast<int16_t>(dyEnd - dyStart);
      int16_t cols = static_cast<int16_t>(dxEnd - dxStart);
      for (int16_t row = 0; row < rows; row++) {
        ui_display_draw_rgb_bitmap(static_cast<int16_t>(x + dxStart), static_cast<int16_t>(y + dyStart + row),
          img->data + static_cast<int32_t>(dyStart + row) * img->w + dxStart, cols, 1);
      }
    } else {
      // Scale using nearest-neighbor
      for (int16_t dy = dyStart; dy < dyEnd; dy++) {
        int16_t srcY = (static_cast<int32_t>(dy) * img->h) / drawH;
        for (int16_t dx = dxStart; dx < dxEnd; dx++) {
          int16_t srcX = (static_cast<int32_t>(dx) * img->w) / drawW;
          UI_COLOR_T color = img->data[static_cast<int32_t>(srcY) * img->w + srcX];
          ui_display_draw_pixel(x + dx, y + dy, color);
        }
      }
    }
    return;
  }
  for (int16_t dy = dyStart; dy < dyEnd; dy++) {
    int16_t srcY = (static_cast<int32_t>(dy) * img->h) / drawH;
    for (int16_t dx = dxStart; dx < dxEnd; dx++) {
      int16_t srcX = (static_cast<int32_t>(dx) * img->w) / drawW;
      UI_COLOR_T color = img->data[static_cast<int32_t>(srcY) * img->w + srcX];
      int16_t rdx = 0, rdy = 0;
      if (q == 1) {
        rdx = drawH - 1 - dy;
        rdy = dx;
      } else if (q == 2) {
        rdx = drawW - 1 - dx;
        rdy = drawH - 1 - dy;
      } else {
        rdx = dy;
        rdy = drawW - 1 - dx;
      }
      ui_display_draw_pixel(x + rdx, y + rdy, color);
    }
  }
}

static inline void ui_draw_image_rotated(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg) {
   uint8_t q = ui_rotation_quadrant(rotateDeg);
   int16_t clipX = x;
   int16_t clipY = y;
   int16_t clipW = (q == 1 || q == 3) ? img->h : img->w;
   int16_t clipH = (q == 1 || q == 3) ? img->w : img->h;
   if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
   if (q == 0) {
     int16_t sx0 = ui_clamp_i16(static_cast<int16_t>(clipX - x), 0, static_cast<int16_t>(img->w));
     int16_t sy0 = ui_clamp_i16(static_cast<int16_t>(clipY - y), 0, static_cast<int16_t>(img->h));
     int16_t sw = ui_clamp_i16(clipW, 0, static_cast<int16_t>(img->w - sx0));
     int16_t sh = ui_clamp_i16(clipH, 0, static_cast<int16_t>(img->h - sy0));
     for (int16_t row = 0; row < sh; row++) {
       ui_display_draw_rgb_bitmap(static_cast<int16_t>(x + sx0), static_cast<int16_t>(y + sy0 + row),
         img->data + static_cast<int32_t>(sy0 + row) * img->w + sx0, sw, 1);
     }
     return;
   }
   uint16_t sxStart = 0, sxEnd = img->w, syStart = 0, syEnd = img->h;
   if (q == 1) {
     sxStart = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(clipY - y), 0, static_cast<int16_t>(img->w)));
     sxEnd = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(clipY + clipH - y), 0, static_cast<int16_t>(img->w)));
     syStart = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(x + img->h - (clipX + clipW)), 0, static_cast<int16_t>(img->h)));
     syEnd = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(x + img->h - clipX), 0, static_cast<int16_t>(img->h)));
   } else if (q == 2) {
     sxStart = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(x + img->w - (clipX + clipW)), 0, static_cast<int16_t>(img->w)));
     sxEnd = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(x + img->w - clipX), 0, static_cast<int16_t>(img->w)));
     syStart = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(y + img->h - (clipY + clipH)), 0, static_cast<int16_t>(img->h)));
     syEnd = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(y + img->h - clipY), 0, static_cast<int16_t>(img->h)));
   } else {
     sxStart = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(y + img->w - (clipY + clipH)), 0, static_cast<int16_t>(img->w)));
     sxEnd = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(y + img->w - clipY), 0, static_cast<int16_t>(img->w)));
     syStart = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(clipX - x), 0, static_cast<int16_t>(img->h)));
     syEnd = static_cast<uint16_t>(ui_clamp_i16(static_cast<int16_t>(clipX + clipW - x), 0, static_cast<int16_t>(img->h)));
   }
   if (sxStart >= sxEnd || syStart >= syEnd) return;
   for (uint16_t sy = syStart; sy < syEnd; sy++) {
     for (uint16_t sx = sxStart; sx < sxEnd; sx++) {
       UI_COLOR_T color = img->data[static_cast<uint32_t>(sy) * img->w + sx];
       int16_t dx = 0;
       int16_t dy = 0;
       if (q == 1) {
         dx = static_cast<int16_t>(img->h - 1 - sy);
         dy = static_cast<int16_t>(sx);
       } else if (q == 2) {
         dx = static_cast<int16_t>(img->w - 1 - sx);
         dy = static_cast<int16_t>(img->h - 1 - sy);
       } else {
         dx = static_cast<int16_t>(sy);
         dy = static_cast<int16_t>(img->w - 1 - sx);
       }
       ui_display_draw_pixel(x + dx, y + dy, color);
     }
   }
 }
`;
}
