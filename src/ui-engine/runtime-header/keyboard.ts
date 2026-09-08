// Slice of the C++ runtime header (original source lines 5434-5769).
// On-screen keyboard: add_key/insert/delete/compute_box/open/close/rect/touch/tick/tap/draw.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitKeyboard(): string {
  return `
// ── On-screen keyboard subsystem ───────────────────────────────────────────
// (UIKey struct, UI_KB_* defines, __ui_kb_box, __ui_kb_visible, __ui_kb_bs_held,
//  __ui_last_touch_x/y are declared earlier near the touch state machine so
//  the touch functions can reference them.)

// Populated by the per-keyboard loader function (emitted by the lowering).
// (__ui_kb_keys is forward-declared earlier near the touch state machine.)
static uint8_t __ui_kb_keyCount;
static uint8_t __ui_kb_rows;
static uint8_t __ui_kb_cols;
static char    __ui_kb_buffer[UI_TEXT_BUF + 1];
static uint8_t __ui_kb_len;
static uint8_t __ui_kb_maxlen;
static uint8_t __ui_kb_shift;
// __ui_kb_visible, __ui_kb_bs_held, __ui_last_touch_x/y are forward-declared
// earlier (near the touch state machine) because ui_touch_up references them.
// __ui_kb_target is also forward-declared there (the UI_HIDE_OSK caret/blink
// paths in ui_tick and the input draw reference it before this point).
static uint32_t __ui_kb_bs_repeat;   // last auto-repeat deletion time
// __ui_kb_dirty is forward-declared earlier (near the touch state machine).
static void    (*__ui_kb_onchange)();
// Dispatch table: one loader per input node. Indexed by input position.
extern void (*__ui_kb_loaders[])();
extern const uint16_t __ui_kb_loader_count;

static inline void ui_kb_add_key(char ch, uint8_t special, UI_COLOR_T bg, UI_COLOR_T fg, UI_COLOR_T borderColor) {
  if (__ui_kb_keyCount >= UI_KB_MAX) return;
  __ui_kb_keys[__ui_kb_keyCount] = { ch, special };
  __ui_kb_styles[__ui_kb_keyCount] = { bg, fg, borderColor };
  __ui_kb_keyCount++;
}

// Insert a character into the buffer (if space permits).
static inline void ui_kb_insert(char c) {
  if (__ui_kb_maxlen > 0 && __ui_kb_len >= __ui_kb_maxlen) return;
  if (__ui_kb_len >= UI_TEXT_BUF) return;
  __ui_kb_buffer[__ui_kb_len++] = c;
  __ui_kb_buffer[__ui_kb_len] = 0;
#if defined(UI_HIDE_OSK)
  // Desktop target: the OSK grid isn't drawn, so the input field itself is the
  // only place the in-progress text appears. Sync the buffer into the target
  // node's textBuffer and mark it dirty so the field repaints on the next tick
  // — without this, typing appears to do nothing until Enter commits at close.
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    ui_mark_dirty(static_cast<uint16_t>(__ui_kb_target));
  }
#endif
}

// Delete one character from the buffer.
static inline void ui_kb_delete() {
  if (__ui_kb_len == 0) return;
  __ui_kb_buffer[--__ui_kb_len] = 0;
#if defined(UI_HIDE_OSK)
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    ui_mark_dirty(static_cast<uint16_t>(__ui_kb_target));
  }
#endif
}

// Compute the keyboard box on open from display dimensions + grid shape.
// Alpha (wide grid) docks to the bottom 75%; number (narrow grid) centers at 60%.
// Uses the display profile dimensions if available, else 320×240.
#ifndef __ui_display_w
#define __ui_display_w 320
#endif
#ifndef __ui_display_h
#define __ui_display_h 240
#endif
static inline void ui_kb_compute_box() {
  uint8_t isNumber = (__ui_kb_cols <= 4);
  uint16_t h = isNumber ? (__ui_display_h * 60 / 100) : (__ui_display_h * 75 / 100);
  __ui_kb_box.w = isNumber ? (__ui_display_w * 50 / 100) : __ui_display_w;
  __ui_kb_box.h = h;
  __ui_kb_box.x = isNumber ? (__ui_display_w - __ui_kb_box.w) / 2 : 0;
  __ui_kb_box.y = __ui_display_h - h;
}

// Open the keyboard for an input node.
static inline void ui_kb_open(uint16_t nodeIdx, uint8_t inputPosition) {
  __ui_kb_target = nodeIdx;
  strncpy(__ui_kb_buffer, __ui_nodes[nodeIdx].textBuffer, UI_TEXT_BUF);
  __ui_kb_buffer[UI_TEXT_BUF] = 0;
  __ui_kb_len = strlen(__ui_kb_buffer);
  uint16_t ml = __ui_nodes[nodeIdx].maxlen;
  __ui_kb_maxlen = (ml > 0 && ml <= UI_TEXT_BUF) ? static_cast<uint8_t>(ml) : UI_TEXT_BUF;
  __ui_kb_shift = 0;
  __ui_kb_bs_held = 0;
  // Load the key set via the dispatch table.
  if (inputPosition < __ui_kb_loader_count) __ui_kb_loaders[inputPosition]();
  __ui_kb_set_onchange();
  ui_kb_compute_box();
  __ui_kb_visible = 1;
  __ui_kb_dirty = 1;  // redraw on the first visible frame
  // Do NOT pre-mark the tree dirty here. While the keyboard is visible the
  // draw pass is skipped (its opaque background covers app nodes), so any
  // dirty flags set now are never consumed/cleared — they survive until close,
  // and the first post-close frame then repaints every dirty node = full-screen
  // flash on SPI TFTs. The close path scopes the repaint to nodes whose paint
  // rect intersects __ui_kb_box, which is the only region that needs restoring.
#if defined(UI_HIDE_OSK)
  // Desktop target: the OSK isn't drawn, so the draw pass runs normally and the
  // input field must repaint on focus to show the caret BEFORE the first
  // keystroke. (The full-screen-flash concern above doesn't apply — there's no
  // opaque overlay being skipped.) Seed the blink phase so the caret is ON for
  // the first ~530ms (bit 0x20 set → visible), so focus feels immediate.
  if (__ui_kb_target >= 0) ui_mark_dirty(static_cast<uint16_t>(__ui_kb_target));
  __ui_kb_blink = 0x20;
#endif
}

// Close the keyboard: commit buffer back to the input node.
static inline void ui_kb_close() {
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    if (__ui_kb_onchange) __ui_kb_onchange();
  }
  // Capture the keyboard box before clearing visibility — it identifies the
  // screen region the opaque overlay covered and that now needs restoring.
  UIRect kbBox = __ui_kb_box;
  __ui_kb_visible = 0;
  __ui_kb_target = -1;
  __ui_kb_bs_held = 0;
  // The <screen> root's paint rect spans the whole display, so it always
  // intersects kbBox. Routing it through ui_mark_dirty would cascade via
  // ui_mark_overlapping_higher_layers_dirty into marking every node on the
  // active screen dirty (its rect overlaps everything), which is the
  // full-screen flash this function exists to avoid. Repaint just the
  // keyboard-box slice of its background directly instead.
  int16_t screenRoot = -1;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].parent == UI_NO_PARENT && __ui_nodes[i].screenId == __ui_active_screen) {
      screenRoot = static_cast<int16_t>(i);
      break;
    }
  }
  if (screenRoot >= 0) {
    UI_COLOR_T rootBg = (UI_COLOR_T)(__ui_nodes[screenRoot].hasBg
      ? __ui_nodes[screenRoot].bg
      : __ui_nodes[screenRoot].clearColor);
    ui_display_fill_rect(kbBox.x, kbBox.y, kbBox.w, kbBox.h, rootBg);
  }
  // Repaint everything else the keyboard overlay actually overwrote: nodes
  // whose paint rect intersects the keyboard box, plus the edited input
  // itself (its text just changed). ui_mark_dirty handles overlap repair +
  // scroll clipping — safe here since these nodes are bounded in size, unlike
  // the screen root.
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (static_cast<int16_t>(i) == screenRoot) continue;
    UIRect r;
    ui_node_current_paint_rect(i, &r);
    if (r.w > 0 && r.h > 0 &&
        ui_rects_intersect(r.x, r.y, r.w, r.h, kbBox.x, kbBox.y, kbBox.w, kbBox.h)) {
      ui_mark_dirty(i);
    }
  }
}

// Compute a key's rect from its index, given the grid + box.
// The top UI_KB_TEXT_H pixels of the box are reserved for the preview text row;
// keys fill the area below it.
static inline void ui_kb_key_rect(uint8_t idx, UIRect* out) {
  uint8_t col = idx % __ui_kb_cols;
  uint8_t row = idx / __ui_kb_cols;
  int16_t keysH = __ui_kb_box.h - UI_KB_TEXT_H;  // key area height (below text row)
  out->x = __ui_kb_box.x + static_cast<int16_t>(col) * __ui_kb_box.w / __ui_kb_cols;
  out->y = __ui_kb_box.y + UI_KB_TEXT_H + static_cast<int16_t>(row) * keysH / __ui_kb_rows;
  out->w = __ui_kb_box.w / __ui_kb_cols;
  out->h = keysH / __ui_kb_rows;
}

// Handle a touch-down inside the keyboard box. tx,ty are display coords.
// Handle a touch-down inside the keyboard box. Only fires on the initial
// down edge (tracked by __ui_touch_state in the modal path), NOT every poll.
// Records WHICH key is under the finger — the same key is activated on release
// (ui_kb_handle_tap), avoiding mis-targeting from coordinate drift on release.
static inline void ui_kb_handle_touch(int16_t tx, int16_t ty) {
  __ui_kb_pressed_key = -1;
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIKey k = __ui_kb_keys[i];
    if (k.special == 255) continue;  // padding cell, skip
    UIRect r;
    ui_kb_key_rect(i, &r);
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
      __ui_kb_pressed_key = static_cast<int8_t>(i);  // remember for release
      __ui_kb_repaint_key = static_cast<int8_t>(i);
      __ui_kb_dirty = 2;  // targeted: redraw just this key's highlight
      // Backspace starts deleting immediately + arms auto-repeat.
      if (k.special == 2) {
        __ui_kb_bs_held = 1;
        __ui_kb_bs_repeat = __tc_now_ms();
        ui_kb_delete();
      }
      return;
    }
  }
}

// Called each frame while the keyboard is visible + a touch is held.
// Handles ⌫ auto-repeat.
static inline void ui_kb_tick(uint32_t now) {
  if (!__ui_kb_bs_held) return;
  if (now - __ui_kb_bs_repeat >= UI_KB_REPEAT_MS) {
    ui_kb_delete();
    __ui_kb_bs_repeat = now;
    __ui_kb_repaint_key = __ui_kb_pressed_key;  // ⌫ key stays highlighted
    __ui_kb_dirty = 2;  // targeted: text row + ⌫ key
  }
}

// Handle a tap release. Activates the key that was under the finger on
// touch-down (__ui_kb_pressed_key) — NOT a fresh hit-test, which would
// mis-target due to coordinate drift on a resistive panel at release.
static inline void ui_kb_handle_tap(int16_t tx, int16_t ty) {
  (void)tx; (void)ty;  // key was recorded on touch-down; no re-hit-test
  if (__ui_kb_pressed_key < 0) return;
  UIKey k = __ui_kb_keys[__ui_kb_pressed_key];
  int8_t releasedKey = __ui_kb_pressed_key;
  __ui_kb_pressed_key = -1;  // clear pressed state → highlight reverts
  switch (k.special) {
    case 0: {  // char
      char c = k.ch;
      uint8_t wasShift = __ui_kb_shift;
      if (wasShift && c >= 'a' && c <= 'z') c -= 32;
      ui_kb_insert(c);
      __ui_kb_shift = 0;  // shift resets after one char
      // Text row changes; if shift was active, repaint shift key too.
      __ui_kb_repaint_key = wasShift ? -1 : releasedKey;
      __ui_kb_dirty = 2;
      break;
    }
    case 1:  // shift toggle — all letter keys change case, full redraw
      __ui_kb_shift = !__ui_kb_shift;
      __ui_kb_dirty = 1;
      break;
    case 2:  // backspace: handled on down + repeat; nothing on tap-up
      __ui_kb_repaint_key = releasedKey;  // revert highlight
      __ui_kb_dirty = 2;
      break;
    case 3:  // OK
      ui_kb_close();
      break;
    case 4: {  // page-swap — new key layout, full redraw
      extern void __ui_kb_load_default_alpha();
      extern void __ui_kb_load_default_number();
      if (__ui_kb_cols <= 4) __ui_kb_load_default_alpha();
      else __ui_kb_load_default_number();
      ui_kb_compute_box();
      __ui_kb_dirty = 1;
      break;
    }
  }
}

// Draw a single key by index. Shared by the full draw + targeted redraw.
static inline void ui_kb_draw_key(uint8_t i) {
  UIKey k = __ui_kb_keys[i];
  UIKeyStyle ks = __ui_kb_styles[i];
  UIRect r;
  ui_kb_key_rect(i, &r);
  UI_COLOR_T bg = ks.bg;
  UI_COLOR_T fg = ks.fg;
  UI_COLOR_T border = ks.borderColor;
  // Shift-active highlight: brighten the shift key's background — but only
  // when not pressed, so the press inversion stays high-contrast.
  if (k.special == 1 && __ui_kb_shift && static_cast<int8_t>(i) != __ui_kb_pressed_key) {
#if UI_COLOR_DEPTH == 888
    bg = 0xBDEFFF;
#else
    bg = 0xBDF7;
#endif
  }
  // Pressed key: invert colors for clear tap feedback.
  if (static_cast<int8_t>(i) == __ui_kb_pressed_key) { UI_COLOR_T t = bg; bg = fg; fg = t; }
  ui_display_fill_rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, bg);
  ui_display_draw_rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, border);
  ui_display_set_text_color(fg, bg);
  ui_display_set_text_size(1);
  // Derive the label string + its length for centering.
  const char* labelStr;
  char single[2];
  switch (k.special) {
    case 1:  labelStr = "Aa"; break;
    case 2:  labelStr = "DEL"; break;
    case 3:  labelStr = "OK"; break;
    case 4:  labelStr = __ui_kb_cols <= 4 ? "ABC" : "123"; break;
    default:
      single[0] = (__ui_kb_shift && k.ch >= 'a' && k.ch <= 'z') ? static_cast<char>(k.ch - 32) : k.ch;
      single[1] = 0;
      labelStr = single;
      break;
  }
  // Center: textW = len * 6px, textH = 8px. Position inside the key rect.
  uint8_t len = strlen(labelStr);
  int16_t textW = static_cast<int16_t>(len) * 6;
  int16_t textH = 8;
  int16_t cx = r.x + (r.w - textW) / 2;
  int16_t cy = r.y + (r.h - textH) / 2;
  if (cx < r.x + 1) cx = r.x + 1;  // clamp if label wider than key
  ui_display_set_cursor(cx, cy);
  ui_display_print(labelStr);
}

// Redraw only the text display row (top of keyboard box). Used when a char is
// inserted/deleted without changing key highlights.
static inline void ui_kb_draw_text_row() {
  // Clear the text row area (top UI_KB_TEXT_H px of the keyboard box).
  ui_display_fill_rect(__ui_kb_box.x, __ui_kb_box.y, __ui_kb_box.w, UI_KB_TEXT_H, __ui_kb_bg);
  ui_display_set_cursor(__ui_kb_box.x + 4, __ui_kb_box.y + 4);
#if UI_COLOR_DEPTH == 888
  ui_display_set_text_color(0xFFFFFF, 0x000000);
#else
  ui_display_set_text_color(0xFFFF, 0x0000);
#endif
  ui_display_set_text_size(2);
  ui_display_print(__ui_kb_buffer);
  ui_display_print("_");  // cursor
}

// Draw the full keyboard overlay (background + text row + all keys).
// Renders into a dedicated offscreen canvas first, then pushes in a single
// SPI transaction — avoids the per-key/per-rect display writes that show up
// as visible row-by-row painting on SPI TFTs.
// (__ui_kb_canvas is forward-declared in the touch-keyboard-fwd slice.)
static inline void ui_kb_draw() {
  int16_t kw = __ui_kb_box.w;
  int16_t kh = __ui_kb_box.h;
  if (kw <= 0 || kh <= 0) return;
  // (Re)allocate the keyboard canvas to exact size (see repair-canvas comment
  // — stride mismatch corrupts the push when reusing a differently-sized canvas).
  // ui_create_canvas_best prefers PSRAM when available (a full-width keyboard
  // canvas can be ~30KB, too big for no-PSRAM internal SRAM) and falls back to
  // SRAM — same policy as the list/scroll viewport canvases.
  if (!__ui_kb_canvas || !display_canvasBuffer(__ui_kb_canvas) ||
      display_canvasWidth(__ui_kb_canvas) != kw ||
      display_canvasHeight(__ui_kb_canvas) != kh) {
    display_deleteCanvas(__ui_kb_canvas);
    __ui_kb_canvas = ui_create_canvas_best(kw, kh);
  }
  if (!__ui_kb_canvas || !display_canvasBuffer(__ui_kb_canvas)) {
    // Canvas alloc failed — fall back to direct draw (slow but correct).
    ui_display_fill_rect(__ui_kb_box.x, __ui_kb_box.y, kw, kh, __ui_kb_bg);
    ui_kb_draw_text_row();
    for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
      if (__ui_kb_keys[i].special == 255) continue;
      ui_kb_draw_key(i);
    }
    return;
  }
  // Redirect drawing into the canvas. All ui_display_* calls below go to RAM.
  CuttlefishDisplayTarget* __kb_prev_target = ui_display_get_target();
  ui_display_set_target(__ui_kb_canvas);
  // Opaque background over the keyboard box (canvas-local 0,0).
  ui_display_fill_rect(0, 0, kw, kh, __ui_kb_bg);
  // Text row + keys: temporarily shift box origin to canvas-local so the
  // existing draw_text_row / draw_key functions compute coords at (0,0).
  int16_t saveBoxX = __ui_kb_box.x;
  int16_t saveBoxY = __ui_kb_box.y;
  __ui_kb_box.x = 0;
  __ui_kb_box.y = 0;
  ui_kb_draw_text_row();
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    if (__ui_kb_keys[i].special == 255) continue;
    ui_kb_draw_key(i);
  }
  __ui_kb_box.x = saveBoxX;
  __ui_kb_box.y = saveBoxY;
  // Restore display target and push the canvas in one transaction.
  ui_display_set_target(__kb_prev_target);
  display_startWrite();
  display_setAddrWindow(saveBoxX, saveBoxY, kw, kh);
  display_writePixels(display_canvasBuffer(__ui_kb_canvas), static_cast<uint32_t>(kw) * kh);
  display_endWrite();
}

static inline void ui_select_menu_geom(uint16_t nodeIdx, UIRect* out, int16_t* rowH) {
  const UINode* n = &__ui_nodes[nodeIdx];
  int16_t rows = static_cast<int16_t>(n->optionCount);
  if (rows < 1) rows = 1;
  *rowH = 22;
  // Anchor to the select itself: same left edge and width, so the modal
  // reads as the control's own dropdown (never overhangs toward a scrollbar).
  // Clamp to the screen for selects that extend past it.
  int16_t x = n->box.x;
  if (x < 0) x = 0;
  int16_t w = n->box.w;
  if (w < 120) w = 120;
  if (x + w > static_cast<int16_t>(__ui_display_w)) w = static_cast<int16_t>(__ui_display_w) - x;
  int16_t h = rows * (*rowH) + 8;
  int16_t maxH = static_cast<int16_t>(__ui_display_h) * 3 / 5;
  if (h > maxH) h = maxH;
  out->x = x;
  out->y = static_cast<int16_t>((static_cast<int16_t>(__ui_display_h) - h) / 2);
  out->w = w;
  out->h = h;
}

static inline void ui_select_menu_open(uint16_t nodeIdx) {
  if (__ui_nodes[nodeIdx].kind != NODE_SELECT) return;
  if (__ui_nodes[nodeIdx].optionCount < 1) return;
  __ui_select_menu = static_cast<int16_t>(nodeIdx);
  __ui_select_menu_dirty = 1;
}

static inline void ui_select_menu_close(uint8_t repaint) {
  if (__ui_select_menu < 0) return;
  __ui_select_menu = -1;
  __ui_select_menu_dirty = 0;
  if (repaint) {
    // Erase repaint: the whole active screen redraws beneath the vanished
    // overlay (same contract as navigate's mark-all-dirty).
    for (uint16_t i = 0; i < __ui_node_count; i++) {
      __ui_nodes[i].dirty = 1;
      __ui_nodes[i].lastTextHeight = 0;
    }
  }
}

static inline void ui_select_menu_draw() {
  if (__ui_select_menu < 0) return;
  uint16_t idx = static_cast<uint16_t>(__ui_select_menu);
  const UINode* n = &__ui_nodes[idx];
  UIRect g;
  int16_t rowH;
  ui_select_menu_geom(idx, &g, &rowH);
  // Themed panel: the select's own radius/border/bg — the modal reads as
  // the control's popover, matching the surrounding UI (device parity with
  // the preview's drawSelectMenu theming).
  int16_t radius = n->borderRadius > 0 ? n->borderRadius : 6;
  if (radius > g.w / 2) radius = g.w / 2;
  if (radius > g.h / 2) radius = g.h / 2;
  UI_COLOR_T panel = n->hasBg ? n->bg : n->clearColor;
  UI_COLOR_T borderCol = (n->borderStyle != 0 && n->borderColor != 0) ? n->borderColor : n->fg;
  ui_display_fill_round_rect(g.x, g.y, g.w, g.h, radius, panel);
  ui_display_draw_round_rect(g.x, g.y, g.w, g.h, radius, borderCol);
  char buf[UI_TEXT_BUF + 1];
  int16_t rowInset = radius / 2; if (rowInset < 2) rowInset = 2;
  int16_t rowRadius = radius; if (rowRadius > 6) rowRadius = 6;
  for (uint8_t r = 0; r < n->optionCount; r++) {
    int16_t ry = g.y + 4 + static_cast<int16_t>(r) * rowH;
    uint8_t current = (r == static_cast<uint8_t>(n->value));
    // The selected row carries the :checked pair (the kit wires it to
    // --accent/--accent-foreground, shadcn's SelectItem selected state).
    UI_COLOR_T rowBg = n->hasCheckedBg ? static_cast<UI_COLOR_T>(n->checkedBg) : n->fg;
    UI_COLOR_T rowFg = n->hasCheckedFg ? static_cast<UI_COLOR_T>(n->checkedFg) : panel;
    if (current) {
      ui_display_fill_round_rect(g.x + rowInset, ry, g.w - 2 * rowInset, rowH, rowRadius, rowBg);
    }
    buf[0] = 0;
    if (n->optionTextFn) n->optionTextFn(r, buf, UI_TEXT_BUF + 1);
    ui_draw_wrapped_text(buf,
      g.x + 22, ry + (rowH - static_cast<int16_t>(8 * n->textSize)) / 2,
      static_cast<uint16_t>(g.w - 30),
      current ? rowFg : n->fg,
      panel, n->textSize, n->fontAntialias, n->fontFace, n->letterSpacing,
      n->lineHeight, n->whiteSpaceMode, 0, 0, 0);
    if (current) {
      int16_t cx = g.x + 7;
      int16_t cy = ry + rowH / 2;
      ui_display_draw_line(cx, cy, cx + 3, cy + 3, rowFg);
      ui_display_draw_line(cx + 3, cy + 3, cx + 8, cy - 4, rowFg);
    }
  }
  __ui_select_menu_dirty = 0;
}

static inline void ui_select_menu_tap(int16_t tx, int16_t ty) {
  if (__ui_select_menu < 0) return;
  uint16_t idx = static_cast<uint16_t>(__ui_select_menu);
  UIRect g;
  int16_t rowH;
  ui_select_menu_geom(idx, &g, &rowH);
  if (tx >= g.x && tx < g.x + g.w && ty >= g.y && ty < g.y + g.h) {
    int16_t row = (ty - g.y - 4) / rowH;
    if (row >= 0 && row < static_cast<int16_t>(__ui_nodes[idx].optionCount)) {
      __ui_nodes[idx].value = row;
      ui_mark_dirty(idx);
    }
  }
  ui_select_menu_close(1);
}

// ── <drawer> implementation (device twin of the preview drawer) ──────────

static int8_t __ui_drawer_slot_of(uint16_t nodeIdx) {
  for (uint8_t s = 0; s < __ui_drawer_slots; s++) {
    if (__ui_drawer_idx[s] == static_cast<int16_t>(nodeIdx)) return static_cast<int8_t>(s);
  }
  return -1;
}

static void ui_drawer_discover() {
  __ui_drawer_slots = 0;
  for (uint16_t i = 0; i < __ui_node_count && __ui_drawer_slots < UI_DRAWER_MAX; i++) {
    if (__ui_nodes[i].drawerSide < 0) continue;
    uint8_t s = __ui_drawer_slots++;
    __ui_drawer_idx[s] = static_cast<int16_t>(i);
    __ui_drawer_open[s] = 0;
    __ui_drawer_progress[s] = 0;
    // Seed closed: subtree offsets at full travel (never paints at rest).
    ui_drawer_apply(s, 0);
  }
}

static void ui_drawer_apply(uint8_t slot, uint8_t progress) {
  if (slot >= __ui_drawer_slots || __ui_drawer_idx[slot] < 0) return;
  uint16_t di = static_cast<uint16_t>(__ui_drawer_idx[slot]);
  UINode* d = &__ui_nodes[di];
  int16_t travel = (d->drawerSide == 2 || d->drawerSide == 3)
    ? static_cast<int16_t>(d->box.w) : static_cast<int16_t>(d->box.h);
  if (d->drawerSide == 4) travel = 0;  // <dialog>: centered, no slide
  else {
    // Edge panels must slide FULLY off the display, not just their own
    // height: a bottom panel anchored at the viewport bottom (bottom:0) is
    // already AT the edge, so travel == box.h parks its top row exactly at
    // the fold — a sliver stayed visible after close. The seeded closed
    // state never showed that sliver before the first open (the initial
    // paint's scroll-clip dropped it), and a closed panel can't be tapped
    // open, so the post-close "peek" read as a rendering artifact, not an
    // affordance — it is gone for drawers and toasts alike. Rest position =
    // box minus ancestor scroll (transformOffset still holds the previous
    // apply's slide at this point, so it cannot be used here).
    int16_t restX = static_cast<int16_t>(d->box.x);
    int16_t restY = static_cast<int16_t>(d->box.y);
    uint16_t pa = d->parent;
    while (pa != UI_NO_PARENT && pa < __ui_node_count) {
      if (__ui_nodes[pa].scrollable) restY = static_cast<int16_t>(restY - __ui_nodes[pa].scrollY);
      pa = __ui_nodes[pa].parent;
    }
    int16_t dl = 0, dt = 0, dr = 0, db = 0;
    ui_display_target_bounds(&dl, &dt, &dr, &db);
    int16_t need = d->drawerSide == 0 ? static_cast<int16_t>(db - restY)
      : d->drawerSide == 1 ? static_cast<int16_t>(restY + d->box.h - dt)
      : d->drawerSide == 2 ? static_cast<int16_t>(restX + d->box.w - dl)
      : static_cast<int16_t>(dr - restX);
    if (need > travel) travel = need;
  }
  int16_t off = static_cast<int16_t>((static_cast<int32_t>(travel) * (255 - progress)) / 255);
  int16_t dx = d->drawerSide == 2 ? -off : d->drawerSide == 3 ? off : 0;
  int16_t dy = d->drawerSide == 1 ? -off : d->drawerSide == 0 ? off : 0;
  d->transformOffsetX = dx;
  d->transformOffsetY = dy;
  for (uint16_t i = di + 1; i < d->subtreeEnd; i++) {
    // Descendants don't inherit transform offsets: their own box coords are
    // layout-local, so shift their draw origin via transform offsets too.
    __ui_nodes[i].transformOffsetX += dx - (__ui_drawer_last_dx[slot]);
    __ui_nodes[i].transformOffsetY += dy - (__ui_drawer_last_dy[slot]);
  }
  __ui_drawer_last_dx[slot] = dx;
  __ui_drawer_last_dy[slot] = dy;
  __ui_drawer_progress[slot] = progress;
}

static void ui_drawer_open(uint16_t nodeIdx) {
  int8_t s = __ui_drawer_slot_of(nodeIdx);
  if (s < 0) return;
  __ui_drawer_open[s] = 1;
  __ui_toast_elapsed[s] = 0;  // <toast>: restart the auto-close window
}

static void ui_drawer_close(uint16_t nodeIdx) {
  int8_t s = __ui_drawer_slot_of(nodeIdx);
  if (s < 0) return;
  __ui_drawer_open[s] = 0;
}

static void ui_drawer_close_all() {
  for (uint8_t s = 0; s < __ui_drawer_slots; s++) __ui_drawer_open[s] = 0;
}

static void ui_drawer_tick(uint32_t deltaMs) {
  uint8_t step = static_cast<uint8_t>((deltaMs * 255UL) / 180UL);
  if (step == 0) step = 1;
  for (uint8_t s = 0; s < __ui_drawer_slots; s++) {
    if (__ui_drawer_idx[s] < 0) continue;
    uint16_t tnode = static_cast<uint16_t>(__ui_drawer_idx[s]);
    // <toast duration>: once fully open, count up and auto-close. A reopen
    // (ui_drawer_open) restarts the window; manual close just wins.
    if (__ui_nodes[tnode].toastDuration > 0 && __ui_drawer_open[s] &&
        __ui_drawer_progress[s] == 255) {
      __ui_toast_elapsed[s] += deltaMs;
      if (__ui_toast_elapsed[s] >= __ui_nodes[tnode].toastDuration) {
        __ui_drawer_open[s] = 0;
      }
    }
    uint8_t target = __ui_drawer_open[s] ? 255 : 0;
    uint8_t p = __ui_drawer_progress[s];
    if (p == target) continue;
    // Compose each slide frame as the UNION of the drawer's old and new
    // SUBTREE paint rects in tear-free bands (ui_render_screen_bands). The
    // previous contract — mark the whole active screen dirty per slide step —
    // repainted the entire screen with direct per-node clears on no-fb
    // targets: visible flashing, and only ~3 steps fit inside the 180ms
    // slide. The banded union is a fraction of the SPI traffic and never
    // exposes an intermediate state. Falls back to the whole-screen dirty
    // repaint when the band canvas can't allocate or a retained framebuffer
    // composes the frame in RAM (its dirty-union push is already tear-free).
    //
    // SUBTREE extent, not the root's paint rect: a <dialog> root whose
    // children are absolutely positioned lays out at h=0 — the root-rect
    // union degenerated to an empty band (a no-op "composed" success), so
    // NOTHING repainted on open or close on hardware. The preview already
    // used its currentSubtreePaintRect here. Side-4 dialogs also snap
    // instead of animating: travel is 0, so intermediate progress values
    // are 180ms of identical frames — the snap composes ONE band frame for
    // the open state and ONE for the erase, so modal toggles are tear-free
    // on no-fb SPI targets too (mark-all's per-node clears flashed the
    // whole screen).
    uint16_t di = static_cast<uint16_t>(__ui_drawer_idx[s]);
    uint8_t next = target > p ? (p + step > target ? target : p + step)
                              : (p < step || p - step < target ? target : p - step);
    if (__ui_nodes[di].drawerSide == 4) next = target;
    UIRect oldRect;
    uint8_t hasOld = ui_subtree_current_paint_rect(di, &oldRect);
    ui_drawer_apply(s, next);
    UIRect newRect;
    uint8_t hasNew = ui_subtree_current_paint_rect(di, &newRect);
    // A failed rect query leaves x/y UNWRITTEN — unioning it against the
    // good side mixed stack garbage into the band region (huge regions clipped
    // to full-screen, or empty ones that "composed" nothing). When one side
    // has no on-screen extent (a dialog snapping open from fully-closed, or
    // erasing to fully-closed), the union is just the side that exists.
    if (!hasOld && !hasNew) continue;
    if (!hasOld) oldRect = newRect;
    if (!hasNew) newRect = oldRect;
    uint8_t composed = 0;
    if (!ui_get_framebuffer()) {
      int16_t ux0 = oldRect.x < newRect.x ? oldRect.x : newRect.x;
      int16_t uy0 = oldRect.y < newRect.y ? oldRect.y : newRect.y;
      int16_t ux1 = oldRect.x + oldRect.w > newRect.x + newRect.w ? static_cast<int16_t>(oldRect.x + oldRect.w) : static_cast<int16_t>(newRect.x + newRect.w);
      int16_t uy1 = oldRect.y + oldRect.h > newRect.y + newRect.h ? static_cast<int16_t>(oldRect.y + oldRect.h) : static_cast<int16_t>(newRect.y + newRect.h);
      composed = ui_render_screen_bands(ux0, uy0, static_cast<int16_t>(ux1 - ux0), static_cast<int16_t>(uy1 - uy0));
      if (composed) {
        // The drawer crossed a scroll viewport that caches its pixels; the
        // canvas holds pre-slide content where the drawer now sits. Invalidate
        // it so the next scroll recomposites instead of shifting stale pixels.
        ui_invalidate_scroll_canvas_for_node(di);
        // The composed bands are the AUTHORITATIVE frame for this region —
        // every node fully inside it is already painted in correct stacking
        // order. Clear those dirty flags or the dirty pass repaints them
        // through the per-node ladder: a viewport-sized overlay (the dialog
        // scrim) is too big for the repair canvas and falls to the DIRECT
        // ladder — one flat full-screen fill that erased the just-composed
        // frame, then the card/title/buttons re-popped band by band. That
        // erase + re-layer sequence was the modal-toggle flash on hardware.
        // Bindings run after the drawer tick, so any dirty flag they raise
        // this frame still repaints normally.
        for (uint16_t q = 0; q < __ui_node_count; q++) {
          if (__ui_nodes[q].screenId != __ui_active_screen) continue;
          if (!__ui_nodes[q].dirty) continue;
          UIRect pr;
          ui_node_current_paint_rect(q, &pr);
          if (pr.w <= 0 || pr.h <= 0) continue;
          if (pr.x >= ux0 && pr.y >= uy0 &&
              static_cast<int16_t>(pr.x + pr.w) <= static_cast<int16_t>(ux1) &&
              static_cast<int16_t>(pr.y + pr.h) <= static_cast<int16_t>(uy1)) {
            __ui_nodes[q].dirty = 0;
          }
        }
      }
    }
    if (!composed) {
      for (uint16_t i = 0; i < __ui_node_count; i++) {
        if (__ui_nodes[i].screenId != __ui_active_screen) continue;
        __ui_nodes[i].dirty = 1;
        __ui_nodes[i].lastTextHeight = 0;
      }
    }
  }
}
`;
}

// ── Modal <select> option list ────────────────────────────────────────────
// Device twin of the preview's select modal: tapping a select opens a
// centered list of its options (capped to ~60% of the panel height); tapping
// a row sets the value and closes; tapping outside dismisses. The overlay is
// stamped after the dirty pass every frame while open; closing marks the
// whole tree dirty for the erase repaint.
