// ---------------------------------------------------------------------------
// Default bundled font — DejaVu Sans 2.37 (Bitstream Vera License).
//
// Every color display gets an implicit @font-face pair (regular + bold) so
// antialiased, continuously-sized text works out of the box: users don't have
// to source a TTF before their UI renders like the browser preview. Devices
// never receive the TTF itself — font-assets.ts rasterizes the exact
// (family, px, weight, style, characters) subsets a UI uses into glyph tables.
//
// Monochrome displays (1-bit OLEDs/e-ink) keep the engine's built-in bitmap
// font: alpha blending is disabled there, so rasterized AA glyphs add flash
// cost without a visual payoff.
//
// License: the unmodified TTFs live in packages/ui/assets/fonts/dejavu with
// the full text (LICENSE) and checksums (README.md). They must be redistributed
// with that license file and must not be renamed or modified (Bitstream Vera
// License reserved-name terms). Generated font tables carry an attribution
// comment (see ui-lowering.ts emitFontTables).
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { CSSFontFace } from "./css-parser.js";

/** The sans family the default faces register under. It matches the font's
 *  real name (unmodified file, original name — license-clean). */
export const DEFAULT_FONT_FAMILY = "DejaVu Sans";

/** The monospace family for <pre>/<code>/<kbd> UA styling. */
export const DEFAULT_MONO_FAMILY = "DejaVu Sans Mono";

const FONT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/fonts/dejavu",
);

/** Faces injected by default: sans + mono at the workhorse weights. */
const DEFAULT_FACES: Array<{ family: string; file: string; weight: string; style: string }> = [
  { family: DEFAULT_FONT_FAMILY, file: "DejaVuSans.ttf", weight: "400", style: "normal" },
  { family: DEFAULT_FONT_FAMILY, file: "DejaVuSans-Bold.ttf", weight: "700", style: "normal" },
  { family: DEFAULT_MONO_FAMILY, file: "DejaVuSansMono.ttf", weight: "400", style: "normal" },
  { family: DEFAULT_MONO_FAMILY, file: "DejaVuSansMono-Bold.ttf", weight: "700", style: "normal" },
];

/** Absolute source paths of the bundled faces. */
export function bundledFontPath(file: string): string {
  return path.join(FONT_DIR, file);
}

/** True when the bundled font assets are present and usable. */
export function defaultFontAvailable(): boolean {
  return DEFAULT_FACES.every((f) => fs.existsSync(bundledFontPath(f.file)));
}

/** True when the display profile should use the bundled font. Color displays
 *  only: monochrome targets keep the built-in bitmap font (no AA). An absent
 *  profile defaults to color — the common case and the current build target. */
export function defaultFontApplies(colorFormat: string | undefined): boolean {
  return colorFormat !== "mono" && defaultFontAvailable();
}

/** The implicit @font-face declarations for the bundled default fonts. */
export function defaultFontFaces(): CSSFontFace[] {
  return DEFAULT_FACES.map((f) => ({
    fontFamily: f.family,
    src: bundledFontPath(f.file),
    fontWeight: f.weight,
    fontStyle: f.style,
  }));
}

/** Merge the bundled default faces into a user's @font-face list. Checked
 *  per family: if the author registered any face for "DejaVu Sans" (or the
 *  mono family), theirs wins and that family's bundle faces are skipped.
 *  Injected faces append so user faces sort first in weight/style matching. */
export function injectDefaultFontFaces(userFaces: CSSFontFace[], colorFormat: string | undefined): CSSFontFace[] {
  if (!defaultFontApplies(colorFormat)) return userFaces;
  const declared = new Set(userFaces.map((f) => f.fontFamily.toLowerCase()));
  const bundled = defaultFontFaces().filter(
    (f) => !declared.has(f.fontFamily.toLowerCase()),
  );
  return bundled.length > 0 ? [...userFaces, ...bundled] : userFaces;
}

/** Attribution lines for generated font tables whose glyphs came from the
 *  bundled DejaVu faces (satisfies the license's binary-notice requirement
 *  and makes firmware images auditable). */
export function defaultFontAttribution(sourcePath: string): string | undefined {
  const resolved = path.resolve(sourcePath);
  if (path.dirname(resolved) !== FONT_DIR) return undefined;
  return `${path.basename(resolved)} - DejaVu fonts v2.37` +
    " - (c) 2003 Bitstream, Inc., (c) 2006 Tavmjong Bah." +
    " Bitstream Vera License - see @typecad/ui assets/fonts/dejavu/LICENSE.";
}
