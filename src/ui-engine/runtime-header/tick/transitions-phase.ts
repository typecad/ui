// Slice of the C++ runtime header (original source lines 4027-4233).
// transitions + keyframes.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickTransitionsPhase(): string {
  return `
  }
  // ① Advance transitions.
  for (uint16_t i = 0; i < __ui_trans_count; i++) {
    if (!__ui_trans[i].active) continue;
    __ui_trans[i].elapsed += deltaMs;
    uint16_t k = __ui_trans[i].durationMs == 0
      ? 100
      : static_cast<uint16_t>(static_cast<uint32_t>(__ui_trans[i].elapsed > __ui_trans[i].durationMs
          ? __ui_trans[i].durationMs : __ui_trans[i].elapsed) * 100 / __ui_trans[i].durationMs);
    if (__ui_trans[i].durationMs > 0 && __ui_trans[i].durationMs <= UI_TRANSITION_SNAP_MS) k = 100;
    uint32_t v = UI_LERP_COLOR(__ui_trans[i].prevValue, __ui_trans[i].targetValue, static_cast<uint8_t>(k));
    if (__ui_trans[i].prop == PROP_FG) {
      __ui_nodes[__ui_trans[i].node].fg = v;
    } else {
      __ui_nodes[__ui_trans[i].node].bg = v;
    }
    ui_mark_dirty(__ui_trans[i].node);
    if (k >= 100) __ui_trans[i].active = 0;
  }

  // ①b Advance @keyframes animations.
  uint8_t scrollMotionActive = ui_scroll_motion_active(settlingOnActiveScreen);
  for (uint16_t i = 0; i < __ui_anim_count; i++) {
    if (!__ui_anims[i].active) continue;
    // Skip animations on non-visible screens OR hidden subtrees — their nodes
    // are not drawn, so advancing them would paint stray fragments ("blotches")
    // on the active screen. The screenId check handles multi-screen nav; the
    // effective-visibility check handles master-detail panes (all on screen 0,
    // but only one pane is visible at a time — the rest have visible=0 set by
    // a ui.bind(..., 'visible', ...) binding). Without this, infinite animations
    // on a hidden pane (e.g. the transforms dots) keep ticking, marking their
    // nodes dirty, and repainting on top of the visible pane's content.
    {
      uint16_t animNode = __ui_anims[i].node;
      if (animNode >= __ui_node_count) continue;
      if (__ui_nodes[animNode].screenId != __ui_active_screen) continue;
      if (!ui_is_effectively_visible(animNode)) continue;
    }
    if (scrollMotionActive &&
        ui_keyframe_set_has_scroll_sensitive_geometry(__ui_anims[i].keyframeSet)) {
      continue;
    }
    __ui_anims[i].elapsed += static_cast<uint32_t>(deltaMs);
    uint32_t elapsedNoDelay = __ui_anims[i].elapsed;
    if (elapsedNoDelay < __ui_anims[i].delayMs) continue;
    elapsedNoDelay -= __ui_anims[i].delayMs;
    // Check iteration limit (finite).
    uint8_t completing = 0;
    if (__ui_anims[i].iterations > 0) {
      // Saturate the multiplication so a long duration × iteration count
      // cannot wrap and complete immediately after ~49 days of uptime.
      uint32_t totalDuration = static_cast<uint32_t>(__ui_anims[i].iterations) * static_cast<uint32_t>(__ui_anims[i].durationMs);
      if (__ui_anims[i].durationMs != 0 &&
          static_cast<uint32_t>(__ui_anims[i].iterations) > 0xFFFFFFFFUL / static_cast<uint32_t>(__ui_anims[i].durationMs)) {
        totalDuration = 0xFFFFFFFFUL;
      }
      if (elapsedNoDelay >= totalDuration) {
        elapsedNoDelay = totalDuration;
        completing = 1;
      }
    }
    // Compute cycle position: 0.0 - 1.0 within one loop.
    uint8_t pct = 100;
    if (!completing && __ui_anims[i].durationMs > 0) {
      uint32_t cycleMs = elapsedNoDelay % __ui_anims[i].durationMs;
      pct = static_cast<uint8_t>(static_cast<uint32_t>(cycleMs) * 100 / __ui_anims[i].durationMs);
    }
    // Find surrounding keyframe stops.
    if (__ui_anims[i].keyframeSet >= __ui_keyframe_set_count) continue;
    const UIKeyframeSet* ks = &__ui_keyframe_sets[__ui_anims[i].keyframeSet];
    if (ks->stopCount == 0) continue;
    // Find the two stops that bracket pct.
    uint8_t lo = 0, hi = ks->stopCount - 1;
    for (uint8_t s = 0; s < ks->stopCount; s++) {
      if (ks->stops[s].percent <= pct) lo = s;
      if (ks->stops[s].percent >= pct) { hi = s; break; }
    }
    const UIKeyframeStop* sLo = &ks->stops[lo];
    const UIKeyframeStop* sHi = &ks->stops[hi];
    // Lerp factor between lo and hi.
    uint8_t range = sHi->percent - sLo->percent;
    uint8_t lerpK = range > 0 ? static_cast<uint8_t>(static_cast<uint16_t>(pct - sLo->percent) * 100 / range) : 0;
    // Shape the lerp by the animation's timing function (ease-in-out, etc.).
    // CSS attaches it to the animation and applies it between stops.
    lerpK = ui_ease_lerp_k(__ui_anims[i].timingFunction, lerpK);
    // Apply to node — only mark dirty if a value actually changed.
    uint16_t n = __ui_anims[i].node;
    if (n >= __ui_node_count) continue;
    uint8_t changed = 0;
    if ((sLo->props & UI_KF_BG) && (sHi->props & UI_KF_BG)) {
      uint32_t newBg = range > 0 ? UI_LERP_COLOR(sLo->bg, sHi->bg, lerpK) : sLo->bg;
      if (newBg != __ui_nodes[n].bg) { __ui_nodes[n].bg = newBg; __ui_nodes[n].hasBg = 1; changed = 1; }
    }
    if ((sLo->props & UI_KF_FG) && (sHi->props & UI_KF_FG)) {
      uint32_t newFg = range > 0 ? UI_LERP_COLOR(sLo->fg, sHi->fg, lerpK) : sLo->fg;
      if (newFg != __ui_nodes[n].fg) { __ui_nodes[n].fg = newFg; changed = 1; }
    }
    if ((sLo->props & UI_KF_OPACITY) && (sHi->props & UI_KF_OPACITY)) {
      uint8_t newOp = range > 0
        ? static_cast<uint8_t>(static_cast<int16_t>(sLo->opacity) + (static_cast<int16_t>(sHi->opacity) - static_cast<int16_t>(sLo->opacity)) * lerpK / 100)
        : sLo->opacity;
      if (newOp != __ui_nodes[n].opacity) { __ui_nodes[n].opacity = newOp; changed = 1; }
    }
    int16_t nextTransformX = __ui_nodes[n].transformOffsetX;
    int16_t nextTransformY = __ui_nodes[n].transformOffsetY;
    int16_t nextRotateDeg = __ui_nodes[n].rotateDeg;
    int16_t nextWidth = __ui_nodes[n].box.w;
    int16_t nextHeight = __ui_nodes[n].box.h;
    uint8_t geometryChanged = 0;
    uint8_t hasSizeFrame = (sLo->props & UI_KF_SIZE) && (sHi->props & UI_KF_SIZE);
    if (hasSizeFrame) {
      nextWidth = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->width) + (static_cast<int32_t>(sHi->width) - static_cast<int32_t>(sLo->width)) * lerpK / 100)
        : sLo->width;
      nextHeight = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->height) + (static_cast<int32_t>(sHi->height) - static_cast<int32_t>(sLo->height)) * lerpK / 100)
        : sLo->height;
      if (nextWidth < 0) nextWidth = 0;
      if (nextHeight < 0) nextHeight = 0;
      if (nextWidth != __ui_nodes[n].box.w || nextHeight != __ui_nodes[n].box.h) {
        changed = 1;
        geometryChanged = 1;
      }
    }
    if ((sLo->props & UI_KF_TRANSFORM) && (sHi->props & UI_KF_TRANSFORM)) {
      int16_t pxX = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->transformOffsetX) + (static_cast<int32_t>(sHi->transformOffsetX) - static_cast<int32_t>(sLo->transformOffsetX)) * lerpK / 100)
        : sLo->transformOffsetX;
      int16_t pxY = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->transformOffsetY) + (static_cast<int32_t>(sHi->transformOffsetY) - static_cast<int32_t>(sLo->transformOffsetY)) * lerpK / 100)
        : sLo->transformOffsetY;
      int16_t pctX = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->translatePctX) + (static_cast<int32_t>(sHi->translatePctX) - static_cast<int32_t>(sLo->translatePctX)) * lerpK / 100)
        : sLo->translatePctX;
      int16_t pctY = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->translatePctY) + (static_cast<int32_t>(sHi->translatePctY) - static_cast<int32_t>(sLo->translatePctY)) * lerpK / 100)
        : sLo->translatePctY;
      int16_t scaleX = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->scaleX) + (static_cast<int32_t>(sHi->scaleX) - static_cast<int32_t>(sLo->scaleX)) * lerpK / 100)
        : sLo->scaleX;
      int16_t scaleY = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->scaleY) + (static_cast<int32_t>(sHi->scaleY) - static_cast<int32_t>(sLo->scaleY)) * lerpK / 100)
        : sLo->scaleY;
      nextRotateDeg = range > 0
        ? static_cast<int16_t>(static_cast<int32_t>(sLo->rotateDeg) + (static_cast<int32_t>(sHi->rotateDeg) - static_cast<int32_t>(sLo->rotateDeg)) * lerpK / 100)
        : sLo->rotateDeg;
      if (scaleX < 0) scaleX = 0;
      if (scaleY < 0) scaleY = 0;
      int16_t refW = hasSizeFrame ? nextWidth : __ui_anims[i].baseWidth;
      int16_t refH = hasSizeFrame ? nextHeight : __ui_anims[i].baseHeight;
      if (refW <= 0) refW = __ui_nodes[n].box.w;
      if (refH <= 0) refH = __ui_nodes[n].box.h;
      int16_t originPxX = static_cast<int16_t>(static_cast<int32_t>(refW) * __ui_anims[i].originX / 100);
      int16_t originPxY = static_cast<int16_t>(static_cast<int32_t>(refH) * __ui_anims[i].originY / 100);
      int16_t scaledW = static_cast<int16_t>(static_cast<int32_t>(refW) * scaleX / 100);
      int16_t scaledH = static_cast<int16_t>(static_cast<int32_t>(refH) * scaleY / 100);
      int16_t scaleOffsetX = originPxX - static_cast<int16_t>(static_cast<int32_t>(originPxX) * scaleX / 100);
      int16_t scaleOffsetY = originPxY - static_cast<int16_t>(static_cast<int32_t>(originPxY) * scaleY / 100);
      nextTransformX = pxX + static_cast<int16_t>(static_cast<int32_t>(refW) * pctX / 100) + scaleOffsetX;
      nextTransformY = pxY + static_cast<int16_t>(static_cast<int32_t>(refH) * pctY / 100) + scaleOffsetY;
      nextWidth = scaledW < 0 ? 0 : scaledW;
      nextHeight = scaledH < 0 ? 0 : scaledH;
      if (nextTransformX != __ui_nodes[n].transformOffsetX ||
          nextTransformY != __ui_nodes[n].transformOffsetY ||
          nextRotateDeg != __ui_nodes[n].rotateDeg ||
          nextWidth != __ui_nodes[n].box.w ||
          nextHeight != __ui_nodes[n].box.h) {
        changed = 1;
        geometryChanged = 1;
      }
    }
    if (changed) {
      // Throttle color/opacity-only redraws to ~10fps to avoid ILI9341 tearing
      // from rapid SPI writes (ada49b4). Spatial transforms (translate/scale/
      // rotate/size) are exempt: at 10fps a small dot moving a few px reads as
      // a jump, and the redraw is only the node's own tiny footprint, so the
      // tearing risk that motivated the gate doesn't apply. Geometry redraws
      // every frame a value actually changes (the 'changed' guard above still
      // suppresses no-op repaints).
      uint8_t throttleRedraw = !geometryChanged &&
        !(completing || __ui_anims[i].elapsed - __ui_anims[i].lastUpdateMs >= 100);
      if (!throttleRedraw) {
        UIRect oldGeometryRect = {0, 0, 0, 0};
        uint8_t hasOldGeometryRect = 0;
        if (geometryChanged) {
          ui_node_current_paint_rect(n, &oldGeometryRect);
          hasOldGeometryRect = oldGeometryRect.w > 0 && oldGeometryRect.h > 0;
          __ui_nodes[n].transformOffsetX = nextTransformX;
          __ui_nodes[n].transformOffsetY = nextTransformY;
          __ui_nodes[n].rotateDeg = nextRotateDeg;
          __ui_nodes[n].box.w = nextWidth;
          __ui_nodes[n].box.h = nextHeight;
          ui_invalidate_text_layout_cache(n);
        }
        uint8_t repairedGeometry = 0;
        if (geometryChanged && hasOldGeometryRect) {
          // Small moving solid fills can be repaired as one old+new union
          // bitmap. This avoids the visible erase-then-redraw blink that shows
          // up when transform animations run at full frame rate on SPI TFTs.
          repairedGeometry = ui_try_repair_geometry_fill(n, &oldGeometryRect);
        }
        if (geometryChanged && !repairedGeometry) {
          // Fallback: preserve the old behavior, but clear the captured OLD
          // footprint after the node fields have been updated.
          if (hasOldGeometryRect) ui_clear_node_paint_rect(n, &oldGeometryRect);
          else ui_clear_current_node_paint(n);
          ui_invalidate_scroll_canvas_for_node(n);
        }
        if (!repairedGeometry) ui_mark_dirty(n);
        __ui_anims[i].lastUpdateMs = __ui_anims[i].elapsed;
      }
    }
    if (completing) __ui_anims[i].active = 0;
  }`;
}
