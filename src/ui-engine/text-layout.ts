export type WhiteSpaceMode = "normal" | "nowrap" | "pre" | "pre-line";

export interface TextLayoutLine {
  text: string;
  width: number;
}

export interface TextLayoutResult {
  lines: TextLayoutLine[];
  width: number;
  height: number;
  lineHeight: number;
}

export interface TextLayoutOptions {
  maxWidth?: number;
  whiteSpace?: string;
  lineHeight: number;
  measureText: (text: string) => number;
}

export function whiteSpaceMode(value: string | undefined): WhiteSpaceMode {
  switch ((value ?? "normal").trim().toLowerCase()) {
    case "nowrap": return "nowrap";
    case "pre": return "pre";
    case "pre-line": return "pre-line";
    default: return "normal";
  }
}

function finiteMaxWidth(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const px = Math.trunc(value);
  return px > 0 ? px : undefined;
}

function normalizeText(text: string, mode: WhiteSpaceMode): string {
  const normalizedNewlines = text.replace(/\r\n?/g, "\n");
  if (mode === "pre") return normalizedNewlines;
  if (mode === "pre-line") return normalizedNewlines.replace(/[ \t\f\v]+/g, " ");
  return normalizedNewlines.replace(/\s+/g, " ");
}

function splitLongWord(word: string, maxWidth: number, measureText: (text: string) => number): TextLayoutLine[] {
  const out: TextLayoutLine[] = [];
  let current = "";
  for (const ch of word) {
    const next = current + ch;
    if (current && measureText(next) > maxWidth) {
      out.push({ text: current, width: measureText(current) });
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) out.push({ text: current, width: measureText(current) });
  return out;
}

function wrapParagraph(paragraph: string, maxWidth: number, measureText: (text: string) => number): TextLayoutLine[] {
  const words = paragraph.trim().split(/ +/).filter(Boolean);
  if (words.length === 0) return [{ text: "", width: 0 }];

  const out: TextLayoutLine[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) {
      out.push({ text: line, width: measureText(line) });
      line = "";
    }

    if (measureText(word) <= maxWidth) {
      line = word;
    } else {
      const split = splitLongWord(word, maxWidth, measureText);
      out.push(...split.slice(0, -1));
      line = split.at(-1)?.text ?? "";
    }
  }

  if (line || out.length === 0) out.push({ text: line, width: measureText(line) });
  return out;
}

export function layoutText(text: string | undefined, options: TextLayoutOptions): TextLayoutResult {
  const mode = whiteSpaceMode(options.whiteSpace);
  const lineHeight = Math.max(1, Math.trunc(options.lineHeight));
  const maxWidth = finiteMaxWidth(options.maxWidth);
  const normalized = normalizeText(text ?? "", mode);
  const hardLines = (mode === "pre" || mode === "pre-line") ? normalized.split("\n") : [normalized];
  const canWrap = mode !== "nowrap" && mode !== "pre" && maxWidth !== undefined;

  const lines: TextLayoutLine[] = [];
  for (const hardLine of hardLines) {
    if (canWrap) lines.push(...wrapParagraph(hardLine, maxWidth, options.measureText));
    else lines.push({ text: hardLine, width: options.measureText(hardLine) });
  }
  if (lines.length === 0) lines.push({ text: "", width: 0 });

  const width = lines.reduce((max, line) => Math.max(max, line.width), 0);
  return {
    lines,
    width,
    height: lines.length * lineHeight,
    lineHeight,
  };
}

