import { whiteSpaceMode, WhiteSpaceMode } from "./text-layout.js";

export interface RichSegment {
  /** Index into the source runs[] this segment came from. A run that wraps
   *  across multiple lines produces one segment per line, all with the same
   *  runIndex. */
  runIndex: number;
  text: string;
  /** Offset from the line's left edge (pre-alignment). */
  x: number;
  width: number;
}
export interface RichLine {
  segments: RichSegment[];
  /** Sum of segment widths + inter-word spaces on this line (no trailing space). */
  width: number;
  /** Tallest run height on this line. */
  height: number;
  /** Tallest ascent on this line (for baseline alignment). */
  ascent: number;
}
export interface RichLayoutResult {
  lines: RichLine[];
  /** Max line width. */
  width: number;
  /** Sum of line heights. */
  height: number;
}

export interface LayoutRun {
  text: string;
  hardBreak?: boolean;
  /** Measure a string at THIS run's style (font/size advance). */
  measureText: (s: string) => number;
  /** Rendered content height of this run's font (e.g. 8*textSize). */
  height: number;
  /** Ascent of this run's font (e.g. 7*textSize). */
  ascent: number;
}

/** Greedy multi-run wrapper. Generalizes the single-string wrap to a sequence
 *  of styled runs: each candidate is measured with its OWN measureText, breaks
 *  happen at spaces and at run boundaries, and per-segment geometry is recorded
 *  so the draw layer and link hit-test know where each run sits on each line.
 *
 *  Whitespace handling mirrors text-layout.ts: `normal` collapses runs of
 *  whitespace and wraps on word boundaries; `nowrap` keeps one line; `pre`
 *  preserves whitespace and breaks only on hard breaks/newlines; `pre-line`
 *  collapses spaces but keeps newlines. Per-run text is normalized within the
 *  run; a space straddling a run boundary collapses to one (owned by the
 *  earlier run). */
export function layoutRuns(
  runs: LayoutRun[],
  options: { maxWidth?: number; whiteSpace?: string },
): RichLayoutResult {
  const mode = whiteSpaceMode(options.whiteSpace);
  const maxWidth = options.maxWidth && options.maxWidth > 0 ? Math.trunc(options.maxWidth) : undefined;
  const canWrap = mode !== "nowrap" && mode !== "pre" && maxWidth !== undefined;

  // Tokenize each run into words (split on spaces), preserving which run + the
  // run's measure function. Each word carries `spaceBefore`: true when source
  // whitespace preceded it (within the run, or trailing whitespace of the
  // previous run before this run's first word). This keeps placement faithful
  // to source whitespace — adjacent runs with no whitespace between them join
  // with no separator.
  type Word = { runIndex: number; text: string; mt: (s: string) => number; h: number; a: number; spaceBefore: boolean };
  type Break = { runIndex: number; mt: (s: string) => number; h: number; a: number };
  type Token = { kind: "word"; w: Word } | { kind: "break"; b: Break };
  const tokens: Token[] = [];
  let prevRunTrailingSpace = false;  // did the previous run's text end with whitespace?
  runs.forEach((run, runIndex) => {
    if (run.hardBreak) {
      tokens.push({ kind: "break", b: { runIndex, mt: run.measureText, h: run.height, a: run.ascent } });
      prevRunTrailingSpace = false;
      return;
    }
    const text = normalizeRunText(run.text, mode);
    const leadingSpace = /^\s/.test(run.text);
    if (mode === "pre") {
      // Preserve internal newlines as hard breaks; keep text segments between.
      const parts = text.split("\n");
      parts.forEach((part, i) => {
        if (part) tokens.push({ kind: "word", w: { runIndex, text: part, mt: run.measureText, h: run.height, a: run.ascent, spaceBefore: i === 0 ? (leadingSpace || prevRunTrailingSpace) : false } });
        if (i < parts.length - 1) tokens.push({ kind: "break", b: { runIndex, mt: run.measureText, h: run.height, a: run.ascent } });
      });
      prevRunTrailingSpace = /\s$/.test(text);
      return;
    }
    // normal / nowrap / pre-line: split on whitespace runs into words.
    const words = text.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      // Internal words (i > 0) had whitespace before them within the run.
      // The first word (i === 0) has a space before only if the run's text
      // started with whitespace OR the previous run ended with whitespace.
      const spaceBefore = i > 0 ? true : (leadingSpace || prevRunTrailingSpace);
      tokens.push({ kind: "word", w: { runIndex, text: w, mt: run.measureText, h: run.height, a: run.ascent, spaceBefore } });
    });
    prevRunTrailingSpace = /\s$/.test(run.text);
  });

  const lines: RichLine[] = [];
  // Current line state.
  let segs: RichSegment[] = [];
  let lineW = 0;
  let lineH = 0;
  let lineA = 0;
  // Current in-progress segment for a run (accumulating words of the same run
  // on the current line, joined by spaces).
  let cur: { runIndex: number; text: string; mt: (s: string) => number; h: number; a: number } | null = null;

  const flushCurrent = () => {
    if (cur) {
      segs.push({ runIndex: cur.runIndex, text: cur.text, x: lineW, width: cur.mt(cur.text) });
      lineW += cur.mt(cur.text);
      cur = null;
    }
  };
  const commitLine = (minHeight = 0, minAscent = 0) => {
    flushCurrent();
    lineH = Math.max(lineH, minHeight);
    lineA = Math.max(lineA, minAscent);
    lines.push({ segments: segs, width: lineW, height: lineH, ascent: lineA });
    segs = [];
    lineW = 0;
    lineH = 0;
    lineA = 0;
  };

  for (const tok of tokens) {
    if (tok.kind === "break") {
      commitLine(tok.b.h, tok.b.a);
      continue;
    }
    const word = tok.w;
    // A space precedes this word when the source had whitespace before it
    // (word.spaceBefore) AND we're not at the very start of a line (standard
    // whitespace collapsing trims a leading space on a fresh line). The space
    // is measured with the run that owns the word being added.
    const atLineStart = cur === null && lineW === 0;
    const wantSpace = word.spaceBefore && !atLineStart;
    const sameRun = cur !== null && cur.runIndex === word.runIndex;

    if (sameRun) {
      // Extending the current segment: "cur word" (space included only if wanted).
      if (wantSpace) {
        const candidate = cur!.text + " " + word.text;
        // lineW holds only committed/flushed width + separator spaces; the
        // in-progress segment `cur` is NOT yet in lineW (only flushCurrent
        // adds it). So the true line width after extending cur is lineW plus
        // the candidate's full width — not lineW minus cur plus candidate
        // (that would under-count by cur's width and fail to wrap intra-run).
        const candidateW = lineW + cur!.mt(candidate);
        if (canWrap && candidateW > maxWidth! && cur!.text) {
          commitLine();
          cur = { runIndex: word.runIndex, text: word.text, mt: word.mt, h: word.h, a: word.a };
          lineH = word.h; lineA = word.a;
        } else {
          cur!.text = candidate;
          lineH = Math.max(lineH, word.h);
          lineA = Math.max(lineA, word.a);
        }
      } else {
        // No space: append directly (adjacent words with no source whitespace).
        const candidate = cur!.text + word.text;
        const candidateW = lineW + cur!.mt(candidate);
        if (canWrap && candidateW > maxWidth! && cur!.text) {
          commitLine();
          cur = { runIndex: word.runIndex, text: word.text, mt: word.mt, h: word.h, a: word.a };
          lineH = word.h; lineA = word.a;
        } else {
          cur!.text = candidate;
          lineH = Math.max(lineH, word.h);
          lineA = Math.max(lineA, word.a);
        }
      }
    } else {
      // Different run (or first word on the line).
      const spaceW = wantSpace ? word.mt(" ") : 0;
      const wordW = word.mt(word.text);
      if (cur) flushCurrent();
      if (canWrap && lineW + spaceW + wordW > maxWidth! && lineW > 0) {
        // Doesn't fit: wrap to a new line. (Space suppressed at line start.)
        commitLine();
        if (canWrap && wordW > maxWidth!) {
          const parts = splitLongWord(word.text, maxWidth!, word.mt);
          for (let i = 0; i < parts.length; i++) {
            if (i < parts.length - 1) {
              segs.push({ runIndex: word.runIndex, text: parts[i], x: 0, width: word.mt(parts[i]) });
              lines.push({ segments: segs, width: word.mt(parts[i]), height: word.h, ascent: word.a });
              segs = [];
            } else {
              cur = { runIndex: word.runIndex, text: parts[i], mt: word.mt, h: word.h, a: word.a };
              lineW = 0;
              lineH = word.h; lineA = word.a;
            }
          }
        } else {
          cur = { runIndex: word.runIndex, text: word.text, mt: word.mt, h: word.h, a: word.a };
          lineH = word.h; lineA = word.a;
        }
      } else if (canWrap && wordW > maxWidth!) {
        // Single word longer than the whole line: split char-by-char.
        if (lineW > 0) commitLine();
        const parts = splitLongWord(word.text, maxWidth!, word.mt);
        for (let i = 0; i < parts.length; i++) {
          if (i < parts.length - 1) {
            segs.push({ runIndex: word.runIndex, text: parts[i], x: 0, width: word.mt(parts[i]) });
            lines.push({ segments: segs, width: word.mt(parts[i]), height: word.h, ascent: word.a });
            segs = [];
          } else {
            cur = { runIndex: word.runIndex, text: parts[i], mt: word.mt, h: word.h, a: word.a };
            lineW = 0;
            lineH = word.h; lineA = word.a;
          }
        }
      } else {
        // Place the separator space (advances lineW, not a segment) then start
        // a new in-progress segment for this word.
        lineW += spaceW;
        cur = { runIndex: word.runIndex, text: word.text, mt: word.mt, h: word.h, a: word.a };
        lineH = Math.max(lineH, word.h);
        lineA = Math.max(lineA, word.a);
      }
    }
  }
  commitLine();

  const width = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const height = lines.reduce((s, l) => s + l.height, 0);
  return { lines, width, height };
}

/** Character-by-character break of a single word longer than maxWidth. Returns
 *  the pieces (each <= maxWidth). Mirrors text-layout.ts splitLongWord but
 *  returns plain strings (geometry computed by the caller). */
function splitLongWord(word: string, maxWidth: number, mt: (s: string) => number): string[] {
  const out: string[] = [];
  let current = "";
  for (const ch of word) {
    const next = current + ch;
    if (current && mt(next) > maxWidth) {
      out.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

function normalizeRunText(text: string, mode: WhiteSpaceMode): string {
  const nl = text.replace(/\r\n?/g, "\n");
  if (mode === "pre") return nl;
  if (mode === "pre-line") return nl.replace(/[ \t\f\v]+/g, " ");
  return nl.replace(/\s+/g, " ");
}
