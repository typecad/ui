// ---------------------------------------------------------------------------
// Built-in default keyboard templates — emitted by the transpiler when an
// <input> has no explicit <keyboard> ref. Both are KeyboardTemplate constants
// (same shape as author-written <keyboard> blocks) so the lowering path is
// uniform: a loader function is generated for each.
//
// Every key carries well-known CSS classes (ui-key, ui-key-ok, etc.) so authors
// can theme the defaults without writing a custom <keyboard>. The lowering
// resolves these via CSS and falls back to hardcoded defaults when no CSS
// matches.
// ---------------------------------------------------------------------------

import type { KeyboardTemplate, UIKeyTemplate } from "./html-parser.js";

const k = (ch: string): UIKeyTemplate => ({ ch, special: 0, classes: ["ui-key"] });
const sk = (ch: string, special: 1 | 2 | 3 | 4, kind: string): UIKeyTemplate => ({
  ch,
  special,
  classes: ["ui-key", `ui-key-${kind}`],
});

// Alpha: 10×4 grid (bottom dock). Row 2 has shift + backspace; row 3 has
// 123 (page-swap to symbols), space (_), and OK.
export const DEFAULT_ALPHA_KEYBOARD: KeyboardTemplate = {
  id: "default_alpha",
  variant: "alpha",
  classes: ["ui-keyboard"],
  rows: [
    [k("1"), k("2"), k("3"), k("4"), k("5"), k("6"), k("7"), k("8"), k("9"), k("0")],
    [k("q"), k("w"), k("e"), k("r"), k("t"), k("y"), k("u"), k("i"), k("o"), k("p")],
    [
      sk("⇧", 1, "shift"),
      k("a"), k("s"), k("d"), k("f"), k("g"), k("h"), k("j"), k("k"), k("l"),
      sk("⌫", 2, "del"),
    ],
    [
      sk("123", 4, "page"),
      k("z"), k("x"), k("c"), k("v"), k("b"), k("n"), k("m"),
      k("_"),
      sk("OK", 3, "ok"),
    ],
  ],
};

// Number: 4×4 grid (kept uniform with the alpha column count so the hit-mapping
// math stays simple). Covers digits, ".", "-", ABC (page-swap to alpha),
// backspace, and OK.
export const DEFAULT_NUMBER_KEYBOARD: KeyboardTemplate = {
  id: "default_number",
  variant: "number",
  classes: ["ui-keyboard"],
  rows: [
    [k("1"), k("2"), k("3"), sk("⌫", 2, "del")],
    [k("4"), k("5"), k("6"), k(".")],
    [k("7"), k("8"), k("9"), k("-")],
    [sk("ABC", 4, "page"), k("0"), sk("OK", 3, "ok")],
  ],
};
