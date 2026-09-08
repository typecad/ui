import type { Diagnostic } from "@typecad/cuttlefish/api/shared";

/** Tags whose content participates in inline flow inside a text container.
 *  Bare text nodes between them flow too. Recognized as inline children of a
 *  text-effective node; absorbed into the parent's run list by the resolver. */
export const INLINE_TAGS = new Set(["span", "a", "b", "strong", "i", "em", "u", "code", "kbd", "samp"]);

export type InlineItem =
  | { kind: "text"; text: string }
  | { kind: "element"; tag: string; origTag?: string; classes: string[];
      inlineStyle?: string; href?: string; inline?: InlineItem[] }
  | { kind: "break" };

/** Walk childNodes in document order, building an inline sequence.
 *
 *  Returns `undefined` when the element is NOT inline-bearing:
 *  - has any block-level child (a non-inline, non-br element) → block breaks
 *    the flow, so this element is treated as a container, not a rich-text node;
 *  - has no recognized inline element child at all → plain text, handled by the
 *    existing single-string text path.
 *
 *  Otherwise returns the ordered sequence of text fragments, inline elements
 *  (recursively), and hard-break markers (`<br>`). */
export function collectInlineSequence(el: Element, diagnostics: Diagnostic[]): InlineItem[] | undefined {
  const childElements = Array.from(el.children);
  const hasBlockChild = childElements.some(
    (c) => !INLINE_TAGS.has(c.tagName.toLowerCase()) && c.tagName.toLowerCase() !== "br",
  );
  if (hasBlockChild) return undefined;

  // Only build a sequence when there's at least one recognized inline element
  // child OR a <br> among mixed text (a <br> mid-paragraph is inline content
  // that needs the rich-text path to render as a hard line break). A node with
  // only bare text nodes (no elements, no <br>) is plain text — existing path.
  const hasInlineChild = childElements.some(
    (c) => INLINE_TAGS.has(c.tagName.toLowerCase()) || c.tagName.toLowerCase() === "br",
  );
  if (!hasInlineChild) return undefined;

  const seq: InlineItem[] = [];
  for (const child of Array.from(el.childNodes)) {
    const nodeType = (child as any).nodeType;
    if (nodeType === 3) {  // text node
      const text = child.textContent ?? "";
      if (text) seq.push({ kind: "text", text });
      continue;
    }
    const childTag = (child as Element).tagName?.toLowerCase();
    if (childTag === "br") {
      seq.push({ kind: "break" });
      continue;
    }
    if (childTag && INLINE_TAGS.has(childTag)) {
      const cel = child as Element;
      const classes = (cel.getAttribute("class") || "").split(/\s+/).filter(Boolean);
      let subInline = collectInlineSequence(cel, diagnostics);
      // A leaf inline element (only text, no nested inline children) collects
      // no sub-sequence — synthesize one text item from its text content so the
      // resolver emits a run for it. Without this, <b>world</b> would carry no
      // text and produce no run.
      if (subInline === undefined) {
        const leafText = cel.textContent ?? "";
        subInline = leafText ? [{ kind: "text" as const, text: leafText }] : [];
      }
      seq.push({
        kind: "element",
        tag: "text",
        origTag: childTag,
        classes,
        inlineStyle: cel.getAttribute("style") || undefined,
        href: childTag === "a" ? (cel.getAttribute("href") || undefined) : undefined,
        inline: subInline,
      });
    }
    // Other node types (comments, unknown elements already filtered) are ignored.
  }
  return seq;
}
