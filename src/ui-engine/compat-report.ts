// ---------------------------------------------------------------------------
// CSS compatibility report — post-layout diagnostics that make the engine's
// divergences from browser behavior VISIBLE instead of silent.
//
// Every check here corresponds to a place where the engine approximates or
// quantizes what a browser would do (font-size bucketing on the stock font,
// ignored alpha, display-anchored UA scale, touch-target minimums). Surfaces
// as ordinary warnings in the build output; `--strict-css` upgrades them to
// errors (see the cuttlefish CLI).
// ---------------------------------------------------------------------------

import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import type { StyledNode } from "./style-resolver.js";
import type { Box } from "./layout-engine.js";
import type { UIFontAssetModel } from "./font-assets.js";
import { selectFontAssetForStyle } from "./font-assets.js";
import { hasIgnoredAlpha } from "./color.js";
import { uaScaleFor } from "./ua-stylesheet.js";

const COLOR_PROPS = [
  "color", "background", "borderColor", "borderTopColor", "borderRightColor",
  "borderBottomColor", "borderLeftColor", "outline",
] as const;

/** Stock-font size buckets (model.ts textSizeOf): every font-size in a bucket
 *  renders at the same pixel size when no @font-face matches. */
function bucketOf(px: number): string {
  if (px <= 12) return "1–12";
  if (px <= 20) return "13–20";
  if (px <= 28) return "21–28";
  return "29+";
}

function labelOf(node: StyledNode): string {
  if (node.id) return `#${node.id}`;
  if (node.origTag) return `<${node.origTag}>`;
  return `<${node.tag}>`;
}

/** Produce CSS-compatibility diagnostics for the lowered tree. */
export function cssCompatDiagnostics(
  screens: StyledNode[],
  fontAssets: UIFontAssetModel[],
  viewport: { width: number; height: number },
  colorFormat: string | undefined,
  sourceFile: string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const push = (key: string, d: Diagnostic): void => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };

  const mono = colorFormat === "mono";
  const scale = uaScaleFor(viewport.height, mono);

  // Surface the display-anchored UA scale once when it differs from the
  // browser's classic 16px — "why is my text smaller than on desktop" answered
  // up front instead of discovered pixel-by-pixel.
  if (scale.root !== 16 || mono) {
    out.push({
      severity: "info",
      code: "css-ua-scale",
      message: `Display-anchored UA defaults active: root text ${scale.root}px` +
        (mono ? ` (monochrome; stock-font sizes are bucketed 1–12/13–20/21–28/29+)` : ``) +
        `, headings ${scale.h.join("/")}, touch-target min-height ${scale.controlMinHeight}px.`,
      hint: `Override per element with explicit px font-sizes, or restyle the scale in your own CSS.`,
      source: sourceFile,
    });
  }

  const walk = (node: StyledNode): void => {
    const style = node.style as Record<string, string | undefined>;
    const label = labelOf(node);

    // Partial alpha is silently dropped (no blending on bare metal).
    for (const prop of COLOR_PROPS) {
      const v = style[prop];
      if (v && hasIgnoredAlpha(v)) {
        push(`alpha:${v}`, {
          severity: "warning",
          code: "css-alpha-ignored",
          message: `${label}: alpha in "${v}" is ignored — the color renders fully opaque (${prop}).`,
          hint: `There is no alpha blending on bare metal; blend against the target background color instead.`,
          source: sourceFile,
        });
      }
    }

    // font-size sanity against the viewport and the stock-font buckets.
    const fs = style.fontSize;
    if (fs) {
      const px = parseFloat(fs);
      if (Number.isFinite(px) && px > 0) {
        if (px >= viewport.height * 0.15) {
          push(`fsvp:${px}`, {
            severity: "warning",
            code: "css-font-size-viewport",
            message: `${label}: font-size ${px}px is ${Math.round((px / viewport.height) * 100)}% of the ${viewport.height}px display height.`,
            hint: `Large fills of a small screen are sometimes intended — if not, scale it down.`,
            source: sourceFile,
          });
        }
        // Quantization only bites on the stock font (no matching @font-face).
        if (mono && selectFontAssetForStyle(fontAssets, node.style) === undefined) {
          push(`bucket:${px}`, {
            severity: "warning",
            code: "css-font-size-quantized",
            message: `${label}: font-size ${px}px renders at the stock-font bucket for ${bucketOf(px)}px — every size in that range draws identically on monochrome displays.`,
            hint: `Pick sizes from the bucket edges (12/20/28) or register an @font-face for exact sizes.`,
            source: sourceFile,
          });
        }
      }
    }

    // Touch-target minimums that swallow half the screen.
    const mh = style.minHeight;
    if (mh) {
      const px = parseFloat(mh);
      if (Number.isFinite(px) && px >= viewport.height * 0.5) {
        push(`mhvp:${px}`, {
          severity: "warning",
          code: "css-min-height-viewport",
          message: `${label}: min-height ${px}px is ${Math.round((px / viewport.height) * 100)}% of the ${viewport.height}px display height.`,
          hint: `Reduce the min-height for very small panels (the UA default already scales down).`,
          source: sourceFile,
        });
      }
    }

    for (const child of node.children) walk(child);
  };
  for (const screen of screens) walk(screen);

  return out;
}
