// Slice of the C++ runtime header (original source lines 622-752).
// navigate, canvas/scroll/text/paint/clip/AA/image forward declarations, persistent canvas globals.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
//
// EMIT BOUNDARY: This file is the structural head of the UI runtime header
// surface (C) — every partial emitter in this directory produces bytes that are
// assembled into the C++ header inlined into user programs. The emitted bytes
// are covered by the TypeCAD Runtime Exception (see RUNTIME_EXCEPTION.md at the
// repository root) and are not subject to the license of this tool source.
export function emitForwardDecls(): string {
  return `
// ── Runtime clock + clamp (thin-HAL contract) ────────────────────────────
// The UI runtime's timing contracts (debounce, press/repeat, toasts,
// animations, scroll physics) need a monotonic millisecond clock. The
// framework strategy provides __tc_now_ms() (Zephyr: kernel uptime,
// native: steady_clock) — the same clock the async runtime and Time.now()
// lower onto. All comparisons are subtraction-based, so the 32-bit wrap
// (~49.7 days) is harmless.
extern uint32_t __tc_now_ms(void);
// Integer clamp used by progress/range draws and the keyboard value steps.
static inline long __ui_constrain(long x, long lo, long hi) { return (x < lo) ? lo : ((x > hi) ? hi : x); }

// ── Modal <select> + <drawer> declarations ────────────────────────────────
// Declared here (the earliest runtime-header module) because ui_navigate,
// ui_is_effectively_visible, ui_init, and ui_tick all reference them;
// definitions live in the touch/keyboard modules below.
// ── Modal <select> option list ────────────────────────────────────────────
// Tapping a select opens a centered list of its options; tapping a row sets
// the value, tapping outside dismisses. Mirrors the preview's select modal.
static int16_t __ui_select_menu = -1;   // node index while open, -1 closed
static uint8_t __ui_select_menu_dirty = 0; // overlay needs stamping this frame
static inline void ui_select_menu_open(uint16_t nodeIdx);
static inline void ui_select_menu_close(uint8_t repaint);
static inline void ui_select_menu_geom(uint16_t nodeIdx, UIRect* out, int16_t* rowH);
static inline void ui_select_menu_draw();
static inline void ui_select_menu_tap(int16_t tx, int16_t ty);

// ── <drawer> slide-in panels ──────────────────────────────────────────────
// Author-styled absolute panels; the runtime slides the subtree in from the
// drawer's edge (transform offsets), hides it while closed, and closes on
// outside taps. Mirrors the preview's drawer implementation.
#define UI_DRAWER_MAX 4
static int16_t  __ui_drawer_idx[UI_DRAWER_MAX];    // node index per slot, -1 free; int16 — node indices exceed 127 in real apps
static uint8_t  __ui_drawer_open[UI_DRAWER_MAX];   // target state (0 closed, 1 open)
static uint8_t  __ui_drawer_progress[UI_DRAWER_MAX]; // 0 closed .. 1 open
static uint8_t  __ui_drawer_slots = 0;             // discovered drawers (init scan)
static int16_t __ui_drawer_last_dx[UI_DRAWER_MAX]; // last applied slide dx (delta bookkeeping)
static int16_t __ui_drawer_last_dy[UI_DRAWER_MAX]; // last applied slide dy
static uint32_t __ui_toast_elapsed[UI_DRAWER_MAX]; // <toast>: ms since fully open
// Compose-region inflation for an open drawer's subtree compose: nodes the
// overlap classification skipped (their own ladder would paint their FULL
// rect over the open panel) still owe pixels — their uncovered sliver. The
// dirty pass unions their paint rect here; the drawer's subtree compose
// consumes it and clears the flag. Per-frame, reset at pass start.
static UIRect   __ui_drawer_inflate_rect[UI_DRAWER_MAX];
static uint8_t  __ui_drawer_inflate_used[UI_DRAWER_MAX];
static int8_t   __ui_drawer_slot_of(uint16_t nodeIdx);
static void     ui_drawer_discover();
static void     ui_drawer_open(uint16_t nodeIdx);
static void     ui_drawer_close(uint16_t nodeIdx);
static void     ui_drawer_close_all();
static void     ui_drawer_apply(uint8_t slot, uint8_t progress);
static void     ui_drawer_tick(uint32_t deltaMs);

// Early forward declaration: ui_navigate (below) calls ui_release_canvas_state
// and ui_set_pressed (defined later) during screen changes. Needed on native
// (single TU, no Arduino auto-prototyper).
static inline void ui_release_canvas_state();
static inline void ui_set_pressed(uint16_t nodeIdx, uint8_t pressed);
static inline void ui_refresh_active_screen_bg_node();
static inline CuttlefishCanvas16* ui_get_framebuffer();
// Set when the next frame must be composed from the active screen background;
// declared before ui_navigate because navigation can request that composition.
static uint8_t __ui_fb_needs_compose = 1;

// Navigate to a screen by index. Marks the new screen's nodes dirty, releases
// persistent canvas state, and requests a complete off-screen composition when
// the full-frame path is available. The physical panel is never cleared here on
// that path: navigation must not expose an intermediate frame while the next
// frame is built. Without a full-frame buffer, the fallback remains best-effort;
// no-TE TFT hardware cannot provide a strict tear-free guarantee.
static inline void ui_navigate(uint8_t screenIdx) {
  if (screenIdx >= __ui_screen_count || screenIdx == __ui_active_screen) return;
  __ui_active_screen = screenIdx;
  ui_refresh_active_screen_bg_node();
  // Reset scroll/touch state so the old screen's scroll container doesn't
  // interfere with the new screen. Release any currently-pressed button FIRST:
  // navigation fires from a button's click handler during touch-down, so the
  // matching touch-up release would otherwise be suppressed by the reset below
  // and the button would stay stuck in its :pressed color.
  if (__ui_touch_node >= 0 && __ui_touch_node < __ui_node_count &&
      __ui_nodes[__ui_touch_node].kind == NODE_BUTTON && __ui_nodes[__ui_touch_node].value != 0) {
    ui_set_pressed(static_cast<uint16_t>(__ui_touch_node), 0);
  }
  __ui_scroll_node = -1;
  __ui_touch_node = -1;
  __ui_touch_state = 0;
  __ui_kb_visible = 0;
  __ui_select_menu = -1;
  __ui_select_menu_dirty = 0;
  // Drawers reset closed on navigation (device parity with the preview).
  ui_drawer_close_all();
  for (uint8_t s = 0; s < __ui_drawer_slots; s++) ui_drawer_apply(s, 0);
  // Free every persistent canvas so the new screen allocates into a clean,
  // unfragmented heap. Without this, the previous screen's canvas buffer stays
  // resident and fragments the heap, so the new screen's buffer can't get a
  // contiguous block (the "works first, then blanks until reset" symptom).
  ui_release_canvas_state();
  // A framebuffer-capable target keeps the old frame visible until the new one
  // is complete. Targets without enough memory retain the legacy clear fallback
  // so stale pixels from the old screen cannot remain; this constrained path is
  // best-effort because the panel has no TE/vblank synchronization.
  if (ui_get_framebuffer()) {
    __ui_fb_needs_compose = 1;
  } else {
#ifndef UI_REFRESH_DEFERRED
    UI_COLOR_T navBg = (UI_COLOR_T)0;
    if (__ui_active_screen_bg_node < __ui_node_count) {
      navBg = __ui_nodes[__ui_active_screen_bg_node].hasBg
        ? __ui_nodes[__ui_active_screen_bg_node].bg
        : __ui_nodes[__ui_active_screen_bg_node].clearColor;
    }
    display_fillScreen(navBg);
#endif
  }
  // Mark all nodes dirty so the new screen fully redraws.
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
    __ui_nodes[i].lastTextHeight = 0;
    __ui_nodes[i].layoutCacheKey = 0;
    if (__ui_nodes[i].scrollable) {
      // The next screen needs a complete scroll-canvas seed; subsequent local
      // child updates can use retained-canvas repairs.
      __ui_nodes[i].lastPaintedScrollY = static_cast<int16_t>(
        __ui_nodes[i].scrollY - (__ui_nodes[i].box.h > 0 ? __ui_nodes[i].box.h : 1));
    }
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) __ui_nodes[i].lastTextWidth = -1;
    else __ui_nodes[i].lastTextWidth = 0;
  }
}
extern const uint16_t __ui_font_face_count;

#define UI_NO_PARENT 0xFFFF   // sentinel: out of uint16_t node-index range

// Forward declarations suppress Arduino's auto-prototyper, which would insert
// prototypes before UIFontFace/UIFontGlyph are declared.
static inline const UIFontFace* ui_font_face(uint8_t id);
static inline const UIFontGlyph* ui_font_glyph(const UIFontFace* face, uint16_t codepoint);
static inline uint8_t ui_font_alpha_at(const UIFontFace* face, const UIFontGlyph* glyph, uint16_t pixelIndex);
static inline uint16_t ui_asset_text_width(const char* text, const UIFontFace* face);
static inline uint8_t ui_asset_text_height(const UIFontFace* face);
static inline uint8_t ui_draw_asset_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t antialias, uint8_t fontFace);
static inline uint16_t ui_text_width(const char* text, uint8_t ts, uint8_t fontFace, int8_t letterSpacing);
struct UITextLine;
static inline uint8_t ui_text_next_line(const char** cursor, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, UITextLine* out);
static inline void ui_text_layout_metrics(const char* text, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, uint8_t lineHeight, uint16_t* outW, uint16_t* outH);
static inline void ui_invalidate_text_layout_cache(uint16_t nodeIdx);
static inline uint16_t ui_node_text_max_width(uint16_t nodeIdx);
static inline void ui_node_text_layout_metrics(uint16_t nodeIdx, uint16_t textMaxW, uint16_t* outW, uint16_t* outH);
static inline uint8_t ui_rects_intersect(int16_t ax, int16_t ay, int16_t aw, int16_t ah, int16_t bx, int16_t by, int16_t bw, int16_t bh);
static inline uint8_t ui_is_effectively_visible(uint16_t nodeIdx);
static inline uint8_t ui_node_draws_before(uint16_t a, uint16_t b);
static inline void ui_node_paint_rect(uint16_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH, UIRect* out);
static inline void ui_node_current_paint_rect(uint16_t nodeIdx, UIRect* out);
static inline uint8_t ui_subtree_current_paint_rect(uint16_t nodeIdx, UIRect* out);
static inline void ui_mark_overlapping_higher_layers_dirty(uint16_t nodeIdx);
static inline void ui_mark_overlapping_higher_layers_dirty_for_rect(uint16_t nodeIdx, const UIRect* r);
static inline void ui_mark_scroll_view_dirty(uint16_t scrollNode);
static inline UI_COLOR_T ui_parent_clear_color(uint16_t nodeIdx);
static inline void ui_release_canvas_state();
static inline void ui_set_visible(uint16_t nodeIdx, uint8_t visible);
static inline void ui_invalidate_scroll_canvas_for_node(uint16_t nodeIdx);
static inline uint8_t ui_clip_rect_to_rect(UIRect* r, const UIRect* clip);
static inline void ui_fill_rect_clipped(int16_t x, int16_t y, int16_t w, int16_t h, const UIRect* clip, UI_COLOR_T color);
static inline void ui_hline_clipped(int16_t x, int16_t y, int16_t w, const UIRect* clip, UI_COLOR_T color);
static inline void ui_vline_clipped(int16_t x, int16_t y, int16_t h, const UIRect* clip, UI_COLOR_T color);
static inline void ui_draw_rect_outline_clipped(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t style, uint8_t width, const UIRect* clip, UI_COLOR_T color);
static inline void ui_draw_node_decoration_clipped(uint16_t nodeIdx, int16_t drawY, const UIRect* clip);
// Forward declarations for functions used before their definition in the
// single native translation unit (Arduino's auto-prototyper hides this;
// native emits one TU so explicit forwards are needed).
static inline int8_t ui_rich_link_hit(uint16_t nodeIdx, int16_t px, int16_t py);
#ifdef UI_AA
static inline CuttlefishCanvas16* ui_aa_begin(int16_t w, int16_t h, UI_COLOR_T bg);
static inline void ui_aa_end(CuttlefishCanvas16* c);
static inline void ui_aa_push(CuttlefishCanvas16* c, int16_t dx, int16_t dy);
static inline void ui_aa_line(CuttlefishCanvas16* c, float x0, float y0, float x1, float y1, UI_COLOR_T color);
static inline void ui_aa_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color);
static inline void ui_aa_fill_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color);
#endif
static inline uint8_t ui_repair_current_node_paint_with_parent(uint16_t nodeIdx, UIRect* r);
static inline void ui_clear_node_paint_rect(uint16_t nodeIdx, const UIRect* paintRect);
static inline uint8_t ui_try_repair_geometry_fill(uint16_t nodeIdx, const UIRect* oldRect);
// Band renderers (defined in node-draw-body; forward-declared so the NODE_LIST
// case can fall back to ui_render_list_bands before its definition site).
static inline uint8_t ui_render_node_bands(uint16_t nodeIdx, int16_t prX, int16_t prY, int16_t prW, int16_t prH);
static inline uint8_t ui_render_screen_bands(int16_t rx, int16_t ry, int16_t rw, int16_t rh);
static inline uint8_t ui_render_list_bands(uint16_t i);
static inline uint8_t ui_render_list_direct(uint16_t i);
static inline void ui_draw_node_border(uint16_t i, int16_t drawX, int16_t drawY, UI_COLOR_T color);
static inline void ui_draw_node_outline(uint16_t i, int16_t drawX, int16_t drawY);
static inline void ui_draw_gradient_fill(uint16_t i, int16_t drawY);
static inline uint8_t ui_rotation_quadrant(int16_t deg);
static inline int16_t ui_rotated_face_w(uint16_t nodeIdx, int16_t w, int16_t h);
static inline int16_t ui_rotated_face_h(uint16_t nodeIdx, int16_t w, int16_t h);
static inline void ui_draw_image_rotated(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg);
static inline void ui_draw_image_with_fit(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                          uint8_t fitMode, int16_t targetW, int16_t targetH);
static inline void ui_draw_scaled_image(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                         int16_t drawW, int16_t drawH);

static CuttlefishDisplayTarget* __ui_gfx = display_defaultTarget();
// Full-frame composition is required for the first frame and after navigation.
// Once composed, subsequent dirty updates can safely modify the retained
// framebuffer without rebuilding unchanged nodes. The flags are declared
// before ui_navigate above because navigation sets the compose request.
// Persistent canvas slots, all freed on screen change (ui_navigate) so each
// screen starts with a clean heap. Without this, the first screen's canvas
// buffer stays resident and fragments the heap, so a later screen's buffer
// can't get a contiguous block — manifesting as that element blanking until a
// hard reset. File-scoped (not function-static) so ui_release_canvas_state can
// reach them.
static CuttlefishCanvas16* __ui_container_canvas = nullptr;  // Mode B shift-and-repair
static CuttlefishCanvas16* __ui_list_canvas = nullptr;       // virtualized <list> viewport
static int16_t __ui_list_canvas_node = -1;                   // node currently represented by __ui_list_canvas
static CuttlefishCanvas16* __ui_node_canvas = nullptr;       // <canvas> element offscreen
static CuttlefishCanvas16* __ui_repair_canvas = nullptr;     // buffered-paint / exposed-strip
static CuttlefishCanvas16* __ui_band_canvas = nullptr;       // band renderer (no-PSRAM scroll)
static CuttlefishCanvas16* __ui_kb_canvas = nullptr;         // on-screen keyboard overlay
static int16_t __ui_canvas_fallback_w = 0;                   // dimensions for direct <canvas> fallback
static int16_t __ui_canvas_fallback_h = 0;
// Draw offset: normally zero. The <canvas> allocation fallback sets it so
// callback-local coordinates draw into the node's current display/canvas target.
static int16_t __ui_draw_off_x = 0;
static int16_t __ui_draw_off_y = 0;

// Release every persistent canvas so the next screen allocates into a clean`;
}
