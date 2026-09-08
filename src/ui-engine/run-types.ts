import { CSSProperty } from "./css-parser.js";

/** A resolver-side rich-text run: one piece of styled inline text within a
 *  text node's `runs[]`. The run's `style` holds the inherited-or-overridden
 *  keys; the parent text node's resolved style is the base, the inline
 *  element's own matched rules and the styling-tag defaults layer on top. */
export interface TextRun {
  text: string;
  style: Partial<CSSProperty>;
  /** Resolved screen target if this run came from an <a href="#screenId">. */
  href?: string;
  /** <br> sentinel: forces a hard line break (no text rendered). */
  hardBreak?: boolean;
}
