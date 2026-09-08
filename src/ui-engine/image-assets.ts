// ---------------------------------------------------------------------------
// Image asset loader: reads raw RGB565 binary files for <img> nodes and keeps
// node ids mapped to the generated image table indices.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type { StyledNode } from "./style-resolver.js";
import { getCachedDecodedImage } from "./image-decode.js";

type ColorFormat = "rgb565" | "rgb666" | "rgb888" | "mono";

export interface UIImageAsset {
  /** C++-safe unique id used for the generated data symbol. */
  id: string;
  /** Pixel width of the raw RGB565 asset. */
  width: number;
  /** Pixel height of the raw RGB565 asset. */
  height: number;
  /** RGB565 pixel data (width * height values, row-major). */
  data: number[];
}

export interface LoadedUIImageAssets {
  assets: UIImageAsset[];
  nodeIdToAssetIndex: Map<string, number>;
}

function sanitizeCppIdentifier(value: string, fallback: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  const base = sanitized.length > 0 ? sanitized : fallback;
  return /^[A-Za-z_]/.test(base) ? base : `img_${base}`;
}

function uniqueAssetId(preferred: string, index: number, used: Set<string>): string {
  const base = sanitizeCppIdentifier(preferred, `img_${index}`);
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  used.add(candidate);
  return candidate;
}

function imageNaturalWidth(node: StyledNode): number {
  const width = (node as any).imgWidth as number | undefined;
  return width && width > 0 ? width : 32;
}

function imageNaturalHeight(node: StyledNode): number {
  const height = (node as any).imgHeight as number | undefined;
  return height && height > 0 ? height : 32;
}

function imageAssetKey(src: string, htmlDir: string, width: number, height: number): string {
  const abs = path.isAbsolute(src) ? src : path.resolve(htmlDir, src);
  return `${abs}\0${width}\0${height}`;
}

export function loadImageAssets(roots: StyledNode | StyledNode[], htmlDir: string): LoadedUIImageAssets {
  const assets: UIImageAsset[] = [];
  const nodeIdToAssetIndex = new Map<string, number>();
  const keyToAssetIndex = new Map<string, number>();
  const usedIds = new Set<string>();

  const walk = (node: StyledNode) => {
    const src = (node as any).src as string | undefined;
    if (src && node.id) {
      const abs = path.isAbsolute(src) ? src : path.resolve(htmlDir, src);
      const decoded = getCachedDecodedImage(abs);
      const width = imageNaturalWidth(node);
      const height = imageNaturalHeight(node);
      // Decoded (converted) assets are keyed by file alone — their size is
      // the image's natural size, not the node's attrs. Raw .img dumps keep
      // the (src, dims) key — the dims ARE the asset geometry there.
      const key = decoded ? `decoded:\0${abs}` : imageAssetKey(src, htmlDir, width, height);
      let assetIdx = keyToAssetIndex.get(key);
      if (assetIdx === undefined) {
        const assetId = uniqueAssetId(node.id, assets.length, usedIds);
        const asset = readRgb565Image(src, htmlDir, assetId, width, height);
        if (asset) {
          assetIdx = assets.length;
          assets.push(asset);
          keyToAssetIndex.set(key, assetIdx);
        }
      }
      if (assetIdx !== undefined) {
        nodeIdToAssetIndex.set(node.id, assetIdx);
      }
    }
    node.children.forEach(walk);
  };

  for (const root of Array.isArray(roots) ? roots : [roots]) {
    walk(root);
  }

  return { assets, nodeIdToAssetIndex };
}

function rgb565ToRgb888(v: number): number {
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  const r = (r5 << 3) | (r5 >> 2);
  const g = (g6 << 2) | (g6 >> 4);
  const b = (b5 << 3) | (b5 >> 2);
  return (r << 16) | (g << 8) | b;
}

function emitPixelValue(v: number, colorFormat: ColorFormat): string {
  if (colorFormat === "rgb666" || colorFormat === "rgb888") {
    return "0x" + rgb565ToRgb888(v).toString(16).padStart(6, "0");
  }
  return "0x" + (v & 0xffff).toString(16).padStart(4, "0");
}

export function emitImageTables(assets: UIImageAsset[], colorFormat: ColorFormat = "rgb565"): string {
  if (assets.length === 0) {
    return "const UIImage __ui_images[] = {};\nconst uint16_t __ui_image_count = 0;";
  }

  const lines: string[] = [];
  for (const asset of assets) {
    lines.push(`static const UI_COLOR_T __ui_img_${asset.id}_data[] = {`);
    for (let i = 0; i < asset.data.length; i += 16) {
      const chunk = asset.data
        .slice(i, i + 16)
        .map((v) => emitPixelValue(v, colorFormat));
      lines.push("  " + chunk.join(", ") + ",");
    }
    lines.push("};");
  }

  lines.push("const UIImage __ui_images[] = {");
  for (const asset of assets) {
    lines.push(`  { ${asset.width}, ${asset.height}, __ui_img_${asset.id}_data },`);
  }
  lines.push("};");
  lines.push(`const uint16_t __ui_image_count = ${assets.length};`);
  return lines.join("\n");
}

/** Give <img> nodes without explicit width/height attributes their decoded
 *  image's natural size, so the layout box matches the asset. Must run
 *  BEFORE layout (both pipelines arrange first, then load assets); explicit
 *  author attrs keep controlling the layout box, with object-fit scaling. */
export function applyDecodedImageSizes(roots: StyledNode | StyledNode[], htmlDir: string): void {
  const walk = (node: StyledNode) => {
    const src = (node as any).src as string | undefined;
    if (src && (node as any).imgWidth === undefined && (node as any).imgHeight === undefined) {
      const abs = path.isAbsolute(src) ? src : path.resolve(htmlDir, src);
      const decoded = getCachedDecodedImage(abs);
      if (decoded) {
        (node as any).imgWidth = decoded.width;
        (node as any).imgHeight = decoded.height;
      }
    }
    node.children.forEach(walk);
  };
  for (const root of Array.isArray(roots) ? roots : [roots]) {
    walk(root);
  }
}

/** Read a raw RGB565 binary file and return a padded UIImageAsset. A decoded
 *  (converted) image in the warm-up cache wins — natural size, converted
 *  pixels. */
export function readRgb565Image(
  srcPath: string,
  htmlDir: string,
  id: string,
  width: number,
  height: number,
): UIImageAsset | null {
  const abs = path.isAbsolute(srcPath)
    ? srcPath
    : path.resolve(htmlDir, srcPath);

  const decoded = getCachedDecodedImage(abs);
  if (decoded) {
    return { id, width: decoded.width, height: decoded.height, data: decoded.data };
  }

  if (!fs.existsSync(abs)) {
    console.warn(`[img] Image file not found: ${abs}`);
    return null;
  }

  const buf = fs.readFileSync(abs);
  const expectedPixels = width * height;
  const expectedBytes = expectedPixels * 2;
  if (buf.length < expectedBytes) {
    console.warn(`[img] Image ${srcPath} is ${buf.length} bytes, expected ${expectedBytes} (${width}x${height}x2). Padding missing pixels with 0.`);
  }

  const availablePixels = Math.min(expectedPixels, Math.floor(buf.length / 2));
  const data = new Array<number>(expectedPixels).fill(0);
  for (let i = 0; i < availablePixels; i++) {
    data[i] = buf.readUInt16LE(i * 2);
  }

  return { id, width, height, data };
}
