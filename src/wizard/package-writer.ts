// ---------------------------------------------------------------------------
// package.json script writer for the @typecad/ui integration wizard.
//
// package.json is plain JSON (no comments, no expressions), so unlike
// typecad-hal.config.ts (see config-writer.ts) this needs no AST surgery —
// parse, compare, set, and re-serialize with the 2-space formatting npm and
// `typecad-hal create` both write. An unchanged script is a no-op: the
// original text is returned verbatim so a re-run never reformats the file.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

const PACKAGE_FILENAME = "package.json";

/** Walk up from `startDir` looking for package.json. */
export function findPackageJson(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, PACKAGE_FILENAME);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function parsePackageJson(sourceText: string): Record<string, unknown> {
  try {
    return JSON.parse(sourceText) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `package.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function scriptsOf(pkg: Record<string, unknown>): Record<string, string> | undefined {
  const scripts = pkg.scripts;
  return typeof scripts === "object" && scripts !== null && !Array.isArray(scripts)
    ? (scripts as Record<string, string>)
    : undefined;
}

/** Read a single npm script; undefined when missing. Throws on invalid JSON. */
export function readPackageScript(sourceText: string, name: string): string | undefined {
  const scripts = scriptsOf(parsePackageJson(sourceText));
  const value = scripts?.[name];
  return typeof value === "string" ? value : undefined;
}

export interface UpsertScriptResult {
  text: string;
  /** false — the script already had this exact command; text is unchanged. */
  changed: boolean;
  /** The command that was replaced, when a different script existed. */
  previous?: string;
}

/** Insert or update one npm script, preserving every other key and their order. */
export function upsertPackageScript(
  sourceText: string,
  name: string,
  command: string,
): UpsertScriptResult {
  const pkg = parsePackageJson(sourceText);
  const scripts = scriptsOf(pkg);
  const previous = scripts?.[name];
  if (previous === command) {
    return { text: sourceText, changed: false };
  }
  if (!scripts) {
    pkg.scripts = {};
  }
  (pkg.scripts as Record<string, string>)[name] = command;
  // Keep the file's trailing-newline convention (npm writes LF; a missing
  // final newline stays missing so the diff is one line, not two).
  const eol = sourceText.endsWith("\r\n") ? "\r\n" : sourceText.endsWith("\n") ? "\n" : "";
  return {
    text: `${JSON.stringify(pkg, null, 2)}${eol}`,
    changed: true,
    ...(previous !== undefined ? { previous } : {}),
  };
}

/**
 * The `typecad-hal preview` command the wizard writes as the `preview` npm
 * script. The --config path is made relative to the package.json directory
 * (npm scripts run there), posix-separated, and explicitly ./-prefixed so
 * sibling configs render as `./typecad-hal.config.ts`.
 */
export function previewScriptCommand(packageJsonPath: string, configPath: string): string {
  let rel = path.relative(path.dirname(packageJsonPath), configPath).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return `typecad-hal preview --config ${rel}`;
}
