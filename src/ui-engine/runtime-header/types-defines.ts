// Slice of the C++ runtime header (original source lines 17-89).
// Guard open, includes, and #define knobs.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTypesDefines(): string {
  return `
// ── TypeCAD UI runtime (emit once per TU) ──────────────────────────────
#ifndef __TC_UI_RUNTIME
#define __TC_UI_RUNTIME
#include <stdint.h>
#include <cstring>
#include <new>
#define UI_TEXT_BUF 32   // max stored UI text chars, excluding the trailing NUL
#define UI_TEXT_LINE_BUF 96
#define UI_WS_NORMAL 0
#define UI_WS_NOWRAP 1
#define UI_WS_PRE 2
#define UI_WS_PRE_LINE 3
#ifndef UI_MAX_BUFFERED_PAINT_PIXELS
#define UI_MAX_BUFFERED_PAINT_PIXELS 20000
#endif
// Above this many pixels, prefer the band renderer (small ~10KB SRAM canvas,
// strip-at-a-time) over the repair canvas even when the repair canvas could
// allocate (e.g. in PSRAM). A large repair canvas (a full-width button is
// ~15-30KB) has higher alloc/seed/push latency than banding — the per-band
// push is smaller and the band canvas lives in fast internal SRAM. Set below
// UI_MAX_BUFFERED_PAINT_PIXELS so large rects band while small repaints keep
// the fast single-canvas composite. Tune per target; 0 = always prefer the
// repair canvas when it allocates (the pre-PSRAM behavior).
#ifndef UI_BAND_PREFER_PIXELS
#define UI_BAND_PREFER_PIXELS 8000
#endif
#ifndef UI_USE_FULL_FRAMEBUFFER
#define UI_USE_FULL_FRAMEBUFFER 0
#endif
#ifndef UI_TRANSITION_SNAP_MS
#define UI_TRANSITION_SNAP_MS 100
#endif
// Scroll physics + capability defaults. The per-TU #define overrides emitted
// by the UI emitter (from resolveScrollConfig) hit BEFORE this header, so these
// #ifndef guards adopt the configured values. Spec: 2026-06-28-scroll-engine-rewrite-design.md
#ifndef UI_SCROLL_MAX_OVERSCROLL
#define UI_SCROLL_MAX_OVERSCROLL 40
#endif
#ifndef UI_SCROLL_STIFFNESS_X10
#define UI_SCROLL_STIFFNESS_X10 5
#endif
#ifndef UI_SCROLL_EDGE_SNAP_PX
#define UI_SCROLL_EDGE_SNAP_PX 12
#endif
#ifndef UI_SCROLL_DRAG_SCALE_X10
#define UI_SCROLL_DRAG_SCALE_X10 10
#endif
#ifndef UI_SCROLL_SETTLE_MS
#define UI_SCROLL_SETTLE_MS 180
#endif
#ifndef UI_SCROLL_DEADBAND_PX
#define UI_SCROLL_DEADBAND_PX 2
#endif
// Capability tier flags (emitted per-TU before this header; defaults = full).
// The default-on check must run BEFORE the per-flag #ifndef defaults below —
// after them, all three flags are defined 0 and the fallback would redefine
// UI_SCROLL_INPUT_TIER_RESISTIVE with a different value (ill-formed).
#if !defined(UI_SCROLL_INPUT_TIER_CAPACITIVE) && !defined(UI_SCROLL_INPUT_TIER_RESISTIVE) && !defined(UI_SCROLL_INPUT_TIER_NONE)
#define UI_SCROLL_INPUT_TIER_RESISTIVE 1
#endif
#ifndef UI_SCROLL_INPUT_TIER_CAPACITIVE
#define UI_SCROLL_INPUT_TIER_CAPACITIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_RESISTIVE
#define UI_SCROLL_INPUT_TIER_RESISTIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_NONE
#define UI_SCROLL_INPUT_TIER_NONE 0
#endif
#ifndef UI_SCROLL_RENDER_TIER_FULL
#define UI_SCROLL_RENDER_TIER_FULL 1
#endif
#ifndef UI_SCROLL_RENDER_TIER_CONSTRAINED
#define UI_SCROLL_RENDER_TIER_CONSTRAINED 0
#endif
#define UI_SCROLL_HAS_TOUCH (UI_SCROLL_INPUT_TIER_CAPACITIVE || UI_SCROLL_INPUT_TIER_RESISTIVE)
#define UI_SCROLL_ELASTIC (UI_SCROLL_RENDER_TIER_FULL)
// Telemetry: emits per-frame scrollY/overscrollPx/dy over Serial when defined.
#ifndef UI_SCROLL_DEBUG
#define UI_SCROLL_DEBUG 0
#endif
// Band renderer: height (px) of the horizontal band canvas used to composite
// scroll subtrees tear-free when no viewport canvas fits (no PSRAM / over
// budget). Each band is vw × UI_STRIP_BAND_HEIGHT. Must be tall enough that a
// single line of AA text (glyph height ~lineHeight, typically 16-22px at ts=2)
// fits within one band — if a glyph straddles a band boundary, its anti-
// aliased edge pixels blend toward the wrong bg in the adjacent band, visible
// as a clipped/faded text bottom. 32 ensures most fonts fit; at 480px wide
// that's ~30KB (fits SRAM on most ESP32 targets).
// Dirty-rect merging (LVGL refresh-cycle technique): several same-frame
// dirty nodes whose paint rects are near each other composite as one banded
// region instead of per-node transactions. Regions cap at the band-
// compositable pixel budget; singleton rects keep the per-node ladder.
#ifndef UI_MERGE_INFLATE
#define UI_MERGE_INFLATE 8
#endif
#ifndef UI_MERGE_MAX_REGIONS
#define UI_MERGE_MAX_REGIONS 6
#endif
#ifndef UI_MERGE_MAX_NODES
#define UI_MERGE_MAX_NODES 12
#endif

#ifndef UI_STRIP_BAND_HEIGHT
#define UI_STRIP_BAND_HEIGHT 32
#endif
#if defined(ESP32) || defined(ESP8266)
#include <Esp.h>
#endif
`;
}
