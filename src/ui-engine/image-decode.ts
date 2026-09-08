// ---------------------------------------------------------------------------
// Automatic image conversion: decode any common image format (PNG, JPEG,
// GIF, BMP, WebP, AVIF/HEIF, TIFF, SVG, ICO) into the raw RGB565 asset form
// the runtime consumes, so `<img src="photo.png">` just works — no manual
// conversion to raw .img dumps.
//
// Decoding is asynchronous (sharp); the UI module loader is synchronous. The
// bridge is a warm-up pass: the transpile graph collector and the preview
// snapshot builder await `warmUpImageDecoding()` on each UI source BEFORE
// the module loads, priming a cache keyed by absolute path + mtime. The
// synchronous image-assets reader then consults `getCachedDecodedImage()`.
// Anything undecodable (including the legacy raw RGB565 .img files) falls
// back to the raw reader unchanged.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

export type DetectedImageFormat =
  | "png"
  | "jpeg"
  | "gif"
  | "bmp"
  | "webp"
  | "avif"
  | "tiff"
  | "ico"
  | "svg";

/** A decoded image in the asset pipeline's internal currency (RGB565). */
export interface DecodedImage {
  width: number;
  height: number;
  /** RGB565 pixels, row-major, width*height values. */
  data: number[];
}

/** Identify a buffer by magic bytes. null = unknown (raw RGB565 dump). */
export function detectImageFormat(buf: Buffer): DetectedImageFormat | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") return "gif";
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  // ISO-BMFF family (AVIF/HEIF): bytes 4..8 are "ftyp".
  if (buf.length >= 8 && buf.toString("ascii", 4, 8) === "ftyp") return "avif";
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "II*\0") return "tiff";
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "MM\0*") return "tiff";
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return "ico";
  // SVG is XML text: after an optional BOM, the first non-space char is '<'.
  for (let i = 0; i < Math.min(buf.length, 8); i++) {
    const b = buf[i];
    if (b === 0xef || b === 0xbb || b === 0xbf) continue; // UTF-8 BOM bytes
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b === 0x3c) return "svg";
    break;
  }
  return null;
}

/** RGBA/RGB pixel block plus its channel count. */
interface RawPixels {
  pixels: Buffer | Uint8Array;
  channels: number;
  width: number;
  height: number;
}

let sharpLoader: Promise<any> | null = null;
function loadSharp(): Promise<any> {
  if (!sharpLoader) {
    sharpLoader = import("sharp").then((m) => (m as { default: any }).default).catch((err) => {
      sharpLoader = null; // a later call can retry (e.g. after an install fix)
      throw new Error(
        `the sharp image decoder could not be loaded (${err instanceof Error ? err.message : String(err)}) — ` +
        `reinstall dependencies, or convert the image to a raw RGB565 .img file manually`,
      );
    });
  }
  return sharpLoader;
}

/** Run a sharp pipeline to raw pixels: flatten alpha onto black, optionally
 *  downscale to fit the display (never enlarge). */
async function runSharp(
  pipeline: any,
  naturalW: number,
  naturalH: number,
  opts: { maxW?: number; maxH?: number },
): Promise<RawPixels> {
  if (opts.maxW && opts.maxH && (naturalW > opts.maxW || naturalH > opts.maxH)) {
    pipeline = pipeline.resize({ width: opts.maxW, height: opts.maxH, fit: "inside", withoutEnlargement: true });
  }
  const { data, info } = await pipeline
    .flatten({ background: "#000000" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: data, channels: info.channels, width: info.width, height: info.height };
}

/** Decode an .ico: decode-ico returns every frame as RGBA (PNG and BMP
 *  frames alike); pick the largest so the asset carries the best detail. */
async function decodeIco(buf: Buffer): Promise<RawPixels> {
  const decodeIcoMod = await import("decode-ico");
  const decodeIco = (decodeIcoMod as unknown as {
    default: (src: Uint8Array) => Array<{ width: number; height: number; data: Uint8Array }>;
  }).default;
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const frames = decodeIco(u8);
  if (!frames || frames.length === 0) throw new Error("no frames in .ico");
  let best = frames[0];
  for (const f of frames) {
    if (f.width * f.height > best.width * best.height) best = f;
  }
  return { pixels: best.data, channels: 4, width: best.width, height: best.height };
}

function rgbaToRgb565(px: Buffer | Uint8Array, channels: number): number[] {
  const count = Math.floor(px.length / channels);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const r = px[i * channels] >> 3;
    const g = px[i * channels + 1] >> 2;
    const b = px[i * channels + 2] >> 3;
    out[i] = (r << 11) | (g << 5) | b;
  }
  return out;
}

async function decodeImageBuffer(
  buf: Buffer,
  format: DetectedImageFormat,
  opts: { maxW?: number; maxH?: number },
): Promise<DecodedImage> {
  const sharp = await loadSharp();
  let raw: RawPixels;
  if (format === "ico") {
    const ico = await decodeIco(buf);
    if (opts.maxW && opts.maxH && (ico.width > opts.maxW || ico.height > opts.maxH)) {
      // The largest frame still exceeds the display; route its RGBA through
      // sharp for the same fit-inside downscale every other format gets.
      const rgbaBuf = Buffer.from(ico.pixels.buffer, ico.pixels.byteOffset, ico.pixels.byteLength);
      raw = await runSharp(
        sharp(rgbaBuf, { raw: { width: ico.width, height: ico.height, channels: 4 } }),
        ico.width,
        ico.height,
        opts,
      );
    } else {
      raw = ico;
    }
  } else {
    // File bytes: auto-orient by EXIF first, then the shared flatten/fit path.
    // metadata() reports the STORED dimensions — an EXIF orientation of 5-8
    // means the pipeline's rotate() transposes the output, so the fit decision
    // must compare against the swapped natural size or portrait photos can
    // skip the downscale they need (and landscape ones downscale needlessly).
    const oriented = sharp(buf, { failOn: "none" }).rotate();
    const meta = await oriented.metadata();
    const exifSwap = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
    const naturalW = exifSwap ? meta.height : meta.width;
    const naturalH = exifSwap ? meta.width : meta.height;
    raw = await runSharp(oriented, naturalW ?? 0, naturalH ?? 0, opts);
  }
  return { width: raw.width, height: raw.height, data: rgbaToRgb565(raw.pixels, raw.channels) };
}

// ── Warm-up cache ──────────────────────────────────────────────────────────
// Keyed by absolute path + mtime so a preview watch session picks up edited
// images; entries for prior mtimes simply go stale (a snapshot build is
// short-lived, and the transpile pipeline is one-shot).

interface CacheEntry {
  mtimeMs: number;
  image: DecodedImage | null; // null = failed decode (raw fallback, one warning)
}

const decodedCache = new Map<string, CacheEntry>();

function cacheKey(abs: string, mtimeMs: number): string {
  return `${abs}\0${mtimeMs}`;
}

/** The decoded image for a file, or undefined when it was never warmed up or
 *  its decode failed (the caller falls back to the raw RGB565 reader). */
export function getCachedDecodedImage(absPath: string): DecodedImage | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return undefined;
  }
  const entry = decodedCache.get(cacheKey(absPath, stat.mtimeMs));
  return entry ? (entry.image ?? undefined) : undefined;
}

const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/g;

/** Scan a UI source for src="…" references and pre-decode every referenced
 *  image file. Called with `await` BEFORE the UI module loads (the module
 *  loader and asset reader are synchronous); failures warn and fall back. */
export async function warmUpImageDecoding(
  sourceText: string,
  baseDir: string,
  opts: { maxW?: number; maxH?: number } = {},
): Promise<void> {
  const pending = new Set<string>();
  let match: RegExpExecArray | null;
  SRC_ATTR.lastIndex = 0;
  while ((match = SRC_ATTR.exec(sourceText)) !== null) {
    const src = match[1];
    if (!src || /^(data:|https?:|#)/.test(src)) continue;
    const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
    pending.add(abs);
  }
  await Promise.all([...pending].map(async (abs) => {
    // Track the mtime up front so a failed decode is memoized under the key
    // getCachedDecodedImage() looks up — the next warm-up of an unchanged
    // file hits the null entry instead of re-attempting (and re-warning).
    let mtimeMs = 0;
    try {
      if (!fs.existsSync(abs)) return;
      const stat = fs.statSync(abs);
      mtimeMs = stat.mtimeMs;
      const key = cacheKey(abs, mtimeMs);
      if (decodedCache.has(key)) return;
      const buf = fs.readFileSync(abs);
      const format = detectImageFormat(buf);
      if (!format) return; // legacy raw RGB565 dump — the raw reader handles it
      const image = await decodeImageBuffer(buf, format, opts);
      decodedCache.set(key, { mtimeMs, image });
    } catch (err) {
      if (mtimeMs > 0) {
        decodedCache.set(cacheKey(abs, mtimeMs), { mtimeMs, image: null });
      }
      console.warn(`[img] ${path.basename(abs)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }));
}

/** Test hook: drop cached decodes. */
export function resetImageDecodeCache(): void {
  decodedCache.clear();
}
