// Slice of the C++ runtime header (original source lines 902-999).
// ui_display_* target/pixel/bitmap/rect/cursor/text shim layer.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitDisplayShim(): string {
  return `

static inline CuttlefishDisplayTarget* ui_display_get_target() { return __ui_gfx; }
static inline void ui_display_set_target(CuttlefishDisplayTarget* target) {
  __ui_gfx = target ? target : display_defaultTarget();
}
static inline void ui_display_use_default_target() {
  __ui_gfx = display_defaultTarget();
}
static inline uint8_t ui_display_is_default_target() {
  return __ui_gfx == display_defaultTarget();
}
static inline int16_t ui_display_target_width() {
  return display_targetWidth(__ui_gfx);
}
static inline int16_t ui_display_target_height() {
  return display_targetHeight(__ui_gfx);
}
static inline int16_t ui_clamp_i16(int16_t value, int16_t lo, int16_t hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}
static inline void ui_display_target_bounds(int16_t* left, int16_t* top, int16_t* right, int16_t* bottom) {
  if (left) *left = static_cast<int16_t>(-__ui_draw_off_x);
  if (top) *top = static_cast<int16_t>(-__ui_draw_off_y);
  if (right) *right = static_cast<int16_t>(ui_display_target_width() - __ui_draw_off_x);
  if (bottom) *bottom = static_cast<int16_t>(ui_display_target_height() - __ui_draw_off_y);
}
static inline uint8_t ui_clip_rect_to_display_target(int16_t* x, int16_t* y, int16_t* w, int16_t* h) {
  if (!x || !y || !w || !h || *w <= 0 || *h <= 0) return 0;
  int16_t left, top, right, bottom;
  ui_display_target_bounds(&left, &top, &right, &bottom);
  int16_t x0 = *x > left ? *x : left;
  int16_t y0 = *y > top ? *y : top;
  int16_t x1 = static_cast<int16_t>(*x + *w);
  int16_t y1 = static_cast<int16_t>(*y + *h);
  if (x1 > right) x1 = right;
  if (y1 > bottom) y1 = bottom;
  if (x0 >= x1 || y0 >= y1) return 0;
  *x = x0;
  *y = y0;
  *w = static_cast<int16_t>(x1 - x0);
  *h = static_cast<int16_t>(y1 - y0);
  return 1;
}
static inline void ui_display_draw_pixel(int16_t x, int16_t y, UI_COLOR_T color) {
  display_targetDrawPixel(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_rgb_bitmap(int16_t x, int16_t y, const UI_COLOR_T* bitmap, int16_t w, int16_t h) {
  display_targetDrawRGBBitmap(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, bitmap, w, h);
}
static inline void ui_display_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {
  display_targetFillRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_fast_hline(int16_t x, int16_t y, int16_t w, UI_COLOR_T color) {
  display_targetDrawFastHLine(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_fast_vline(int16_t x, int16_t y, int16_t h, UI_COLOR_T color) {
  display_targetDrawFastVLine(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, h, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_fill_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {
  display_targetFillRoundRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_rect(int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {
  display_targetDrawRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {
  display_targetDrawRoundRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) {
  display_targetDrawLine(__ui_gfx, x0 + __ui_draw_off_x, y0 + __ui_draw_off_y,
    x1 + __ui_draw_off_x, y1 + __ui_draw_off_y, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_fill_circle(int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {
  display_targetFillCircle(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_circle(int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {
  display_targetDrawCircle(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_set_cursor(int16_t x, int16_t y) {
  display_targetSetCursor(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y);
}
static inline void ui_display_set_text_color(UI_COLOR_T fg, UI_COLOR_T bg) {
  display_targetSetTextColorBg(__ui_gfx, fg, bg);
}
static inline void ui_display_set_text_color_solid(UI_COLOR_T fg) {
  display_targetSetTextColor(__ui_gfx, fg);
}
static inline void ui_display_set_text_size(uint8_t size) {
  display_targetSetTextSize(__ui_gfx, size);
}
static inline void ui_display_set_text_wrap(bool wrap) {
  display_targetSetTextWrap(__ui_gfx, wrap);
}
static inline void ui_display_print(const char* text) {
  display_targetPrint(__ui_gfx, text);
}
`;
}
