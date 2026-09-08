// Slice of the C++ runtime header (original source lines 5279-5287).
// scrollbar + buffered scroll canvas push.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickScrollCanvasPhase(): string {
  return `
  // ②b Draw scrollbar + push canvas for the buffered scroll container.
  if (bufferedScrollNode >= 0 && bufferedScrollCanvas) {
    ui_push_buffered_scroll_canvas(bufferedScrollCanvas, bufferedScrollRepaintCanvas,
      bufferedScrollNode, bufferedScrollVX, bufferedScrollVY,
      bufferedScrollRepaintY, bufferedScrollRepaintH, __ui_draw_target);
  } else if (bufferedScrollNode >= 0 && bufferedScrollBands) {
    // Band render fallback: the main loop didn't trigger it at the owner's
    // z-slot (e.g. the owner was filtered out after dispatch). Render now so
    // the subtree is never left unpainted. ui_render_scroll_bands sets
    // lastPaintedScrollY itself on success; only the failure fallback (band
    // canvas wouldn't allocate) needs to record the scrollY here so the next
    // frame's delta is correct.
    if (!ui_render_scroll_bands(static_cast<uint16_t>(bufferedScrollNode))) {
      // No band canvas means there is no coherent frame to submit. Retain the
      // previous viewport rather than drawing the scrollbar/direct subtree to
      // the live SPI target, which would reintroduce tearing.
      if (__ui_scroll_render_locked) __ui_scroll_render_locked[static_cast<uint16_t>(bufferedScrollNode)] = 1;
      __ui_nodes[bufferedScrollNode].dirty = 0;
    }
  } else if (bufferedScrollNode >= 0 && bufferedScrollDirectFull) {
    // The direct-full path is intentionally disabled for tear-sensitive scroll
    // rendering. Keep the retained pixels when no compositor is available.
    if (__ui_scroll_render_locked) __ui_scroll_render_locked[static_cast<uint16_t>(bufferedScrollNode)] = 1;
    __ui_nodes[bufferedScrollNode].dirty = 0;`;
}
