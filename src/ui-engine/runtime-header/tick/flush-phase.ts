// Slice of the C++ runtime header (original source lines 5288-5298).
// Phase 4/5: fb bulk push + refresh flush + closing brace of ui_tick.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickFlushPhase(): string {
  return `
  }
  // ── Framebuffer bulk push ────────────────────────────────────────────────
  // When a framebuffer was used this frame, publish only its changed bounds.
  // Local touch updates therefore avoid a full-screen SPI burst (which appears
  // as a brightness dip on panels without a synchronized frame latch).
  // Repairs performed before the dirty-node pass (for example transform
  // geometry cleanup) may update the retained buffer without leaving a node
  // dirty. The dirty-bounds accumulator is the authoritative publish signal.
  if (__ui_fb && (__ui_fb_frame_dirty || __ui_fb_dirty)) {
    ui_push_framebuffer();
  }
  ui_display_use_default_target();
  // ③ Flush — ILI9341 is immediate, no separate flush needed. On deferred-
  // refresh panels (e-ink), flush the union of this frame's dirty paint rects
  // as one partial refresh. No-op on TFT.`;
}
