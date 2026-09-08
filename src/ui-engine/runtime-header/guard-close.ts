// Slice of the C++ runtime header (original source lines 5770-5770).
// Closing #endif of the __TC_UI_RUNTIME guard.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitGuardClose(): string {
  return `
#endif
`;
}
