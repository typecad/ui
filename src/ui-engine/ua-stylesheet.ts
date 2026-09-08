// ---------------------------------------------------------------------------
// UA (User-Agent) default stylesheet.
// Applied before user CSS so elements have sensible built-in behavior without
// requiring explicit CSS. Author CSS overrides it (cascade: the UA layer loses
// to any author rule; see style-resolver.ts).
//
// The sheet is display-anchored, like a browser's per-device-class defaults:
// the root type size (what a browser fixes at 16px on desktop) scales with the
// target display — 16px on large color panels, ~14px on 320×240 TFTs, ~12px on
// tiny panels — and every UA size derives from that root, so heading ratios
// and touch-target minimums stay web-familiar at every pixel budget.
// Monochrome displays additionally snap sizes to the stock font's buckets
// (only ~4 distinct rendered sizes exist there).
// ---------------------------------------------------------------------------

import { parseCss } from "./css-parser.js";
import type { CSSRule } from "./css-parser.js";
import { getDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";
import { DEFAULT_FONT_FAMILY, DEFAULT_MONO_FAMILY, defaultFontApplies } from "./default-font.js";

/** The derived UA scale for one display profile. */
export interface UAScale {
  /** Root (body text) size in px — the display-anchored "16px". */
  root: number;
  /** Monochrome display: stock bitmap font, quantized text sizes. */
  mono: boolean;
  /** Heading sizes h1..h6 in px. */
  h: [number, number, number, number, number, number];
  /** Vertical margin for headings and paragraphs (browser-like spacing). */
  blockMargin: number;
  /** Minimum touch-target height for buttons/selects/checks/radios. */
  controlMinHeight: number;
  /** Button/select vertical + horizontal padding. */
  buttonPadV: number;
  buttonPadH: number;
}

/** Derive the UA type scale from the display class. Height is the portrait
 *  dimension the profile reports; an unbound profile gets the color/large
 *  default (root 16 — the classic browser default). */
export function uaScaleFor(height: number | undefined, mono: boolean): UAScale {
  if (mono) {
    // Stock font buckets: ≤12 → size 1, 13–20 → 2, 21–28 → 3. Snap UA sizes
    // to 12/20/28 so every declared size renders at a DISTINCT bucket.
    const tall = (height ?? 128) >= 96;
    return {
      root: 12,
      mono: true,
      h: tall ? [28, 20, 20, 12, 12, 12] : [20, 20, 12, 12, 12, 12],
      blockMargin: 6,
      controlMinHeight: 32,
      buttonPadV: 6,
      buttonPadH: 12,
    };
  }
  const root = height === undefined ? 16 : height >= 300 ? 16 : height >= 150 ? 14 : 12;
  const r = (m: number): number => Math.round(root * m);
  return {
    root,
    mono: false,
    h: [r(1.5), r(1.25), r(1.125), r(1), r(0.875), r(0.75)],
    blockMargin: r(0.5),
    controlMinHeight: Math.max(32, Math.min(48, r(3))),
    buttonPadV: r(0.625),
    buttonPadH: r(1),
  };
}

/** Read the active display profile (null when unbound — the default scale). */
function profileFor(): { height: number | undefined; mono: boolean; colorFormat: string | undefined } {
  try {
    const p = getDisplayProfile();
    return {
      height: p.height,
      mono: p.colorFormat === "mono",
      colorFormat: p.colorFormat,
    };
  } catch {
    return { height: undefined, mono: false, colorFormat: undefined };
  }
}

/** Build the UA stylesheet text for a scale. Sizes interpolate as concrete px
 *  so the CSS pipeline stays unit-simple. */
function uaCssFor(s: UAScale, useDefaultFont: boolean): string {
  const gap = Math.round(s.root * 0.625);
  const headerGap = Math.round(s.root * 0.5);
  return `
/* Browser-like light defaults: dark text on a near-white background.
   A dark theme overrides these via user CSS (e.g. screen { color: #f0f0f0;
   background: #1a1a1a }). Without these, screen fg defaults to white
   (0xFFFF at the model level), making text invisible on light backgrounds. */
screen {
  display: flex;
  flex-direction: column;
  color: #1a1a1a;
  background: #ffffff;${useDefaultFont ? `\n  /* Bundled default font: AA + continuous sizes out of the box. */\n  font-family: "${DEFAULT_FONT_FAMILY}";` : ""}
}
body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
view {
  display: flex;
  flex-direction: column;
}
/* Scrollable content area — the standard pattern for multi-screen apps.
   align-items:center + gap give readable card-style layouts out of the box.
   .ui-scroll-body / .ui-screen-header are the framework-prefixed spellings. */
.scrollBody, .ui-scroll-body {
  overflow: scroll;
  flex: 1;
  align-items: center;
  gap: ${gap}px;
}
/* Header bar (back link + title). flex-direction:row is the expected layout;
   without it the back link and title stack vertically. */
.screenHeader, .ui-screen-header {
  flex-direction: row;
  align-items: center;
  gap: ${headerGap}px;
}
button {
  padding: ${s.buttonPadV}px ${s.buttonPadH}px;
  border: 1px solid;
  min-height: ${s.controlMinHeight}px;
  text-align: center;
}
input {
  padding: ${Math.round(s.root * 0.5)}px;
  border: 1px solid;
}
select {
  padding: ${s.buttonPadV}px ${s.buttonPadH}px;
  border: 1px solid;
  min-height: ${s.controlMinHeight}px;
}
check, radio {
  min-height: ${s.controlMinHeight}px;
}
range {
  height: ${Math.round(s.root * 2.5)}px;
}
list {
  overflow: scroll;
  flex-grow: 1;
}
a {
  text-decoration: underline;
}
label {
  text-align: left;
}
/* Headings and paragraphs carry browser-like margins so a bare heading stack
   doesn't render glued together. Sizes derive from the display-anchored root
   (see uaScaleFor). */
h1 { font-size: ${s.h[0]}px; font-weight: bold; margin: ${s.blockMargin}px 0; }
h2 { font-size: ${s.h[1]}px; font-weight: bold; margin: ${s.blockMargin}px 0; }
h3 { font-size: ${s.h[2]}px; font-weight: bold; margin: ${s.blockMargin}px 0; }
h4 { font-size: ${s.h[3]}px; font-weight: bold; margin: ${s.blockMargin}px 0; }
h5 { font-size: ${s.h[4]}px; margin: ${s.blockMargin}px 0; }
h6 { font-size: ${s.h[5]}px; margin: ${s.blockMargin}px 0; }
p { font-size: ${s.root}px; margin: ${s.blockMargin}px 0; }
small { font-size: ${Math.round(s.root * 0.8)}px; }
hr { height: 1px; background: #808080; margin: ${s.blockMargin}px 0; }
/* Definition lists: bold term, indented description — the settings-screen
   idiom web authors reach for. */
dt { font-weight: bold; }
dd { margin-left: ${Math.round(s.root * 0.75)}px; }
/* Tables: the equal-width flex approximation — tr is a row, td/th are
   stretched cells (flex:1 basis 0), th bold + centered like browsers.
   No auto column sizing; set widths/flex-grow on cells for custom columns. */
table { gap: 1px; }
tr { flex-direction: row; align-items: stretch; gap: 1px; }
td { flex: 1; padding: ${Math.round(s.root * 0.3)}px; text-align: left; }
th { flex: 1; padding: ${Math.round(s.root * 0.3)}px; text-align: center; font-weight: bold; }
caption { text-align: center; margin: ${Math.round(s.root * 0.25)}px 0; }
/* Grouped form chrome. */
fieldset { border: 1px solid; padding: ${s.blockMargin}px; }
/* Preformatted text keeps its whitespace (engine white-space modes); the
   monospace family rides on the bundled DejaVu Sans Mono when available. */
pre { white-space: pre; }${useDefaultFont ? `\npre, code, kbd, samp { font-family: "${DEFAULT_MONO_FAMILY}"; }` : ""}
/* Keyboard structural defaults (the OSK is runtime-generated, not
   user-authored HTML). Border keeps keys visually separated. Colors
   are design choices left to user CSS. */
.ui-key {
  border: 1px solid;
}
`;
}

const cache = new Map<string, CSSRule[]>();

/** Get the parsed UA default rules for the active display profile. Lazily
 *  computed, cached per scale (profile changes pick up a new scale key). */
export function getUARules(): CSSRule[] {
  const profile = profileFor();
  const scale = uaScaleFor(profile.height, profile.mono);
  const useDefaultFont = defaultFontApplies(profile.colorFormat);
  const key = `${scale.root}|${scale.mono}|${useDefaultFont}|${scale.h.join(",")}`;
  let rules = cache.get(key);
  if (!rules) {
    rules = parseCss(uaCssFor(scale, useDefaultFont));
    cache.set(key, rules);
  }
  return rules;
}
