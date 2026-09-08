// Slice of the C++ runtime header (original source lines 2962-2994).
// ui_blend565/ui_blend888 bodies. Tiny slice sitting between touch and text in source.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitBlendBodies(): string {
  return `
// Blend LUTs (LVGL draw-unit trick, memory-frugal variant): two 256-entry
// per-channel tables rebuilt only when the opacity level CHANGES. Blends
// typically run per-pixel at a fixed opacity (skeleton pulse frame, one
// shadow pass, a glyph's coverage step), so the table amortizes to one
// rebuild per pass and every pixel becomes three array lookups instead of
// three multiply-divide rounds. Total cost: 513 bytes of static RAM.
static uint8_t __ui_blend_lut_fg[256];
static uint8_t __ui_blend_lut_bg[256];
static uint8_t __ui_blend_lut_opacity = 255; // 255 = never built (valid range 0..100)
static inline void ui_blend_lut_build(uint8_t opacity) {
  if (__ui_blend_lut_opacity == opacity) return;
  for (int16_t v = 0; v < 256; v++) {
    __ui_blend_lut_fg[v] = static_cast<uint8_t>((v * opacity) / 100);
    __ui_blend_lut_bg[v] = static_cast<uint8_t>((v * (100 - opacity)) / 100);
  }
  __ui_blend_lut_opacity = opacity;
}

static inline uint16_t ui_blend565(uint16_t fg, uint16_t bg, uint8_t opacity) {
  if (opacity >= 100) return fg;
  if (opacity == 0) return bg;
  ui_blend_lut_build(opacity);
  // Blend in 888 internally for higher precision: unpack 565->888 (replicating
  // high bits), blend at 8-bit, then re-quantize to 565. This produces smoother
  // intermediate values for AA text edges, opacity, shadows, and gradients --
  // the 565-channel blend (32 red levels) was too coarse and showed banding.
  uint8_t fr = (fg >> 11) & 0x1F, fg5 = (fg >> 5) & 0x3F, fb = fg & 0x1F;
  uint8_t br = (bg >> 11) & 0x1F, bg5 = (bg >> 5) & 0x3F, bb = bg & 0x1F;
  // Unpack to 8-bit (5-bit -> 8-bit: (v << 3) | (v >> 2)).
  uint16_t fr8 = (fr << 3) | (fr >> 2), fg8 = (fg5 << 2) | (fg5 >> 4), fb8 = (fb << 3) | (fb >> 2);
  uint16_t br8 = (br << 3) | (br >> 2), bg8 = (bg5 << 2) | (bg5 >> 4), bb8 = (bb << 3) | (bb >> 2);
  uint16_t r = static_cast<uint16_t>(__ui_blend_lut_fg[fr8] + __ui_blend_lut_bg[br8]);
  uint16_t g = static_cast<uint16_t>(__ui_blend_lut_fg[fg8] + __ui_blend_lut_bg[bg8]);
  uint16_t b = static_cast<uint16_t>(__ui_blend_lut_fg[fb8] + __ui_blend_lut_bg[bb8]);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

// Blend two RGB888 colors by opacity (0-100). Added for Phase 2 (RGB888/RGB666
// targets); unused in Phase 1, whose TFT path keeps 565 node values and blends
// via ui_blend565 above. Kept alongside so the 888 path is ready when the
// descriptor routes emit through resolveColor888.
static inline uint32_t ui_blend888(uint32_t fg, uint32_t bg, uint8_t opacity) {
  if (opacity >= 100) return fg;
  if (opacity == 0) return bg;
  ui_blend_lut_build(opacity);
  uint8_t fr = (fg >> 16) & 0xff, fg8 = (fg >> 8) & 0xff, fb = fg & 0xff;
  uint8_t br = (bg >> 16) & 0xff, bg8 = (bg >> 8) & 0xff, bb = bg & 0xff;
  uint8_t r = static_cast<uint8_t>(__ui_blend_lut_fg[fr] + __ui_blend_lut_bg[br]);
  uint8_t g = static_cast<uint8_t>(__ui_blend_lut_fg[fg8] + __ui_blend_lut_bg[bg8]);
  uint8_t b = static_cast<uint8_t>(__ui_blend_lut_fg[fb] + __ui_blend_lut_bg[bb]);
  return (static_cast<uint32_t>(r) << 16) | (static_cast<uint32_t>(g) << 8) | b;
}
`;
}
