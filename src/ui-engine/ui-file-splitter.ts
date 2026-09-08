// ---------------------------------------------------------------------------
// .ui single-file component splitter.
//
// A .ui file combines <script>, <style>, and an HTML template in one file:
//
//   <script>
//     export const count = ui.signal(0);
//   </script>
//   <style>
//     #btn { background: #3399ff; }
//   </style>
//   <screen id="home">
//     <button id="btn" on:click="increment">Tap</button>
//   </screen>
//
// splitUiFile extracts the three streams so the transpiler can feed them to the
// existing pipelines: script → TS, style → CSS, template → HTML parser. The
// blocks may appear in any order; multiple <style> blocks are concatenated.
// ---------------------------------------------------------------------------

export interface UiFileParts {
  /** The <script> block contents (TS source). Empty when absent. */
  script: string;
  /** All <style> block contents concatenated. Empty when absent. */
  style: string;
  /** The remaining HTML template (everything except script/style blocks). */
  html: string;
}

/**
 * Split a .ui single-file component into its script, style, and template parts.
 * Extracts <script> and <style> blocks (case-insensitive tags) and returns the
 * remainder as the HTML template. Multiple <style> blocks are concatenated.
 */
export function splitUiFile(src: string): UiFileParts {
  let script = "";
  const styles: string[] = [];
  // Remove script and style blocks from the source, collecting their contents.
  // The remainder is the HTML template.
  let html = src;

  // Extract <script>...</script> (first one wins; v1 supports a single block).
  html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_m, content: string) => {
    if (!script) script = content.trim();
    return "";
  });

  // Extract all <style>...</style> blocks.
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, content: string) => {
    styles.push(content.trim());
    return "";
  });

  return {
    script,
    style: styles.join("\n"),
    html: html.trim(),
  };
}
