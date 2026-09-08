// animation-timing-function codes (kept in sync with runtime-header.ts UI_TIMING_*).
export const TIMING_LINEAR = 0;
export const TIMING_EASE_IN_OUT = 1;
export const TIMING_EASE = 2;
export const TIMING_EASE_IN = 3;
export const TIMING_EASE_OUT = 4;

/** Map a CSS animation-timing-function keyword to its TIMING_* code.
 *  Unknown/unsupported (cubic-bezier(), steps()) -> linear. */
export function timingFunctionCode(keyword: string | undefined): number {
  switch ((keyword ?? "").trim().toLowerCase()) {
    case "ease-in-out": return TIMING_EASE_IN_OUT;
    case "ease": return TIMING_EASE;
    case "ease-in": return TIMING_EASE_IN;
    case "ease-out": return TIMING_EASE_OUT;
    default: return TIMING_LINEAR;  // linear + cubic-bezier() + steps() unsupported
  }
}

/** Apply the easing curve to a 0..100 linear lerp factor (fixed-point, no
 *  floats). Mirrors the C++ ui_ease_lerp_k in runtime-header.ts exactly.
 *  Returns k unchanged for TIMING_LINEAR. */
export function easeCurveLerpK(timing: number, k: number): number {
  if (timing === TIMING_LINEAR || k <= 0) return k;
  if (k >= 100) return 100;
  // CSS cubic-bezier control points (normalized 0..1). Endpoints are (0,0),(1,1).
  let x1 = 0, y1 = 0, x2 = 1, y2 = 1;
  switch (timing) {
    case TIMING_EASE_IN_OUT: x1 = 0.42; y1 = 0;    x2 = 0.58; y2 = 1;    break;
    case TIMING_EASE:        x1 = 0.25; y1 = 0.1;  x2 = 0.25; y2 = 1;    break;
    case TIMING_EASE_IN:     x1 = 0.42; y1 = 0;    x2 = 1;    y2 = 1;    break;
    case TIMING_EASE_OUT:    x1 = 0;    y1 = 0;    x2 = 0.58; y2 = 1;    break;
    default: return k;
  }
  // Solve X(t)=input for t, then return Y(t). X(t)=3(1-t)^2*t*x1 + 3(1-t)*t^2*x2 + t^3.
  // Bisection (not Newton-Raphson): Newton diverges for curves whose x-derivative
  // is ~0 near an endpoint (ease-out: x1=0), snapping the dot to the wrong stop.
  // X(t) is monotonic increasing for valid CSS control points, so bisection always
  // converges. The device runtime's ui_ease_lerp_k uses the identical algorithm +
  // control points (in /1000 fixed point) so preview and device agree.
  const input = k / 100;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    const mt = 1 - t;
    const x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
    if (x < input) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  const mt = 1 - t;
  const y = 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
  return Math.round(y * 100);
}
