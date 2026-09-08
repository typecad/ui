// ---------------------------------------------------------------------------
// CSS @import expansion — build-time stylesheet inclusion.
//
// Local @import statements are inlined before parsing so shared stylesheets
// (e.g. the shadcn preset added by `typecad-hal add shadcn`) compose with
// per-module CSS, like a browser resolving imports. Relative paths resolve
// against the importing stylesheet's directory; recursion is supported with a
// cycle guard. Remote (http/data:) imports and unreadable files are left in
// place — the CSS parser's existing "@import is not supported" warning then
// reports them instead of failing silently.
//
// This is compile-time inclusion only: each firmware build still targets one
// display, so there is no runtime fetch.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/** Guard against runaway include chains (distinct-file budget across the
 *  whole expansion; cycles are caught by the seen-set, this bounds depth). */
const MAX_INCLUDED_FILES = 32;

const IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)["']?\s*\)?\s*[^;]*;/g;

/** Resolve a bare package specifier ("@typecad/ui/themes/blue.css") through
 *  node_modules relative to baseDir — how pre-packaged themes are imported.
 *  Returns null when it doesn't resolve (e.g. the Tailwind scaffolding
 *  specifier "tailwindcss" inside stock theme exports). */
function resolvePackageSpecifier(spec: string, baseDir: string): string | null {
  try {
    const req = createRequire(path.join(baseDir, "package.json"));
    return req.resolve(spec);
  } catch {
    return null;
  }
}

/** Inline local @import statements in `cssText`. `baseDir` is the directory
 *  of the stylesheet the text came from. `seen` tracks normalized absolute
 *  paths already inlined (cycle guard) across the whole expansion. */
export function expandCssImports(cssText: string, baseDir: string, seen: Set<string> = new Set()): string {
  return cssText.replace(IMPORT_RE, (match, spec: string) => {
    if (/^(https?|data):/i.test(spec)) return match;
    // Package specifiers ("@typecad/ui/themes/blue.css", but also the
    // "tailwindcss" scaffolding inside stock exports) start with @ or a bare
    // name — NOT "./", "../", "/", or a drive letter. Resolvable ones load
    // from node_modules (pre-packaged themes); the rest drop silently so
    // pasted tweakcn/ui.shadcn.com files import cleanly.
    const pathLike = spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || /^[a-zA-Z]:/.test(spec);
    let abs: string;
    if (!pathLike) {
      const resolved = resolvePackageSpecifier(spec, baseDir);
      if (!resolved) return "";
      abs = resolved;
    } else {
      abs = path.normalize(path.isAbsolute(spec) ? spec : path.join(baseDir, spec));
    }
    if (seen.has(abs) || seen.size >= MAX_INCLUDED_FILES) return "";
    seen.add(abs);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf-8");
    } catch {
      return match; // unreadable: keep the statement so the parser warns
    }
    return expandCssImports(text, path.dirname(abs), seen);
  });
}
