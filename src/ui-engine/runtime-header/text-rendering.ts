// Slice of the C++ runtime header (original source lines 2995-3703).
// Fonts, UTF-8, metrics, wrap, layout cache, all text draw variants, rich link hit.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTextRendering(): string {
  return `
static inline const UIFontFace* ui_font_face(uint8_t id) {
   if (id == 0) return nullptr;
   for (uint16_t i = 0; i < __ui_font_face_count; i++) {
     if (__ui_font_faces[i].id == id) return &__ui_font_faces[i];
   }
   return nullptr;
 }

 static inline const UIFontGlyph* ui_font_glyph(const UIFontFace* face, uint16_t codepoint) {
   if (!face) return nullptr;
  for (uint8_t i = 0; i < face->glyphCount; i++) {
    if (face->glyphs[i].codepoint == codepoint) return &face->glyphs[i];
  }
  return nullptr;
}

static inline uint8_t ui_font_alpha_at(const UIFontFace* face, const UIFontGlyph* glyph, uint16_t pixelIndex) {
   if (!face || !glyph || !face->alpha) return 0;
   uint16_t nibble = glyph->dataOffset + pixelIndex;
   // Bounds check to prevent reading past the alpha array
   if (nibble >> 1 >= 65535) return 0;
#if defined(__AVR__)
   uint8_t byte = pgm_read_byte(&face->alpha[nibble >> 1]);
#else
   uint8_t byte = face->alpha[nibble >> 1];
#endif
   return (nibble & 1) ? (byte & 0x0F) : (byte >> 4);
 }

static inline uint16_t ui_next_utf8_codepoint(const unsigned char** p) {
  const unsigned char* s = *p;
  uint8_t b0 = *s++;
  if (b0 < 0x80) {
    *p = s;
    return b0;
  }
  if ((b0 & 0xE0) == 0xC0 && (s[0] & 0xC0) == 0x80) {
    uint16_t cp = (static_cast<uint16_t>(b0 & 0x1F) << 6) | static_cast<uint16_t>(s[0] & 0x3F);
    *p = s + 1;
    return cp;
  }
  if ((b0 & 0xF0) == 0xE0 && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80) {
    uint16_t cp = (static_cast<uint16_t>(b0 & 0x0F) << 12) | (static_cast<uint16_t>(s[0] & 0x3F) << 6) | static_cast<uint16_t>(s[1] & 0x3F);
    *p = s + 2;
    return cp;
  }
  if ((b0 & 0xF8) == 0xF0 && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80) {
    *p = s + 3;
    return '?';
  }
  *p = s;
  return '?';
}

static inline uint16_t ui_asset_text_width(const char* text, const UIFontFace* face) {
  if (!text || !face) return 0;
  uint16_t w = 0;
  const unsigned char* p = (const unsigned char*)text;
  while (*p) {
    uint16_t codepoint = ui_next_utf8_codepoint(&p);
    const UIFontGlyph* glyph = ui_font_glyph(face, codepoint);
    w += glyph ? glyph->advance : (face->lineHeight / 2);
  }
  return w;
}

static inline uint8_t ui_asset_text_height(const UIFontFace* face) {
  return face ? face->lineHeight : 0;
}

static inline uint16_t ui_text_width(const char* text, uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (face) return ui_asset_text_width(text, face);
  if (!text) return 0;
  if (ts == 0) ts = 2;
  uint16_t w = 0;
  for (const char* p = text; *p; p++) w += ts * 6 + letterSpacing;
  return w;
}

static inline uint8_t ui_text_height(uint8_t ts, uint8_t fontFace) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (face) return ui_asset_text_height(face);
  return (ts ? ts : 2) * 8;
}

static inline uint8_t ui_text_line_height(uint8_t ts, uint8_t fontFace, uint8_t lineHeight) {
  return lineHeight ? lineHeight : ui_text_height(ts, fontFace);
}

static inline uint8_t ui_is_text_space(char c) {
  return c == ' ' || c == '\\t' || c == '\\f' || c == '\\v';
}

static inline uint8_t ui_is_text_newline(char c) {
  return c == '\\n' || c == '\\r';
}

static inline const char* ui_after_text_newline(const char* p) {
  if (!p || !*p) return p;
  if (*p == '\\r' && p[1] == '\\n') return p + 2;
  return p + 1;
}

static inline const char* ui_skip_wrap_spaces(const char* p) {
  while (p && ui_is_text_space(*p)) p++;
  return p;
}

static inline uint16_t ui_next_utf8_codepoint_bounded(const unsigned char** p, const unsigned char* end) {
  const unsigned char* s = *p;
  if (!s || s >= end) return 0;
  uint8_t b0 = *s++;
  if (b0 < 0x80) {
    *p = s;
    return b0;
  }
  if ((b0 & 0xE0) == 0xC0 && s < end && (s[0] & 0xC0) == 0x80) {
    uint16_t cp = (static_cast<uint16_t>(b0 & 0x1F) << 6) | static_cast<uint16_t>(s[0] & 0x3F);
    *p = s + 1;
    return cp;
  }
  if ((b0 & 0xF0) == 0xE0 && s + 1 < end && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80) {
    uint16_t cp = (static_cast<uint16_t>(b0 & 0x0F) << 12) | (static_cast<uint16_t>(s[0] & 0x3F) << 6) | static_cast<uint16_t>(s[1] & 0x3F);
    *p = s + 2;
    return cp;
  }
  if ((b0 & 0xF8) == 0xF0 && s + 2 < end && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80) {
    *p = s + 3;
    return '?';
  }
  *p = s;
  return '?';
}

static inline uint16_t ui_text_codepoint_advance(uint16_t codepoint, uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (face) {
    const UIFontGlyph* glyph = ui_font_glyph(face, codepoint);
    return glyph ? glyph->advance : (face->lineHeight / 2);
  }
  int16_t adv = static_cast<int16_t>(ts ? ts : 2) * 6 + letterSpacing;
  return adv > 0 ? static_cast<uint16_t>(adv) : 1;
}

static inline uint16_t ui_text_span_width(const char* start, const char* end, uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  if (!start || !end || end <= start) return 0;
  uint16_t w = 0;
  const unsigned char* p = (const unsigned char*)start;
  const unsigned char* limit = (const unsigned char*)end;
  while (p < limit && *p) {
    uint16_t codepoint = ui_next_utf8_codepoint_bounded(&p, limit);
    if (codepoint == 0) break;
    w += ui_text_codepoint_advance(codepoint, ts, fontFace, letterSpacing);
  }
  return w;
}

struct UITextLine {
  const char* start;
  const char* end;
  uint16_t width;
};

static inline uint8_t ui_text_next_line(const char** cursor, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, UITextLine* out) {
   if (!cursor || !*cursor || !out) return 0;
   const char* p = *cursor;
   if (!*p) return 0;
   uint8_t hardNewlines = whiteSpaceMode == UI_WS_PRE || whiteSpaceMode == UI_WS_PRE_LINE;
   uint8_t canWrap = (whiteSpaceMode == UI_WS_NORMAL || whiteSpaceMode == UI_WS_PRE_LINE) && maxWidth > 0;

   if (whiteSpaceMode == UI_WS_NORMAL || whiteSpaceMode == UI_WS_PRE_LINE) {
     p = ui_skip_wrap_spaces(p);
   }
   if (!*p) {
     *cursor = p;
     return 0;
   }
   if (hardNewlines && ui_is_text_newline(*p)) {
     out->start = p;
     out->end = p;
     out->width = 0;
     *cursor = ui_after_text_newline(p);
     return 1;
   }

   const char* lineStart = p;
   if (!canWrap) {
     while (*p && !(hardNewlines && ui_is_text_newline(*p))) p++;
     out->start = lineStart;
     out->end = p;
     out->width = ui_text_span_width(lineStart, p, ts, fontFace, letterSpacing);
     *cursor = (hardNewlines && ui_is_text_newline(*p)) ? ui_after_text_newline(p) : p;
     return 1;
   }

   uint16_t width = 0;
   const char* lastBreakAfter = nullptr;
   const char* lastBreakEnd = lineStart;
   uint16_t lastBreakWidth = 0;
   const char* lastNonSpaceEnd = lineStart;
   uint16_t lastNonSpaceWidth = 0;

   // Pre-compute string end bounds to avoid repeated scans in the loop
   const unsigned char* textEnd = (const unsigned char*)p;
   while (*textEnd) textEnd++;

   while (*p && p < (const char*)textEnd) {
     if (hardNewlines && ui_is_text_newline(*p)) break;
     const char* charStart = p;
     const unsigned char* next = (const unsigned char*)p;
     uint16_t codepoint = ui_next_utf8_codepoint_bounded(&next, textEnd);
     if (codepoint == 0) break;
     const char* charEnd = (const char*)next;
     uint8_t isBreakSpace = ui_is_text_space(*charStart) || (!hardNewlines && ui_is_text_newline(*charStart));
     uint16_t adv = ui_text_codepoint_advance(codepoint, ts, fontFace, letterSpacing);

     if (width > 0 && width + adv > maxWidth) {
       if (lastBreakAfter && lastBreakAfter > lineStart) {
         out->start = lineStart;
         out->end = lastBreakEnd;
         out->width = lastBreakWidth;
         *cursor = lastBreakAfter;
         return 1;
       }
       out->start = lineStart;
       out->end = charStart;
       out->width = width;
       *cursor = charStart;
       return 1;
     }

     width += adv;
     p = charEnd;
     if (isBreakSpace) {
       lastBreakAfter = p;
       lastBreakEnd = lastNonSpaceEnd;
       lastBreakWidth = lastNonSpaceWidth;
     } else {
       lastNonSpaceEnd = p;
       lastNonSpaceWidth = width;
     }
   }

   out->start = lineStart;
   if (whiteSpaceMode == UI_WS_NORMAL || whiteSpaceMode == UI_WS_PRE_LINE) {
     out->end = lastNonSpaceEnd;
     out->width = lastNonSpaceWidth;
   } else {
     out->end = p;
     out->width = width;
   }
   *cursor = (hardNewlines && ui_is_text_newline(*p)) ? ui_after_text_newline(p) : p;
   return 1;
 }

 static inline void ui_text_layout_metrics(const char* text, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, uint8_t lineHeight, uint16_t* outW, uint16_t* outH) {
  if (!text) text = "";
  uint16_t maxLineW = 0;
  uint16_t h = 0;
  uint8_t lh = ui_text_line_height(ts, fontFace, lineHeight);
  const char* cursor = text;
  UITextLine line;
  while (ui_text_next_line(&cursor, maxWidth, whiteSpaceMode, ts, fontFace, letterSpacing, &line)) {
    if (line.width > maxLineW) maxLineW = line.width;
    h += lh;
  }
  if (h == 0) h = lh;
  if (outW) *outW = maxLineW;
  if (outH) *outH = h;
}

static inline void ui_invalidate_text_layout_cache(uint16_t nodeIdx) {
  if (nodeIdx < __ui_node_count) __ui_nodes[nodeIdx].layoutCacheKey = 0;
}

static inline uint32_t ui_text_layout_cache_key(uint16_t nodeIdx, uint16_t textMaxW) {
  uint32_t key = textMaxW;
  key = key * 31u + __ui_nodes[nodeIdx].whiteSpaceMode;
  uint8_t ts = __ui_nodes[nodeIdx].textSize ? __ui_nodes[nodeIdx].textSize : 2;
  key = key * 31u + ts;
  key = key * 31u + __ui_nodes[nodeIdx].fontFace;
  key = key * 31u + static_cast<uint8_t>(__ui_nodes[nodeIdx].letterSpacing + 128);
  key = key * 31u + __ui_nodes[nodeIdx].lineHeight;
  if (__ui_nodes[nodeIdx].hasTextBinding) {
    const char* t = __ui_nodes[nodeIdx].textBuffer;
    while (t && *t) {
      key = key * 31u + static_cast<uint8_t>(*t);
      t++;
    }
  }
  return key | 1u;
}

static inline uint16_t ui_node_text_max_width(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return 0;
  uint16_t textMaxW = __ui_nodes[nodeIdx].box.w;
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT || __ui_nodes[nodeIdx].kind == NODE_BUTTON || __ui_nodes[nodeIdx].kind == NODE_SELECT) {
    uint16_t hInset = static_cast<uint16_t>(__ui_nodes[nodeIdx].paddingLeft) + static_cast<uint16_t>(__ui_nodes[nodeIdx].paddingRight) +
      static_cast<uint16_t>(__ui_nodes[nodeIdx].borderWidth) * 2;
    textMaxW = __ui_nodes[nodeIdx].box.w > hInset ? static_cast<uint16_t>(__ui_nodes[nodeIdx].box.w - hInset) : 0;
  } else if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    textMaxW = __ui_nodes[nodeIdx].box.w > 22 ? static_cast<uint16_t>(__ui_nodes[nodeIdx].box.w - 22) : 0;
  }
  return textMaxW;
}

static inline void ui_node_text_layout_metrics(uint16_t nodeIdx, uint16_t textMaxW, uint16_t* outW, uint16_t* outH) {
  if (nodeIdx >= __ui_node_count) {
    if (outW) *outW = 0;
    if (outH) *outH = 0;
    return;
  }
  uint32_t key = ui_text_layout_cache_key(nodeIdx, textMaxW);
  if (__ui_nodes[nodeIdx].layoutCacheKey == key) {
    if (outW) *outW = __ui_nodes[nodeIdx].layoutMetricsW;
    if (outH) *outH = __ui_nodes[nodeIdx].layoutMetricsH;
    return;
  }
  const char* displayText = __ui_nodes[nodeIdx].hasTextBinding
    ? __ui_nodes[nodeIdx].textBuffer
    : __ui_nodes[nodeIdx].text;
  uint8_t ts = __ui_nodes[nodeIdx].textSize ? __ui_nodes[nodeIdx].textSize : 2;
  uint16_t tw = 0;
  uint16_t th = 0;
  ui_text_layout_metrics(displayText, textMaxW, __ui_nodes[nodeIdx].whiteSpaceMode, ts,
    __ui_nodes[nodeIdx].fontFace, __ui_nodes[nodeIdx].letterSpacing, __ui_nodes[nodeIdx].lineHeight, &tw, &th);
  __ui_nodes[nodeIdx].layoutCacheKey = key;
  __ui_nodes[nodeIdx].layoutMetricsW = tw;
  __ui_nodes[nodeIdx].layoutMetricsH = th;
  if (outW) *outW = tw;
  if (outH) *outH = th;
}

static inline void ui_copy_text_span(const char* start, const char* end, char* out, uint8_t outSize) {
  if (!out || outSize == 0) return;
  uint8_t len = 0;
  while (start && end && start < end && *start && len + 1 < outSize) {
    out[len++] = *start++;
  }
  out[len] = 0;
}

static inline uint8_t ui_draw_asset_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t antialias, uint8_t fontFace) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (!text || !face) return 0;
  int16_t cursor = x;
  int16_t baseline = y + face->baseline;
  int16_t targetLeft, targetTop, targetRight, targetBottom;
  ui_display_target_bounds(&targetLeft, &targetTop, &targetRight, &targetBottom);
  const unsigned char* p = (const unsigned char*)text;
  while (*p) {
    uint16_t codepoint = ui_next_utf8_codepoint(&p);
    const UIFontGlyph* glyph = ui_font_glyph(face, codepoint);
    if (!glyph) {
      cursor += face->lineHeight / 2;
      continue;
    }
    int16_t glyphX = cursor + glyph->xOffset;
    int16_t glyphY = baseline + glyph->yOffset;
    if (glyphX + static_cast<int16_t>(glyph->width) <= targetLeft || glyphX >= targetRight ||
        glyphY + static_cast<int16_t>(glyph->height) <= targetTop || glyphY >= targetBottom) {
      cursor += glyph->advance;
      continue;
    }
    int16_t gxStart = glyphX < targetLeft ? static_cast<int16_t>(targetLeft - glyphX) : 0;
    int16_t gyStart = glyphY < targetTop ? static_cast<int16_t>(targetTop - glyphY) : 0;
    int16_t gxEnd = glyphX + static_cast<int16_t>(glyph->width) > targetRight ? static_cast<int16_t>(targetRight - glyphX) : glyph->width;
    int16_t gyEnd = glyphY + static_cast<int16_t>(glyph->height) > targetBottom ? static_cast<int16_t>(targetBottom - glyphY) : glyph->height;
    for (int16_t gy = gyStart; gy < gyEnd; gy++) {
      for (int16_t gx = gxStart; gx < gxEnd; gx++) {
        uint16_t pixelIndex = static_cast<uint16_t>(gy) * glyph->width + static_cast<uint16_t>(gx);
        uint8_t alpha = ui_font_alpha_at(face, glyph, pixelIndex);
        if (alpha == 0) continue;
        int16_t dx = glyphX + gx;
        int16_t dy = glyphY + gy;
        if (antialias) {
          if (fg == bg) {
            // Transparent mode: can't blend (fg==bg → all alphas become fg).
            // Use a threshold so only high-coverage pixels draw, avoiding
            // the bumpy look from flattening sub-pixel coverage to solid.
            if (alpha >= 8) ui_display_draw_pixel(dx, dy, fg);
          } else {
            ui_display_draw_pixel(dx, dy, alpha >= 15 ? fg : ui_blend(fg, bg, static_cast<uint8_t>(static_cast<uint16_t>(alpha) * 100 / 15)));
          }
        } else if (alpha >= 8) {
          ui_display_draw_pixel(dx, dy, fg);
        }
      }
    }
    cursor += glyph->advance;
  }
  return 1;
}

static inline void ui_draw_bitmap_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts, int8_t letterSpacing) {
  if (!text) text = "";
  if (ts == 0) ts = 2;
  ui_display_set_text_color(fg, bg);
  ui_display_set_text_size(ts);
  ui_display_set_text_wrap(false);
  // Draw char-by-char to apply letterSpacing between glyphs.
  if (letterSpacing == 0) {
    ui_display_set_cursor(x, y);
    ui_display_print(text);
  } else {
    int16_t cx = x;
    char buf[2] = {0, 0};
    for (const char* p = text; *p; p++) {
      ui_display_set_cursor(cx, y);
      buf[0] = *p;
      ui_display_print(buf);
      cx += ts * 6 + letterSpacing;
    }
}
 }

 #ifdef UI_AA
 static CuttlefishCanvas16* __ui_aa_canvas = nullptr;
 static CuttlefishCanvas16* __ui_text_src_canvas = nullptr;
 static CuttlefishCanvas16* __ui_text_dst_canvas = nullptr;

 static inline CuttlefishCanvas16* ui_text_canvas(CuttlefishCanvas16** slot, int16_t w, int16_t h) {
   if (w <= 0) w = 1;
   if (h <= 0) h = 1;
   if (!*slot || display_canvasWidth(*slot) < w || display_canvasHeight(*slot) < h) {
     display_deleteCanvas(*slot);
     *slot = display_createCanvas(w, h);
   }
   return *slot;
 }

 static inline uint8_t ui_text_fg_neighbors(CuttlefishCanvas16* src, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T fg, uint8_t radius = 1) {
  uint8_t count = 0;
  for (int8_t dy = -static_cast<int8_t>(radius); dy <= static_cast<int8_t>(radius); dy++) {
    int16_t yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (int8_t dx = -static_cast<int8_t>(radius); dx <= static_cast<int8_t>(radius); dx++) {
      int16_t xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      if (display_canvasGetPixel(src, xx, yy) == fg) count++;
    }
  }
  return count;
}

static inline uint8_t ui_text_aa_coverage(uint8_t neighbors, uint8_t outerNeighbors, uint8_t isFg, uint8_t ts) {
  if (isFg) {
    if (ts <= 1) return neighbors >= 4 ? 100 : 96;
    if (ts == 2) return neighbors >= 8 ? 100 : neighbors >= 5 ? 96 : 92;
    return neighbors >= 8 ? 100 : neighbors >= 6 ? 96 : neighbors >= 4 ? 90 : 84;
  }
  if (neighbors == 0) {
    if (ts >= 3 && outerNeighbors > 0) {
      uint8_t outer = outerNeighbors * 2;
      return outer > 14 ? 14 : outer;
    }
    return 0;
  }
  uint8_t step = ts <= 1 ? 4 : ts == 2 ? 6 : 8;
  uint8_t cap = ts <= 1 ? 18 : ts == 2 ? 28 : 38;
  uint8_t coverage = neighbors * step;
  return coverage > cap ? cap : coverage;
}

// ── Rasterized-glyph coverage cache (LVGL-style) ──────────────────────────
// The classic-font AA pass neighbor-counts a 3x3 (5x5 for large sizes) kernel
// per pixel of the whole line canvas on EVERY repaint — a 460px label at ts=2
// costs ~70k canvas reads per frame. Classic 5x7 glyph cells are position-
// independent (the 6ts cell's trailing gap column is blank and the sampling
// radius never crosses it into the next glyph's pixels except the final gap
// column's 1px outer halo, which lands on spacing), so per-(char, ts)
// coverage is cacheable. Direct-mapped, color-independent (coverage is a
// shape property; fg/bg enter only at blend time).
#ifndef UI_AA_GLYPH_CACHE_SLOTS
#if defined(__AVR__)
#define UI_AA_GLYPH_CACHE_SLOTS 0
#else
#define UI_AA_GLYPH_CACHE_SLOTS 48
#endif
#endif
#define UI_AA_GLYPH_CACHE_MAX_TS 3
#if UI_AA_GLYPH_CACHE_SLOTS > 0
struct UIGlyphCovEntry {
  uint8_t ch;
  uint8_t ts;
  uint8_t valid;
  uint8_t cov[(6 * UI_AA_GLYPH_CACHE_MAX_TS) * (8 * UI_AA_GLYPH_CACHE_MAX_TS + 1)];
};
static struct UIGlyphCovEntry __ui_glyph_cov[UI_AA_GLYPH_CACHE_SLOTS];
static CuttlefishCanvas16* __ui_glyph_src_canvas = nullptr;

// Compute (on miss) and return the cached coverage map for one glyph cell,
// or nullptr when the size exceeds the cached range. The cell is
// (6*ts) x (8*ts + 1) — the +1 bottom pad row matches the whole-line canvas
// so bottom-edge coverage is identical.
static const uint8_t* ui_aa_glyph_coverage(uint8_t ch, uint8_t ts) {
  if (ts == 0U || ts > UI_AA_GLYPH_CACHE_MAX_TS) return nullptr;
  uint16_t slot = static_cast<uint16_t>((static_cast<uint16_t>(ch) * 7U) + ts) % UI_AA_GLYPH_CACHE_SLOTS;
  struct UIGlyphCovEntry* e = &__ui_glyph_cov[slot];
  if (e->valid && e->ch == ch && e->ts == ts) return e->cov;
  int16_t cw = static_cast<int16_t>(6 * ts);
  int16_t chh = static_cast<int16_t>(8 * ts + 1);
  if (cw <= 0 || chh <= 0) return nullptr;
  if (!__ui_glyph_src_canvas || display_canvasWidth(__ui_glyph_src_canvas) < cw || display_canvasHeight(__ui_glyph_src_canvas) < chh) {
    display_deleteCanvas(__ui_glyph_src_canvas);
    __ui_glyph_src_canvas = display_createCanvas(cw, chh);
  }
  if (!__ui_glyph_src_canvas || !display_canvasBuffer(__ui_glyph_src_canvas)) return nullptr;
  // Rasterize in black-on-white: coverage is shape-only (neighbor counts
  // compare against the glyph color), independent of the draw-time colors.
  const UI_COLOR_T cellFg = 0x0000;
  const UI_COLOR_T cellBg = 0xFFFF;
  display_canvasFillRect(__ui_glyph_src_canvas, 0, 0, cw, chh, cellBg);
  display_targetSetCursor((CuttlefishDisplayTarget*)__ui_glyph_src_canvas, 0, 0);
  display_targetSetTextColorBg((CuttlefishDisplayTarget*)__ui_glyph_src_canvas, cellFg, cellBg);
  display_targetSetTextSize((CuttlefishDisplayTarget*)__ui_glyph_src_canvas, ts);
  display_targetSetTextWrap((CuttlefishDisplayTarget*)__ui_glyph_src_canvas, false);
  char buf[2] = { static_cast<char>(ch), 0 };
  display_targetPrint((CuttlefishDisplayTarget*)__ui_glyph_src_canvas, buf);
  uint16_t i = 0;
  for (int16_t yy = 0; yy < chh; yy++) {
    for (int16_t xx = 0; xx < cw; xx++) {
      UI_COLOR_T px = display_canvasGetPixel(__ui_glyph_src_canvas, xx, yy);
      uint8_t neighbors = ui_text_fg_neighbors(__ui_glyph_src_canvas, xx, yy, cw, chh, cellFg);
      uint8_t outerNeighbors = 0;
      if (ts >= 3U && px != cellFg && neighbors == 0U) {
        outerNeighbors = ui_text_fg_neighbors(__ui_glyph_src_canvas, xx, yy, cw, chh, cellFg, 2);
      }
      e->cov[i++] = ui_text_aa_coverage(neighbors, outerNeighbors, px == cellFg ? 1U : 0U, ts);
    }
  }
  e->ch = ch;
  e->ts = ts;
  e->valid = 1U;
  return e->cov;
}
#else
static const uint8_t* ui_aa_glyph_coverage(uint8_t /*ch*/, uint8_t /*ts*/) { return nullptr; }
#endif

static inline void ui_draw_aa_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts) {
  if (!text || !*text) return;
  if (ts == 0) ts = 2;
  uint16_t w = ui_text_width(text, ts, 0, 0);
  // Add 1px bottom padding so the AA edge-detection sampling doesn't clip the
  // glyph bottoms (the neighbor-count at the last row rounds partial coverage
  // to 0 without this clearance).
  uint8_t h = ui_text_height(ts, 0) + 1;
  if (w == 0 || h == 0 || fg == bg) {
    ui_draw_bitmap_text(text, x, y, fg, bg, ts, 0);
    return;
  }
  int16_t clipX = x;
  int16_t clipY = y;
  int16_t clipW = static_cast<int16_t>(w);
  int16_t clipH = static_cast<int16_t>(h);
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  int16_t localX = static_cast<int16_t>(clipX - x);
  int16_t localY = static_cast<int16_t>(clipY - y);

  // Fast path (rasterized-glyph cache): when every glyph's coverage is
  // cached, blend per-cell straight into dst — no line-canvas rasterization,
  // no neighbor sampling. Identical coverage per pixel except the 1px outer
  // halo the whole-line kernel lands on the final gap column before a glyph
  // start (spacing-only; sub-perceptual).
  {
    const uint8_t* firstCov = ui_aa_glyph_coverage(static_cast<uint8_t>(text[0]), ts);
    if (firstCov != nullptr) {
      CuttlefishCanvas16* dst = ui_text_canvas(&__ui_text_dst_canvas, static_cast<int16_t>(w), static_cast<int16_t>(h));
      if (dst && display_canvasBuffer(dst)) {
        display_canvasFillRect(dst, localX, localY, clipW, clipH, bg);
        int16_t cellW = static_cast<int16_t>(6 * ts);
        int16_t cellH = static_cast<int16_t>(8 * ts + 1);
        int16_t cellX = 0;
        for (const char* p2 = text; *p2; p2++) {
          const uint8_t* cov = (p2 == text) ? firstCov : ui_aa_glyph_coverage(static_cast<uint8_t>(*p2), ts);
          if (!cov) break;  // size fell out of the cached range mid-string
          int16_t sx0 = cellX < localX ? static_cast<int16_t>(localX - cellX) : 0;
          int16_t sy0 = localY;
          int16_t sx1 = static_cast<int16_t>(cellX + cellW < localX + clipW ? cellX + cellW : localX + clipW);
          int16_t sy1 = static_cast<int16_t>(localY + clipH < cellH ? localY + clipH : cellH);
          for (int16_t yy = sy0; yy < sy1; yy++) {
            for (int16_t xx = static_cast<int16_t>(cellX + sx0); xx < sx1; xx++) {
              uint8_t coverage = cov[static_cast<uint16_t>(yy) * static_cast<uint16_t>(cellW) + static_cast<uint16_t>(xx - cellX)];
              display_targetDrawPixel((CuttlefishDisplayTarget*)dst, xx, yy,
                coverage == 0U ? bg : ui_blend(fg, bg, coverage));
            }
          }
          cellX += cellW;
          if (cellX >= localX + clipW) break;
        }
        int16_t stride = display_canvasWidth(dst);
        UI_COLOR_T* pixels = display_canvasBuffer(dst);
        for (int16_t row = 0; row < clipH; row++) {
          ui_display_draw_rgb_bitmap(clipX, static_cast<int16_t>(clipY + row),
            pixels + static_cast<int32_t>(localY + row) * stride + localX, clipW, 1);
        }
        return;
      }
    }
  }

// Use pre-allocated static canvases (no dynamic allocation)
   CuttlefishCanvas16* src = ui_text_canvas(&__ui_text_src_canvas, static_cast<int16_t>(w), static_cast<int16_t>(h));
   CuttlefishCanvas16* dst = ui_text_canvas(&__ui_text_dst_canvas, static_cast<int16_t>(w), static_cast<int16_t>(h));
   if (!src || !dst || !display_canvasBuffer(src) || !display_canvasBuffer(dst)) {
     ui_draw_bitmap_text(text, x, y, fg, bg, ts, 0);
     return;
   }

   display_canvasFillRect(src, 0, 0, w, h, bg);
   display_canvasFillRect(dst, localX, localY, clipW, clipH, bg);
   display_targetSetCursor((CuttlefishDisplayTarget*)src, 0, 0);
   display_targetSetTextColorBg((CuttlefishDisplayTarget*)src, fg, bg);
   display_targetSetTextSize((CuttlefishDisplayTarget*)src, ts);
   display_targetSetTextWrap((CuttlefishDisplayTarget*)src, false);
   display_targetPrint((CuttlefishDisplayTarget*)src, text);

   for (int16_t yy = localY; yy < localY + clipH; yy++) {
     for (int16_t xx = localX; xx < localX + clipW; xx++) {
       UI_COLOR_T px = display_canvasGetPixel(src, xx, yy);
       uint8_t neighbors = ui_text_fg_neighbors(src, xx, yy, static_cast<int16_t>(w), h, fg);
       uint8_t outerNeighbors = 0;
       if (ts >= 3 && px != fg && neighbors == 0) {
         outerNeighbors = ui_text_fg_neighbors(src, xx, yy, static_cast<int16_t>(w), h, fg, 2);
       }
       uint8_t coverage = ui_text_aa_coverage(neighbors, outerNeighbors, px == fg ? 1 : 0, ts);
       display_targetDrawPixel((CuttlefishDisplayTarget*)dst, xx, yy, coverage == 0 ? bg : ui_blend(fg, bg, coverage));
     }
   }

   int16_t stride = display_canvasWidth(dst);
   UI_COLOR_T* pixels = display_canvasBuffer(dst);
   for (int16_t row = 0; row < clipH; row++) {
     ui_display_draw_rgb_bitmap(clipX, static_cast<int16_t>(clipY + row),
       pixels + static_cast<int32_t>(localY + row) * stride + localX, clipW, 1);
   }
 }

static inline void ui_draw_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing) {
  if (fontFace && ui_draw_asset_text(text, x, y, fg, bg, antialias, fontFace)) {
    return;
  }
  // Only use AA when fg != bg (opaque background). When fg == bg (transparent
  // mode), the AA source canvas fills entirely with fg — no edges to detect,
  // producing a solid rectangle instead of text.
  if (antialias && fg != bg && letterSpacing == 0) {
    ui_draw_aa_text(text, x, y, fg, bg, ts);
    return;
  }
  ui_draw_bitmap_text(text, x, y, fg, bg, ts, letterSpacing);
}
#else
static inline void ui_draw_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing) {
  (void)antialias;
  if (fontFace && ui_draw_asset_text(text, x, y, fg, bg, antialias, fontFace)) {
    return;
  }
  ui_draw_bitmap_text(text, x, y, fg, bg, ts, letterSpacing);
}
#endif

// Draw classic list rows without routing through CuttlefishGFX::print(). The
// Zephyr native target uses CuttlefishGFX for both the panel and RGB565 canvas;
// its virtual text path is reliable on the panel but can be lost when the
// canvas is later copied to the panel. Writing the same 5x7 glyphs through the
// normal pixel/fill shims keeps the row pixels in the canvas buffer and works
// for both cached-list and band-list rendering. Other adapters retain the
// existing ui_draw_text fallback because they provide their own canvas text
// implementation.
static inline void ui_draw_list_text(const char* text, int16_t x, int16_t y,
                                      UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts,
                                      uint8_t fontFace, int8_t letterSpacing) {
#if defined(CUTTLEFISH_GFX_DEFINED)
  if (fontFace == 0) {
    if (!text) text = "";
    if (ts == 0) ts = 2;
    int16_t cx = x;
    for (const unsigned char* p = (const unsigned char*)text; *p; p++) {
      uint8_t ch = *p;
      // CuttlefishGFX's classic font is the full 256-glyph Adafruit table.
      for (uint8_t col = 0; col < 5; col++) {
        uint8_t bits = cuttlefish_glcdfont[static_cast<uint16_t>(ch) * 5u + col];
        for (uint8_t row = 0; row < 7; row++) {
          if (bits & static_cast<uint8_t>(1u << row)) {
            ui_display_fill_rect(static_cast<int16_t>(cx + static_cast<int16_t>(col) * ts),
              static_cast<int16_t>(y + static_cast<int16_t>(row) * ts), ts, ts, fg);
          }
        }
      }
      // Match the classic GFX advance: five columns plus one blank column.
      cx = static_cast<int16_t>(cx + static_cast<int16_t>(ts) * 6 + letterSpacing);
    }
    return;
  }
#endif
  ui_draw_text(text, x, y, fg, bg, ts, 0, fontFace, letterSpacing);
}

// Direct-panel list fallback. CuttlefishGFX's bitmap glyph path above is
// intentionally used for RAM canvases, but a few native panel adapters only
// commit their text state correctly through print()/drawChar(). Use that
// established path when the list is painted straight to the panel; the caller
// keeps the whole list inside one write transaction, so this does not expose a
// partially composed row set.
static inline void ui_draw_list_text_direct(const char* text, int16_t x, int16_t y,
                                             UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts,
                                             uint8_t fontFace, int8_t letterSpacing) {
  if (fontFace == 0) {
    ui_draw_bitmap_text(text, x, y, fg, bg, ts, letterSpacing);
  } else {
    ui_draw_text(text, x, y, fg, bg, ts, 0, fontFace, letterSpacing);
  }
}

/** Truncate a NUL-terminated buffer in place to fit within maxWidth (px) and
 *  append "...". Used by text-overflow: ellipsis. Adafruit_GFX has no ellipsis
 *  glyph, so three ASCII dots approximate it. */
static inline void ui_truncate_ellipsis(char* buf, uint8_t bufSize, uint16_t maxWidth,
                                        uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  if (!buf || bufSize == 0) return;
  uint8_t len = static_cast<uint8_t>(strlen(buf));
  // Reserve space for the three trailing dots.
  uint16_t dotsW = static_cast<uint16_t>(3) * ui_text_codepoint_advance(static_cast<uint16_t>('.'), ts, fontFace, letterSpacing);
  int16_t budget = static_cast<int16_t>(maxWidth) - static_cast<int16_t>(dotsW);
  if (budget <= 0) { if (bufSize > 3) { buf[0]='.'; buf[1]='.'; buf[2]='.'; buf[3]=0; } return; }
  // Measure once, then remove one UTF-8 codepoint at a time from the end.
  // The previous prefix-- loop rescanned the whole prefix on every iteration
  // (O(n²)); this keeps truncation linear for long bound strings.
  uint8_t prefix = len;
  uint16_t prefixW = ui_text_span_width(buf, buf + prefix, ts, fontFace, letterSpacing);
  while (prefix > 0 && static_cast<int16_t>(prefixW) > budget) {
    uint8_t cut = static_cast<uint8_t>(prefix - 1);
    while (cut > 0 && (static_cast<uint8_t>(buf[cut]) & 0xC0) == 0x80) cut--;
    uint16_t removed = ui_text_span_width(buf + cut, buf + prefix, ts, fontFace, letterSpacing);
    prefixW = prefixW > removed ? static_cast<uint16_t>(prefixW - removed) : 0;
    prefix = cut;
  }
  if (prefix + 3 < bufSize) {
    buf[prefix] = '.'; buf[prefix+1] = '.'; buf[prefix+2] = '.'; buf[prefix+3] = 0;
  } else if (bufSize > 3) {
    buf[0]='.'; buf[1]='.'; buf[2]='.'; buf[3]=0;
  }
}

// text-overflow: clip — trim trailing chars until the prefix fits maxWidth,
// then NUL-terminate. No trailing dots (contrast with ui_truncate_ellipsis).
static inline void ui_truncate_clip(char* buf, uint8_t bufSize, uint16_t maxWidth,
                                     uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  if (!buf || bufSize == 0) return;
  uint8_t len = static_cast<uint8_t>(strlen(buf));
  uint8_t prefix = len;
  uint16_t prefixW = ui_text_span_width(buf, buf + prefix, ts, fontFace, letterSpacing);
  while (prefix > 0 && static_cast<int16_t>(prefixW) > static_cast<int16_t>(maxWidth)) {
    uint8_t cut = static_cast<uint8_t>(prefix - 1);
    while (cut > 0 && (static_cast<uint8_t>(buf[cut]) & 0xC0) == 0x80) cut--;
    uint16_t removed = ui_text_span_width(buf + cut, buf + prefix, ts, fontFace, letterSpacing);
    prefixW = prefixW > removed ? static_cast<uint16_t>(prefixW - removed) : 0;
    prefix = cut;
  }
  if (prefix < bufSize) buf[prefix] = 0;
}

static inline void ui_draw_wrapped_text(const char* text, int16_t x, int16_t y, uint16_t maxWidth, UI_COLOR_T fg, UI_COLOR_T bg,
                                        uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing,
                                        uint8_t lineHeight, uint8_t whiteSpaceMode, uint8_t textAlign, uint8_t underline, uint8_t textOverflow) {
  if (!text) text = "";
  uint8_t lh = ui_text_line_height(ts, fontFace, lineHeight);
  const char* cursor = text;
  int16_t lineY = y;
  UITextLine line;
  char lineBuf[UI_TEXT_LINE_BUF];
  int16_t targetLeft, targetTop, targetRight, targetBottom;
  ui_display_target_bounds(&targetLeft, &targetTop, &targetRight, &targetBottom);
  while (ui_text_next_line(&cursor, maxWidth, whiteSpaceMode, ts, fontFace, letterSpacing, &line)) {
    int16_t lineBottom = static_cast<int16_t>(lineY + lh);
    if (lineBottom <= targetTop || lineY >= targetBottom) {
      lineY += lh;
      continue;
    }
    int16_t lineX = x;
    if (textAlign == 1) lineX = x + (static_cast<int16_t>(maxWidth) - static_cast<int16_t>(line.width)) / 2;
    else if (textAlign == 2) lineX = x + static_cast<int16_t>(maxWidth) - static_cast<int16_t>(line.width);
    if (lineX + static_cast<int16_t>(line.width) <= targetLeft || lineX >= targetRight) {
      lineY += lh;
      continue;
    }
    ui_copy_text_span(line.start, line.end, lineBuf, UI_TEXT_LINE_BUF);
    // text-overflow — only applies when the line is wider than maxWidth.
    //   textOverflow==1 (ellipsis): trim the span and append "...".
    //   textOverflow==0 (clip):     trim the span to the edge, no dots.
    if (static_cast<int16_t>(line.width) > static_cast<int16_t>(maxWidth)) {
      if (textOverflow) ui_truncate_ellipsis(lineBuf, UI_TEXT_LINE_BUF, maxWidth, ts, fontFace, letterSpacing);
      else              ui_truncate_clip(lineBuf, UI_TEXT_LINE_BUF, maxWidth, ts, fontFace, letterSpacing);
    }
    ui_draw_text(lineBuf, lineX, lineY, fg, bg, ts, antialias, fontFace, letterSpacing);
    // text-decoration (underline=bit0, strikethrough=bit1)
    if (underline & 1) ui_display_draw_fast_hline(lineX, lineY + ui_text_height(ts, fontFace) - 1, line.width, fg);
    if (underline & 2) ui_display_draw_fast_hline(lineX, lineY + ui_text_height(ts, fontFace) / 2, line.width, fg);
    lineY += lh;
  }
}

// Draw a rich-text node from its precomputed run/segment/line geometry. Does
// NOT re-wrap — the geometry was baked at transpile time (runs are static-only,
// so the text never changes at runtime). Iterate segments once, skip lines and
// segments outside the active draw target, and compute each segment's line
// origin from textAlign + line width. Mixed font sizes align on the line's
// baseline (each segment's top = baseline − its own ascent).
static inline void ui_draw_rich_text(uint16_t nodeIdx, int16_t x, int16_t y, UI_COLOR_T bg, uint8_t antialias,
                                     uint8_t useFgOverride = 0, UI_COLOR_T fgOverride = 0, uint16_t maxWidth = 0) {
  UINode* n = &__ui_nodes[nodeIdx];
  uint16_t alignWidth = maxWidth ? maxWidth : n->box.w;
  int16_t targetLeft = static_cast<int16_t>(-__ui_draw_off_x);
  int16_t targetTop = static_cast<int16_t>(-__ui_draw_off_y);
  int16_t targetRight = static_cast<int16_t>(ui_display_target_width() - __ui_draw_off_x);
  int16_t targetBottom = static_cast<int16_t>(ui_display_target_height() - __ui_draw_off_y);
  uint16_t richSegEnd = static_cast<uint16_t>(n->richSegStart + n->richSegCount);
  for (uint16_t si = n->richSegStart; si < richSegEnd; si++) {
    UIRichSeg* seg = &__ui_rich_segs[si];
    if (seg->line >= n->richLineCount) continue;
    UIRichLine* line = &__ui_rich_lines[n->richLineStart + seg->line];
    int16_t lineTop = y + line->y;
    int16_t lineBottom = static_cast<int16_t>(lineTop + static_cast<int16_t>(line->h));
    if (lineBottom <= targetTop || lineTop >= targetBottom) continue;
    int16_t lineX = x;
    if (n->textAlign == 1) lineX = x + (static_cast<int16_t>(alignWidth) - static_cast<int16_t>(line->w)) / 2;
    else if (n->textAlign == 2) lineX = x + static_cast<int16_t>(alignWidth) - static_cast<int16_t>(line->w);
    int16_t segX = static_cast<int16_t>(lineX + seg->x);
    int16_t segRight = static_cast<int16_t>(segX + static_cast<int16_t>(seg->w));
    if (segRight <= targetLeft || segX >= targetRight) continue;
    UIRichRun* run = &__ui_runs[n->runStart + seg->runIndex];
    // Baseline alignment: for asset fonts, the ascent is the font face's
    // baseline (baked per px size); for the bitmap font (fontFace=0), it's the
    // 5x8 glyph ascent (7px × textSize). Using the wrong ascent misaligns runs
    // vertically and makes mixed rich-text lines look garbled.
    int16_t ascent;
    if (run->fontFace) {
      const UIFontFace* face = ui_font_face(run->fontFace);
      ascent = face ? static_cast<int16_t>(face->baseline) : (7 * static_cast<int16_t>(run->textSize));
    } else {
      ascent = 7 * static_cast<int16_t>(run->textSize);
    }
    int16_t segY = y + line->baseline - ascent;
    UI_COLOR_T fg = useFgOverride ? fgOverride : run->fg;
    ui_draw_text(seg->text, segX, segY, fg, bg, run->textSize, antialias, run->fontFace, run->letterSpacing);
    if (run->underline & 1) ui_display_draw_fast_hline(segX, segY + 8 * run->textSize - 1, seg->w, fg);
    if (run->underline & 2) ui_display_draw_fast_hline(segX, segY + 4 * run->textSize, seg->w, fg);
  }
}

// Hit-test a tap point (in node-local coordinates) against a rich-text node's
// link runs. Returns the link run's resolved screen index, or -1 if the point
// doesn't land on a link segment. Mirrors the list-item subdivision precedent
// but uses measured segment rects instead of fixed row heights.
static inline int8_t ui_rich_link_hit(uint16_t nodeIdx, int16_t px, int16_t py) {
  UINode* n = &__ui_nodes[nodeIdx];
  int16_t insetL = static_cast<int16_t>(n->borderWidth) + static_cast<int16_t>(n->paddingLeft);
  int16_t insetR = static_cast<int16_t>(n->borderWidth) + static_cast<int16_t>(n->paddingRight);
  int16_t insetT = static_cast<int16_t>(n->borderWidth) + static_cast<int16_t>(n->paddingTop);
  int16_t localX = px - insetL;
  int16_t localY = py - insetT;
  uint16_t alignWidth = n->box.w > static_cast<uint16_t>(insetL + insetR)
    ? static_cast<uint16_t>(static_cast<int16_t>(n->box.w) - insetL - insetR)
    : 0;
  for (uint16_t si = n->richSegStart; si < n->richSegStart + n->richSegCount; si++) {
    UIRichSeg* seg = &__ui_rich_segs[si];
    UIRichRun* run = &__ui_runs[n->runStart + seg->runIndex];
    if (run->linkTarget < 0) continue;
    UIRichLine* line = &__ui_rich_lines[n->richLineStart + seg->line];
    // Segment x is relative to its line's left edge (pre-alignment). For the
    // hit-test, account for center/right alignment the same way draw does.
    int16_t originX = 0;
    if (n->textAlign == 1) originX = (static_cast<int16_t>(alignWidth) - static_cast<int16_t>(line->w)) / 2;
    else if (n->textAlign == 2) originX = static_cast<int16_t>(alignWidth) - static_cast<int16_t>(line->w);
    int16_t sx = originX + seg->x;
    int16_t sy = line->y;
    if (localX >= sx && localX < sx + static_cast<int16_t>(seg->w) && localY >= sy && localY < sy + static_cast<int16_t>(line->h)) {
      return run->linkTarget;
    }
  }
  return -1;
}

// Draw shadows for an element. Loops over up to 4 shadow specs. Outset shadows
// are drawn behind the element; inset shadows are drawn over the element fill.
// Draw a gradient fill for an element. Replaces solid fillRect/fillRoundRect.`;
}
