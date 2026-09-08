// ---------------------------------------------------------------------------
// Public surface of the @typecad/ui integration wizard (`npx @typecad/ui
// --config`). Pure helpers (catalog, rendering, config splicing, starter
// template) are exported for tests and tooling; the interactive flow lives in
// integration-wizard.ts.
// ---------------------------------------------------------------------------

export {
  DISPLAY_CATALOG,
  TOUCH_CATALOG,
  findPinConflicts,
} from "./display-catalog.js";
export type {
  DisplayCatalogEntry,
  TouchCatalogEntry,
  WizardBus,
  WizardTouchKind,
} from "./display-catalog.js";

export {
  findTypecadConfig,
  findSyntaxError,
  readConfigSection,
  readEntryPath,
  renderDisplayBody,
  renderDisplayProperty,
  upsertDisplaySection,
} from "./config-writer.js";
export type {
  ConfigRecord,
  RenderDisplayOptions,
  UpsertDisplayResult,
} from "./config-writer.js";

export {
  findPackageJson,
  previewScriptCommand,
  readPackageScript,
  upsertPackageScript,
} from "./package-writer.js";
export type { UpsertScriptResult } from "./package-writer.js";

export { renderStarterUi } from "./starter-ui.js";

export { runIntegrationWizard } from "./integration-wizard.js";
export type { WizardRunResult, WizardStreams } from "./integration-wizard.js";
