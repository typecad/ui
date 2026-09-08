// Slice of the C++ runtime header (original source lines 3704-3909).
// Gradient, shadow, round-rect, border, outline drawing.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitNodeDecoration(): string {
  return `
static inline void ui_draw_gradient_fill(uint16_t i, int16_t drawY) {
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = drawY;
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  int16_t clipX = bx;
  int16_t clipY = by;
  int16_t clipW = bw;
  int16_t clipH = bh;
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  UI_COLOR_T c1 = __ui_nodes[i].gradientColor1;
  UI_COLOR_T c2 = __ui_nodes[i].gradientColor2;
  uint8_t dir = __ui_nodes[i].gradientEnabled;  // 1=vertical, 2=horizontal
  if (dir == 1) {
    // Vertical: top=c1, bottom=c2. Draw row by row.
    int16_t yStart = static_cast<int16_t>(clipY - by);
    int16_t yEnd = static_cast<int16_t>(clipY + clipH - by);
    for (int16_t y = yStart; y < yEnd; y++) {
      uint8_t op = static_cast<uint8_t>(static_cast<uint16_t>(y) * 100 / (bh > 1 ? bh - 1 : 1));
      uint32_t col = ui_blend(c1, c2, op);
      ui_display_draw_fast_hline(clipX, by + y, clipW, col);
    }
  } else {
    // Horizontal: left=c1, right=c2. Draw column by column.
    int16_t xStart = static_cast<int16_t>(clipX - bx);
    int16_t xEnd = static_cast<int16_t>(clipX + clipW - bx);
    for (int16_t x = xStart; x < xEnd; x++) {
      uint8_t op = static_cast<uint8_t>(static_cast<uint16_t>(x) * 100 / (bw > 1 ? bw - 1 : 1));
      uint32_t col = ui_blend(c1, c2, op);
      ui_display_draw_fast_vline(bx + x, clipY, clipH, col);
    }
  }
}

static inline void ui_draw_shadow(uint16_t i, int16_t drawY, uint8_t insetOnly) {
  if (__ui_nodes[i].shadowCount == 0) return;
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = drawY;
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  UI_COLOR_T clearCol = __ui_nodes[i].clearColor;
  uint8_t radius = __ui_nodes[i].borderRadius;

  for (uint8_t s = 0; s < __ui_nodes[i].shadowCount && s < 4; s++) {
    if (s >= __ui_nodes[i].shadowCount) continue;  // use count, not color check (0 is valid black)
    UI_COLOR_T shadowCol = __ui_nodes[i].shadowColor[s];
    int8_t ox = __ui_nodes[i].shadowOffsetX[s];
    int8_t oy = __ui_nodes[i].shadowOffsetY[s];
    uint8_t rawBlur = __ui_nodes[i].shadowBlur[s];
    uint8_t blur = rawBlur;
    if (blur == 0) blur = 1;  // at least 1 pass for a hard shadow
    uint8_t baseAlpha = __ui_nodes[i].shadowAlpha[s];
    uint8_t inset = __ui_nodes[i].shadowInset[s];
    if (insetOnly && !inset) continue;
    if (!insetOnly && inset) continue;

    if (inset && rawBlur == 0) {
      UI_COLOR_T insetBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
      uint32_t col = ui_blend(shadowCol, insetBg, baseAlpha);
      if (oy > 0) {
        ui_display_fill_rect(bx, by, bw, oy, col);
      } else if (oy < 0) {
        ui_display_fill_rect(bx, by + bh + oy, bw, -oy, col);
      }
      if (ox > 0) {
        ui_display_fill_rect(bx, by, ox, bh, col);
      } else if (ox < 0) {
        ui_display_fill_rect(bx + bw + ox, by, -ox, bh, col);
      }
      if (ox == 0 && oy == 0) {
        ui_display_draw_rect(bx, by, bw, bh, col);
      }
      continue;
    }

    for (int8_t pass = blur; pass >= 1; pass--) {
      uint8_t opacity = static_cast<uint8_t>(static_cast<uint16_t>(baseAlpha) / (pass + 1));
      uint32_t col = ui_blend(shadowCol, inset ? (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : clearCol) : clearCol, opacity);
      if (inset) {
        // Inset: draw inside the element, shrinking inward by pass.
        int16_t ix = bx + pass;
        int16_t iy = by + pass;
        int16_t iw = bw - 2 * pass;
        int16_t ih = bh - 2 * pass;
        if (iw <= 0 || ih <= 0) continue;
        // Offset the inset by the shadow's x/y (e.g. top highlight).
        iy += oy;
        ix += ox;
        // Draw only the edge ring (4 thin rects), not a full fill — the
        // element's own background will cover the center anyway.
        ui_display_fill_rect(ix, iy, iw, 1, col);         // top edge
        ui_display_fill_rect(ix, iy + ih - 1, iw, 1, col); // bottom edge
        ui_display_fill_rect(ix, iy, 1, ih, col);          // left edge
        ui_display_fill_rect(ix + iw - 1, iy, 1, ih, col); // right edge
      } else {
        // Outset: expand outward from box + offset.
        int16_t sx = bx + ox - pass;
        int16_t sy = by + oy - pass;
        int16_t sw = bw + 2 * pass;
        int16_t sh_ = bh + 2 * pass;
        if (radius > 0) {
          uint8_t r = radius + static_cast<uint8_t>(pass);
          if (r > sw / 2) r = sw / 2;
          if (r > sh_ / 2) r = sh_ / 2;
          ui_display_fill_round_rect(sx, sy, sw, sh_, r, col);
        } else {
          ui_display_fill_rect(sx, sy, sw, sh_, col);
        }
      }
    }
  }
}

static inline void ui_draw_closed_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t radius, UI_COLOR_T color) {
  if (w <= 0 || h <= 0) return;
  uint8_t r = radius;
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  if (r == 0) {
    ui_display_draw_rect(x, y, w, h, color);
    return;
  }
  ui_display_draw_round_rect(x, y, w, h, r, color);
  // Adafruit_GFX's circle helper omits the cardinal tangent pixels. Fill them
  // so straight edges and corner arcs meet without visible pinholes.
  ui_display_draw_pixel(x + r, y, color);
  ui_display_draw_pixel(x + w - r - 1, y, color);
  ui_display_draw_pixel(x + r, y + h - 1, color);
  ui_display_draw_pixel(x + w - r - 1, y + h - 1, color);
  ui_display_draw_pixel(x, y + r, color);
  ui_display_draw_pixel(x + w - 1, y + r, color);
  ui_display_draw_pixel(x, y + h - r - 1, color);
  ui_display_draw_pixel(x + w - 1, y + h - r - 1, color);
}

static inline void ui_draw_rect_outline(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t radius, uint8_t style, uint8_t width, UI_COLOR_T color) {
  if (style == 0 || width == 0 || w <= 0 || h <= 0) return;
  for (uint8_t b = 0; b < width; b++) {
    int16_t rx = x + b;
    int16_t ry = y + b;
    int16_t rw = w - 2 * b;
    int16_t rh = h - 2 * b;
    if (rw <= 0 || rh <= 0) return;
    uint8_t r = radius > b ? radius - b : 0;
    if (style == 1) {
      if (r > 0) ui_draw_closed_round_rect(rx, ry, rw, rh, r, color);
      else ui_display_draw_rect(rx, ry, rw, rh, color);
    } else {
      for (int16_t dx = 0; dx < rw; dx += 8) {
        int16_t seg = (dx + 4 <= rw) ? 4 : (rw - dx);
        if (seg > 0) {
          ui_display_draw_fast_hline(rx + dx, ry, seg, color);
          ui_display_draw_fast_hline(rx + dx, ry + rh - 1, seg, color);
        }
      }
      for (int16_t dy = 0; dy < rh; dy += 8) {
        int16_t seg = (dy + 4 <= rh) ? 4 : (rh - dy);
        if (seg > 0) {
          ui_display_draw_fast_vline(rx, ry + dy, seg, color);
          ui_display_draw_fast_vline(rx + rw - 1, ry + dy, seg, color);
        }
      }
    }
  }
}

static inline void ui_draw_node_border(uint16_t i, int16_t drawX, int16_t drawY, UI_COLOR_T color) {
  // Per-side borders: when any side's width differs from the uniform width,
  // draw each side as an independent filled rect. The uniform path (one
  // ui_draw_rect_outline call) is the common case and stays unchanged.
  if (__ui_nodes[i].hasPerSideBorder) {
    int16_t w = __ui_nodes[i].box.w;
    int16_t h = __ui_nodes[i].box.h;
    // Top edge
    if (__ui_nodes[i].borderTopWidth > 0) {
      ui_display_fill_rect(drawX, drawY, w, __ui_nodes[i].borderTopWidth, color);
    }
    // Bottom edge
    if (__ui_nodes[i].borderBottomWidth > 0) {
      ui_display_fill_rect(drawX, drawY + h - __ui_nodes[i].borderBottomWidth, w, __ui_nodes[i].borderBottomWidth, color);
    }
    // Left edge (between top and bottom borders)
    if (__ui_nodes[i].borderLeftWidth > 0) {
      ui_display_fill_rect(drawX, drawY + __ui_nodes[i].borderTopWidth, __ui_nodes[i].borderLeftWidth,
        h - __ui_nodes[i].borderTopWidth - __ui_nodes[i].borderBottomWidth, color);
    }
    // Right edge
    if (__ui_nodes[i].borderRightWidth > 0) {
      ui_display_fill_rect(drawX + w - __ui_nodes[i].borderRightWidth, drawY + __ui_nodes[i].borderTopWidth,
        __ui_nodes[i].borderRightWidth, h - __ui_nodes[i].borderTopWidth - __ui_nodes[i].borderBottomWidth, color);
    }
    return;
  }
  ui_draw_rect_outline(drawX, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h,
    __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, color);
}

static inline void ui_draw_node_outline(uint16_t i, int16_t drawX, int16_t drawY) {
  if (__ui_nodes[i].outlineStyle == 0 || __ui_nodes[i].outlineWidth == 0) return;
  uint8_t w = __ui_nodes[i].outlineWidth;
  ui_draw_rect_outline(drawX - w, drawY - w,
    __ui_nodes[i].box.w + 2 * w, __ui_nodes[i].box.h + 2 * w,
    __ui_nodes[i].borderRadius + w, __ui_nodes[i].outlineStyle, w, __ui_nodes[i].outlineColor);
}
`;
}
