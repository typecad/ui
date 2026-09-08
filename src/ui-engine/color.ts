// ---------------------------------------------------------------------------
// Color resolution — CSS color formats → target color format (RGB565 / mono)
//
// Supports: #rrggbb, #rgb, #rrggbbaa, rgb(r,g,b), rgba(r,g,b,a),
//           named colors (red, white, transparent, ...), transparent
//
// Resolved ONCE at transpile time against the framework's colorFormat(), so the
// device never performs color conversion. Alpha is ignored (no blending on
// bare metal) — rgba/transparent resolve to the RGB value as-is.
// ---------------------------------------------------------------------------

export interface RGB { r: number; g: number; b: number; }

// CSS named colors (the 147 from the CSS Color Module Level 4 spec, excluding
// CSS4 additions). Each maps to {r,g,b}.
const NAMED_COLORS: Record<string, RGB> = {
  aliceblue: { r: 240, g: 248, b: 255 }, antiquewhite: { r: 250, g: 235, b: 215 },
  aqua: { r: 0, g: 255, b: 255 }, aquamarine: { r: 127, g: 255, b: 212 },
  azure: { r: 240, g: 255, b: 255 }, beige: { r: 245, g: 245, b: 220 },
  bisque: { r: 255, g: 228, b: 196 }, black: { r: 0, g: 0, b: 0 },
  blanchedalmond: { r: 255, g: 235, b: 205 }, blue: { r: 0, g: 0, b: 255 },
  blueviolet: { r: 138, g: 43, b: 226 }, brown: { r: 165, g: 42, b: 42 },
  burlywood: { r: 222, g: 184, b: 135 }, cadetblue: { r: 95, g: 158, b: 160 },
  chartreuse: { r: 127, g: 255, b: 0 }, chocolate: { r: 210, g: 105, b: 30 },
  coral: { r: 255, g: 127, b: 80 }, cornflowerblue: { r: 100, g: 149, b: 237 },
  cornsilk: { r: 255, g: 248, b: 220 }, crimson: { r: 220, g: 20, b: 60 },
  cyan: { r: 0, g: 255, b: 255 }, darkblue: { r: 0, g: 0, b: 139 },
  darkcyan: { r: 0, g: 139, b: 139 }, darkgoldenrod: { r: 184, g: 134, b: 11 },
  darkgray: { r: 169, g: 169, b: 169 }, darkgrey: { r: 169, g: 169, b: 169 },
  darkgreen: { r: 0, g: 100, b: 0 }, darkkhaki: { r: 189, g: 183, b: 107 },
  darkmagenta: { r: 139, g: 0, b: 139 }, darkolivegreen: { r: 85, g: 107, b: 47 },
  darkorange: { r: 255, g: 140, b: 0 }, darkorchid: { r: 153, g: 50, b: 204 },
  darkred: { r: 139, g: 0, b: 0 }, darksalmon: { r: 233, g: 150, b: 122 },
  darkseagreen: { r: 143, g: 188, b: 143 }, darkslateblue: { r: 72, g: 61, b: 139 },
  darkslategray: { r: 47, g: 79, b: 79 }, darkslategrey: { r: 47, g: 79, b: 79 },
  darkturquoise: { r: 0, g: 206, b: 209 }, darkviolet: { r: 148, g: 0, b: 211 },
  deeppink: { r: 255, g: 20, b: 147 }, deepskyblue: { r: 0, g: 191, b: 255 },
  dimgray: { r: 105, g: 105, b: 105 }, dimgrey: { r: 105, g: 105, b: 105 },
  dodgerblue: { r: 30, g: 144, b: 255 }, firebrick: { r: 178, g: 34, b: 34 },
  floralwhite: { r: 255, g: 250, b: 240 }, forestgreen: { r: 34, g: 139, b: 34 },
  fuchsia: { r: 255, g: 0, b: 255 }, gainsboro: { r: 220, g: 220, b: 220 },
  ghostwhite: { r: 248, g: 248, b: 255 }, gold: { r: 255, g: 215, b: 0 },
  goldenrod: { r: 218, g: 165, b: 32 }, gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 }, green: { r: 0, g: 128, b: 0 },
  greenyellow: { r: 173, g: 255, b: 47 }, honeydew: { r: 240, g: 255, b: 240 },
  hotpink: { r: 255, g: 105, b: 180 }, indianred: { r: 205, g: 92, b: 92 },
  indigo: { r: 75, g: 0, b: 130 }, ivory: { r: 255, g: 255, b: 240 },
  khaki: { r: 240, g: 230, b: 140 }, lavender: { r: 230, g: 230, b: 250 },
  lavenderblush: { r: 255, g: 240, b: 245 }, lawngreen: { r: 124, g: 252, b: 0 },
  lemonchiffon: { r: 255, g: 250, b: 205 }, lightblue: { r: 173, g: 216, b: 230 },
  lightcoral: { r: 240, g: 128, b: 128 }, lightcyan: { r: 224, g: 255, b: 255 },
  lightgoldenrodyellow: { r: 250, g: 250, b: 210 }, lightgray: { r: 211, g: 211, b: 211 },
  lightgrey: { r: 211, g: 211, b: 211 }, lightgreen: { r: 144, g: 238, b: 144 },
  lightpink: { r: 255, g: 182, b: 193 }, lightsalmon: { r: 255, g: 160, b: 122 },
  lightseagreen: { r: 32, g: 178, b: 170 }, lightskyblue: { r: 135, g: 206, b: 250 },
  lightslategray: { r: 119, g: 136, b: 153 }, lightslategrey: { r: 119, g: 136, b: 153 },
  lightsteelblue: { r: 176, g: 196, b: 222 }, lightyellow: { r: 255, g: 255, b: 224 },
  lime: { r: 0, g: 255, b: 0 }, limegreen: { r: 50, g: 205, b: 50 },
  linen: { r: 250, g: 240, b: 230 }, magenta: { r: 255, g: 0, b: 255 },
  maroon: { r: 128, g: 0, b: 0 }, mediumaquamarine: { r: 102, g: 205, b: 170 },
  mediumblue: { r: 0, g: 0, b: 205 }, mediumorchid: { r: 186, g: 85, b: 211 },
  mediumpurple: { r: 147, g: 112, b: 219 }, mediumseagreen: { r: 60, g: 179, b: 113 },
  mediumslateblue: { r: 123, g: 104, b: 238 }, mediumspringgreen: { r: 0, g: 250, b: 154 },
  mediumturquoise: { r: 72, g: 209, b: 204 }, mediumvioletred: { r: 199, g: 21, b: 133 },
  midnightblue: { r: 25, g: 25, b: 112 }, mintcream: { r: 245, g: 255, b: 250 },
  mistyrose: { r: 255, g: 228, b: 225 }, moccasin: { r: 255, g: 228, b: 181 },
  navajowhite: { r: 255, g: 222, b: 173 }, navy: { r: 0, g: 0, b: 128 },
  oldlace: { r: 253, g: 245, b: 230 }, olive: { r: 128, g: 128, b: 0 },
  olivedrab: { r: 107, g: 142, b: 35 }, orange: { r: 255, g: 165, b: 0 },
  orangered: { r: 255, g: 69, b: 0 }, orchid: { r: 218, g: 112, b: 214 },
  palegoldenrod: { r: 238, g: 232, b: 170 }, palegreen: { r: 152, g: 251, b: 152 },
  paleturquoise: { r: 175, g: 238, b: 238 }, palevioletred: { r: 219, g: 112, b: 147 },
  papayawhip: { r: 255, g: 239, b: 213 }, peachpuff: { r: 255, g: 218, b: 185 },
  peru: { r: 205, g: 133, b: 63 }, pink: { r: 255, g: 192, b: 203 },
  plum: { r: 221, g: 160, b: 221 }, powderblue: { r: 176, g: 224, b: 230 },
  purple: { r: 128, g: 0, b: 128 }, rebeccapurple: { r: 102, g: 51, b: 153 },
  red: { r: 255, g: 0, b: 0 }, rosybrown: { r: 188, g: 143, b: 143 },
  royalblue: { r: 65, g: 105, b: 225 }, saddlebrown: { r: 139, g: 69, b: 19 },
  salmon: { r: 250, g: 128, b: 114 }, sandybrown: { r: 244, g: 164, b: 96 },
  seagreen: { r: 46, g: 139, b: 87 }, seashell: { r: 255, g: 245, b: 238 },
  sienna: { r: 160, g: 82, b: 45 }, silver: { r: 192, g: 192, b: 192 },
  skyblue: { r: 135, g: 206, b: 235 }, slateblue: { r: 106, g: 90, b: 205 },
  slategray: { r: 112, g: 128, b: 144 }, slategrey: { r: 112, g: 128, b: 144 },
  snow: { r: 255, g: 250, b: 250 }, springgreen: { r: 0, g: 255, b: 127 },
  steelblue: { r: 70, g: 130, b: 180 }, tan: { r: 210, g: 180, b: 140 },
  teal: { r: 0, g: 128, b: 128 }, thistle: { r: 216, g: 191, b: 216 },
  tomato: { r: 255, g: 99, b: 71 }, turquoise: { r: 64, g: 224, b: 208 },
  violet: { r: 238, g: 130, b: 238 }, wheat: { r: 245, g: 222, b: 179 },
  white: { r: 255, g: 255, b: 255 }, whitesmoke: { r: 245, g: 245, b: 245 },
  yellow: { r: 255, g: 255, b: 0 }, yellowgreen: { r: 154, g: 205, b: 50 },
};

/** Is this color fully transparent (the `transparent` keyword, alpha-0 rgba/
 *  hsla, or #rrggbb00)? Callers treat it as "no fill" rather than black. */
export function isTransparentColor(input: string): boolean {
  const s = input.trim().toLowerCase();
  if (s === "transparent" || s === "none") return true;
  const rgbaM = /^rgba?\([^)]*,\s*(0(?:\.0+)?)\s*\)$/.exec(s);
  if (rgbaM) return true;
  const hslaM = /^hsla?\([^)]*\/\s*(0(?:\.0+)?|0%)\s*\)$/.exec(s);
  if (hslaM) return true;
  const hex8M = /^#[0-9a-f]{8}$/.exec(s);
  if (hex8M) return s.endsWith("00");
  return false;
}

/** Does this color carry a partial (non-zero, non-one) alpha that the engine
 *  will ignore? (No alpha blending on bare metal.) Used for warnings. */
export function hasIgnoredAlpha(input: string): boolean {
  const s = input.trim().toLowerCase();
  const rgbaM = /^rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(s);
  if (rgbaM) return parseFloat(rgbaM[1]) < 1;
  const hslaM = /^hsla?\([^)]*\/\s*([\d.]+)%?\s*\)$/.exec(s);
  if (hslaM) return (hslaM[1].endsWith("%") ? parseFloat(hslaM[1]) / 100 : parseFloat(hslaM[1])) < 1;
  const hex8M = /^#[0-9a-f]{8}$/.exec(s);
  if (hex8M) {
    const a = parseInt(s.slice(7, 9), 16) / 255;
    return a > 0 && a < 1;
  }
  return false;
}

/** Parse any CSS color string to {r,g,b}. Alpha is ignored (no blending). */
export function parseColor(input: string): RGB {
  const s = input.trim().toLowerCase();

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbM = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/.exec(s);
  if (rgbM) return { r: +rgbM[1], g: +rgbM[2], b: +rgbM[3] };

  // rgb(r g b) space-separated (CSS4)
  const rgbSpaceM = /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s\/\s[\d.]+)?\s*\)$/.exec(s);
  if (rgbSpaceM) return { r: +rgbSpaceM[1], g: +rgbSpaceM[2], b: +rgbSpaceM[3] };

  // hsl(h, s%, l%) or hsla(h, s%, l%, a) — comma syntax. Angles accept deg/turn/none.
  const hslCommaM = /^hsla?\(\s*([\d.]+)(?:deg|turn|rad)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*[\d.]+)?\s*\)$/.exec(s);
  if (hslCommaM) return hslToRgb(+hslCommaM[1], +hslCommaM[2], +hslCommaM[3]);

  // hsl(h s% l%) or hsla(h s% l% / a) — space syntax (CSS4), with optional slash alpha.
  const hslSpaceM = /^hsla?\(\s*([\d.]+)(?:deg|turn|rad)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*[\d.%]+)?\s*\)$/.exec(s);
  if (hslSpaceM) {
    // 'turn' suffix multiplies by 360; bare number or 'deg' is degrees.
    let h = +hslSpaceM[1];
    if (/turn\b/.test(s)) h = h * 360;
    return hslToRgb(h, +hslSpaceM[2], +hslSpaceM[3]);
  }

  // #rrggbb (6-digit hex)
  const hex6M = /^#([0-9a-f]{6})$/.exec(s);
  if (hex6M) {
    const v = parseInt(hex6M[1], 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }

  // #rrggbbaa (8-digit hex — alpha ignored)
  const hex8M = /^#([0-9a-f]{8})$/.exec(s);
  if (hex8M) {
    const v = parseInt(hex8M[1].slice(0, 6), 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }

  // #rgb (3-digit short hex)
  const hex3M = /^#([0-9a-f]{3})$/.exec(s);
  if (hex3M) {
    const h = hex3M[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }

  // Named colors
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];

  // transparent resolves to black as a COLOR (e.g. gradient stops); fill
  // sites check isTransparentColor() first and skip painting entirely.
  if (s === "transparent") return { r: 0, g: 0, b: 0 };

  // oklch(L C H [/ a]) — CSS Color 4, the dialect of Tailwind v4 era shadcn
  // themes. Alpha ignored like everywhere else; L accepts % form.
  const oklchM = /^oklch\(\s*([\d.]+|none)(%)?\s+([\d.]+|none)\s+([\d.]+|none)(?:deg|turn|rad)?(?:\s*\/\s*[\d.%]+)?\s*\)$/i.exec(s);
  if (oklchM) {
    const l = oklchM[1] === "none" ? 0 : parseFloat(oklchM[1]) / (oklchM[2] ? 100 : 1);
    const c = oklchM[3] === "none" ? 0 : parseFloat(oklchM[3]);
    let h = oklchM[4] === "none" ? 0 : parseFloat(oklchM[4]);
    if (/turn\b/i.test(s)) h = h * 360;
    return oklchToRgb(l, c, h);
  }

  // shadcn theme dialect: bare HSL channel triplets ("222.2 47.4% 11.2%") —
  // the format stock shadcn themes store in CSS variables, normally consumed
  // as hsl(var(--x)). The shape (number % number%) is unambiguous with any
  // valid CSS color, so both dialects work through var() substitution.
  const tripletM = /^([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%$/.exec(s);
  if (tripletM) return hslToRgb(parseFloat(tripletM[1]), parseFloat(tripletM[2]), parseFloat(tripletM[3]));

  throw new Error(`Unsupported color format "${input}" — use #hex, rgb(), hsl(), oklch(), or a named color`);
}

/** Convert oklch (L 0-1, C 0-~0.4, H degrees) to sRGB via OkLab — Björn
 *  Ottosson's reference matrices, then the sRGB transfer function. Values
 *  outside the sRGB gamut clamp per channel (compile-time approximation of
 *  CSS gamut mapping — good enough for opaque 16-bit panel output). */
function oklchToRgb(l: number, c: number, h: number): RGB {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  const lr = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const lb = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;
  const gamma = (v: number): number => {
    const x = Math.min(1, Math.max(0, v));
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  };
  return { r: gamma(lr), g: gamma(lg), b: gamma(lb) };
}

/** Convert HSL (h: 0-360, s/l: 0-100) to RGB. Standard CSS algorithm. */
function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** @deprecated Use parseColor instead — parseHexColor only handles #rrggbb. */
export function parseHexColor(hex: string): RGB {
  return parseColor(hex);
}

export function toRGB565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

export function toMono(r: number, g: number, b: number): 0 | 1 {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum >= 0.27 ? 1 : 0;
}

/** Pack 8-bit channels into a uint32 RGB888 value (R<<16 | G<<8 | B). */
export function pack888(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** Unpack a uint32 RGB888 value into 8-bit channels. */
export function unpack888(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
}

/** Quantize RGB888 → RGB565 (uint16). Channel math identical to toRGB565. */
export function rgb888To565(c: number): number {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** Quantize RGB888 → RGB666 (uint18 packed in lower 18 bits). */
export function rgb888To666(c: number): number {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return ((r & 0xfc) << 10) | ((g & 0xfc) << 4) | (b >> 2);
}

/** Quantize RGB888 → 1-bit mono via luminance threshold (matches toMono). */
export function rgb888ToMono(c: number): 0 | 1 {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return toMono(r, g, b);
}

/**
 * Snap RGB888 to the nearest ink in a palette. Palette entries are RGB888 values.
 * Used by e-ink palette shims (Phase 4); included so the quantizer set is complete.
 */
export function rgb888ToNearest(c: number, palette888: number[]): number {
  const r1 = (c >> 16) & 0xff, g1 = (c >> 8) & 0xff, b1 = c & 0xff;
  let best = palette888[0];
  let bestD = Infinity;
  for (const ink of palette888) {
    const dr = (ink >> 16) & 0xff, dg = (ink >> 8) & 0xff, db = ink & 0xff;
    const dr2 = r1 - dr, dg2 = g1 - dg, db2 = b1 - db;
    const d = dr2 * dr2 + dg2 * dg2 + db2 * db2;
    if (d < bestD) { bestD = d; best = ink; }
  }
  return best;
}

/**
 * Resolve any CSS color string to packed RGB888 (uint32, R<<16 | G<<8 | B).
 * Canonical color resolution for the display-agnostic core. Alpha is ignored
 * (no blending), matching parseColor semantics.
 */
export function resolveColor888(input: string): number {
  const { r, g, b } = parseColor(input);
  return pack888(r, g, b);
}

/**
 * Resolve a CSS color string and quantize to a target format. Backwards-
 * compatible wrapper over resolveColor888 + quantizer. Existing call sites
 * keep their behavior (565/mono output unchanged).
 */
export function resolveColor(input: string, format: "rgb565" | "rgb666" | "rgb888" | "mono"): number {
  const c = resolveColor888(input);
  if (format === "rgb565") return rgb888To565(c);
  if (format === "rgb666") return rgb888To666(c);
  if (format === "rgb888") return c;
  return rgb888ToMono(c);
}

/**
 * Resolve a CSS color to the INTERNAL representation value stored in node
 * fields. For rgb666 targets this is RGB888 (666 quantization happens at the
 * push boundary so blends keep full precision); for rgb565 it is RGB565
 * (byte-identical with pre-Phase-3 behavior); for mono it is 0/1. The value
 * depth and the runtime blend math switch together (see UI_COLOR_DEPTH). */
export function resolveColorInternal(input: string, format: "rgb565" | "rgb666" | "rgb888" | "mono"): number {
  if (format === "rgb666" || format === "rgb888") return resolveColor888(input);
  return resolveColor(input, format);
}
