// Slice of the C++ runtime header (original source lines 90-303).
// Enums (UINodeKind, UIProperty) and all struct definitions + extern table decls.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitStructs(): string {
  return `
enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT, NODE_IMG, NODE_LIST, NODE_CANVAS, NODE_SELECT };
enum UIProperty { PROP_BG, PROP_FG, PROP_TEXT, PROP_VISIBLE, PROP_BORDER_COLOR, PROP_VALUE };

struct UIRect { int16_t x, y, w, h; };
struct UIFontGlyph {
  uint16_t codepoint;
  int8_t xOffset;
  int8_t yOffset;
  uint8_t width;
  uint8_t height;
  uint8_t advance;
  uint16_t dataOffset; // 4-bit alpha pixel offset
};
struct UIFontFace {
  uint8_t id;
  uint8_t glyphCount;
  uint8_t lineHeight;
  uint8_t baseline;
  const UIFontGlyph* glyphs;
  const uint8_t* alpha;
};
struct UINode {
  UIRect box;
  uint32_t bg;
  uint32_t fg;
  UINodeKind kind;
  const char* text;
  char textBuffer[UI_TEXT_BUF + 1]; // dynamic text — read only when hasTextBinding == 1
  uint8_t hasTextBinding;       // set by ui_init when a PROP_TEXT binding targets this node
  const uint8_t* font;
  uint8_t hasBg;
  uint8_t textAlign;    // 0=left, 1=center, 2=right
  uint8_t textSize;     // GFX text size: 1-4
  uint8_t lineHeight;   // px per text line (0 = font default)
  int8_t letterSpacing; // px between chars (0 = default advance)
  uint8_t fontAntialias; // 1 = smooth text edges when UI_AA is available
  uint8_t fontFace;     // 0 = classic GFX bitmap font; otherwise UIFontFace id
  uint32_t borderColor; // resolved color for the border (0 = use fg)
  uint8_t borderStyle;  // 0=none, 1=solid, 2=dashed
  uint8_t borderWidth;  // px, 0=none (uniform fallback)
  uint8_t borderTopWidth;    // per-side; equals borderWidth when uniform
  uint8_t borderRightWidth;
  uint8_t borderBottomWidth;
  uint8_t borderLeftWidth;
  uint8_t hasPerSideBorder;  // 1 when any per-side width differs from borderWidth
  uint8_t borderRadius; // px, 0=square
  uint8_t paddingTop;
  uint8_t paddingRight;
  uint8_t paddingBottom;
  uint8_t paddingLeft;
  uint8_t gradientEnabled; // 0=none, 1=vertical, 2=horizontal
  uint32_t gradientColor1;
  uint32_t gradientColor2;
  uint32_t outlineColor;
  uint8_t outlineStyle; // 0=none, 1=solid, 2=dashed
  uint8_t outlineWidth;
  int16_t zIndex;      // effective draw layer; higher layers draw later
  int16_t transformOffsetX; // draw-only transform: translate(...)
  int16_t transformOffsetY;
  int16_t rotateDeg;
  int8_t pressedOffsetX; // draw-only :pressed offset, no Yoga relayout
  int8_t pressedOffsetY;
  uint8_t shadowCount;  // 0-4 active shadows
  int8_t shadowOffsetX[4];
  int8_t shadowOffsetY[4];
  uint8_t shadowBlur[4];
  uint32_t shadowColor[4];
  uint8_t shadowAlpha[4];
  uint8_t shadowInset[4]; // 0=outset, 1=inset
  uint8_t textShadowCount;
  int8_t textShadowOffsetX;
  int8_t textShadowOffsetY;
  uint8_t textShadowBlur;
  uint32_t textShadowColor;
  uint8_t textShadowAlpha;
  uint8_t underline;    // text-decoration: 0=none,1=underline,2=line-through,3=both
  uint8_t textOverflow; // text-overflow: 0=clip, 1=ellipsis (truncate + ...)
  uint8_t nowrap;       // 1 = no text wrapping (white-space: nowrap/pre)
  uint8_t whiteSpaceMode; // 0=normal, 1=nowrap, 2=pre, 3=pre-line
  uint8_t visible;      // 0=hidden, 1=visible
  uint8_t opacity;      // 0-100
  uint32_t clearColor;  // ancestor's background — used to wipe transparent text before redraw
  int16_t lastTextWidth;
  int16_t lastTextHeight;
  uint32_t layoutCacheKey;  // 0 = invalid; non-zero hashes layout inputs
  uint16_t layoutMetricsW;  // cached ui_text_layout_metrics width
  uint16_t layoutMetricsH;  // cached ui_text_layout_metrics height
  // scroll (unified: containers and virtualized lists share these)
  uint8_t scrollable;   // 1 = children offset by scrollY, clipped to this box
  uint8_t virtualized;  // 1 = children produced by list*Fn callbacks (<list>)
  int16_t scrollY;      // committed offset (always in [0, maxScroll]); draw subtracts it
  int16_t contentHeight; // total child height (clamp bound + scrollbar ratio)
  int16_t overscrollPx; // elastic excursion past a boundary (0 in-bounds; +top, -bottom)
  uint8_t settling;     // 1 while a bounce-back/snap animation runs
  int16_t lastPaintedScrollY;  // scrollY at last container repaint (Mode B shift delta)
  uint16_t listCount;   // virtualized: current item count (refreshed each frame)
  uint16_t (*listCountFn)(void);
  void (*listItemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*listTapFn)(uint16_t idx);  // nullptr if no tap handler
  uint16_t parent;      // 0xFFFF = root/no parent (UI_NO_PARENT)
  uint16_t subtreeEnd;  // exclusive pre-order end index
  uint8_t screenId;     // which <screen> this node belongs to (for navigation)
  uint8_t imgDataId;    // index into __ui_images[] (255 = no image)
  uint8_t objectFit;    // 0=none, 1=fill, 2=contain, 3=cover, 4=scale-down
  uint16_t listItemHeight; // px per item for <list> (0 = not a list)
  int16_t rangeMin;     // for <range>: minimum value
  int16_t rangeMax;     // for <range>: maximum value
  int16_t maxlen;       // for <input>: max character length (0 = UI_TEXT_BUF)
  uint16_t canvasW;        // canvas buffer width  (for <canvas>)
  uint16_t canvasH;        // canvas buffer height (for <canvas>)
  // Rich-text runs (runCount > 0 for text nodes with mixed inline content).
  // The node references a contiguous slice of the global run / segment / line
  // arrays; geometry is precomputed at transpile time (runs are static-only).
  uint8_t runCount;       // number of runs in this node (0 = plain single-string text)
  uint8_t richLineCount;  // number of wrapped lines
  uint16_t runStart;      // first index into __ui_runs[]
  uint16_t richSegStart;  // first index into __ui_rich_segs[]
  uint16_t richSegCount;  // total segments across all lines
  uint16_t richLineStart; // first index into __ui_rich_lines[]
  // runtime slot
  uint8_t dirty;
  int16_t value;  // unified element
  uint8_t disabled;  // HTML disabled attr: no taps/keyboard, dimmed draw state
  uint8_t optionCount;  // <select>: number of options
  void (*optionTextFn)(uint8_t idx, char* buf, uint8_t size);  // option text by index
  int8_t drawerSide;  // <drawer>/<toast>: 0=bottom 1=top 2=left 3=right; 4=<dialog> center; -1 = none
  uint16_t toastDuration;  // <toast duration>: ms before auto-close (0 = manual)
  uint32_t checkedBg;    // :checked background (RGB565) — switch track / checkbox face / radio dot / select selected row
  uint32_t checkedFg;    // :checked color (RGB565) — knob / checkmark / selected-row text
  uint8_t hasCheckedBg;  // 1 when checkedBg was authored (0 = swap not wired)
  uint8_t hasCheckedFg;  // 1 when checkedFg was authored
  int8_t flowAxis;  // visibility reflow: 0 none, 1 column, 2 row (ui_reflow_visibility)
  uint8_t flowGap;  // visibility reflow: main-axis gap between in-flow children
  uint8_t flowFlags;  // bit0 auto height, bit1 auto width, bit2 out-of-flow
};
// Rich-text run: one piece of styled inline text within a node's run list.
struct UIRichRun {
  const char* text;
  uint32_t fg;
  uint8_t textSize;
  uint8_t fontFace;
  uint8_t underline;     // 0=none,1=underline,2=line-through,3=both
  int8_t letterSpacing;
  int8_t linkTarget;     // resolved screen index, -1 = not a link
};
// One laid-out segment of a run on one line (precomputed geometry).
struct UIRichSeg {
  uint8_t runIndex;      // index into the node's runs (0..runCount-1)
  const char* text;
  int16_t x;             // offset from the line's left edge (pre-alignment)
  uint16_t w;            // measured width
  uint8_t line;          // which line (0..richLineCount-1) this segment is on
};
// One wrapped line of rich text (precomputed).
struct UIRichLine {
  int16_t y;             // top y relative to the node's text top
  uint16_t h;            // line height (tallest run on this line)
  int16_t baseline;      // baseline y (for mixed-size baseline alignment)
  uint16_t w;            // total line width (for alignment)
};
struct UITransition {
  uint16_t node;
  UIProperty prop;
  uint16_t durationMs;
  // The :pressed and base-state target colors. ui_on_press arms toward
  // pressedTarget; ui_on_release arms toward baseTarget.
  uint32_t pressedTarget;
  uint32_t baseTarget;
  // runtime
  uint32_t elapsed;
  uint32_t prevValue;
  uint32_t targetValue;
  uint8_t  active;
};
struct UIBinding {
  uint16_t node;
  UIProperty prop;
  uint32_t (*fn)(void);       // for color/numeric bindings
  void (*textFn)(char* buf, uint8_t size); // for text bindings (PROP_TEXT): fills buf
  uint32_t lastValue;         // numeric binding cache; avoids redundant dirty work
  uint8_t initialized;        // first evaluation establishes the baseline
};

// Color lerp for transitions (rgb565). For mono, this collapses to a snap.
static inline uint16_t lerp_color(uint16_t a, uint16_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  // Lerp in 888 internally for smoother color transitions (keyframe animation,
  // :pressed transitions). Unpack 565→888, lerp at 8-bit, re-quantize to 565.
  uint8_t ar5 = (a >> 11) & 0x1f, ag6 = (a >> 5) & 0x3f, ab5 = a & 0x1f;
  uint8_t br5 = (b >> 11) & 0x1f, bg6 = (b >> 5) & 0x3f, bb5 = b & 0x1f;
  uint16_t ar8 = (ar5 << 3) | (ar5 >> 2), ag8 = (ag6 << 2) | (ag6 >> 4), ab8 = (ab5 << 3) | (ab5 >> 2);
  uint16_t br8 = (br5 << 3) | (br5 >> 2), bg8 = (bg6 << 2) | (bg6 >> 4), bb8 = (bb5 << 3) | (bb5 >> 2);
  int16_t r = static_cast<int16_t>(ar8 + static_cast<int16_t>((br8 - ar8) * k100 / 100));
  int16_t g = static_cast<int16_t>(ag8 + static_cast<int16_t>((bg8 - ag8) * k100 / 100));
  int16_t bl = static_cast<int16_t>(ab8 + static_cast<int16_t>((bb8 - ab8) * k100 / 100));
  return (static_cast<uint16_t>((r >> 3) & 0x1f) << 11) | (static_cast<uint16_t>((g >> 2) & 0x3f) << 5) | static_cast<uint16_t>((bl >> 3) & 0x1f);
}

// RGB888 lerp — for transitions on RGB888/RGB666 targets (Phase 2+). Unused in
// Phase 1; the 565 lerp_color above remains the active path for TFT targets,
// whose node colors are still emitted as 565 values stored in uint32_t fields.
static inline uint32_t lerp_color_888(uint32_t a, uint32_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  uint8_t ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  uint8_t br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  int16_t r = ar + static_cast<int16_t>((static_cast<int16_t>(br) - static_cast<int16_t>(ar)) * k100 / 100);
  int16_t g = ag + static_cast<int16_t>((static_cast<int16_t>(bg) - static_cast<int16_t>(ag)) * k100 / 100);
  int16_t bl = ab + static_cast<int16_t>((static_cast<int16_t>(bb) - static_cast<int16_t>(ab)) * k100 / 100);
  return (static_cast<uint32_t>(r & 0xff) << 16) | (static_cast<uint32_t>(g & 0xff) << 8) | static_cast<uint32_t>(bl & 0xff);
}

// Declared by the lowering output (the tables). Matches the mutable (non-const)
// definitions: ui_tick updates node bg/dirty and transition elapsed/active.
extern UINode __ui_nodes[];
extern UITransition __ui_trans[];
extern UIBinding __ui_bindings[];
extern const UIFontFace __ui_font_faces[];
// Rich-text run / segment / line tables (parallel arrays; nodes reference
// contiguous slices via runStart/richSegStart/richLineStart + counts).
extern UIRichRun __ui_runs[];
extern UIRichSeg __ui_rich_segs[];
extern UIRichLine __ui_rich_lines[];
extern const uint16_t __ui_node_count;
extern const uint16_t __ui_trans_count;
extern const uint16_t __ui_binding_count;
extern const uint16_t __ui_run_count;
extern const uint16_t __ui_rich_seg_count;
extern const uint16_t __ui_rich_line_count;`;
}
