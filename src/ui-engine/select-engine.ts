// ---------------------------------------------------------------------------
// Engine selection — picks Yoga (flexbox) or BlockLayout based on whether any
// node in the styled tree declares display: flex.
// ---------------------------------------------------------------------------

import { isDisplayNone, LayoutEngine } from "./layout-engine.js";
import { BlockLayoutEngine } from "./block-layout.js";
import { YogaLayoutEngine } from "./yoga-layout.js";
import { StyledNode } from "./style-resolver.js";

/** Check if any node in the tree uses display: flex. */
function usesFlex(node: StyledNode): boolean {
  if (isDisplayNone(node)) return false;
  if (node.style.display === "flex") return true;
  return node.children.some(usesFlex);
}

/** Select the layout engine: Yoga for flex, BlockLayoutEngine as fallback. */
export function selectEngine(root: StyledNode): LayoutEngine {
  return usesFlex(root) ? new YogaLayoutEngine() : new BlockLayoutEngine();
}
