// Slice of the C++ runtime header (original source lines 2562-2961).
// Touch hit-test/dispatch/state machine + keyboard forward-decls & state defines.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTouchKeyboardFwd(): string {
  return `
#include <cstdlib>  // abs() for drag-distance thresholds (self-sufficient slice)
// ── Touch hit-testing + click dispatch ─────────────────────────────────────
// Radio groups for mutual exclusion
struct UIRadioGroup {
  uint16_t nodeIndices[8];
  uint8_t count;
};
extern UIRadioGroup __ui_radio_groups[];
extern const uint16_t __ui_radio_group_count;

// Forward-declare the click handler type + tables (defined by the emit layer).
// The tables are const (flash rodata) — they are never written at runtime.
extern void (*const __ui_click_handlers[])();
extern void (*const __ui_hold_handlers[])();
extern void (*const __ui_release_handlers[])();
extern void (*__ui_rangechange_handlers[])();
extern const uint16_t __ui_click_handler_count;
extern const uint16_t __ui_hold_handler_count;
extern const uint16_t __ui_release_handler_count;
extern const uint16_t __ui_rangechange_handler_count;

// Touch state machine: tracks down → hold → up → click lifecycle
// Touch node/scroll node state is defined near navigation because ui_navigate resets it.
static uint32_t __ui_touch_down_time = 0;  // __tc_now_ms() when touch started
static int16_t __ui_touch_down_y_pos = 0; // Y position when touch started (for tap vs drag detection)
static uint32_t __ui_last_touch_time = 0;  // for debounce (updated on touch down only)
static uint32_t __ui_last_release_time = 0;  // for release debounce
static int16_t __ui_drag_start_x = 0;
static int16_t __ui_drag_start_y = 0;
static uint8_t __ui_is_dragging = 0;     // 1 once movement exceeds threshold
static int16_t __ui_range_node = -1;     // range slider being dragged (int16: node index can exceed 127)

// ── Awaitable tap source (for \`await ui.onTap()\`) ─────────────────────────
// __ui_tap_seq increments on every completed tap (after click/release dispatch);
// async awaiters poll it for change. __ui_tap_node records the node hit by the
// last tap (-1 = empty space / non-interactive area) for per-element awaiters.
// volatile: written in the touch path, read from task .step() polls.
static volatile uint32_t __ui_tap_seq = 0;
static volatile int16_t  __ui_tap_node = -1;   // int16: node index can exceed 127
// Keyboard overlay state.
#define UI_KB_MAX 48   // max key cells (4 rows × 11 padded cols + margin)
#define UI_KB_HOLD_MS 600
#define UI_KB_REPEAT_MS 100
#define UI_KB_TEXT_H 24  // height reserved for the preview text row at the top
struct UIKey { char ch; uint8_t special; };  // special: 0=char,1=shift,2=bs,3=ok,4=page
struct UIKeyStyle { uint32_t bg, fg, borderColor; };
static UIRect  __ui_kb_box;
static UIKey   __ui_kb_keys[UI_KB_MAX];
static UIKeyStyle __ui_kb_styles[UI_KB_MAX];
static UI_COLOR_T __ui_kb_bg = 0x0000;  // keyboard background (resolved from CSS)
static uint8_t __ui_kb_bs_held = 0;
static uint8_t __ui_kb_dirty = 0;     // 0=clean, 1=full redraw, 2=text row + single key
// (__ui_kb_canvas is declared in forward-decls.ts alongside the other persistent canvases.)
// Forward-declared here (defined in the keyboard subsystem block below) so the
// UI_HIDE_OSK caret/blink paths in ui_tick and the input draw can reference it.
static int16_t  __ui_kb_target;
#if defined(UI_HIDE_OSK)
// Caret blink phase for the desktop target (no OSK grid → no focus indicator).
// Incremented each tick; the input draw path blinks a caret on the active edit
// target every ~530ms (32 ticks ≈ 512ms at 60fps, even-power-of-2 mask).
static uint16_t __ui_kb_blink = 0;
#endif
static int8_t __ui_kb_pressed_key = -1; // key index under the current touch (-1=none)
static int8_t __ui_kb_repaint_key = -1; // key to repaint on a targeted (mode 2) redraw
static int16_t __ui_last_touch_x = 0;
static int16_t __ui_last_touch_y = 0;
// Keyboard function forward declarations (defined in the subsystem block below;
// needed because ui_touch_down/up/handle_touch reference them, AND to suppress
// Arduino's auto-prototyper which would inject prototypes before UIRect is defined).
static inline void ui_kb_insert(char c);
static inline void ui_kb_delete();
static inline void ui_kb_open(uint16_t nodeIdx, uint8_t inputPosition);
static inline void ui_kb_close();
static inline void ui_kb_tick(uint32_t now);
static inline void ui_kb_handle_touch(int16_t tx, int16_t ty);
static inline void ui_kb_handle_tap(int16_t tx, int16_t ty);
static inline void ui_kb_key_rect(uint8_t idx, UIRect* out);
static inline void ui_kb_draw();

// Modal <select> + <drawer> declarations live in forward-decls.ts
// (emit order: ui_navigate/visibility/ui_init reference them before this module).

static inline void ui_kb_draw_key(uint8_t i);
static inline void ui_kb_draw_text_row();
static inline void ui_kb_compute_box();
#define UI_TOUCH_DEBOUNCE_MS 50
#define UI_TOUCH_HOLD_MS 600
#define UI_DRAG_THRESHOLD 10

// Hit-test a touch point against all visible nodes (topmost first).
// Returns the node the tap TARGETS, resolved like the DOM: the topmost node
// whose box contains the point, then bubbling to ANCESTORS only. Returns -1
// if no ancestor of the target is interactive or handler-bearing.
static int16_t ui_hit_test(int16_t tx, int16_t ty) {
  // Phase 1 — the event target: the TOPMOST node containing the tap (last in
  // draw order), regardless of handlers. Filtering for handler-bearing nodes
  // here let a tap fall through SIBLING layers: a modal card (no handler,
  // higher z) over a click-to-close scrim (handler) routed every card tap to
  // the scrim underneath, so any tap dismissed the dialog. In the DOM the
  // click targets the topmost element and never propagates sideways to a
  // covered sibling.
  int16_t target = -1;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (!ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    if (__ui_nodes[i].disabled) continue;  // HTML disabled: not a tap target
    int16_t drawX = ui_draw_x_for_node(static_cast<uint16_t>(i));
    int16_t drawY = ui_draw_y_for_node(static_cast<uint16_t>(i));
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      // The node's box contains the tap. For nodes inside a scroll container,
      // the tap point (not the whole box) must lie within the visible viewport:
      // a tall wrapped paragraph can overflow below the fold yet still have a
      // tappable link segment in its visible portion.
      if (ui_is_point_clipped_by_scroll(static_cast<uint16_t>(i), tx, ty)) continue;
      if (target < 0 || ui_node_draws_before(target, i)) target = static_cast<int16_t>(i);
    }
  }
  // Phase 2 — bubbling: walk from the target up through its ancestors.
  // Interactive kinds match even with no JS handler wired — NODE_RANGE
  // (horizontal drag), NODE_INPUT (opens the keyboard), NODE_LIST
  // (virtualized item tap), and NODE_BUTTON/NODE_CHECK/NODE_RADIO so a
  // pure-CSS control still gets :pressed/transition visual feedback.
  int16_t n = target;
  while (n >= 0) {
    uint16_t u = static_cast<uint16_t>(n);
    if (__ui_nodes[u].kind == NODE_RANGE || __ui_nodes[u].kind == NODE_INPUT || __ui_nodes[u].kind == NODE_LIST || __ui_nodes[u].kind == NODE_BUTTON || __ui_nodes[u].kind == NODE_CHECK || __ui_nodes[u].kind == NODE_RADIO) return n;
    if ((u < __ui_click_handler_count && __ui_click_handlers[u]) ||
        (u < __ui_hold_handler_count && __ui_hold_handlers[u]) ||
        (u < __ui_release_handler_count && __ui_release_handlers[u])) return n;
    if (__ui_nodes[u].parent == UI_NO_PARENT || __ui_nodes[u].parent >= __ui_node_count) break;
    n = static_cast<int16_t>(__ui_nodes[u].parent);
  }
  return -1;
}

// Dispatch a handler from the given table if registered for the node.
static void ui_dispatch(void (*const* table)(), uint16_t count, int16_t node) {
  if (node >= 0 && static_cast<uint16_t>(node) < count && table[node]) {
    table[node]();
  }
}

static inline void ui_open_keyboard_for_input(uint16_t nodeIdx) {
  if (__ui_nodes[nodeIdx].kind != NODE_INPUT) return;
#if defined(UI_HIDE_OSK)
  // Desktop target: the OSK grid isn't shown, so inputs remain visible and
  // tappable while another is being edited. Commit any open session before
  // opening for the new target, so focus follows the tap instead of being
  // locked to the first input. (ui_kb_open is a no-op if already closed.)
  if (__ui_kb_visible) ui_kb_close();
#endif
  if (__ui_kb_visible) return;
  // Resolve the input's position in the loader dispatch table by scanning
  // for the Nth NODE_INPUT. (The loader table is indexed by input order.)
  // Counter is uint16_t: nodeIdx is uint16_t and inputs can live past node
  // 255 (demo-ui's are at 263/265/309). A uint8_t counter wraps 255→0 and
  // never reaches nodeIdx, deadlocking the device on input tap.
  uint8_t inputPos = 0;
  for (uint16_t j = 0; j < nodeIdx; j++) {
    if (__ui_nodes[j].kind == NODE_INPUT) inputPos++;
  }
  ui_kb_open(nodeIdx, inputPos);
}

// Touch down: called when screen is first touched.
static void ui_touch_down(int16_t tx, int16_t ty) {
  // Modal <select> list: record the touch position; tap-up routes to the
  // option rows. No hit-test/press/scroll while the overlay is open.
  if (__ui_select_menu >= 0) {
    __ui_touch_state = 1;
    __ui_touch_down_time = __tc_now_ms();
    return;
  }
  int16_t node = ui_hit_test(tx, ty);
  __ui_touch_node = node;
  __ui_touch_state = 1;
  __ui_touch_down_time = __tc_now_ms();
  __ui_touch_down_y_pos = ty;
  __ui_drag_start_x = tx;
  __ui_drag_start_y = ty;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
  __ui_range_node = -1;
  // Unified scroll-scan: one pass over scrollable nodes (containers AND lists —
  // lists are scrollable via the UA stylesheet) finds the owning container.
  // One owner per gesture; the double-delta bug class (node in both a container
  // and a list) is gone because there's no second mechanism.
#if UI_SCROLL_HAS_TOUCH
  __ui_scroll_node = ui_scroll_node_at(tx, ty);
#else
  (void)tx; (void)ty;
#endif
  if (node >= 0) {
    if (__ui_nodes[node].kind == NODE_BUTTON) {
      ui_set_pressed(static_cast<uint16_t>(node), 1);
    }
    // Track range nodes for horizontal drag
    if (__ui_nodes[node].kind == NODE_RANGE) {
      __ui_range_node = node;
      // Range owns this gesture. Do not let vertical touch jitter also scroll
      // the containing view, which would dirty and repaint the whole viewport.
      __ui_scroll_node = -1;
      // Immediately set value from touch position
      int16_t rMin = __ui_nodes[node].rangeMin;
      int16_t rMax = __ui_nodes[node].rangeMax;
      int16_t range = rMax - rMin;
      if (range <= 0) range = 100;
      int16_t relX = tx - ui_draw_x_for_node(static_cast<uint16_t>(node)) - 4;
      int16_t usable = __ui_nodes[node].box.w - 8;
      if (usable <= 0) usable = 1;
      int16_t nextVal = rMin + (static_cast<int32_t>(relX) * range) / usable;
      nextVal = __ui_constrain(nextVal, rMin, rMax);
      if (nextVal != __ui_nodes[node].value) {
        __ui_nodes[node].value = nextVal;
        ui_mark_dirty(node);
      }
    }
    // Only controls with a visual state change need a dirty repaint on touch-down:
    // buttons were marked by ui_set_pressed() above and ranges were marked when
    // their value changed. Links, inputs, checks, radios, selects, and list
    // containers do not have a pressed state; repainting them here is redundant
    // and can expose a clear/redraw flash on direct SPI targets. They repaint
    // after the click/value change (or when scrolling actually begins).
  }
}

// Touch up: called when touch is released. Determines click vs hold.
static void ui_touch_up() {
  // Modal keyboard: route tap-up to the keyboard; swallow normal click logic.
  // (Skipped on UI_HIDE_OSK desktop targets — touches pass through to the app,
  // since the editing session is driven by the real keyboard, not the grid.)
  // Open drawers close on outside taps (device parity with the preview).
  {
    int16_t dx0 = __ui_last_touch_x;
    int16_t dy0 = __ui_last_touch_y;
    for (uint8_t s = 0; s < __ui_drawer_slots; s++) {
      if (__ui_drawer_idx[s] < 0 || !__ui_drawer_open[s] || __ui_drawer_progress[s] < 255) continue;
      uint16_t di = static_cast<uint16_t>(__ui_drawer_idx[s]);
      // Hit-test the SUBTREE rect: a <dialog> root with absolutely
      // positioned children lays out at h=0 — the root box made every tap
      // count as "outside" and closed the dialog immediately.
      UIRect panelRect;
      if (!ui_subtree_current_paint_rect(di, &panelRect)) {
        panelRect.x = ui_draw_x_for_node(di);
        panelRect.y = ui_draw_y_for_node(di);
        panelRect.w = __ui_nodes[di].box.w;
        panelRect.h = __ui_nodes[di].box.h;
      }
      if (dx0 < panelRect.x || dx0 >= panelRect.x + panelRect.w ||
          dy0 < panelRect.y || dy0 >= panelRect.y + panelRect.h) {
        __ui_drawer_open[s] = 0;
      }
    }
  }
  if (__ui_select_menu >= 0) {
    ui_select_menu_tap(__ui_last_touch_x, __ui_last_touch_y);
    __ui_touch_state = 0;
    __ui_last_touch_time = __tc_now_ms();
    return;
  }
#if !defined(UI_HIDE_OSK)
  if (__ui_kb_visible) {
    ui_kb_handle_tap(__ui_last_touch_x, __ui_last_touch_y);
    __ui_kb_bs_held = 0;
    __ui_touch_state = 0;
    __ui_last_touch_time = __tc_now_ms();
    return;
  }
#endif
  uint32_t elapsed = __tc_now_ms() - __ui_touch_down_time;
  // Release the scroll owner: arm a bounded settle (bounce-back / edge-snap).
  // No fling — motion ends with the finger (the settle animation is the only
  // post-lift motion, terminating within UI_SCROLL_SETTLE_MS).
  if (__ui_scroll_node >= 0) {
    ui_scroll_release(__ui_scroll_node);
  }
  if (__ui_touch_node >= 0 && !__ui_is_dragging) {
    int16_t clickedNode = __ui_touch_node;
    if (elapsed < UI_TOUCH_HOLD_MS) {
      if (__ui_nodes[clickedNode].kind == NODE_INPUT) {
        ui_open_keyboard_for_input(static_cast<uint16_t>(clickedNode));
      }
      ui_dispatch(__ui_click_handlers, __ui_click_handler_count, __ui_touch_node);
      // Rich-text inline link: if the tapped node has link runs, find which link
      // segment the tap falls within and navigate to its target screen. Copies
      // the list-item subdivision precedent with measured run rects.
      if (__ui_nodes[clickedNode].runCount > 0) {
        int16_t ndx = __ui_last_touch_x - ui_draw_x_for_node(static_cast<uint16_t>(clickedNode));
        int16_t ndy = __ui_last_touch_y - ui_draw_y_for_node(static_cast<uint16_t>(clickedNode));
        int8_t target = ui_rich_link_hit(static_cast<uint16_t>(clickedNode), ndx, ndy);
        if (target >= 0) ui_navigate(static_cast<uint8_t>(target));
      }
    }
    ui_dispatch(__ui_release_handlers, __ui_release_handler_count, __ui_touch_node);
    // Built-in check/radio/select handlers mutate the node value during click
    // dispatch and need one repaint. Buttons are already dirty from releasing
    // :pressed; links, lists, inputs, and ordinary callbacks are either handled
    // by navigation/keyboard state or observed by bindings on the next tick.
    if (__ui_nodes[clickedNode].kind == NODE_CHECK ||
        __ui_nodes[clickedNode].kind == NODE_RADIO ||
        __ui_nodes[clickedNode].kind == NODE_SELECT) {
      ui_mark_dirty(static_cast<uint16_t>(clickedNode));
    }
  }
  // Release the pressed button's :pressed state unconditionally — even when a
  // drag/scroll hijacked the gesture (the click above is correctly gated on
  // !__ui_is_dragging, but the visual press state should always reset on lift,
  // otherwise a touch-down on a button followed by a scroll leaves it stuck).
  if (__ui_touch_node >= 0 && __ui_touch_node < __ui_node_count &&
      __ui_nodes[__ui_touch_node].kind == NODE_BUTTON && __ui_nodes[__ui_touch_node].value != 0) {
    ui_set_pressed(static_cast<uint16_t>(__ui_touch_node), 0);
  }
  // Resume any \`await ui.onTap()\` awaiter. Runs for EVERY completed tap —
  // including holds (released above) and taps on empty space (__ui_touch_node
  // == -1), which is what makes "wake on any touch" work for display-sleep.
  // Placed AFTER the click/release dispatch so onClick always fires first.
  // Note: explicit '+ 1' instead of '++' — GCC 13+ (IDF v6) deprecates '++'
  // on volatile-qualified types under -Werror=volatile.
  __ui_tap_seq = __ui_tap_seq + 1;
  __ui_tap_node = __ui_touch_node;
  // Virtualized list item tap: if the touch was inside a list, compute the item
  // index from the touch Y. Use total movement (not drag flag) to distinguish
  // tap from scroll: a tap moves < itemHeight/2 total; a scroll moves more.
  if (__ui_scroll_node >= 0 && __ui_nodes[__ui_scroll_node].virtualized) {
    int16_t n = __ui_scroll_node;
    if (__ui_nodes[n].listTapFn) {
      int16_t drawY = ui_draw_y_for_node(n);
      int16_t relY = __ui_last_touch_y - drawY;
      int16_t totalMove = abs(__ui_last_touch_y - __ui_touch_down_y_pos);
      uint16_t ih = __ui_nodes[n].listItemHeight > 0 ? __ui_nodes[n].listItemHeight : 24;
      if (totalMove < static_cast<int16_t>(ih / 2) &&
          relY >= 0 && relY < __ui_nodes[n].box.h) {
        uint16_t itemIdx = static_cast<uint16_t>((relY + __ui_nodes[n].scrollY) / ih);
        if (itemIdx < __ui_nodes[n].listCount) {
          __ui_nodes[n].listTapFn(itemIdx);
        }
      }
    }
  }
  __ui_touch_state = 0;
  __ui_touch_node = -1;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
  __ui_range_node = -1;
}

// Called each frame from ui_poll_touch when touch is detected.
// Implements debounce + the down/hold/up/click state machine.
static inline void ui_handle_touch(int16_t tx, int16_t ty) {
  uint32_t now = __tc_now_ms();
  // Track last touch coords for tap-up routing.
  __ui_last_touch_x = tx;
  __ui_last_touch_y = ty;

  // Modal keyboard: if visible, route touch to the keyboard only.
  // (Skipped on UI_HIDE_OSK desktop targets — touches pass through to the app,
  // since the editing session is driven by the real keyboard, not the grid.)
#if !defined(UI_HIDE_OSK)
  if (__ui_kb_visible) {
    // Only process the down-edge for key actions (insert/delete-on-down).
    // Repeat is handled by ui_kb_tick; release by ui_touch_up → ui_kb_handle_tap.
    if (__ui_touch_state == 0) {
      __ui_touch_state = 1;
      __ui_touch_down_time = now;
      if (tx >= __ui_kb_box.x && tx < __ui_kb_box.x + __ui_kb_box.w &&
          ty >= __ui_kb_box.y && ty < __ui_kb_box.y + __ui_kb_box.h) {
        ui_kb_handle_touch(tx, ty);
      }
    } else {
      // Held: run auto-repeat (backspace).
      ui_kb_tick(now);
    }
    __ui_last_touch_time = now;
    return;  // swallow all other touches while modal
  }
#endif

  if (__ui_touch_state == 0) {
    // Idle: check debounce, then start touch
    if (now - __ui_last_touch_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_down(tx, ty);
  } else {
    // Already touching: check for drag or hold
    if (__ui_range_node < 0 && !__ui_is_dragging && __ui_scroll_node >= 0) {
      // Check if movement exceeds drag threshold
      int16_t dy = ty - __ui_drag_start_y;
      if (abs(dy) >= UI_DRAG_THRESHOLD) {
        __ui_is_dragging = 1;
      }
    }
    // Range slider: update value from horizontal touch position
    if (__ui_range_node >= 0) {
      int16_t rMin = __ui_nodes[__ui_range_node].rangeMin;
      int16_t rMax = __ui_nodes[__ui_range_node].rangeMax;
      int16_t range = rMax - rMin;
      if (range <= 0) range = 100;
      int16_t relX = tx - ui_draw_x_for_node(static_cast<uint16_t>(__ui_range_node)) - 4;
      int16_t usable = __ui_nodes[__ui_range_node].box.w - 8;
      if (usable <= 0) usable = 1;
      int16_t newVal = rMin + (static_cast<int32_t>(relX) * range) / usable;
      newVal = __ui_constrain(newVal, rMin, rMax);
      if (newVal != __ui_nodes[__ui_range_node].value) {
        __ui_nodes[__ui_range_node].value = newVal;
        ui_mark_dirty(__ui_range_node);
        // Fire the onChange callback (if any) — every value change during drag.
        if (__ui_range_node < static_cast<int16_t>(__ui_rangechange_handler_count) &&
            __ui_rangechange_handlers[__ui_range_node]) {
          __ui_rangechange_handlers[__ui_range_node]();
        }
      }
    }
    // Unified scroll drag: one owning node, immediate-apply each frame (the
    // list's proven model, now used for all scroll containers). No accumulator,
    // no cadence gate, no pending buffer — the smoothed delta is applied via the
    // physics layer (1:1 in-bounds, rubber-band at edges). Telemetry optional.
    if (__ui_range_node < 0 && __ui_is_dragging && __ui_scroll_node >= 0) {
      int16_t rawDy = ty - __ui_drag_start_y;
      if (rawDy != 0) {
        int16_t dy = ui_scroll_smooth_dy(rawDy);
        if (dy != 0) {
          ui_apply_scroll_delta(__ui_scroll_node, dy);
          __ui_drag_start_y = ty;
#if UI_SCROLL_DEBUG
#if defined(ESP32) && defined(ARDUINO)
          Serial.printf("scroll dy=%d sy=%d ov=%d virt=%d\\n",
            dy, __ui_nodes[__ui_scroll_node].scrollY,
            __ui_nodes[__ui_scroll_node].overscrollPx,
            static_cast<int>(__ui_nodes[__ui_scroll_node].virtualized));
#else
          printk("scroll dy=%d sy=%d ov=%d virt=%d\\n",
            dy, __ui_nodes[__ui_scroll_node].scrollY,
            __ui_nodes[__ui_scroll_node].overscrollPx,
            static_cast<int>(__ui_nodes[__ui_scroll_node].virtualized));
#endif
#endif
        }
      }
    }
    if (__ui_touch_state == 1 && __ui_touch_node >= 0 && !__ui_is_dragging) {
      if (now - __ui_touch_down_time >= UI_TOUCH_HOLD_MS) {
        __ui_touch_state = 2;
        ui_dispatch(__ui_hold_handlers, __ui_hold_handler_count, __ui_touch_node);
      }
    }
  }
  __ui_last_touch_time = now;
}

// Called each frame when no touch is detected.
static inline void ui_handle_no_touch() {
  if (__ui_touch_state != 0) {
    // Debounce: require a gap since the last release before processing another.
    // This prevents crash from rapid touch/no-touch flicker on resistive screens.
    if (__tc_now_ms() - __ui_last_release_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_up();
    __ui_last_release_time = __tc_now_ms();
  }
}

// Blend two RGB565 colors by opacity (0-100). Returns fg faded toward bg.`;
}
