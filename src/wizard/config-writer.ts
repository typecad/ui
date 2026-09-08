// ---------------------------------------------------------------------------
// typecad-hal.config.ts reader/writer for the @typecad/ui integration wizard.
//
// The build's config loader (packages/cuttlefish/src/config-loader.ts) is
// AST-based and deliberately never evaluates user code — only inline literals
// survive extraction. The writer here plays by the same rules: the wizard
// emits plain object literals and splices them into the config's default
// export object via the TypeScript AST, so every other section (and its
// comments) survives an update byte-for-byte.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const CONFIG_FILENAME = "typecad-hal.config.ts";

/** Walk up from `startDir` looking for typecad-hal.config.ts. */
export function findTypecadConfig(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** A plain record as extracted from a config object literal. */
export type ConfigRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// AST helpers (kept aligned with the config loader's extraction rules)
// ---------------------------------------------------------------------------

function unwrapTypeCast(node: ts.Expression): ts.Expression {
  let curr = node;
  for (;;) {
    if (ts.isAsExpression(curr) || ts.isTypeAssertionExpression(curr) || ts.isParenthesizedExpression(curr)) {
      curr = curr.expression;
      continue;
    }
    const isSatisfies = (ts as unknown as { isSatisfiesExpression?: (n: ts.Node) => boolean }).isSatisfiesExpression;
    if (typeof isSatisfies === "function" && isSatisfies(curr)) {
      curr = (curr as ts.SatisfiesExpression).expression;
      continue;
    }
    return curr;
  }
}

function propertyKeyName(prop: ts.ObjectLiteralElement): string | undefined {
  const name = (prop as { name?: ts.PropertyName }).name;
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function getScalarValue(node: ts.Expression): string | number | boolean | undefined {
  const unwrapped = unwrapTypeCast(node);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }
  if (ts.isPrefixUnaryExpression(unwrapped)
    && (unwrapped.operator === ts.SyntaxKind.MinusToken || unwrapped.operator === ts.SyntaxKind.PlusToken)
    && ts.isNumericLiteral(unwrapped.operand)) {
    const magnitude = Number(unwrapped.operand.text);
    return unwrapped.operator === ts.SyntaxKind.MinusToken ? -magnitude : magnitude;
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function getStringLiteral(node: ts.Expression): string | undefined {
  const unwrapped = unwrapTypeCast(node);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  return undefined;
}

/**
 * Find the config's default-export object literal. Accepts the same shapes as
 * the build's loader:
 *   1. `export default { ... }`
 *   2. `const config: TypecadConfig = { ... }; export default config;`
 * with `as` / `satisfies` / parenthesized wrappers unwrapped.
 */
function findConfigObjectLiteral(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const variableDecls = new Map<string, ts.VariableDeclaration>();
  let defaultExportName: string | undefined;
  let inlineDefaultObject: ts.ObjectLiteralExpression | undefined;

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          variableDecls.set(decl.name.text, decl);
        }
      }
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = unwrapTypeCast(stmt.expression);
      if (ts.isIdentifier(expr)) {
        defaultExportName = expr.text;
      } else if (ts.isObjectLiteralExpression(expr)) {
        inlineDefaultObject = expr;
      }
    }
  }

  if (inlineDefaultObject) return inlineDefaultObject;
  if (defaultExportName) {
    const decl = variableDecls.get(defaultExportName);
    if (decl?.initializer) {
      const init = unwrapTypeCast(decl.initializer);
      if (ts.isObjectLiteralExpression(init)) return init;
    }
  }
  return undefined;
}

function parseSource(sourceText: string): ts.SourceFile {
  return ts.createSourceFile(CONFIG_FILENAME, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function objectLiteralToRecord(obj: ts.ObjectLiteralExpression): ConfigRecord {
  const result: ConfigRecord = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = propertyKeyName(prop);
    if (!key) continue;
    const init = unwrapTypeCast(prop.initializer);
    if (ts.isObjectLiteralExpression(init)) {
      result[key] = objectLiteralToRecord(init);
    } else if (ts.isArrayLiteralExpression(init)) {
      const items: string[] = [];
      for (const elem of init.elements) {
        const s = getStringLiteral(elem);
        if (s === undefined) break;
        items.push(s);
      }
      if (items.length === init.elements.length && items.length > 0) result[key] = items;
    } else {
      const scalar = getScalarValue(init);
      if (scalar !== undefined) result[key] = scalar;
    }
  }
  return result;
}

/**
 * Read a top-level section of the config (e.g. `display`) as a plain record.
 * Returns undefined when the section is missing or not an object literal.
 */
export function readConfigSection(sourceText: string, section: string): ConfigRecord | undefined {
  const obj = findConfigObjectLiteral(parseSource(sourceText));
  if (!obj) return undefined;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (propertyKeyName(prop) !== section) continue;
    const init = unwrapTypeCast(prop.initializer);
    if (!ts.isObjectLiteralExpression(init)) return undefined;
    return objectLiteralToRecord(init);
  }
  return undefined;
}

/** Read the top-level `entry` scalar (the .ui/.ts entry path). */
export function readEntryPath(sourceText: string): string | undefined {
  const obj = findConfigObjectLiteral(parseSource(sourceText));
  if (!obj) return undefined;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (propertyKeyName(prop) !== "entry") continue;
    const value = getStringLiteral(unwrapTypeCast(prop.initializer));
    return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Rendering — build the `display` object-literal text
// ---------------------------------------------------------------------------

/** Keys whose numeric values read best in hex (I2C addresses). */
const HEX_KEYS: ReadonlySet<string> = new Set(["address", "i2cAddress"]);

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isPlainRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderValue(key: string, value: unknown): string {
  if (typeof value === "number") {
    if (HEX_KEYS.has(key) && Number.isInteger(value) && value >= 0) {
      return `0x${value.toString(16)}`;
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return `'${escapeString(value)}'`;
  if (Array.isArray(value)) {
    return `[${value.map((item) => renderValue(key, item)).join(", ")}]`;
  }
  if (isPlainRecord(value)) {
    const inner = Object.entries(value)
      .map(([nestedKey, nestedValue]) => `${nestedKey}: ${renderValue(nestedKey, nestedValue)}`)
      .join(", ");
    return `{ ${inner} }`;
  }
  throw new Error(`Cannot render display config value for key "${key}" (${typeof value}).`);
}

export interface RenderDisplayOptions {
  /** Indentation of the property lines inside the braces (default 2 spaces). */
  indent?: string;
  /** Indentation of the closing brace (default: none). */
  closingIndent?: string;
  /** Line ending used in the rendered block (default "\n"). */
  eol?: string;
  /** Optional `// comment` lines rendered above the matching key. */
  comments?: Record<string, string>;
}

/**
 * Render the display section as an object-literal body (braces included).
 * Key order follows insertion order of the record, matching the demos
 * (profile/wiring first, touch last). Nested objects render inline.
 */
export function renderDisplayBody(display: ConfigRecord, options: RenderDisplayOptions = {}): string {
  const indent = options.indent ?? "  ";
  const closingIndent = options.closingIndent ?? "";
  const eol = options.eol ?? "\n";
  const lines: string[] = [];
  for (const [key, value] of Object.entries(display)) {
    const comment = options.comments?.[key];
    if (comment) {
      lines.push(`${indent}// ${comment}`);
    }
    lines.push(`${indent}${key}: ${renderValue(key, value)},`);
  }
  return `{${eol}${lines.join(eol)}${eol}${closingIndent}}`;
}

/** Render the complete `display: { ... }` property text for a property that
 *  starts at `options.indent`. The returned text's first line is NOT indented
 *  — the caller positions the property start; body lines and the closing
 *  brace are indented relative to `options.indent`. */
export function renderDisplayProperty(display: ConfigRecord, options: RenderDisplayOptions = {}): string {
  const indent = options.indent ?? "";
  return `display: ${renderDisplayBody(display, {
    ...options,
    indent: `${indent}  `,
    closingIndent: indent,
  })}`;
}

// ---------------------------------------------------------------------------
// Splicing — insert or replace the display section inside the config
// ---------------------------------------------------------------------------

/** Leading whitespace of the line containing `pos` ("" when mid-line). */
function lineIndentAt(text: string, pos: number): string {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  return /^[ \t]*$/.test(before) ? before : "";
}

function detectLineEnding(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Skip whitespace and comments from `pos`; true when the next char is ','. */
function spanStartsWithComma(text: string, pos: number, end: number): boolean {
  let i = pos;
  while (i < end) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i);
      if (newline === -1 || newline >= end) return false;
      i = newline + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i);
      if (close === -1 || close + 2 > end) return false;
      i = close + 2;
      continue;
    }
    return ch === ",";
  }
  return false;
}

export interface UpsertDisplayResult {
  text: string;
  /** "replaced" — an existing display section was rewritten; "inserted" — none existed. */
  mode: "replaced" | "inserted";
}

/**
 * Insert or replace the `display` section in a typecad-hal.config.ts source
 * string, preserving every other section and comment. Throws when the config
 * has no recognizable default-export object literal.
 */
export function upsertDisplaySection(
  sourceText: string,
  display: ConfigRecord,
  options: RenderDisplayOptions = {},
): UpsertDisplayResult {
  const sourceFile = parseSource(sourceText);
  const obj = findConfigObjectLiteral(sourceFile);
  if (!obj) {
    throw new Error(
      "typecad-hal.config.ts has no recognizable config object — expected `export default { ... }` or `const config = { ... }; export default config;`.",
    );
  }

  const eol = options.eol ?? detectLineEnding(sourceText);
  const existing = obj.properties.find(
    (prop) => ts.isPropertyAssignment(prop) && propertyKeyName(prop) === "display",
  ) as ts.PropertyAssignment | undefined;

  if (existing) {
    const indent = lineIndentAt(sourceText, existing.getStart());
    const body = renderDisplayBody(display, { ...options, indent: `${indent}  `, closingIndent: indent, eol });
    const init = unwrapTypeCast(existing.initializer);
    if (ts.isObjectLiteralExpression(init)) {
      // Replace just the initializer — `display:` name and its comments stay.
      return {
        text: sourceText.slice(0, init.getStart()) + body + sourceText.slice(init.getEnd()),
        mode: "replaced",
      };
    }
    // `display: someExpression` — replace the whole property.
    return {
      text: sourceText.slice(0, existing.getStart()) + `display: ${body}` + sourceText.slice(existing.getEnd()),
      mode: "replaced",
    };
  }

  // No display section — insert before the object literal's closing brace.
  const closeBrace = obj.getEnd() - 1;
  const lastProp = obj.properties[obj.properties.length - 1];
  const indent = lastProp
    ? lineIndentAt(sourceText, lastProp.getStart())
    : lineIndentAt(sourceText, obj.getStart()) + "  ";
  const body = renderDisplayBody(display, { ...options, indent: `${indent}  `, closingIndent: indent, eol });
  const closingIndent = lineIndentAt(sourceText, closeBrace);

  let prefix = sourceText;
  if (lastProp && !spanStartsWithComma(sourceText, lastProp.getEnd(), closeBrace)) {
    prefix = sourceText.slice(0, lastProp.getEnd()) + "," + sourceText.slice(lastProp.getEnd());
  }

  // Recompute the brace position if a comma was inserted before it.
  const insertedComma = prefix !== sourceText;
  const closeBraceFinal = closeBrace + (insertedComma ? 1 : 0);
  return {
    text:
      prefix.slice(0, closeBraceFinal)
      // Trailing comma keeps the multi-property style of the demos.
      + `${indent}display: ${body},${eol}${closingIndent}`
      + prefix.slice(closeBraceFinal),
    mode: "inserted",
  };
}

/**
 * Syntactic sanity check for wizard output: returns the first error message
 * when the text no longer parses as TypeScript, or null when it is clean.
 * (Semantic checking is the build's job — this only guards the splice.)
 */
export function findSyntaxError(text: string): string | null {
  const output = ts.transpileModule(text, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  });
  const errors = (output.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length === 0) return null;
  const first = errors[0]!;
  const message = ts.flattenDiagnosticMessageText(first.messageText, "\n");
  if (typeof first.start === "number") {
    const line = text.slice(0, first.start).split("\n").length;
    return `line ${line}: ${message}`;
  }
  return message;
}
