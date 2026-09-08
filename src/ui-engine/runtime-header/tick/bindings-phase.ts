// Slice of the C++ runtime header (original source lines 3930-4026).
// ui_tick signature + opening, caret blink re-mark, bindings/list-bindings/input-bindings. Contains ui_tick opening.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickBindingsPhase(): string {
  return `
static inline void ui_tick(uint16_t deltaMs) {
  // Touch poll — runs if touch is configured (defined by the emit layer)
  ui_poll_touch();
  // <drawer> slide animation (device parity with the preview's applyDrawers).
  ui_drawer_tick(deltaMs);
  // Allocate the retained framebuffer before transitions run. Geometry repair
  // must clear old animation footprints into RAM, not directly onto the panel.
  (void)ui_get_framebuffer();
  // ⓪' Poll GPIO inputs
  ui_poll_inputs();
#if defined(UI_HIDE_OSK)
  // Advance the caret blink phase for the active input (desktop target).
  __ui_kb_blink++;
  // Re-mark the edited input dirty every ~16 ticks so the blink repainting
  // keeps cycling even when no other state changes (otherwise the caret
  // freezes once the typed-text dirty clears).
  if (__ui_kb_visible && __ui_kb_target >= 0 && (__ui_kb_blink & 0x10)) {
    ui_mark_dirty(static_cast<uint16_t>(__ui_kb_target));
  }
#endif
  // ⓪ Evaluate bindings: call each binding's fn, compare to the node's
  // current property value, mark dirty if changed.
  for (uint16_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      // Text callbacks are necessarily evaluated to detect changes (the callback
      // may format a signal or read external state), but avoid a stack-sized old
      // copy: compare the generated value against the node buffer after writing.
      // The callback contract is fill-style and must be deterministic for the same
      // inputs; the temporary buffer keeps a change from destroying the old text.
      uint16_t n = __ui_bindings[i].node;
      if (n >= __ui_node_count) continue;
      char nextBuf[UI_TEXT_BUF + 1];
      nextBuf[0] = '\\0';
      __ui_bindings[i].textFn(nextBuf, UI_TEXT_BUF + 1);
      nextBuf[UI_TEXT_BUF] = '\\0';
      if (strcmp(nextBuf, __ui_nodes[n].textBuffer) != 0) {
        strncpy(__ui_nodes[n].textBuffer, nextBuf, UI_TEXT_BUF);
        __ui_nodes[n].textBuffer[UI_TEXT_BUF] = '\\0';
        ui_invalidate_text_layout_cache(n);
        ui_mark_dirty(n);
      }
    } else if (__ui_bindings[i].fn) {
      // Color/numeric binding
      uint32_t newVal = __ui_bindings[i].fn();
      if (__ui_bindings[i].prop == PROP_VISIBLE) {
        uint8_t nextVisible = newVal ? 1 : 0;
        if (nextVisible != __ui_nodes[__ui_bindings[i].node].visible) {
          ui_set_visible(__ui_bindings[i].node, nextVisible);
        }
        continue;
      }
      if (__ui_bindings[i].prop == PROP_VALUE) {
        // Numeric value binding: drive a progress/range node's value live.
        uint16_t n = __ui_bindings[i].node;
        int16_t v = static_cast<int16_t>(__ui_bindings[i].fn());
        if (v != __ui_nodes[n].value) {
          __ui_nodes[n].value = v;
          ui_mark_dirty(n);
        }
        continue;
      }
      // Cache numeric binding results. The first sample establishes the baseline;
      // subsequent identical values return immediately without touching node state.
      if (__ui_bindings[i].initialized && newVal == __ui_bindings[i].lastValue) continue;
      __ui_bindings[i].lastValue = newVal;
      __ui_bindings[i].initialized = 1;
      uint32_t* target = (__ui_bindings[i].prop == PROP_BG) ? &__ui_nodes[__ui_bindings[i].node].bg
                    : (__ui_bindings[i].prop == PROP_FG) ? &__ui_nodes[__ui_bindings[i].node].fg
                    : (__ui_bindings[i].prop == PROP_BORDER_COLOR) ? &__ui_nodes[__ui_bindings[i].node].borderColor
                    : &__ui_nodes[__ui_bindings[i].node].bg;
      if (newVal != *target) {
        *target = newVal;
        // When a background binding writes a new color, ensure hasBg is set
        // so the draw dispatch actually fills (the node may have started
        // transparent but now has a runtime-assigned background).
        if (__ui_bindings[i].prop == PROP_BG) __ui_nodes[__ui_bindings[i].node].hasBg = 1;
        ui_mark_dirty(__ui_bindings[i].node);
      }
    }
  }
  // ⓪b Evaluate list bindings (on-node): refresh item count, recompute content
  // height, and advance any in-flight settle animation (bounce-back / edge-snap).
  // Also note whether any active-screen node is settling (feeds scroll-motion
  // gating below without a second full-node scan).
  uint8_t settlingOnActiveScreen = 0;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].virtualized && __ui_nodes[i].listCountFn) {
      uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
      // Keep the callback result as the list's invalidation token. The callback
      // is still evaluated because it is the public list-count source, but an
      // unchanged token avoids layout/dirty work and preserves the retained
      // viewport canvas.
      uint16_t newCount = __ui_nodes[i].listCountFn();
      if (newCount != __ui_nodes[i].listCount) {
        __ui_nodes[i].listCount = newCount;
        __ui_nodes[i].contentHeight = static_cast<int16_t>(static_cast<uint32_t>(newCount) * ih);
        __ui_nodes[i].lastPaintedScrollY = __ui_nodes[i].scrollY - (__ui_nodes[i].box.h > 0 ? __ui_nodes[i].box.h : 1);
        ui_mark_dirty(i);
      }
    }
    if (__ui_nodes[i].settling) {
      if (__ui_nodes[i].screenId == __ui_active_screen) settlingOnActiveScreen = 1;
      ui_scroll_advance_settle(i, deltaMs);
    }
  }
  // ⓪c Evaluate input bindings (two-way): if a bound <input>'s textBuffer
  // changed since last tick (e.g. the user typed via the on-screen keyboard),
  // fire the author's callback with the new text.
  for (uint16_t i = 0; i < __ui_input_binding_count; i++) {
    if (!__ui_input_bindings[i].cb) continue;
    uint16_t n = __ui_input_bindings[i].node;
    if (n >= __ui_node_count) continue;
    const char* cur = __ui_nodes[n].textBuffer;
    if (strcmp(cur, __ui_input_bindings[i].lastSeen) != 0) {
      strncpy(__ui_input_bindings[i].lastSeen, cur, UI_TEXT_BUF);
      __ui_input_bindings[i].lastSeen[UI_TEXT_BUF] = '\\0';
      __ui_input_bindings[i].cb(cur);
    }`;
}
