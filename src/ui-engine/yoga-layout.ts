// ---------------------------------------------------------------------------
// YogaLayoutEngine — flexbox layout via Facebook's Yoga engine.
//
// Implements the LayoutEngine interface using yoga-layout (WASM, ~2MB).
// Handles display:flex, flex-direction, gap, align-self, padding (shorthand),
// border, and content-sized leaf nodes. Falls back gracefully when flex
// properties are absent.
//
// The critical contract: arrange() returns Box[] in pre-order DFS order
// matching the StyledNode tree, so lowerUIToCpp's flatten() can index
// boxes[] in lockstep with the styled nodes.
// ---------------------------------------------------------------------------

import { Box, IntrinsicSize, isDisplayNone, LayoutEngine, parseAspectRatio, cssDimValue, cssSizeValue, dimSet, expandBoxShorthand, CssDim } from "./layout-engine.js";
import { StyledNode } from "./style-resolver.js";
import { CSSProperty } from "./css-parser.js";
import Yoga from "yoga-layout";

/** Parse the first numeric value from a CSS string ("8px", "8px 16px" → 8). */
/** Parse a single CSS length to device pixels.
 *  rem/em × 16 (root font size), px/bare as-is, decimals supported.
 *  Percentages and "auto" fold to numbers here — use cssDimValue() for the
 *  properties (sizes, margins, paddings, insets) where they are meaningful. */
function cssLength(val: string): number {
  const v = val.trim();
  const remM = /^(-?[\d.]+)rem$/.exec(v);
  if (remM) return Math.round(parseFloat(remM[1]) * 16);
  const emM = /^(-?[\d.]+)em$/.exec(v);
  if (emM) return Math.round(parseFloat(emM[1]) * 16);
  const m = /^(-?[\d.]+)(?:px|%)?$/.exec(v);
  return m ? parseFloat(m[1]) : 0;
}

function cssNum(val: string | undefined): number {
  if (!val) return 0;
  return cssLength(val);
}

/** Parse border width from "2px solid #808080" → 2. */
function cssBorderWidth(val: string | undefined): number {
  if (!val) return 0;
  // border shorthand: "<width> <style> <color>" — width is the first token.
  const first = val.trim().split(/\s+/)[0];
  return cssLength(first);
}

/** Metadata stored per Yoga node, indexed by traversal position. */
interface NodeMeta {
  style: CSSProperty;
}

export class YogaLayoutEngine implements LayoutEngine {
  readonly id = "flex" as const;

  arrange(
    root: StyledNode,
    viewport: Box,
    measureFn: (node: StyledNode, availableWidth?: number) => IntrinsicSize,
  ): Box[] {
    const metaArray: NodeMeta[] = [];

    // Build the Yoga tree from the StyledNode tree.
    const yogaRoot = this.buildTree(root, metaArray, measureFn);

    yogaRoot.setWidth(viewport.w);
    yogaRoot.setHeight(viewport.h);
    yogaRoot.calculateLayout(viewport.w, viewport.h, Yoga.DIRECTION_LTR);

    // Extract boxes in pre-order DFS matching the StyledNode tree.
    const boxes: Box[] = [];
    let extractIdx = 0;
    this.extractBoxes(yogaRoot, boxes, () => metaArray[extractIdx++]);

    return boxes;
  }

  /** Recursively build a Yoga node tree from a StyledNode tree. */
  private buildTree(
    node: StyledNode,
    metaArray: NodeMeta[],
    measureFn: (node: StyledNode, availableWidth?: number) => IntrinsicSize,
    myIndex: number = metaArray.length,
  ): any {
    const yn = Yoga.Node.create();
    const idx = metaArray.length;
    metaArray.push({ style: node.style });

    const s = node.style;
    if (isDisplayNone(node)) {
      yn.setDisplay?.(Yoga.DISPLAY_NONE);
    }

    // Flex container
    // flex-direction: row | row-reverse | column | column-reverse.
    // Each value maps to a distinct Yoga enum (reverse was previously
    // dropped — any non-"row" value collapsed to column).
    const fd = s.display === "flex" ? s.flexDirection : "column";
    if (fd === "row") yn.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    else if (fd === "row-reverse") yn.setFlexDirection(Yoga.FLEX_DIRECTION_ROW_REVERSE);
    else if (fd === "column-reverse") yn.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN_REVERSE);
    else yn.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);

    // Padding: full 1-4 value shorthand (TRBL rotation) with % support.
    // "auto" is not valid padding — fold it to the default 0 via asSize.
    const asSize = (d: CssDim): number | `${number}%` => (d === "auto" ? 0 : d);
    const [padT, padR, padB, padL] = expandBoxShorthand(s.padding);
    if (dimSet(padT)) yn.setPadding(Yoga.EDGE_TOP, asSize(padT));
    if (dimSet(padR)) yn.setPadding(Yoga.EDGE_RIGHT, asSize(padR));
    if (dimSet(padB)) yn.setPadding(Yoga.EDGE_BOTTOM, asSize(padB));
    if (dimSet(padL)) yn.setPadding(Yoga.EDGE_LEFT, asSize(padL));
    // Scroll containers draw an overlay scrollbar at the right edge (4px
    // strip: box.x + box.w - 4). Reserve the strip plus a 4px breathing gap
    // as right padding so stretched children (align-items: stretch selects,
    // cards) never lay out or paint against/under the scrollbar — browser
    // behavior for classic scrollbars, which take layout space.
    if (s.overflow === "scroll") {
      const basePad = typeof padR === "number" ? padR : 0;
      yn.setPadding(Yoga.EDGE_RIGHT, basePad + 8);
    }

    // Margin: per-side longhands win over the `margin` shorthand when set.
    // Full 1-4 value shorthand expansion; percentages resolve against the
    // parent, and "auto" margins absorb free space (margin: 0 auto centers).
    const [mgT, mgR, mgB, mgL] = expandBoxShorthand(s.margin);
    const mTop: CssDim = s.marginTop !== undefined ? cssDimValue(s.marginTop) : mgT;
    const mBottom: CssDim = s.marginBottom !== undefined ? cssDimValue(s.marginBottom) : mgB;
    const mLeft: CssDim = s.marginLeft !== undefined ? cssDimValue(s.marginLeft) : mgL;
    const mRight: CssDim = s.marginRight !== undefined ? cssDimValue(s.marginRight) : mgR;
    if (dimSet(mTop)) yn.setMargin(Yoga.EDGE_TOP, mTop);
    if (dimSet(mBottom)) yn.setMargin(Yoga.EDGE_BOTTOM, mBottom);
    if (dimSet(mLeft)) yn.setMargin(Yoga.EDGE_LEFT, mLeft);
    if (dimSet(mRight)) yn.setMargin(Yoga.EDGE_RIGHT, mRight);

    // Gap: row-gap / column-gap are applied per-axis. Uniform `gap`
    // (both equal) uses GUTTER_ALL for efficiency; mismatched values
    // set GUTTER_ROW and GUTTER_COLUMN separately.
    const rowGap = cssNum(s.rowGap);
    const colGap = cssNum(s.columnGap);
    if (rowGap && colGap && rowGap === colGap) {
      yn.setGap(Yoga.GUTTER_ALL, rowGap);
    } else {
      if (rowGap) yn.setGap(Yoga.GUTTER_ROW, rowGap);
      if (colGap) yn.setGap(Yoga.GUTTER_COLUMN, colGap);
    }

    // Border
    const borderW = cssBorderWidth(s.border);
    if (borderW) {
      yn.setBorder(Yoga.EDGE_ALL, borderW);
    }

    // Align-self
    if (s.alignSelf === "flex-start") yn.setAlignSelf(Yoga.ALIGN_FLEX_START);
    else if (s.alignSelf === "center") yn.setAlignSelf(Yoga.ALIGN_CENTER);
    else if (s.alignSelf === "stretch") yn.setAlignSelf(Yoga.ALIGN_STRETCH);
    else if (s.alignSelf === "flex-end") yn.setAlignSelf(Yoga.ALIGN_FLEX_END);
    else if (s.alignSelf === "baseline") yn.setAlignSelf(Yoga.ALIGN_BASELINE);

    // Align-items / justify-content (container properties)
    if (s.alignItems) {
      if (s.alignItems === "flex-start") yn.setAlignItems(Yoga.ALIGN_FLEX_START);
      else if (s.alignItems === "center") yn.setAlignItems(Yoga.ALIGN_CENTER);
      else if (s.alignItems === "stretch") yn.setAlignItems(Yoga.ALIGN_STRETCH);
      else if (s.alignItems === "flex-end") yn.setAlignItems(Yoga.ALIGN_FLEX_END);
    }
    // Align-content (multi-line flex-wrap cross-axis alignment)
    if (s.alignContent) {
      if (s.alignContent === "flex-start") yn.setAlignContent(Yoga.ALIGN_FLEX_START);
      else if (s.alignContent === "center") yn.setAlignContent(Yoga.ALIGN_CENTER);
      else if (s.alignContent === "flex-end") yn.setAlignContent(Yoga.ALIGN_FLEX_END);
      else if (s.alignContent === "stretch") yn.setAlignContent(Yoga.ALIGN_STRETCH);
      else if (s.alignContent === "space-between") yn.setAlignContent(Yoga.ALIGN_SPACE_BETWEEN);
      else if (s.alignContent === "space-around") yn.setAlignContent(Yoga.ALIGN_SPACE_AROUND);
      else if (s.alignContent === "space-evenly") yn.setAlignContent(Yoga.ALIGN_SPACE_EVENLY);
    }
    if (s.justifyContent) {
      if (s.justifyContent === "flex-start") yn.setJustifyContent(Yoga.JUSTIFY_FLEX_START);
      else if (s.justifyContent === "center") yn.setJustifyContent(Yoga.JUSTIFY_CENTER);
      else if (s.justifyContent === "flex-end") yn.setJustifyContent(Yoga.JUSTIFY_FLEX_END);
      else if (s.justifyContent === "space-between") yn.setJustifyContent(Yoga.JUSTIFY_SPACE_BETWEEN);
      else if (s.justifyContent === "space-around") yn.setJustifyContent(Yoga.JUSTIFY_SPACE_AROUND);
      else if (s.justifyContent === "space-evenly") yn.setJustifyContent(Yoga.JUSTIFY_SPACE_EVENLY);
    }

    // Flex wrap
    if (s.flexWrap === "wrap") yn.setFlexWrap(Yoga.WRAP_WRAP);
    else if (s.flexWrap === "wrap-reverse") yn.setFlexWrap(Yoga.WRAP_WRAP_REVERSE);
    else if (s.flexWrap === "nowrap") yn.setFlexWrap(Yoga.WRAP_NO_WRAP);

    // Flex grow/shrink/basis
    if (s.flexGrow) yn.setFlexGrow(cssNum(s.flexGrow));
    if (s.flexShrink) yn.setFlexShrink(cssNum(s.flexShrink));
    if (s.flexBasis) {
      if (s.flexBasis === "auto") yn.setFlexBasisAuto();
      else yn.setFlexBasis(cssSizeValue(s.flexBasis));
    }

    // Order (Yoga may not expose setOrder in its types, but the runtime has it)
    if (s.order) (yn as any).setOrder?.(cssNum(s.order));

    // Min/max dimensions (px or % of the parent)
    if (s.minWidth) yn.setMinWidth(cssSizeValue(s.minWidth));
    if (s.maxWidth) yn.setMaxWidth(cssSizeValue(s.maxWidth));
    if (s.minHeight) yn.setMinHeight(cssSizeValue(s.minHeight));
    if (s.maxHeight) yn.setMaxHeight(cssSizeValue(s.maxHeight));

    // Box sizing
    if (s.boxSizing === "border-box") yn.setBoxSizing?.(Yoga.BOX_SIZING_BORDER_BOX);

    // Overflow
    if (s.overflow === "hidden") yn.setOverflow?.(Yoga.OVERFLOW_HIDDEN);
    else if (s.overflow === "scroll") yn.setOverflow?.(Yoga.OVERFLOW_SCROLL);

    // Position
    if (s.position === "relative") yn.setPositionType(Yoga.POSITION_TYPE_RELATIVE);
    else if (s.position === "absolute") yn.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    else yn.setPositionType(Yoga.POSITION_TYPE_STATIC);
    if (s.top !== undefined) yn.setPosition(Yoga.EDGE_TOP, cssSizeValue(s.top));
    if (s.right !== undefined) yn.setPosition(Yoga.EDGE_RIGHT, cssSizeValue(s.right));
    if (s.bottom !== undefined) yn.setPosition(Yoga.EDGE_BOTTOM, cssSizeValue(s.bottom));
    if (s.left !== undefined) yn.setPosition(Yoga.EDGE_LEFT, cssSizeValue(s.left));

    // Width/height (explicit; px or % of the parent)
    if (s.width) yn.setWidth(cssSizeValue(s.width));
    if (s.height) yn.setHeight(cssSizeValue(s.height));
    const aspectRatio = parseAspectRatio(s.aspectRatio);
    if (aspectRatio !== undefined) yn.setAspectRatio(aspectRatio);

    // Children. The yoga binding in use has no setOrder API, so CSS `order`
    // can't be applied via yoga — sort children by their order value first
    // (stable sort: source order preserved for equal order) so the flex engine
    // lays items out in their order sequence.
    const orderedChildren = [...node.children].sort((a, b) => {
      const ao = cssNum(a.style.order);
      const bo = cssNum(b.style.order);
      return ao - bo;
    });
    // Build yoga nodes in the sorted (visual) order so yoga positions them by
    // order, but record the SOURCE index of each so extractBoxes can emit boxes
    // in source-tree order (the contract lowerUIToModel relies on).
    for (let si = 0; si < orderedChildren.length; si++) {
      const child = orderedChildren[si];
      const sourceIndex = node.children.indexOf(child);
      const childNode = this.buildTree(child, metaArray, measureFn);
      // Tag the yoga node with its source index so extraction can reorder.
      (childNode as any).__sourceIndex = sourceIndex;
      yn.insertChild(childNode, yn.getChildCount());
    }

    // Leaf nodes with text: let Yoga pass available width into measurement so
    // wrapped text can expand height under constraints.
    if (node.children.length === 0) {
      // select is text-like too: its label is the current option, and the
      // generic else-branch sizes the width without the UA control padding —
      // a wider option ("Gamma" vs "Alpha" in a proportional font) then
      // overflows the box and wraps mid-word.
      const textLike = node.tag === "text" || node.tag === "button" || node.tag === "check" || node.tag === "radio" || node.tag === "select";
      if (textLike) {
        yn.setMeasureFunc((width: number, widthMode: number) => {
          const hasWidth = widthMode !== Yoga.MEASURE_MODE_UNDEFINED && Number.isFinite(width) && width > 0;
          const intrinsic = measureFn(node, hasWidth ? width : undefined);
          return {
            width: Math.ceil(intrinsic.w),
            height: Math.ceil(intrinsic.h),
          };
        });
      } else {
        const intrinsic = measureFn(node);
        const [padTop, , , padLeft] = expandBoxShorthand(s.padding);
        const childPadV = typeof padTop === "number" ? padTop : 0;
        const childPadH = typeof padLeft === "number" ? padLeft : 0;
        const childBorder = cssBorderWidth(s.border);
        if (!s.width && intrinsic.w > 0) {
          yn.setWidth(Math.ceil(intrinsic.w + childPadH * 2 + childBorder * 2));
        }
        if (!s.height && intrinsic.h > 0) {
          yn.setHeight(intrinsic.h + childPadV * 2 + childBorder * 2);
        }
      }
    }

    return yn;
  }

  /** Walk the Yoga tree in pre-order DFS, extracting absolute {x,y,w,h} per node.
   * Yoga returns positions relative to the parent — we accumulate parentX/Y
   * to produce absolute coordinates. Must match the StyledNode tree's DFS. */
  private extractBoxes(
    node: any,
    out: Box[],
    nextMeta: () => NodeMeta | undefined,
    parentX: number = 0,
    parentY: number = 0,
  ): void {
    const x = parentX + Math.round(node.getComputedLeft());
    const y = parentY + Math.round(node.getComputedTop());
    const w = Math.round(node.getComputedWidth());
    const h = Math.round(node.getComputedHeight());
    out.push({ x, y, w, h });

    nextMeta();

    for (let i = 0; i < node.getChildCount(); i++) {
      this.extractBoxes(node.getChild(i), out, nextMeta, x, y);
    }
  }
}
