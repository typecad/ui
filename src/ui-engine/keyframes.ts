import { resolveColor } from "./color.js";
import type { KeyframeSet } from "./css-parser.js";
import {
  clampInt16,
  cssOpacityToPercent,
  cssPx,
  KEYFRAME_PROP_BG,
  KEYFRAME_PROP_FG,
  KEYFRAME_PROP_OPACITY,
  KEYFRAME_PROP_SIZE,
  KEYFRAME_PROP_TRANSFORM,
  parseTransform,
  type KeyframeSetModel,
} from "./model.js";

export function buildKeyframeSets(rawKeyframes: KeyframeSet[], colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono"): KeyframeSetModel[] {
  return rawKeyframes.map((ks) => ({
    name: ks.name,
    stops: ks.stops.map((stop) => {
      let props = 0;
      if (stop.background) props |= KEYFRAME_PROP_BG;
      if (stop.color) props |= KEYFRAME_PROP_FG;
      if (stop.opacity) props |= KEYFRAME_PROP_OPACITY;
      if (stop.transform || stop.left || stop.top) props |= KEYFRAME_PROP_TRANSFORM;
      if (stop.width || stop.height) props |= KEYFRAME_PROP_SIZE;
      const transform = parseTransform(stop.transform);
      const x = transform.x + cssPx(stop.left);
      const y = transform.y + cssPx(stop.top);
      return {
        percent: stop.percent,
        props,
        bg: stop.background ? resolveColor(stop.background, colorFormat) : 0,
        fg: stop.color ? resolveColor(stop.color, colorFormat) : 0,
        opacity: stop.opacity ? cssOpacityToPercent(stop.opacity) : 100,
        transformOffsetX: clampInt16(x),
        transformOffsetY: clampInt16(y),
        translatePctX: clampInt16(transform.pctX),
        translatePctY: clampInt16(transform.pctY),
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        rotateDeg: clampInt16(transform.rotateDeg),
        width: stop.width ? Math.max(0, Math.min(32767, cssPx(stop.width))) : 0,
        height: stop.height ? Math.max(0, Math.min(32767, cssPx(stop.height))) : 0,
      };
    }),
  }));
}
