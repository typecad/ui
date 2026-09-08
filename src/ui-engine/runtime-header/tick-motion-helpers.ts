// Slice of the C++ runtime header (original source lines 3910-3929).
// scroll_motion_active, keyframe_set_has_scroll_sensitive_geometry.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickMotionHelpers(): string {
  return `
static inline uint8_t ui_scroll_motion_active(uint8_t settlingOnActiveScreen) {
  if (__ui_scroll_node >= 0 && __ui_is_dragging) return 1;
  return settlingOnActiveScreen;
}

static inline uint8_t ui_keyframe_set_has_scroll_sensitive_geometry(uint8_t setIdx) {
  if (setIdx >= __ui_keyframe_set_count) return 0;
  const UIKeyframeSet* ks = &__ui_keyframe_sets[setIdx];
  for (uint8_t s = 0; s < ks->stopCount; s++) {
    if (ks->stops[s].props & (UI_KF_TRANSFORM | UI_KF_SIZE)) return 1;
  }
  return 0;
}

// Per-frame driver. The host async/loop pump calls this each tick (~16ms).
// Phase -2: poll touch (if configured). Phase -1: poll input pins.
// Phase 0: evaluate bindings. Phase 1: transitions. Phase 2: draw.
// Forward decl: the keyboard overlay is defined below but drawn at the end.
// (ui_kb_draw and ui_kb_handle_tap forward declarations are near the touch
// state machine, above.)`;
}
