// Slice of the C++ runtime header.
// The per-node kind switch, extracted into a callable function so the
// strip/band renderer (ui_render_scroll_bands) can compose scroll-subtree
// nodes into a band canvas without duplicating ~700 lines of kind-specific
// draw code.
//
// The caller fills a UINodeDrawCtx with the computed draw state (drawY, text
// metrics, colors, text source) and invokes ui_draw_node_body. Both the main
// dirty-node draw loop (dirty-draw-phase.ts) and the band renderer set the ctx
// up the same way; the difference is only what __ui_gfx points at (display /
// framebuffer / scroll canvas / band canvas) and how the node's box coords are
// translated, both of which the caller handles before calling this.
//
// The NODE_LIST case is special: it manages its own canvas push, static
// decoration, coordinate restore, dirty-clear, and then returns 1 (a sentinel
// meaning "I fully handled this node — skip the caller's post-switch
// epilogue"). Every other case returns 0 and the caller runs its epilogue
// (outline, paint-canvas push, coordinate restore, dirty-clear, refresh rect).
// This return-sentinel preserves the original 'continue;' the list case used
// to short-circuit the rest of the per-node loop body.
//
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitNodeDrawBody(): string {
  return `
// Computed draw state for one node, passed into ui_draw_node_body so it can be
// called from both the main dirty-node loop and the strip/band renderer.
struct UINodeDrawCtx {
  int16_t drawY;            // node's screen-space draw Y (scroll-adjusted)
  UI_COLOR_T bColor;        // border color (borderColor or fg, opacity-blended)
  UI_COLOR_T fillBg;        // fill background (bg, opacity-blended toward parent)
  uint8_t ts;               // text size
  uint16_t textMaxW;        // max text width (node box content width)
  uint16_t tw;              // laid-out text width
  uint16_t th;              // laid-out text height
  uint16_t paintTextW;      // paint-rect text width (tw + insets)
  uint16_t paintTextH;      // paint-rect text height (th + insets)
  const char* displayText;  // text source (binding buffer or flash literal)
  // Call-site draw state the NODE_LIST case reads. These mirror the main draw
  // loop's locals; the band renderer sets them to its own (target = band canvas,
  // drawingBufferedScroll = 0, origBox = the node's untranslated box).
  uint8_t drawingBufferedScroll;  // 1 when drawing into the buffered scroll canvas
  CuttlefishDisplayTarget* drawTarget;  // __ui_draw_target (framebuffer or display)
  int16_t origBoxX;         // node's untranslated box.x (restored after draw)
  int16_t origBoxY;         // node's untranslated box.y (restored after draw)
};

// Returns 1 when the node fully handled its own canvas push, decoration,
// coordinate restore, and dirty-clear (NODE_LIST). Returns 0 otherwise, in
// which case the caller is responsible for the post-switch epilogue.
//
// The ctx parameter is typed const void* (cast back to UINodeDrawCtx* below):
// the emitter auto-inserts a forward declaration of every function near the
// top of the program, BEFORE this struct is defined, so a struct-typed
// parameter makes that generated prototype fail to compile
// ("'UINodeDrawCtx' does not name a type"). Primitive-only parameters keep
// the auto-generated prototype valid; call sites still pass &ctx, which
// converts implicitly to const void*.
static inline uint8_t ui_draw_node_body(int16_t i, const void* rawCtx) {
  const UINodeDrawCtx* ctx = static_cast<const UINodeDrawCtx*>(rawCtx);
  int16_t drawY = ctx->drawY;
  UI_COLOR_T bColor = ctx->bColor;
  UI_COLOR_T fillBg = ctx->fillBg;
  uint8_t ts = ctx->ts;
  uint16_t textMaxW = ctx->textMaxW;
  uint16_t tw = ctx->tw;
  uint16_t th = ctx->th;
  uint16_t paintTextW = ctx->paintTextW;
  uint16_t paintTextH = ctx->paintTextH;
  const char* displayText = ctx->displayText;
  uint8_t drawingBufferedScroll = ctx->drawingBufferedScroll;
  CuttlefishDisplayTarget* __ui_draw_target = ctx->drawTarget;
  int16_t origBoxX = ctx->origBoxX;
  int16_t origBoxY = ctx->origBoxY;
  switch (__ui_nodes[i].kind) {
      case NODE_FILL:
        if (__ui_nodes[i].gradientEnabled > 0) {
          ui_draw_gradient_fill(i, drawY);
        } else if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg) {
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, __ui_nodes[i].borderRadius, fillBg);
        } else if (__ui_nodes[i].hasBg) {
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, fillBg);
        }
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          UI_COLOR_T bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
          int16_t borderW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t borderH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_draw_rect_outline(__ui_nodes[i].box.x, drawY, borderW, borderH,
            __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, bColor);
        }
        break;
      case NODE_TEXT:
        {
          int16_t insetL = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingLeft);
          int16_t insetR = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingRight);
          int16_t insetT = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingTop);
          int16_t textX = __ui_nodes[i].box.x + insetL;
          int16_t textY = drawY + insetT;
          int16_t textW = static_cast<int16_t>(__ui_nodes[i].box.w) - insetL - insetR;
          if (textW < 1) textW = 1;
          uint8_t textBoxPainted = 0;
          if (__ui_nodes[i].gradientEnabled > 0) {
            ui_draw_gradient_fill(i, drawY);
            textBoxPainted = 1;
          } else if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg) {
            ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY,
              __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].borderRadius, fillBg);
            textBoxPainted = 1;
          } else if (__ui_nodes[i].hasBg) {
            ui_display_fill_rect(__ui_nodes[i].box.x, drawY,
              __ui_nodes[i].box.w, __ui_nodes[i].box.h, fillBg);
            textBoxPainted = 1;
          }
          {
            uint16_t clearW = __ui_nodes[i].box.w;
            int16_t paintedTextW = static_cast<int16_t>(__ui_nodes[i].lastTextWidth) + insetL + insetR;
            if (__ui_nodes[i].lastTextWidth > 0 && paintedTextW > static_cast<int16_t>(clearW)) {
              clearW = static_cast<uint16_t>(paintedTextW);
            }
            uint16_t paddedTw = static_cast<uint16_t>(static_cast<int16_t>(tw) + insetL + insetR);
            if (paddedTw > clearW) clearW = paddedTw;
            // overflow:hidden/scroll: never clear past the node's own box. A nowrap
            // line wider than its box would otherwise erase the parent's border.
            if (__ui_nodes[i].scrollable) clearW = __ui_nodes[i].box.w;
            uint16_t clearH = __ui_nodes[i].box.h;
            int16_t paintedTextH = static_cast<int16_t>(__ui_nodes[i].lastTextHeight) + insetT + static_cast<int16_t>(__ui_nodes[i].paddingBottom) + static_cast<int16_t>(__ui_nodes[i].borderWidth);
            if (__ui_nodes[i].lastTextHeight > 0 && paintedTextH > static_cast<int16_t>(clearH)) {
              clearH = static_cast<uint16_t>(paintedTextH);
            }
            uint16_t paddedTh = static_cast<uint16_t>(static_cast<int16_t>(th) + insetT + static_cast<int16_t>(__ui_nodes[i].paddingBottom) + static_cast<int16_t>(__ui_nodes[i].borderWidth));
            if (paddedTh > clearH) clearH = paddedTh;
            // Dynamic transparent text still needs a clear, otherwise old glyph
            // pixels accumulate when only this text node is dirty.
            UI_COLOR_T clearCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            // Blend the clear toward the backdrop by opacity so a translucent text
            // node (inherited from an opacity:<1 parent) doesn't repaint a solid
            // block of its parent's fill around the glyphs.
            if (__ui_nodes[i].opacity < 100) {
              clearCol = ui_blend(clearCol, ui_parent_clear_color(i), __ui_nodes[i].opacity);
            }
            if (!textBoxPainted) {
              ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH, clearCol);
            }
            __ui_nodes[i].lastTextWidth = tw;
            __ui_nodes[i].lastTextHeight = th;
          }
          ui_draw_shadow(i, drawY, 1);
          if (__ui_nodes[i].borderStyle != 0) {
            ui_draw_node_border(i, __ui_nodes[i].box.x, drawY, bColor);
          }
          // Rich-text (inline runs): draw from precomputed geometry instead of the
          // single-string wrapped path. Geometry is baked at transpile time; the
          // runtime does not re-wrap.
          if (__ui_nodes[i].runCount > 0) {
          UI_COLOR_T richTextBg;
          if (__ui_nodes[i].opacity < 100) {
            uint16_t p = __ui_nodes[i].parent;
            UI_COLOR_T source = (p != UI_NO_PARENT && __ui_nodes[p].hasBg) ? __ui_nodes[p].bg
                          : (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
            richTextBg = ui_blend(source, __ui_nodes[i].clearColor, __ui_nodes[i].opacity);
          } else {
            richTextBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : ui_parent_clear_color(i);
          }
          if (__ui_nodes[i].textShadowCount > 0) {
            UI_COLOR_T tsClear = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            uint32_t tsCol = ui_blend(__ui_nodes[i].textShadowColor, tsClear, __ui_nodes[i].textShadowAlpha);
            // Shadow pass: draw the rich block in the shadow color at the offset.
            // (Per-segment shadow color is approximated by drawing the whole
            // block once in tsCol.)
            ui_draw_rich_text(i,
              textX + __ui_nodes[i].textShadowOffsetX,
              textY + __ui_nodes[i].textShadowOffsetY,
              tsClear, __ui_nodes[i].fontAntialias, 1, tsCol, static_cast<uint16_t>(textW));
          }
          ui_draw_rich_text(i, textX, textY, richTextBg, __ui_nodes[i].fontAntialias, 0, 0, static_cast<uint16_t>(textW));
          break;
        }
        {
          // Text shadow: draw the text in the shadow color at the offset first.
          UI_COLOR_T tsClear = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          if (__ui_nodes[i].textShadowCount > 0) {
            uint32_t tsCol = ui_blend(__ui_nodes[i].textShadowColor, tsClear, __ui_nodes[i].textShadowAlpha);
            ui_draw_wrapped_text(displayText,
              textX + __ui_nodes[i].textShadowOffsetX,
              textY + __ui_nodes[i].textShadowOffsetY,
              static_cast<uint16_t>(textW), tsCol, tsCol, ts, __ui_nodes[i].fontAntialias,
              __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing, __ui_nodes[i].lineHeight,
              __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, 0, __ui_nodes[i].textOverflow);
          }
          // Use the parent's clear color as the text background when the node
          // has no own background. This makes Adafruit_GFX's opaque glyph-cell
          // fill blend with the parent (instead of drawing solid fg blocks that
          // overlap adjacent lines/elements). For AA text, fg != bg so the
          // edge-detection path still runs correctly.
          // Glyph-cell background. For a translucent text node sitting on a
          // filled translucent parent, the glyph cells must match the parent's
          // blended fill: blend565(parent.bg, backdrop, opacity). The node's own
          // clearColor carries the backdrop (set by flatten), and opacity has
          // already inherited from the parent. Use the parent's raw bg as the
          // source so the glyph cells reproduce the parent's translucent fill.
          UI_COLOR_T textBg;
          if (__ui_nodes[i].opacity < 100) {
            uint16_t p = __ui_nodes[i].parent;
            UI_COLOR_T source = (p != UI_NO_PARENT && __ui_nodes[p].hasBg) ? __ui_nodes[p].bg
                          : (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
            textBg = ui_blend(source, __ui_nodes[i].clearColor, __ui_nodes[i].opacity);
          } else {
            textBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : ui_parent_clear_color(i);
          }
          ui_draw_wrapped_text(displayText, textX, textY, static_cast<uint16_t>(textW),
            __ui_nodes[i].fg, textBg, ts, __ui_nodes[i].fontAntialias,
            __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing, __ui_nodes[i].lineHeight,
            __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
          }
        }
        break;
      case NODE_BUTTON:
        // HTML disabled: halve the drawn colors (web-like faded control).
        if (__ui_nodes[i].disabled) {
          fillBg = (fillBg >> 1) & UI_DIM_MASK;
          bColor = (bColor >> 1) & UI_DIM_MASK;
        }
        if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg)
          ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].borderRadius, fillBg);
        else if (__ui_nodes[i].hasBg)
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, fillBg);
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          ui_draw_node_border(i, __ui_nodes[i].box.x, drawY, bColor);
        }
        {
          int16_t insetL = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingLeft);
          int16_t insetR = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingRight);
          int16_t insetT = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingTop);
          int16_t insetB = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingBottom);
          int16_t textX = __ui_nodes[i].box.x + insetL;
          int16_t textY = drawY + insetT;
          int16_t textW = static_cast<int16_t>(__ui_nodes[i].box.w) - insetL - insetR;
          int16_t textH = static_cast<int16_t>(__ui_nodes[i].box.h) - insetT - insetB;
          if (textW < 1) textW = 1;
          if (textH < 1) textH = static_cast<int16_t>(th);
          ui_draw_wrapped_text(displayText,
            textX,
            textY + (textH - static_cast<int16_t>(th)) / 2,
            static_cast<uint16_t>(textW),
            __ui_nodes[i].fg,
            __ui_nodes[i].hasBg ? fillBg : ui_parent_clear_color(i),
            ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
            __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
        }
        break;
      case NODE_SELECT:
        // <select>: a bordered, optionally rounded box with its current option
        // text drawn VERTICALLY CENTERED (unlike NODE_TEXT, which top-aligns).
        // Mirrors NODE_BUTTON's centering so the label sits mid-box when the
        // control is enlarged for touch (min-height). The label is dynamic
        // (auto-bound to the selected option's text), so clear the previous
        // text rect before redrawing, like NODE_CHECK does.
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > static_cast<int16_t>(clearW)) {
            clearW = static_cast<uint16_t>(__ui_nodes[i].lastTextWidth);
          }
          if (paintTextW > clearW) clearW = paintTextW;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > static_cast<int16_t>(clearH)) {
            clearH = static_cast<uint16_t>(__ui_nodes[i].lastTextHeight);
          }
          if (paintTextH > clearH) clearH = paintTextH;
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH,
            __ui_nodes[i].hasBg ? fillBg : ui_parent_clear_color(i));
          __ui_nodes[i].lastTextWidth = paintTextW;
          __ui_nodes[i].lastTextHeight = paintTextH;
        }
        if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg)
          ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].borderRadius, fillBg);
        else if (__ui_nodes[i].hasBg)
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, fillBg);
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          ui_draw_node_border(i, __ui_nodes[i].box.x, drawY, bColor);
        }
        {
          int16_t insetL = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingLeft);
          int16_t insetR = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingRight);
          int16_t insetT = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingTop);
          int16_t insetB = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingBottom);
          int16_t textX = __ui_nodes[i].box.x + insetL;
          int16_t textY = drawY + insetT;
          // The right end reserves 14px for the dropdown chevron — the label
          // wraps against the reduced width, never under the chevron.
          int16_t textW = static_cast<int16_t>(__ui_nodes[i].box.w) - insetL - insetR - 14;
          int16_t textH = static_cast<int16_t>(__ui_nodes[i].box.h) - insetT - insetB;
          if (textW < 1) textW = 1;
          if (textH < 1) textH = static_cast<int16_t>(th);
          ui_draw_wrapped_text(displayText,
            textX,
            textY + (textH - static_cast<int16_t>(th)) / 2,
            static_cast<uint16_t>(textW),
            __ui_nodes[i].fg,
            __ui_nodes[i].hasBg ? fillBg : ui_parent_clear_color(i),
            ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
            __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
          // Dropdown chevron: a small solid v at the right end — the
          // affordance that the control opens a menu of options.
          {
            int16_t chX = __ui_nodes[i].box.x + static_cast<int16_t>(__ui_nodes[i].box.w) - insetR - 11;
            int16_t chY = drawY + (static_cast<int16_t>(__ui_nodes[i].box.h) - 5) / 2;
            ui_display_fill_rect(chX,     chY,     9, 1, __ui_nodes[i].fg);
            ui_display_fill_rect(chX + 1, chY + 1, 7, 1, __ui_nodes[i].fg);
            ui_display_fill_rect(chX + 2, chY + 2, 5, 1, __ui_nodes[i].fg);
            ui_display_fill_rect(chX + 3, chY + 3, 3, 1, __ui_nodes[i].fg);
            ui_display_fill_rect(chX + 4, chY + 4, 1, 1, __ui_nodes[i].fg);
          }
        }
        break;
      case NODE_CHECK:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > static_cast<int16_t>(clearW)) {
            clearW = static_cast<uint16_t>(__ui_nodes[i].lastTextWidth);
          }
          if (paintTextW > clearW) clearW = paintTextW;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > static_cast<int16_t>(clearH)) {
            clearH = static_cast<uint16_t>(__ui_nodes[i].lastTextHeight);
          }
          if (paintTextH > clearH) clearH = paintTextH;
          // border-radius > 0 (kit .switch pills): clear the full text rect to
          // the backdrop, then paint the rounded box. Mirrors the preview's
          // drawCheckNode pill path. The :checked pair (kit wires it to
          // --primary/--primary-foreground) swaps the TRACK color when on.
          if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg) {
            ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH,
              ui_parent_clear_color(i));
            ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY,
              __ui_nodes[i].box.w, __ui_nodes[i].box.h,
              __ui_nodes[i].borderRadius,
              (__ui_nodes[i].value && __ui_nodes[i].hasCheckedBg) ? __ui_nodes[i].checkedBg : fillBg);
          } else {
            ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH,
              __ui_nodes[i].hasBg ? fillBg : ui_parent_clear_color(i));
          }
          __ui_nodes[i].lastTextWidth = paintTextW;
          __ui_nodes[i].lastTextHeight = paintTextH;
        }
        {
          // Pills inset the 16px indicator from the left edge so the knob
          // doesn't touch the rounded end; plain checkboxes keep it flush.
          // The knob SLIDES with state — left when off, right when on — the
          // switch affordance (static jump; no travel animation).
          int16_t knobSlide = __ui_nodes[i].borderRadius > 0
            ? static_cast<int16_t>(__ui_nodes[i].box.w) - 16 - 6
            : 0;
          if (knobSlide < 0) knobSlide = 0;
          int16_t cbX = __ui_nodes[i].box.x
            + (__ui_nodes[i].borderRadius > 0 ? 3 : 0)
            + (__ui_nodes[i].value ? knobSlide : 0);
          // Vertically center the 16px indicator within the box so a tall
          // (touch-friendly) checkbox doesn't pin the indicator to the top.
          // (box.h - 16) / 2 is 0 for the default 16px-tall box, so existing
          // checkboxes render byte-identically.
          int16_t cbY = drawY + (static_cast<int16_t>(__ui_nodes[i].box.h) - 16) / 2;
          if (cbY < drawY) cbY = drawY;
          if (__ui_nodes[i].value && __ui_nodes[i].borderRadius > 0) {
            // Switch pill: the knob stays a knob — a solid circle when on, no
            // checkbox square + checkmark. Same geometry as the radio dot.
            // The knob carries the :checked color (primary-foreground).
            ui_display_fill_circle(cbX + 8, cbY + 8, 7,
              __ui_nodes[i].hasCheckedFg ? __ui_nodes[i].checkedFg : __ui_nodes[i].fg);
          } else if (__ui_nodes[i].value) {
            // Checked face carries the :checked background (primary), the
            // checkmark its color (primary-foreground).
            ui_display_fill_rect(cbX, cbY, 16, 16,
              __ui_nodes[i].hasCheckedBg ? __ui_nodes[i].checkedBg : __ui_nodes[i].fg);
            UI_COLOR_T inv = __ui_nodes[i].hasCheckedFg ? __ui_nodes[i].checkedFg
              : (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
#ifdef UI_AA
            {
              // Draw the checkmark to a 16×16 AA canvas for smooth diagonals.
              CuttlefishCanvas16* c = ui_aa_begin(16, 16, __ui_nodes[i].fg);
              // First stroke: down-left (3,8 → 7,12)
              if (c) {
                ui_aa_line(c, 4.0f, 8.0f, 7.0f, 12.0f, inv);
                ui_aa_line(c, 5.0f, 8.0f, 8.0f, 12.0f, inv);
                // Second stroke: up-right (7,11 → 13,4)
                ui_aa_line(c, 7.0f, 11.0f, 13.0f, 4.0f, inv);
                ui_aa_line(c, 8.0f, 11.0f, 14.0f, 4.0f, inv);
                ui_aa_push(c, cbX, cbY);
              } else {
                ui_display_draw_line(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
                ui_display_draw_line(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
                ui_display_draw_line(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
                ui_display_draw_line(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
              }
            }
#else
            ui_display_draw_line(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
            ui_display_draw_line(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
            ui_display_draw_line(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
            ui_display_draw_line(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
            ui_display_draw_line(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
            ui_display_draw_line(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
#endif
          } else if (__ui_nodes[i].borderRadius > 0) {
            // Off-state pill: hollow circular knob outline on the track.
            ui_display_draw_circle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
          } else {
            ui_display_draw_rect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
          }
        }
        // Center the label on the same baseline as the indicator: apply the
        // indicator's vertical offset to the text origin too, so a tall box
        // keeps the indicator + label aligned as a row rather than straddling
        // the box top/bottom.
        {
          int16_t checkOff = (static_cast<int16_t>(__ui_nodes[i].box.h) - 16) / 2;
          if (checkOff < 0) checkOff = 0;
          ui_draw_wrapped_text(displayText, __ui_nodes[i].box.x + 22, drawY + checkOff, textMaxW,
            __ui_nodes[i].fg, __ui_nodes[i].hasBg ? fillBg : ui_parent_clear_color(i),
            ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
            __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, 0, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
        }
        break;
      case NODE_RADIO:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > static_cast<int16_t>(clearW)) {
            clearW = static_cast<uint16_t>(__ui_nodes[i].lastTextWidth);
          }
          if (paintTextW > clearW) clearW = paintTextW;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > static_cast<int16_t>(clearH)) {
            clearH = static_cast<uint16_t>(__ui_nodes[i].lastTextHeight);
          }
          if (paintTextH > clearH) clearH = paintTextH;
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH,
            __ui_nodes[i].hasBg ? fillBg : ui_parent_clear_color(i));
          __ui_nodes[i].lastTextWidth = paintTextW;
          __ui_nodes[i].lastTextHeight = paintTextH;
          int16_t cbX = __ui_nodes[i].box.x;
          // Vertically center the 16px indicator within the box (see NODE_CHECK).
          int16_t cbY = drawY + (static_cast<int16_t>(__ui_nodes[i].box.h) - 16) / 2;
          if (cbY < drawY) cbY = drawY;
#ifdef UI_AA
          {
            // Render the radio circle to a 16×16 AA canvas, then push.
            UI_COLOR_T radioBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            // The selected ring carries the :checked background (primary).
            UI_COLOR_T ringCol = (__ui_nodes[i].value && __ui_nodes[i].hasCheckedBg)
              ? __ui_nodes[i].checkedBg : __ui_nodes[i].fg;
            CuttlefishCanvas16* c = ui_aa_begin(16, 16, radioBg);
            if (c) {
              if (__ui_nodes[i].value) {
                ui_aa_fill_circle(c, 8, 8, 7.0f, ringCol);
                ui_aa_fill_circle(c, 8, 8, 3.0f, radioBg);
              } else {
                ui_aa_circle(c, 8, 8, 7.0f, __ui_nodes[i].fg);
              }
              ui_aa_push(c, cbX, cbY);
            } else if (__ui_nodes[i].value) {
              ui_display_fill_circle(cbX + 8, cbY + 8, 7, ringCol);
              ui_display_fill_circle(cbX + 8, cbY + 8, 3, radioBg);
            } else {
              ui_display_draw_circle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
            }
          }
#else
          if (__ui_nodes[i].value) {
            ui_display_fill_circle(cbX + 8, cbY + 8, 7,
              __ui_nodes[i].hasCheckedBg ? __ui_nodes[i].checkedBg : __ui_nodes[i].fg);
            ui_display_fill_circle(cbX + 8, cbY + 8, 3, __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          } else {
            ui_display_draw_circle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
          }
#endif
        }
        // Center the label on the same baseline as the indicator (see NODE_CHECK).
        {
          int16_t radioOff = (static_cast<int16_t>(__ui_nodes[i].box.h) - 16) / 2;
          if (radioOff < 0) radioOff = 0;
          ui_draw_wrapped_text(displayText, __ui_nodes[i].box.x + 22, drawY + radioOff, textMaxW,
            __ui_nodes[i].fg, __ui_nodes[i].hasBg ? fillBg : ui_parent_clear_color(i),
            ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
            __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, 0, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
        }
        break;
      case NODE_PROGRESS:
        // Progress bar: outline track + filled portion based on .value (0-100).
        // Incremental redraw — only draws/clears the delta to avoid flashing.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          UI_COLOR_T bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          UI_COLOR_T fgCol = __ui_nodes[i].fg;

          // On first draw (lastTextWidth < 0), draw everything.
          // Otherwise incremental: only update the changed portion.
          uint8_t pct = __ui_constrain(__ui_nodes[i].value, 0, 100);
          int16_t fillW = (static_cast<int32_t>(bw - 2) * pct) / 100;
          int16_t prevW = __ui_nodes[i].lastTextWidth; // reused as previous fill width

          if (prevW < 0) {
            // Full redraw: outline + background + fill
            ui_display_draw_rect(bx, by, bw, bh, fgCol);
            ui_display_fill_rect(bx + 1, by + 1, bw - 2, bh - 2, bgCol);
            if (fillW > 0) {
              ui_display_fill_rect(bx + 1, by + 1, fillW, bh - 2, fgCol);
            }
          } else if (fillW > prevW) {
            // Value increased: draw new fill segment on top (no clear needed)
            ui_display_fill_rect(bx + 1 + prevW, by + 1, fillW - prevW, bh - 2, fgCol);
          } else if (fillW < prevW) {
            // Value decreased: clear the removed portion
            ui_display_fill_rect(bx + 1 + fillW, by + 1, prevW - fillW, bh - 2, bgCol);
          }
          // Remember current fill width for next incremental update
          __ui_nodes[i].lastTextWidth = fillW;
        }
        break;
      case NODE_RANGE:
        // Range slider: horizontal track + draggable thumb.
        // Incremental redraw (like NODE_PROGRESS): lastTextWidth holds the
        // previous fill width. We erase the delta region between old and new
        // thumb positions with the background, then redraw the track portion
        // and the new thumb — so dragging backward doesn't leave ghost thumbs.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          UI_COLOR_T fgCol = __ui_nodes[i].fg;
          UI_COLOR_T bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          UI_COLOR_T dimFg = (UI_COLOR_T)((fgCol >> 1) & UI_DIM_MASK);

          int16_t trackY = by + bh / 2;
          int16_t rMin = __ui_nodes[i].rangeMin;
          int16_t rMax = __ui_nodes[i].rangeMax;
          int16_t range = rMax - rMin;
          if (range <= 0) range = 100;
          int16_t pct = __ui_constrain(__ui_nodes[i].value, rMin, rMax) - rMin;
          int16_t fillW = (static_cast<int32_t>(bw - 8) * pct) / range;
          // lastTextWidth carries the previous fill width, or -1 if this node
          // has never been drawn (fillW=0 at value=min is a valid thumb pos).
          int16_t prevFillW = __ui_nodes[i].lastTextWidth;
          int16_t newThumbX = bx + 4 + fillW - 3;

          if (prevFillW < 0) {
            // First draw: redraw the whole track + fill from scratch.
            ui_display_draw_fast_hline(bx, trackY, bw, dimFg);
            ui_display_draw_fast_hline(bx + 4, trackY, fillW, fgCol);
          } else {
            // Incremental: wipe the strip between the old and new thumb
            // positions (whichever extends further on each side), then restore
            // the track line. This is symmetric — old thumbs disappear whether
            // the drag moves forward or backward.
            int16_t prevThumbX = bx + 4 + prevFillW - 3;
            int16_t left = prevThumbX < newThumbX ? prevThumbX : newThumbX;
            int16_t right = prevThumbX + 6 > newThumbX + 6 ? prevThumbX + 6 : newThumbX + 6;
            if (left < bx) left = bx;
            if (right > bx + bw) right = bx + bw;
            // Erase the thumb band (10px tall) to background.
            ui_display_fill_rect(left, trackY - 5, right - left, 10, bgCol);
            // Restore the track line over the wiped strip: bright up to the
            // current fill end, dim beyond it.
            int16_t fillEnd = bx + 4 + fillW;
            if (right <= fillEnd) {
              ui_display_draw_fast_hline(left, trackY, right - left, fgCol);
            } else if (left >= fillEnd) {
              ui_display_draw_fast_hline(left, trackY, right - left, dimFg);
            } else {
              ui_display_draw_fast_hline(left, trackY, fillEnd - left, fgCol);
              ui_display_draw_fast_hline(fillEnd, trackY, right - fillEnd, dimFg);
            }
          }

          // Thumb: small filled rectangle at the current position.
          if (newThumbX < bx + 1) newThumbX = bx + 1;
          if (newThumbX > bx + bw - 7) newThumbX = bx + bw - 7;
          ui_display_fill_rect(newThumbX, trackY - 5, 6, 10, fgCol);

          // Remember current fill width for the next incremental update.
          __ui_nodes[i].lastTextWidth = fillW;
        }
        break;
      case NODE_INPUT:
        // Input field: bordered rect + current text (or placeholder), clipped to box width.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          UI_COLOR_T fgCol = __ui_nodes[i].fg;
          UI_COLOR_T bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          // HTML disabled: halve the drawn colors (web-like faded control).
          if (__ui_nodes[i].disabled) {
            fgCol = (fgCol >> 1) & UI_DIM_MASK;
            bgCol = (bgCol >> 1) & UI_DIM_MASK;
          }
          if (__ui_nodes[i].borderRadius > 0) {
            ui_display_fill_round_rect(bx, by, bw, bh, __ui_nodes[i].borderRadius, bgCol);
          } else {
            ui_display_fill_rect(bx, by, bw, bh, bgCol);
          }
          UI_COLOR_T inputBorder = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : fgCol;
          uint8_t inputBorderStyle = __ui_nodes[i].borderStyle ? __ui_nodes[i].borderStyle : 1;
          uint8_t inputBorderWidth = __ui_nodes[i].borderWidth ? __ui_nodes[i].borderWidth : 1;
          ui_draw_rect_outline(bx, by, bw, bh, __ui_nodes[i].borderRadius, inputBorderStyle, inputBorderWidth, inputBorder);
          // Show typed text (textBuffer) in fg color, or placeholder (.text)
          // dimmed gray when the buffer is empty.
          UI_COLOR_T textCol = fgCol;
          const char* disp = (__ui_nodes[i].textBuffer[0] != 0)
            ? __ui_nodes[i].textBuffer
            : (__ui_nodes[i].text ? __ui_nodes[i].text : "");
#if defined(UI_HIDE_OSK)
          // Desktop target: when this input is the active edit target, suppress
          // the placeholder. The editing buffer is loaded from the (likely empty)
          // textBuffer on focus, so without this the placeholder ("enter name")
          // would render with the caret at its end. Hide it so the caret shows
          // on a clean field at position 0 until the user types.
          if (__ui_kb_visible && static_cast<int16_t>(__ui_kb_target) == static_cast<int16_t>(i) && __ui_nodes[i].textBuffer[0] == 0) {
            disp = "";
          }
#endif
          if (__ui_nodes[i].textBuffer[0] == 0) {
#if UI_COLOR_DEPTH == 888
            textCol = 0x848484;
#else
            textCol = 0x8410;
#endif
          }
          // Note: the actual text draw is via ui_draw_text (which uses __ui_gfx).
          // The setCursor/setTextColor/setTextSize below are legacy — ui_draw_text
          // handles its own cursor/colors. Keep them on __ui_gfx for consistency
          // (in case __ui_gfx is the scroll canvas, not __tc_display).
          ui_display_set_cursor(bx + 4, by + (bh - ts * 8) / 2);
          ui_display_set_text_color(textCol, bgCol);
          ui_display_set_text_size(ts);
          // Clip: at textSize ts, each char is ts*6px advance. Only print chars
          // that fit within the box (bw - 8px margin), so text never overflows
          // the border or wraps to the next line.
          int16_t maxChars = (bw - 8) / (ts * 6);
          if (maxChars < 0) maxChars = 0;
          int16_t len = static_cast<int16_t>(strlen(disp));
          if (len > maxChars) len = maxChars;
          if (len > UI_TEXT_BUF) len = UI_TEXT_BUF;
          char clipped[UI_TEXT_BUF + 1];
          for (int16_t c = 0; c < len; c++) {
            clipped[c] = disp[c];
          }
          clipped[len] = 0;
          ui_draw_text(clipped, bx + 4, by + (bh - ui_text_height(ts, __ui_nodes[i].fontFace)) / 2,
            textCol, bgCol, ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
#if defined(UI_HIDE_OSK)
          // Desktop target: with no OSK grid there's no focus indicator. Draw a
          // blinking caret at the end of the typed text on the active edit target
          // so the user sees which field they're editing. Blink ~3×/sec via the
          // top bits of __ui_kb_blink (mask 0x20 toggles every 32 ticks ≈ 530ms).
          if (__ui_kb_visible && static_cast<int16_t>(__ui_kb_target) == static_cast<int16_t>(i) && (__ui_kb_blink & 0x20)) {
            uint16_t caretW = ui_text_width(clipped, ts, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
            int16_t caretX = bx + 4 + static_cast<int16_t>(caretW);
            int16_t caretYTop = by + (bh - ts * 8) / 2;
            // fgCol (not textCol): the placeholder-dimming path sets textCol to
            // gray, which would make the caret nearly invisible on a focused
            // empty field. The caret should always be the input's foreground.
            ui_display_fill_rect(caretX, caretYTop, static_cast<int16_t>(ts > 1 ? 2 : 1), static_cast<int16_t>(ts * 8), fgCol);
          }
#endif
        }
        break;
      case NODE_IMG:
        {
          UI_COLOR_T imgBg = __ui_nodes[i].hasBg ? fillBg : __ui_nodes[i].clearColor;
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, imgBg);
        }
        if (__ui_nodes[i].imgDataId < __ui_image_count) {
          const UIImage* img = &__ui_images[__ui_nodes[i].imgDataId];
          int16_t targetW = __ui_nodes[i].box.w;
          int16_t targetH = __ui_nodes[i].box.h;
          ui_draw_image_with_fit(img, __ui_nodes[i].box.x, drawY, __ui_nodes[i].rotateDeg, __ui_nodes[i].objectFit, targetW, targetH);
        }
        if (__ui_nodes[i].borderStyle != 0) {
          int16_t borderW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t borderH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_draw_rect_outline(__ui_nodes[i].box.x, drawY, borderW, borderH,
            __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, bColor);
        }
        break;
      case NODE_CANVAS: {
        // Find this node's draw callback.
        void (*__ui_canvas_fn)(CuttlefishCanvas16*) = nullptr;
        for (uint16_t b = 0; b < __ui_canvas_binding_count; b++) {
          if (__ui_canvas_bindings[b].node == i) { __ui_canvas_fn = __ui_canvas_bindings[b].fn; break; }
        }
        if (__ui_canvas_fn) {
          int16_t __ui_cw = __ui_nodes[i].canvasW;
          int16_t __ui_ch = __ui_nodes[i].canvasH;
          if (__ui_cw > 0 && __ui_ch > 0) {
            uint8_t __ui_canvas_drawn = 0;
            if (ui_display_is_default_target()) {
              // Cache a canvas sized to the buffer for direct hardware draws so
              // the callback's many primitives push as one bitmap. When the
              // active target is already a memory canvas (scroll/repair/full
              // framebuffer), skip the nested allocation and draw directly below.
              // A canvas can construct but fail its internal pixel-buffer malloc
              // (non-null canvas, null buffer). Treat that as "no canvas" so a
              // transient malloc failure self-heals instead of blanking the node.
              if (!__ui_node_canvas || !display_canvasBuffer(__ui_node_canvas) ||
                  display_canvasWidth(__ui_node_canvas) != __ui_cw || display_canvasHeight(__ui_node_canvas) != __ui_ch) {
                display_deleteCanvas(__ui_node_canvas);
                __ui_node_canvas = display_createCanvas(__ui_cw, __ui_ch);
              }
              CuttlefishCanvas16* __ui_lc = __ui_node_canvas;
              if (__ui_lc && display_canvasBuffer(__ui_lc)) {
                display_canvasFillScreen(__ui_lc, __ui_nodes[i].clearColor);
                CuttlefishDisplayTarget* __ui_prev_target = ui_display_get_target();
                ui_display_set_target((CuttlefishDisplayTarget*)__ui_lc);
                __ui_canvas_fn(__ui_lc);
                ui_display_set_target(__ui_prev_target);
                ui_draw_canvas_rect(__ui_lc, __ui_nodes[i].box.x, drawY, __ui_cw, __ui_ch);
                __ui_canvas_drawn = 1;
              }
            }
            if (!__ui_canvas_drawn) {
              UI_COLOR_T __ui_canvas_bg = __ui_nodes[i].hasBg ? fillBg : __ui_nodes[i].clearColor;
              ui_display_fill_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_canvas_bg);
              int16_t __ui_prev_off_x = __ui_draw_off_x;
              int16_t __ui_prev_off_y = __ui_draw_off_y;
              int16_t __ui_prev_canvas_w = __ui_canvas_fallback_w;
              int16_t __ui_prev_canvas_h = __ui_canvas_fallback_h;
              __ui_canvas_fallback_w = __ui_cw;
              __ui_canvas_fallback_h = __ui_ch;
              __ui_draw_off_x = static_cast<int16_t>(__ui_prev_off_x + __ui_nodes[i].box.x);
              __ui_draw_off_y = static_cast<int16_t>(__ui_prev_off_y + drawY);
              __ui_canvas_fn(nullptr);
              __ui_draw_off_x = __ui_prev_off_x;
              __ui_draw_off_y = __ui_prev_off_y;
              __ui_canvas_fallback_w = __ui_prev_canvas_w;
              __ui_canvas_fallback_h = __ui_prev_canvas_h;
            }
          }
        }
        break;
      }
      case NODE_LIST: {
        // Virtualized list: state lives on the node now (listCountFn/listItemFn/
        // listCount/scrollY/contentHeight/listItemHeight), not in a side table.
        // Resolve lazily as a safety net for targets whose startup path runs
        // before the generated binding table has been copied onto the node.
        if (!__ui_nodes[i].listItemFn) {
          for (uint16_t b = 0; b < __ui_list_binding_count; b++) {
            if (__ui_list_bindings[b].node == static_cast<uint16_t>(i)) {
              __ui_nodes[i].listCountFn = __ui_list_bindings[b].countFn;
              __ui_nodes[i].listItemFn = __ui_list_bindings[b].itemFn;
              __ui_nodes[i].listTapFn = __ui_list_bindings[b].tapFn;
              break;
            }
          }
        }
        if (!__ui_nodes[i].listItemFn) break;
        int16_t bx = __ui_nodes[i].box.x;
        int16_t by = drawY;
        int16_t bw = __ui_nodes[i].box.w;
        int16_t bh = __ui_nodes[i].box.h;
        uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
        uint16_t itemCount = __ui_nodes[i].listCount;
        int16_t listScrollY = __ui_nodes[i].scrollY;
        int16_t listContentH = __ui_nodes[i].contentHeight;
        UI_COLOR_T clearCol = __ui_nodes[i].clearColor;
        uint8_t listFullRepaint = 0;
        // Render to a viewport-sized canvas so edge glyphs are naturally clipped.
        // Treat a null buffer (failed internal malloc) as "no canvas" and retry —
        // see __ui_node_canvas for the zombie-caching rationale.
        // __ui_list_canvas is file-scoped so ui_release_canvas_state() can free it.
        if (!__ui_list_canvas || !display_canvasBuffer(__ui_list_canvas) ||
            display_canvasWidth(__ui_list_canvas) != bw || display_canvasHeight(__ui_list_canvas) != bh) {
          display_deleteCanvas(__ui_list_canvas);
          __ui_list_canvas_node = -1;
          __ui_list_canvas = ui_create_canvas_best(bw, bh);
          listFullRepaint = 1;
        }
        CuttlefishCanvas16* lc = __ui_list_canvas;
        if (!lc || !display_canvasBuffer(lc)) {
          // Viewport canvas won't allocate (no PSRAM / over SRAM budget on a
          // full-width list). Fall back to the band renderer: composite the
          // visible rows into the ~10KB band canvas strip-by-strip, pushing
          // each band tear-free. Mirrors the generic scroll path's Mode B →
          // ui_render_scroll_bands fallback. If even the band canvas fails,
          // give up (render nothing) — same as the old break.
          if (ui_render_list_bands(static_cast<uint16_t>(i))) {
            return 1;  // band path handled push + decoration + dirty-clear
          }
          // Last-resort visible fallback: if even the small band canvas cannot
          // allocate, draw the fully visible rows in one target transaction
          // rather than leaving a black/empty list. This path is only reached
          // under extreme memory pressure; normal renders remain atomic canvas
          // pushes.
          if (ui_render_list_direct(static_cast<uint16_t>(i))) {
            __ui_nodes[i].box.x = origBoxX;
            __ui_nodes[i].box.y = origBoxY;
            return 1;
          }
          break;
        }
        if (__ui_list_canvas_node != static_cast<int16_t>(i)) listFullRepaint = 1;
        int16_t repaintY = 0;
        int16_t repaintH = bh;
        int16_t deltaY = listScrollY - __ui_nodes[i].lastPaintedScrollY;
        int16_t absDelta = deltaY < 0 ? -deltaY : deltaY;
        uint8_t canShiftList = (!listFullRepaint && deltaY != 0 && absDelta < bh);
        if (canShiftList) {
          ui_shift_container_canvas(lc, deltaY, clearCol, &repaintY, &repaintH);
        } else {
          display_canvasFillScreen(lc, clearCol);
          repaintY = 0;
          repaintH = bh;
        }
        // GFXcanvas text has no clipping. For shift-and-repair frames, draw row
        // text into a strip-sized repair canvas first, then blit only that strip
        // into the shifted list canvas. This prevents a 1-5px repair from
        // repainting full glyphs across pixels that were already shifted.
        CuttlefishCanvas16* listTextCanvas = lc;
        int16_t listTextOffsetY = 0;
        uint8_t drawingListRepair = 0;
        if (canShiftList && repaintH > 0 && repaintH < bh) {
          CuttlefishCanvas16* rc = ui_get_repair_canvas(bw, repaintH);
          if (rc) {
            display_canvasFillScreen(rc, clearCol);
            listTextCanvas = rc;
            listTextOffsetY = repaintY;
            drawingListRepair = 1;
          } else {
            display_canvasFillScreen(lc, clearCol);
            repaintY = 0;
            repaintH = bh;
            canShiftList = 0;
          }
        }
        // Compute visible range for the repainted strip. Previously-rendered
        // pixels are shifted in-place; only the exposed band needs new rows.
        uint16_t first = (listScrollY + repaintY) / ih;
        uint16_t last = (listScrollY + repaintY + repaintH - 1) / ih + 1;
        if (itemCount > 0 && last >= itemCount) last = itemCount - 1;
        // Draw each visible item (canvas-local coords: 0,0 = viewport top).
        char listBuf[UI_TEXT_BUF + 1];
        CuttlefishDisplayTarget* listPrevTarget = ui_display_get_target();
        if (itemCount > 0 && repaintH > 0) {
          for (uint16_t idx = first; idx <= last; idx++) {
            int16_t itemY = static_cast<int16_t>(idx * ih) - listScrollY - listTextOffsetY;
            __ui_nodes[i].listItemFn(idx, listBuf, UI_TEXT_BUF + 1);
            listBuf[UI_TEXT_BUF] = 0;
            ui_display_set_target((CuttlefishDisplayTarget*)listTextCanvas);
            int16_t __ui_saved_off_x2 = __ui_draw_off_x;
            int16_t __ui_saved_off_y2 = __ui_draw_off_y;
            __ui_draw_off_x = 0;
            __ui_draw_off_y = 0;
            // Keep classic list glyphs in the canvas pixel buffer. Native
            // CuttlefishGFX text can disappear when copied from a canvas to
            // the panel, while the explicit glyph path remains compositable.
            ui_draw_list_text(listBuf, 4, itemY + static_cast<int16_t>(ih - 16) / 2,
              __ui_nodes[i].fg, clearCol, 2, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
            __ui_draw_off_x = __ui_saved_off_x2;
            __ui_draw_off_y = __ui_saved_off_y2;
            ui_display_set_target(listPrevTarget);
          }
        }
        if (drawingListRepair) {
          CuttlefishDisplayTarget* prevTarget = ui_display_get_target();
          ui_display_set_target((CuttlefishDisplayTarget*)lc);
          ui_draw_canvas_rect(listTextCanvas, 0, repaintY, bw, repaintH);
          ui_display_set_target(prevTarget);
        }
        // Scrollbar (canvas-local coords).
        if (listContentH > bh) {
          int16_t tx = bw - 4;
          uint16_t thumbH = static_cast<uint32_t>(bh) * bh / listContentH;
          if (thumbH < 8) thumbH = 8;
          int16_t maxScroll = listContentH - bh;
          uint16_t thumbY = maxScroll > 0 ? static_cast<uint32_t>(bh - thumbH) * listScrollY / maxScroll : 0;
          UI_COLOR_T dimFg = (UI_COLOR_T)((__ui_nodes[i].fg >> 1) & UI_DIM_MASK);
          display_canvasFillRect(lc, tx, 0, 3, bh, dimFg);
          display_canvasFillRect(lc, tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
        }
        // Outset shadows are static decoration. Redrawing the hard shadow
        // directly to the panel before every small scroll-frame creates a
        // visible shadow-then-content intermediate state on SPI TFTs. Keep it
        // for full list repaints, but skip it for shift-and-repair scrolls.
        if (!drawingBufferedScroll && !__ui_fb && !canShiftList) {
          ui_draw_shadow(i, by, 0);
        }
        // Standalone lists push directly. Lists inside a buffered scroll
        // container must composite into that scroll canvas; their box has
        // already been translated to canvas-local coordinates.
        if (drawingBufferedScroll) {
          ui_draw_canvas_rect(lc, bx, by, bw, bh);
        } else {
          ui_push_canvas_rect(lc, bx, by, bw, bh);
        }
        // Draw static decoration after the scrollable pixels are composited.
        // Keeping border rows out of __ui_list_canvas prevents the cached
        // shift step from dragging top/bottom border pixels through the list.
        ui_draw_shadow(i, by, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          ui_draw_node_border(i, bx, by, bColor);
        }
        ui_draw_node_outline(i, bx, by);
        __ui_list_canvas_node = static_cast<int16_t>(i);
        __ui_nodes[i].lastPaintedScrollY = listScrollY;
        __ui_nodes[i].dirty = 0;
        if (__ui_fb) {
          UIRect listPaintRect;
          ui_node_paint_rect(i, origBoxX, origBoxY, origBoxX, origBoxY,
            static_cast<uint16_t>(bw), static_cast<uint16_t>(bh), &listPaintRect);
          ui_fb_add_rect(listPaintRect.x, listPaintRect.y, listPaintRect.w, listPaintRect.h);
        }
        ui_display_set_target(__ui_draw_target);
        __ui_nodes[i].box.x = origBoxX;
        __ui_nodes[i].box.y = origBoxY;
        return 1;  // list handled canvas push, decoration, and coordinate restore
      }
    }
    return 0;
}

// ── Band renderer: tear-free scroll compositing without a viewport canvas ──
// When a scroll container's viewport canvas won't allocate (no PSRAM, tight
// SRAM, or a viewport larger than the budget), the previous fallback
// (direct-full) painted each child straight to the display — one SPI
// transaction per primitive, visible as tearing during fast drags. The band
// renderer instead composes the whole visible subtree into a short horizontal
// band canvas (vw × UI_STRIP_BAND_HEIGHT, e.g. 320×16 ≈ 10KB at RGB565),
// pushes that band in one SPI transaction, then moves to the next band. Each
// band completes before it is pushed, so the panel never shows a half-drawn
// frame — eliminating tearing while keeping memory bounded regardless of
// program size (the canvas height is fixed; only width tracks the viewport).
//
// Returns 1 when the subtree was rendered and pushed (the caller must skip the
// normal direct-full child repaint). Returns 0 when the band canvas could not
// be allocated (caller falls back to direct-full).
// Shared band-canvas alloc helper. The three band renderers reuse the
// persistent __ui_band_canvas, reallocating only when the width changes so
// display_canvasWidth == w == stride (ui_push_canvas_rect's single-write fast
// path requires w == stride — a sub-width push takes a row-by-row path some
// ST7796S drivers mishandle). Returns the canvas (with a valid buffer) or null.
static inline CuttlefishCanvas16* ui_band_canvas_for_width(int16_t w) {
  if (!__ui_band_canvas || !display_canvasBuffer(__ui_band_canvas) ||
      display_canvasWidth(__ui_band_canvas) != w) {
    display_deleteCanvas(__ui_band_canvas);
    __ui_band_canvas = ui_create_canvas_best(w, UI_STRIP_BAND_HEIGHT);
  }
  CuttlefishCanvas16* band = __ui_band_canvas;
  return (band && display_canvasBuffer(band)) ? band : nullptr;
}
static inline uint8_t ui_render_scroll_bands(uint16_t s) {
  if (s >= __ui_node_count) return 0;
  int16_t vw = __ui_nodes[s].box.w;
  int16_t vh = __ui_nodes[s].box.h;
  if (vw <= 0 || vh <= 0) return 0;
  int16_t vox = __ui_nodes[s].box.x;
  int16_t voy = __ui_nodes[s].box.y;
  UI_COLOR_T scrollBg = __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor;
  // One persistent band canvas, reused across bands and frames, reallocated
  // only when the viewport width changes (so stride == vw for the single-write
  // push fast path). See ui_band_canvas_for_width.
  CuttlefishCanvas16* band = ui_band_canvas_for_width(vw);
  if (!band) return 0;
  int16_t bandH = display_canvasHeight(band);
  // Build a compact list of descendants that can intersect the viewport once per
  // scroll repaint. The old nested band×subtree walk repeated visibility, screen,
  // and Y culling for every band; the candidate list keeps that work O(subtree)
  // and each band only visits rows that can actually contribute pixels.
  uint16_t subtreeEnd = __ui_nodes[s].subtreeEnd;
  if (subtreeEnd > __ui_node_count) subtreeEnd = __ui_node_count;
  // The scrollbar occupies the rightmost 4px gutter (tx = vw - 4, 3px wide).
  // Rather than draw it separately at frame end (which made each band push erase
  // the previous frame's scrollbar slice-by-slice, flashing it during scroll),
  // composite this band's scrollbar slice into the gutter of the band canvas
  // itself. Each band then pushes the FULL viewport width in one SPI transaction
  // (the single-write fast path that works on every driver — a sub-width push
  // forces a row-by-row path that some ST7796S drivers mishandle, showing only
  // the first row). The scrollbar is thus part of each band's atomic push: no
  // separate erase/redraw cycle, no flash, and the fast path is preserved.
  int16_t contentW = vw > 4 ? static_cast<int16_t>(vw - 4) : vw;
  // Scrollbar geometry (document/viewport coords): track spans [0, vh); thumb
  // spans [thumbY, thumbY + thumbH). Both are 3px wide at canvas-x contentW.
  uint16_t sbThumbH = 0;
  uint16_t sbThumbY = 0;
  uint8_t sbVisible = 0;
  UI_COLOR_T sbTrackCol = (UI_COLOR_T)((__ui_nodes[s].fg >> 1) & UI_DIM_MASK);
  UI_COLOR_T sbThumbCol = __ui_nodes[s].fg;
  if (__ui_nodes[s].contentHeight > vh) {
    sbVisible = 1;
    sbThumbH = static_cast<uint32_t>(vh) * vh / __ui_nodes[s].contentHeight;
    if (sbThumbH < 8) sbThumbH = 8;
    // Clamp to vh so the (vh - sbThumbH) subtraction below can't go negative on
    // a degenerate sub-8px viewport (which would cast to a huge uint32_t and
    // place the thumb off-screen). ui_draw_scrollbar_direct has the same min-8
    // clamp; this extra guard keeps the band path's slice math safe.
    if (sbThumbH > static_cast<uint16_t>(vh)) sbThumbH = static_cast<uint16_t>(vh);
    int16_t maxScroll = __ui_nodes[s].contentHeight - vh;
    sbThumbY = maxScroll > 0 ? static_cast<uint32_t>(vh - sbThumbH) * __ui_nodes[s].scrollY / maxScroll : 0;
  }
  CuttlefishDisplayTarget* prevTarget = ui_display_get_target();
  if (!__ui_scroll_candidates) return 0;
  __ui_scroll_candidate_count = 0;
  for (uint16_t c = s + 1; c < subtreeEnd && __ui_scroll_candidate_count < __ui_node_count; c++) {
    if (!ui_is_effectively_visible(c) || __ui_nodes[c].screenId != __ui_active_screen) continue;
    UIScrollPaintCandidate& candidate = __ui_scroll_candidates[__ui_scroll_candidate_count++];
    candidate.node = c;
    candidate.screenY = ui_draw_y_for_node(c);
    candidate.faceH = __ui_nodes[c].box.h;
  }

  // Top→bottom bands over the viewport.
  for (int16_t bandTop = 0; bandTop < vh; bandTop += bandH) {
    int16_t bandBot = bandTop + bandH;
    if (bandBot > vh) bandBot = vh;
    int16_t thisH = static_cast<int16_t>(bandBot - bandTop);
    display_canvasFillRect(band, 0, 0, contentW, bandH, scrollBg);
    ui_display_set_target(band);
    for (uint16_t candidateIdx = 0; candidateIdx < __ui_scroll_candidate_count; candidateIdx++) {
      uint16_t c = __ui_scroll_candidates[candidateIdx].node;
      int16_t screenY = __ui_scroll_candidates[candidateIdx].screenY;
      int16_t faceH = __ui_scroll_candidates[candidateIdx].faceH;
      // Cull nodes whose face does not intersect this band's Y range before
      // doing any expensive per-node work (AGENTS.md: clip before the inner
      // loop). A node fully above or below the band contributes no pixels.
      if (screenY + faceH <= voy + bandTop) continue;
      if (screenY >= voy + bandBot) continue;
      // Translate the node's box into band-local coordinates, mirroring the main
      // loop's drawingBufferedScroll setup: subtract the viewport origin and the
      // band's top row. ui_draw_y_for_node then re-derives the band-local Y
      // (document Y - scrollY - voy - bandTop) = (screenY - voy - bandTop). The
      // box.x translate below is read by ui_draw_x_for_node (which adds
      // transformOffsetX + pressedOffsetX), so it must be set before computing
      // drawX; the body needs box.x = drawX (including the pressed offset,
      // matching the main loop and ui_render_node_bands).
      int16_t origBoxX = __ui_nodes[c].box.x;
      int16_t origBoxY = __ui_nodes[c].box.y;
      __ui_nodes[c].box.x = static_cast<int16_t>(origBoxX - vox);
      __ui_nodes[c].box.y = static_cast<int16_t>(origBoxY - voy - bandTop);
      int16_t drawX = ui_draw_x_for_node(c);
      int16_t drawY = ui_draw_y_for_node(c);
      // Outset shadow at the rest position, under the face — parity with the
      // main dirty loop and ui_render_node_bands. This renderer omitted it,
      // so band-composited scroll viewports (viewport canvas won't allocate)
      // lost every shadow: theme --shadow-* tokens rendered in the preview
      // but not on device. Lists manage their own shadow elsewhere.
      if (__ui_nodes[c].kind != NODE_LIST) {
        __ui_nodes[c].box.x = ui_base_draw_x_for_node(c);
        ui_draw_shadow(c, ui_base_draw_y_for_node(c), 0);
      }
      __ui_nodes[c].box.x = drawX;
      uint8_t ts = __ui_nodes[c].textSize ? __ui_nodes[c].textSize : 2;
      uint16_t textMaxW = ui_node_text_max_width(c);
      uint16_t tw = 0;
      uint16_t th = 0;
      ui_node_text_layout_metrics(c, textMaxW, &tw, &th);
      uint16_t paintTextW = tw;
      uint16_t paintTextH = th;
      if (__ui_nodes[c].kind == NODE_TEXT || __ui_nodes[c].kind == NODE_SELECT) {
        uint16_t hInset = static_cast<uint16_t>(__ui_nodes[c].paddingLeft) + static_cast<uint16_t>(__ui_nodes[c].paddingRight) + static_cast<uint16_t>(__ui_nodes[c].borderWidth) * 2;
        uint16_t vInset = static_cast<uint16_t>(__ui_nodes[c].paddingTop) + static_cast<uint16_t>(__ui_nodes[c].paddingBottom) + static_cast<uint16_t>(__ui_nodes[c].borderWidth) * 2;
        paintTextW = static_cast<uint16_t>(tw + hInset);
        paintTextH = static_cast<uint16_t>(th + vInset);
      }
      if (__ui_nodes[c].kind == NODE_CHECK || __ui_nodes[c].kind == NODE_RADIO) {
        paintTextW = static_cast<uint16_t>(tw + 22);
        if (paintTextH < 16) paintTextH = 16;
      }
      const char* displayText = __ui_nodes[c].hasTextBinding
        ? __ui_nodes[c].textBuffer
        : __ui_nodes[c].text;
      UI_COLOR_T bColor = __ui_nodes[c].borderColor ? __ui_nodes[c].borderColor : __ui_nodes[c].fg;
      UI_COLOR_T fillBg = __ui_nodes[c].bg;
      if (__ui_nodes[c].opacity < 100) {
        UI_COLOR_T backdrop = ui_parent_clear_color(c);
        bColor = ui_blend(bColor, backdrop, __ui_nodes[c].opacity);
        fillBg = ui_blend(__ui_nodes[c].bg, backdrop, __ui_nodes[c].opacity);
      }
      UINodeDrawCtx ctx;
      ctx.drawY = drawY;
      ctx.bColor = bColor;
      ctx.fillBg = fillBg;
      ctx.ts = ts;
      ctx.textMaxW = textMaxW;
      ctx.tw = tw;
      ctx.th = th;
      ctx.paintTextW = paintTextW;
      ctx.paintTextH = paintTextH;
      ctx.displayText = displayText;
      ctx.drawingBufferedScroll = 0;
      ctx.drawTarget = prevTarget;
      ctx.origBoxX = origBoxX;
      ctx.origBoxY = origBoxY;
      // The band draws onto a freshly cleared canvas every band, so the node's
      // incremental-paint caches (lastTextWidth/lastTextHeight, which carry
      // across frames for the main loop's NODE_TEXT/NODE_PROGRESS/NODE_RANGE
      // incremental redraws) are bogus here — reset to force a full repaint into
      // the blank band. Save/restore them around the draw so the band path is
      // transient: it must not corrupt the persistent incremental-redraw state
      // the main loop relies on if this container later transitions to canvas
      // mode (the values are also stale across the multiple bands a tall node
      // spans, so restoring the pre-band value keeps things consistent).
      int16_t savedLastTextW = __ui_nodes[c].lastTextWidth;
      uint16_t savedLastTextH = __ui_nodes[c].lastTextHeight;
      if (__ui_nodes[c].kind == NODE_PROGRESS || __ui_nodes[c].kind == NODE_RANGE) {
        __ui_nodes[c].lastTextWidth = -1;
      }
      __ui_nodes[c].lastTextHeight = 0;
      ui_draw_node_body(static_cast<int16_t>(c), &ctx);
      __ui_nodes[c].lastTextWidth = savedLastTextW;
      __ui_nodes[c].lastTextHeight = savedLastTextH;
      __ui_nodes[c].box.x = origBoxX;
      __ui_nodes[c].box.y = origBoxY;
    }
    ui_display_set_target(prevTarget);
    // Composite this band's scrollbar slice into the gutter. The track covers
    // every row; the thumb covers viewport-rows [sbThumbY, sbThumbY+sbThumbH).
    // Intersect that with this band's [bandTop, bandBot) range and fill the
    // overlapping canvas-local rows with the thumb color.
    if (sbVisible) {
      // Full gutter width (vw - contentW, normally 4px): child decorations
      // (outset shadows) poke past the content area and would survive as 1px
      // ticks in any uncovered edge column.
      display_canvasFillRect(band, contentW, 0, vw - contentW, thisH, sbTrackCol);
      int16_t thumbTop = static_cast<int16_t>(sbThumbY);
      int16_t thumbBot = static_cast<int16_t>(sbThumbY + sbThumbH);
      int16_t ovTop = thumbTop > bandTop ? thumbTop : bandTop;
      int16_t ovBot = thumbBot < bandBot ? thumbBot : bandBot;
      if (ovBot > ovTop) {
        display_canvasFillRect(band, contentW, static_cast<int16_t>(ovTop - bandTop), 3, static_cast<int16_t>(ovBot - ovTop), sbThumbCol);
      }
    } else {
      // No scrollbar (content fits) — clear the gutter to the scroll bg so the
      // previous screen's scrollbar pixels don't bleed through.
      display_canvasFillRect(band, contentW, 0, vw - contentW, thisH, scrollBg);
    }
    // Push the FULL viewport width in one transaction (single-write fast path:
    // w == stride). Each band — content + scrollbar slice — is fully rendered
    // before it touches the panel, eliminating both tearing and scrollbar flash.
    ui_push_canvas_rect(band, vox, static_cast<int16_t>(voy + bandTop), vw, thisH);
  }
  __ui_nodes[s].lastPaintedScrollY = __ui_nodes[s].scrollY;
  // The subtree was fully rendered this frame; the main loop's scroll-defer
  // path will skip these nodes (bufferedScrollDirectFull stays clear), and the
  // caller has already marked the owner non-dirty.
  for (uint16_t c = s + 1; c < subtreeEnd; c++) {
    __ui_nodes[c].dirty = 0;
  }
  return 1;
}

// ── Whole-frame band composition (drawer slide frames) ────────────────────
// Composes every visible active-screen node in draw order over a display
// rect, one horizontal band at a time, pushing each band in a single
// transaction. The drawer slide uses it over the union of the panel's old
// and new paint rects: a mark-all-dirty slide step instead repainted the
// whole screen with direct per-node clears (visible flashing on SPI TFTs,
// and only ~3 steps fit inside the 180ms slide). Returns 0 when the band
// canvas or draw order is unavailable (caller falls back to mark-all-dirty);
// a rect fully outside the panel returns 1 (nothing to compose).
static inline uint8_t ui_render_screen_bands(int16_t rx, int16_t ry, int16_t rw, int16_t rh) {
  if (rw <= 0 || rh <= 0) return 1;
  if (!ui_clip_rect_to_display_target(&rx, &ry, &rw, &rh)) return 1;
  if (!__ui_draw_order || !__ui_scroll_candidates) return 0;
  CuttlefishCanvas16* band = ui_band_canvas_for_width(rw);
  if (!band) return 0;
  int16_t bandH = display_canvasHeight(band);
  // Seed color: the active screen's background (the screen fill node paints
  // over it in draw order anyway; the seed keeps uncovered rows defined).
  UI_COLOR_T screenBg = static_cast<UI_COLOR_T>(0);
  if (__ui_active_screen_bg_node < __ui_node_count) {
    screenBg = __ui_nodes[__ui_active_screen_bg_node].hasBg
      ? __ui_nodes[__ui_active_screen_bg_node].bg
      : __ui_nodes[__ui_active_screen_bg_node].clearColor;
  }
  // Draw-ordered candidate list once per composition (same shape as the
  // scroll band path); each band then only Y-culls against it.
  __ui_scroll_candidate_count = 0;
  for (uint16_t pass = 0; pass < __ui_node_count; pass++) {
    uint16_t c = __ui_draw_order[pass];
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_is_effectively_visible(c)) continue;
    if (__ui_scroll_candidate_count >= __ui_node_count) break;
    UIScrollPaintCandidate& cand = __ui_scroll_candidates[__ui_scroll_candidate_count++];
    cand.node = c;
    cand.screenY = ui_draw_y_for_node(c);
    cand.faceH = __ui_nodes[c].box.h;
    // Scrolled children clip to their scroll viewport (CSS overflow): a
    // compose over a region touching the viewport edge must not paint their
    // faces at absolute positions beyond it. The initial whole-screen compose
    // left stale button rows below the fold, and composes over the header
    // region smeared scrolled content into the header — bars of previously
    // scrolled pixels that nothing repaints. The viewport rect is the scroll
    // ancestor's own draw position (its scrollY applies to children, not to
    // itself).
    int16_t san = ui_scroll_ancestor_for_node(c);
    if (san >= 0 && __ui_nodes[san].box.h > 0 && __ui_nodes[san].box.w > 0) {
      cand.clipTop = ui_draw_y_for_node(static_cast<uint16_t>(san));
      cand.clipBottom = static_cast<int16_t>(cand.clipTop + __ui_nodes[san].box.h);
      cand.clipLeft = ui_draw_x_for_node(static_cast<uint16_t>(san));
      cand.clipRight = static_cast<int16_t>(cand.clipLeft + __ui_nodes[san].box.w);
    } else {
      cand.clipTop = -32767;
      cand.clipBottom = 32767;
      cand.clipLeft = -32767;
      cand.clipRight = 32767;
    }
  }
  CuttlefishDisplayTarget* prevTarget = ui_display_get_target();
  for (int16_t bandTop = 0; bandTop < rh; bandTop += bandH) {
    int16_t bandBot = static_cast<int16_t>(bandTop + bandH);
    if (bandBot > rh) bandBot = rh;
    int16_t thisH = static_cast<int16_t>(bandBot - bandTop);
    display_canvasFillRect(band, 0, 0, rw, thisH, screenBg);
    ui_display_set_target(band);
    for (uint16_t ci = 0; ci < __ui_scroll_candidate_count; ci++) {
      uint16_t c = __ui_scroll_candidates[ci].node;
      int16_t screenY = __ui_scroll_candidates[ci].screenY;
      int16_t faceH = __ui_scroll_candidates[ci].faceH;
      // Clip before the per-node work (AGENTS.md): skip nodes whose face
      // does not intersect this band's Y range.
      if (screenY + faceH <= ry + bandTop) continue;
      if (screenY >= ry + bandBot) continue;
      int16_t origBoxX = __ui_nodes[c].box.x;
      int16_t origBoxY = __ui_nodes[c].box.y;
      int16_t origBoxW = __ui_nodes[c].box.w;
      int16_t origBoxH = __ui_nodes[c].box.h;
      __ui_nodes[c].box.x = static_cast<int16_t>(origBoxX - rx);
      __ui_nodes[c].box.y = static_cast<int16_t>(origBoxY - ry - bandTop);
      // Clamp the face to the scroll viewport (band-local DRAW coords). The
      // clamp must operate on the node's DRAW position — box.y is
      // content-local and the ancestor scroll is subtracted later, inside
      // ui_draw_y_for_node, so comparing box.y against display-space clip
      // bounds passed scrolled content whose CONTENT coordinate numerically
      // fell inside the viewport: a button scrolled up past the viewport top
      // painted over the header, and the smearing stuck (nothing repaints
      // the header afterwards). Clamp the draw position and shift the box by
      // the delta; text wrapping and layout metrics shrink with the box.
      // Fully clipped faces drop out here.
      {
        // int32 math: the unclipped sentinels are ±32767 and the band-local
        // conversion subtracts region/band offsets — int16 arithmetic wraps
        // (a wrapped-positive clipTop clamped every face to garbage and
        // dropped the candidate: the main screen's header card vanished
        // into the dark screen background, reading as a black rect).
        int32_t clipTopL = static_cast<int32_t>(__ui_scroll_candidates[ci].clipTop) - ry - bandTop;
        int32_t clipBotL = static_cast<int32_t>(__ui_scroll_candidates[ci].clipBottom) - ry - bandTop;
        int32_t clipLeftL = static_cast<int32_t>(__ui_scroll_candidates[ci].clipLeft) - rx;
        int32_t clipRightL = static_cast<int32_t>(__ui_scroll_candidates[ci].clipRight) - rx;
        int16_t dispY0 = ui_draw_y_for_node(c);
        int16_t dispX0 = ui_draw_x_for_node(c);
        int32_t y0 = dispY0 < clipTopL ? clipTopL : dispY0;
        int32_t y1 = static_cast<int32_t>(dispY0) + __ui_nodes[c].box.h > clipBotL ? clipBotL : static_cast<int32_t>(dispY0) + __ui_nodes[c].box.h;
        int32_t x0 = dispX0 < clipLeftL ? clipLeftL : dispX0;
        int32_t x1 = static_cast<int32_t>(dispX0) + __ui_nodes[c].box.w > clipRightL ? clipRightL : static_cast<int32_t>(dispX0) + __ui_nodes[c].box.w;
        if (x1 - x0 <= 0 || y1 - y0 <= 0) {
          __ui_nodes[c].box.x = origBoxX;
          __ui_nodes[c].box.y = origBoxY;
          __ui_nodes[c].box.w = origBoxW;
          __ui_nodes[c].box.h = origBoxH;
          continue;
        }
        // box.y/box.x already carry the band shift; add the clamp delta on
        // top (y0 - dispY0 is 0 when unclipped, preserving the shift).
        __ui_nodes[c].box.y = static_cast<int16_t>(__ui_nodes[c].box.y + (y0 - dispY0));
        __ui_nodes[c].box.h = static_cast<int16_t>(y1 - y0);
        __ui_nodes[c].box.x = static_cast<int16_t>(__ui_nodes[c].box.x + (x0 - dispX0));
        __ui_nodes[c].box.w = static_cast<int16_t>(x1 - x0);
      }
      int16_t baseDrawX = ui_base_draw_x_for_node(c);
      int16_t baseDrawY = ui_base_draw_y_for_node(c);
      int16_t drawX = ui_draw_x_for_node(c);
      int16_t drawY = ui_draw_y_for_node(c);
      // Outset shadow at the rest position, under the face (mirrors the
      // main loop; lists manage their own shadow elsewhere).
      if (__ui_nodes[c].kind != NODE_LIST) {
        __ui_nodes[c].box.x = baseDrawX;
        ui_draw_shadow(c, baseDrawY, 0);
      }
      __ui_nodes[c].box.x = drawX;
      uint8_t ts = __ui_nodes[c].textSize ? __ui_nodes[c].textSize : 2;
      uint16_t textMaxW = ui_node_text_max_width(c);
      uint16_t tw = 0;
      uint16_t th = 0;
      ui_node_text_layout_metrics(c, textMaxW, &tw, &th);
      uint16_t paintTextW = tw;
      uint16_t paintTextH = th;
      if (__ui_nodes[c].kind == NODE_TEXT || __ui_nodes[c].kind == NODE_SELECT) {
        uint16_t hInset = static_cast<uint16_t>(__ui_nodes[c].paddingLeft) + static_cast<uint16_t>(__ui_nodes[c].paddingRight) + static_cast<uint16_t>(__ui_nodes[c].borderWidth) * 2;
        uint16_t vInset = static_cast<uint16_t>(__ui_nodes[c].paddingTop) + static_cast<uint16_t>(__ui_nodes[c].paddingBottom) + static_cast<uint16_t>(__ui_nodes[c].borderWidth) * 2;
        paintTextW = static_cast<uint16_t>(tw + hInset);
        paintTextH = static_cast<uint16_t>(th + vInset);
      }
      if (__ui_nodes[c].kind == NODE_CHECK || __ui_nodes[c].kind == NODE_RADIO) {
        paintTextW = static_cast<uint16_t>(tw + 22);
        if (paintTextH < 16) paintTextH = 16;
      }
      const char* displayText = __ui_nodes[c].hasTextBinding
        ? __ui_nodes[c].textBuffer
        : __ui_nodes[c].text;
      UI_COLOR_T bColor = __ui_nodes[c].borderColor ? __ui_nodes[c].borderColor : __ui_nodes[c].fg;
      UI_COLOR_T fillBg = __ui_nodes[c].bg;
      if (__ui_nodes[c].opacity < 100) {
        UI_COLOR_T backdrop = ui_parent_clear_color(c);
        bColor = ui_blend(bColor, backdrop, __ui_nodes[c].opacity);
        fillBg = ui_blend(__ui_nodes[c].bg, backdrop, __ui_nodes[c].opacity);
      }
      UINodeDrawCtx ctx;
      ctx.drawY = drawY;
      ctx.bColor = bColor;
      ctx.fillBg = fillBg;
      ctx.ts = ts;
      ctx.textMaxW = textMaxW;
      ctx.tw = tw;
      ctx.th = th;
      ctx.paintTextW = paintTextW;
      ctx.paintTextH = paintTextH;
      ctx.displayText = displayText;
      ctx.drawingBufferedScroll = 0;
      ctx.drawTarget = prevTarget;
      ctx.origBoxX = origBoxX;
      ctx.origBoxY = origBoxY;
      // Each band starts on a freshly seeded canvas, so the persistent
      // incremental-paint caches (lastTextWidth/Height) are invalid mid-band.
      // Save/restore so the band path is transient (same contract as
      // ui_render_scroll_bands / ui_render_node_bands).
      int16_t savedLastTextW = __ui_nodes[c].lastTextWidth;
      uint16_t savedLastTextH = __ui_nodes[c].lastTextHeight;
      if (__ui_nodes[c].kind == NODE_PROGRESS || __ui_nodes[c].kind == NODE_RANGE) {
        __ui_nodes[c].lastTextWidth = -1;
      }
      __ui_nodes[c].lastTextHeight = 0;
      ui_draw_node_body(static_cast<int16_t>(c), &ctx);
      __ui_nodes[c].lastTextWidth = savedLastTextW;
      __ui_nodes[c].lastTextHeight = savedLastTextH;
      __ui_nodes[c].box.x = origBoxX;
      __ui_nodes[c].box.y = origBoxY;
      __ui_nodes[c].box.w = origBoxW;
      __ui_nodes[c].box.h = origBoxH;
    }
    ui_display_set_target(prevTarget);
    ui_push_canvas_rect(band, rx, static_cast<int16_t>(ry + bandTop), rw, thisH);
  }
  return 1;
}

// ── Per-node band renderer ────────────────────────────────────────────────
// Tear-free single-node repaint when the full node-sized repair canvas won't
// allocate (e.g. a full-width button on a no-PSRAM target: a 284×52 paint rect
// is ~29KB, too big for internal SRAM, so ui_get_repair_canvas returns null and
// the repaint would otherwise fall back to direct clear→redraw-to-SPI, which
// flashes). Mirrors ui_render_scroll_bands but composites a SINGLE node over
// its paint rect, reusing the persistent __ui_band_canvas (~10KB at
// UI_STRIP_BAND_HEIGHT, proven to allocate on no-PSRAM targets). Each band is
// seeded with the parent backdrop, the node's shadow+body+outline composited
// into it, then pushed — one transaction per band — so nothing reaches the
// panel until the band is complete (no tearing). Returns 1 if the band canvas
// allocated and the node was rendered; 0 if even the band canvas can't
// allocate (caller falls back to the direct-draw path).
//
// prX/prY/prW/prH = the node's paint rect in DISPLAY coords (the union of
// rest-shadow + pressed-face + outline, as computed by ui_node_paint_rect).
static inline uint8_t ui_render_node_bands(uint16_t i, int16_t prX, int16_t prY, int16_t prW, int16_t prH) {
  if (i >= __ui_node_count || prW <= 0 || prH <= 0) return 0;
  // Band canvas: reuse the persistent slot, reallocated to prW width (so stride
  // == prW for the single-write push fast path). See ui_band_canvas_for_width.
  CuttlefishCanvas16* band = ui_band_canvas_for_width(prW);
  if (!band) return 0;
  int16_t bandH = display_canvasHeight(band);

  // Display-space draw coords for the node (untranslated — band-local offsets
  // are applied per band below). baseDraw excludes the pressed offset; draw
  // includes it (a pressed button's face sits 3px below its shadow).
  int16_t dispBaseDrawX = ui_base_draw_x_for_node(i);
  int16_t dispBaseDrawY = ui_base_draw_y_for_node(i);
  int16_t dispDrawX = ui_draw_x_for_node(i);
  int16_t dispDrawY = ui_draw_y_for_node(i);
  int16_t origBoxX = __ui_nodes[i].box.x;
  int16_t origBoxY = __ui_nodes[i].box.y;

  // Per-kind draw metrics (same as the main loop / scroll band path).
  uint8_t ts = __ui_nodes[i].textSize ? __ui_nodes[i].textSize : 2;
  uint16_t textMaxW = ui_node_text_max_width(i);
  uint16_t tw = 0;
  uint16_t th = 0;
  ui_node_text_layout_metrics(i, textMaxW, &tw, &th);
  uint16_t paintTextW = tw;
  uint16_t paintTextH = th;
  if (__ui_nodes[i].kind == NODE_TEXT || __ui_nodes[i].kind == NODE_SELECT) {
    uint16_t hInset = static_cast<uint16_t>(__ui_nodes[i].paddingLeft) + static_cast<uint16_t>(__ui_nodes[i].paddingRight) + static_cast<uint16_t>(__ui_nodes[i].borderWidth) * 2;
    uint16_t vInset = static_cast<uint16_t>(__ui_nodes[i].paddingTop) + static_cast<uint16_t>(__ui_nodes[i].paddingBottom) + static_cast<uint16_t>(__ui_nodes[i].borderWidth) * 2;
    paintTextW = static_cast<uint16_t>(tw + hInset);
    paintTextH = static_cast<uint16_t>(th + vInset);
  }
  if (__ui_nodes[i].kind == NODE_CHECK || __ui_nodes[i].kind == NODE_RADIO) {
    paintTextW = static_cast<uint16_t>(tw + 22);
    if (paintTextH < 16) paintTextH = 16;
  }
  const char* displayText = __ui_nodes[i].hasTextBinding
    ? __ui_nodes[i].textBuffer
    : __ui_nodes[i].text;
  UI_COLOR_T bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
  UI_COLOR_T fillBg = __ui_nodes[i].bg;
  if (__ui_nodes[i].opacity < 100) {
    UI_COLOR_T backdrop = ui_parent_clear_color(i);
    bColor = ui_blend(bColor, backdrop, __ui_nodes[i].opacity);
    fillBg = ui_blend(__ui_nodes[i].bg, backdrop, __ui_nodes[i].opacity);
  }

  CuttlefishDisplayTarget* prevTarget = ui_display_get_target();
  // Top→bottom bands over the paint rect.
  for (int16_t bandTop = 0; bandTop < prH; bandTop += bandH) {
    int16_t bandBot = bandTop + bandH;
    if (bandBot > prH) bandBot = prH;
    int16_t thisH = static_cast<int16_t>(bandBot - bandTop);
    // Seed the band with the parent backdrop at this band's Y slice. The seed
    // fills the whole band; bandTop shifts the parent fill rect so its rows
    // land in [0, thisH) of the canvas.
    ui_seed_paint_canvas_for_node(i, band, prX, prY + bandTop, bandTop);
    ui_display_set_target(band);
    // Band-local coords: subtract the paint-rect origin and the band's top row.
    int16_t baseDrawX = static_cast<int16_t>(dispBaseDrawX - prX);
    int16_t baseDrawY = static_cast<int16_t>(dispBaseDrawY - prY - bandTop);
    int16_t drawX = static_cast<int16_t>(dispDrawX - prX);
    int16_t drawY = static_cast<int16_t>(dispDrawY - prY - bandTop);
    // Outset shadow at the rest position (baseDraw), under the face. Mirrors
    // the main loop's pre-body shadow draw. Lists skip the outset shadow in
    // the main loop (their shadow is drawn elsewhere); match that here.
    uint8_t skipListOutsetShadow = (__ui_nodes[i].kind == NODE_LIST);
    if (!skipListOutsetShadow) {
      __ui_nodes[i].box.x = baseDrawX;
      ui_draw_shadow(i, baseDrawY, 0);
    }
    __ui_nodes[i].box.x = drawX;
    UINodeDrawCtx ctx;
    ctx.drawY = drawY;
    ctx.bColor = bColor;
    ctx.fillBg = fillBg;
    ctx.ts = ts;
    ctx.textMaxW = textMaxW;
    ctx.tw = tw;
    ctx.th = th;
    ctx.paintTextW = paintTextW;
    ctx.paintTextH = paintTextH;
    ctx.displayText = displayText;
    ctx.drawingBufferedScroll = 0;
    ctx.drawTarget = prevTarget;
    ctx.origBoxX = origBoxX;
    ctx.origBoxY = origBoxY;
    // Each band starts on a freshly seeded canvas, so the persistent
    // incremental-paint caches (lastTextWidth/Height) are invalid mid-band.
    // Save/restore so the band path is transient (see ui_render_scroll_bands).
    int16_t savedLastTextW = __ui_nodes[i].lastTextWidth;
    uint16_t savedLastTextH = __ui_nodes[i].lastTextHeight;
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) {
      __ui_nodes[i].lastTextWidth = -1;
    }
    __ui_nodes[i].lastTextHeight = 0;
    if (!ui_draw_node_body(static_cast<int16_t>(i), &ctx)) {
      ui_draw_node_outline(i, __ui_nodes[i].box.x, drawY);
    }
    __ui_nodes[i].lastTextWidth = savedLastTextW;
    __ui_nodes[i].lastTextHeight = savedLastTextH;
    __ui_nodes[i].box.x = origBoxX;
    __ui_nodes[i].box.y = origBoxY;
    ui_display_set_target(prevTarget);
    // Push the full paint-rect width (== stride) in one transaction: each band
    // is complete before it touches the panel, eliminating the press flash.
    ui_push_canvas_rect(band, prX, static_cast<int16_t>(prY + bandTop), prW, thisH);
  }
  return 1;
}

// ── List band renderer ────────────────────────────────────────────────────
// Tear-free <list> rendering when the viewport-sized list canvas won't allocate
// (a full-width list viewport is ~29KB+, too big for no-PSRAM SRAM, so the
// shift-and-repair cache can't be built and the list would otherwise render
// nothing). Mirrors ui_render_scroll_bands but composites the list's OWN
// virtualized rows (via listItemFn) instead of a subtree walk. Reuses the
// persistent __ui_band_canvas (~10KB at UI_STRIP_BAND_HEIGHT); each band is
// fully rendered — content rows + scrollbar slice — before its single SPI
// push, so the panel never shows a half-drawn frame. Returns 1 if the band
// canvas allocated and the list was rendered+pushed+decorated; 0 if even the
// band canvas can't allocate (caller renders nothing).
//
// Shift-and-repair is impossible without the viewport cache, so every repaint
// re-renders all visible rows. For a typical ~10-20 row text list this is
// affordable; lastPaintedScrollY is still updated so a later transition to
// canvas mode (memory frees) starts correctly.
static inline uint8_t ui_render_list_bands(uint16_t i) {
  if (i >= __ui_node_count) return 0;
  if (!__ui_nodes[i].listItemFn) return 0;
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = ui_draw_y_for_node(i);
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  if (bw <= 0 || bh <= 0) return 0;
  uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
  uint16_t itemCount = __ui_nodes[i].listCount;
  int16_t listScrollY = __ui_nodes[i].scrollY;
  int16_t listContentH = __ui_nodes[i].contentHeight;
  UI_COLOR_T clearCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
  int16_t origBoxX = __ui_nodes[i].box.x;
  int16_t origBoxY = __ui_nodes[i].box.y;

  // Reuse the persistent band canvas, reallocated to bw width (so stride == bw
  // for the single-write push fast path). See ui_band_canvas_for_width.
  CuttlefishCanvas16* band = ui_band_canvas_for_width(bw);
  if (!band) return 0;
  int16_t bandH = display_canvasHeight(band);

  // Scrollbar geometry (viewport coords), same as the cached-canvas list path.
  // Track spans [0, bh); thumb spans [thumbY, thumbY + thumbH). 3px wide at
  // canvas-x (bw - 4). Composited per band so the full-width push is atomic.
  int16_t contentW = bw > 4 ? static_cast<int16_t>(bw - 4) : bw;
  uint8_t sbVisible = (listContentH > bh) ? 1 : 0;
  uint16_t sbThumbH = 0;
  uint16_t sbThumbY = 0;
  UI_COLOR_T sbTrackCol = (UI_COLOR_T)((__ui_nodes[i].fg >> 1) & UI_DIM_MASK);
  UI_COLOR_T sbThumbCol = __ui_nodes[i].fg;
  if (sbVisible) {
    sbThumbH = static_cast<uint32_t>(bh) * bh / listContentH;
    if (sbThumbH < 8) sbThumbH = 8;
    if (sbThumbH > static_cast<uint16_t>(bh)) sbThumbH = static_cast<uint16_t>(bh);
    int16_t maxScroll = listContentH - bh;
    sbThumbY = maxScroll > 0 ? static_cast<uint32_t>(bh - sbThumbH) * listScrollY / maxScroll : 0;
  }

  char listBuf[UI_TEXT_BUF + 1];
  CuttlefishDisplayTarget* listBandPrevTarget = ui_display_get_target();
  // Top→bottom bands over the list viewport.
  for (int16_t bandTop = 0; bandTop < bh; bandTop += bandH) {
    int16_t bandBot = bandTop + bandH;
    if (bandBot > bh) bandBot = bh;
    int16_t thisH = static_cast<int16_t>(bandBot - bandTop);
    // Seed content area with the list bg; the gutter is filled by the
    // scrollbar composite below (or cleared to bg when no scrollbar).
    display_canvasFillRect(band, 0, 0, contentW, bandH, clearCol);
    if (!sbVisible) {
      display_canvasFillRect(band, contentW, 0, bw - contentW, bandH, clearCol);
    }
    // Draw visible items whose row intersects this band (canvas-local Y).
    display_targetSetTextWrap((CuttlefishDisplayTarget*)band, false);
    if (itemCount > 0) {
      // First/last item index whose [idx*ih - listScrollY, +ih) overlaps the
      // band's viewport-Y range [bandTop, bandBot).
      uint16_t first = static_cast<uint16_t>((listScrollY + bandTop) / ih);
      int32_t lastSigned = (static_cast<int32_t>(listScrollY) + bandBot - 1) / ih;
      uint16_t last = lastSigned < 0 ? 0 : static_cast<uint16_t>(lastSigned);
      if (itemCount > 0 && last >= itemCount) last = itemCount - 1;
      for (uint16_t idx = first; idx <= last; idx++) {
        int16_t itemY = static_cast<int16_t>(idx * ih) - listScrollY - bandTop;
        // Cull rows fully outside this band (the first/last estimate can be
        // off by one at the edges).
        if (itemY + static_cast<int16_t>(ih) <= 0) continue;
        if (itemY >= thisH) continue;
        __ui_nodes[i].listItemFn(idx, listBuf, UI_TEXT_BUF + 1);
        listBuf[UI_TEXT_BUF] = 0;
        ui_display_set_target(band);
        int16_t __ui_saved_off_x = __ui_draw_off_x;
        int16_t __ui_saved_off_y = __ui_draw_off_y;
        __ui_draw_off_x = 0;
        __ui_draw_off_y = 0;
        // Keep classic list glyphs in the canvas pixel buffer. Native
        // CuttlefishGFX text can disappear when copied from a canvas to
        // the panel, while the explicit glyph path remains compositable.
        ui_draw_list_text(listBuf, 4, itemY + static_cast<int16_t>(ih - 16) / 2,
          __ui_nodes[i].fg, clearCol, 2, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
        __ui_draw_off_x = __ui_saved_off_x;
        __ui_draw_off_y = __ui_saved_off_y;
        ui_display_set_target(listBandPrevTarget);
      }
    }
    // Composite this band's scrollbar slice into the gutter (atomic full-width
    // push — no separate erase/redraw cycle, no scrollbar flash).
    if (sbVisible) {
      // Full gutter width (bw - contentW): child decorations poking past the
      // content area must not survive in an uncovered edge column.
      display_canvasFillRect(band, contentW, 0, bw - contentW, thisH, sbTrackCol);
      int16_t thumbTop = static_cast<int16_t>(sbThumbY);
      int16_t thumbBot = static_cast<int16_t>(sbThumbY + sbThumbH);
      int16_t ovTop = thumbTop > bandTop ? thumbTop : bandTop;
      int16_t ovBot = thumbBot < bandBot ? thumbBot : bandBot;
      if (ovBot > ovTop) {
        display_canvasFillRect(band, contentW, static_cast<int16_t>(ovTop - bandTop), 3, static_cast<int16_t>(ovBot - ovTop), sbThumbCol);
      }
    }
    ui_push_canvas_rect(band, bx, static_cast<int16_t>(by + bandTop), bw, thisH);
  }
  // Static decoration on top of the composited content (same order as the
  // cached-canvas list path: outset shadow, border, outline).
  if (!__ui_fb) {
    ui_draw_shadow(i, by, 0);
  }
  ui_draw_shadow(i, by, 1);
  if (__ui_nodes[i].borderStyle != 0) {
    UI_COLOR_T bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
    ui_draw_node_border(i, bx, by, bColor);
  }
  ui_draw_node_outline(i, bx, by);
  __ui_list_canvas_node = static_cast<int16_t>(i);
  __ui_nodes[i].lastPaintedScrollY = listScrollY;
  __ui_nodes[i].dirty = 0;
  __ui_nodes[i].box.x = origBoxX;
  __ui_nodes[i].box.y = origBoxY;
  return 1;
}

// Last-resort list renderer used only when neither the viewport canvas nor the
// bounded band canvas can allocate. It keeps the list usable under severe heap
// pressure; normal paths remain canvas-composited and tear-resistant.
static inline uint8_t ui_render_list_direct(uint16_t i) {
  if (i >= __ui_node_count || !__ui_nodes[i].listItemFn) return 0;
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = ui_draw_y_for_node(i);
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  if (bw <= 0 || bh <= 0) return 0;
  uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
  uint16_t count = __ui_nodes[i].listCount;
  int16_t scrollY = __ui_nodes[i].scrollY;
  UI_COLOR_T bg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
  CuttlefishDisplayTarget* target = ui_display_get_target();
  ui_display_set_target(target);
  // This fallback is used only when no framebuffer is active. Keep the fill,
  // native text, and scrollbar in one panel transaction so the visible fallback
  // remains coherent on SPI TFTs even though it does not use a canvas.
  if (!__ui_fb) display_startWrite();
  ui_display_fill_rect(bx, by, bw, bh, bg);
  char buf[UI_TEXT_BUF + 1];
  uint16_t first = static_cast<uint16_t>((scrollY + 15) / ih);
  int16_t lastY = static_cast<int16_t>(scrollY + bh - 16);
  uint16_t last = lastY >= 0 ? static_cast<uint16_t>(lastY / ih) : 0;
  if (count > 0 && last >= count) last = count - 1;
  if (count > 0 && first < count && first <= last) {
    for (uint16_t idx = first; idx <= last; idx++) {
      int16_t itemY = static_cast<int16_t>(idx * ih) - scrollY;
      __ui_nodes[i].listItemFn(idx, buf, UI_TEXT_BUF + 1);
      buf[UI_TEXT_BUF] = 0;
      int16_t savedX = __ui_draw_off_x;
      int16_t savedY = __ui_draw_off_y;
      __ui_draw_off_x = 0;
      __ui_draw_off_y = 0;
      ui_draw_list_text_direct(buf, bx + 4, by + itemY + static_cast<int16_t>(ih - 16) / 2,
        __ui_nodes[i].fg, bg, 2, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
      __ui_draw_off_x = savedX;
      __ui_draw_off_y = savedY;
    }
  }
  if (__ui_nodes[i].contentHeight > bh) {
    int16_t tx = bx + bw - 4;
    uint16_t thumbH = static_cast<uint32_t>(bh) * bh / __ui_nodes[i].contentHeight;
    if (thumbH < 8) thumbH = 8;
    if (thumbH > static_cast<uint16_t>(bh)) thumbH = static_cast<uint16_t>(bh);
    int16_t maxScroll = __ui_nodes[i].contentHeight - bh;
    uint16_t thumbY = maxScroll > 0 ? static_cast<uint32_t>(bh - thumbH) * scrollY / maxScroll : 0;
    UI_COLOR_T dimFg = (UI_COLOR_T)((__ui_nodes[i].fg >> 1) & UI_DIM_MASK);
    ui_display_fill_rect(tx, by, 3, bh, dimFg);
    ui_display_fill_rect(tx, static_cast<int16_t>(by + thumbY), 3, thumbH, __ui_nodes[i].fg);
  }
  if (!__ui_fb) display_endWrite();
  ui_draw_shadow(i, by, 1);
  if (__ui_nodes[i].borderStyle != 0) {
    UI_COLOR_T border = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
    ui_draw_node_border(i, bx, by, border);
  }
  ui_draw_node_outline(i, bx, by);
  __ui_nodes[i].lastPaintedScrollY = scrollY;
  __ui_nodes[i].dirty = 0;
  return 1;
}
`;
}
