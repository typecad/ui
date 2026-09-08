// ---------------------------------------------------------------------------
// @typecad/ui integration wizard — `npx @typecad/ui --config`.
//
// Walks the user through wiring a display (and optional touch controller)
// into their project's typecad-hal.config.ts: pick a display, answer bus/pin/
// speed questions with hardware-aware defaults, then splice the resulting
// `display` section into the config without touching any other section.
// Also adds a `preview` npm script to package.json so the desktop preview
// renderer starts via `npm run preview`. Offers to create a starter .ui entry
// file when none exists and prints the next build/flash/library steps at the
// end.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import {
  createPromptInterface,
  promptConfirm,
  promptInt,
  promptSelect,
  promptText,
  type ReadlineInterface,
} from "./prompts.js";
import {
  DISPLAY_CATALOG,
  TOUCH_CATALOG,
  findPinConflicts,
  type DisplayCatalogEntry,
  type TouchCatalogEntry,
} from "./display-catalog.js";
import {
  findTypecadConfig,
  findSyntaxError,
  readConfigSection,
  readEntryPath,
  renderDisplayProperty,
  upsertDisplaySection,
  type ConfigRecord,
} from "./config-writer.js";
import {
  findPackageJson,
  previewScriptCommand,
  readPackageScript,
  upsertPackageScript,
} from "./package-writer.js";
import { renderStarterUi } from "./starter-ui.js";

/** Keys the wizard manages — anything else found in an existing display
 *  section is carried over untouched instead of being silently dropped. */
const MANAGED_DISPLAY_KEYS: ReadonlySet<string> = new Set([
  "profile", "driver", "bus", "cs", "dc", "rst", "address", "reset",
  "backlight", "spiFrequency", "spiPins", "width", "height",
  "nativeWidth", "nativeHeight", "colorFormat", "displayClass",
  "rotation", "colorOrder", "invertDisplay", "antialias",
  "themeCss", "themeClass", "touch",
]);

function asRecord(value: unknown): ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as ConfigRecord) : {};
}

function existingNumber(section: ConfigRecord, key: string): number | undefined {
  const value = section[key];
  return typeof value === "number" ? value : undefined;
}

function existingString(section: ConfigRecord, key: string): string | undefined {
  const value = section[key];
  return typeof value === "string" ? value : undefined;
}

/** Parse "15", "0x38" into a number; undefined when not numeric. */
function parseNumeric(text: string): number | undefined {
  const trimmed = text.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(trimmed)) return parseInt(trimmed, 16);
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return undefined;
}

interface Calibration {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function asCalibration(value: unknown): Calibration | undefined {
  const record = asRecord(value);
  const { xMin, xMax, yMin, yMax } = record;
  if ([xMin, xMax, yMin, yMax].every((bound) => typeof bound === "number")) {
    return { xMin: xMin as number, xMax: xMax as number, yMin: yMin as number, yMax: yMax as number };
  }
  return undefined;
}

/** Ask the four calibration bounds, prefilled with `defaults`. */
async function promptCalibration(rl: ReadlineInterface, defaults: Calibration): Promise<Calibration> {
  return {
    xMin: (await promptInt(rl, "  xMin (raw at left edge)", { defaultValue: defaults.xMin }))!,
    xMax: (await promptInt(rl, "  xMax (raw at right edge)", { defaultValue: defaults.xMax }))!,
    yMin: (await promptInt(rl, "  yMin (raw at top edge)", { defaultValue: defaults.yMin }))!,
    yMax: (await promptInt(rl, "  yMax (raw at bottom edge)", { defaultValue: defaults.yMax }))!,
  };
}

/** SPI wiring answers, copied into the display record in a fixed key order. */
interface SpiWiring {
  cs: number;
  dc: number;
  rst: number;
  backlight?: number;
  spiFrequency: number;
  spiPins?: { mosi: number; sck: number; miso: number };
}

async function promptSpiWiring(
  rl: ReadlineInterface,
  display: DisplayCatalogEntry,
  existing: ConfigRecord,
): Promise<SpiWiring> {
  const cs = (await promptInt(rl, "CS (chip select) GPIO", {
    defaultValue: existingNumber(existing, "cs") ?? display.defaults.cs,
  }))!;
  const dc = (await promptInt(rl, "DC (data/command) GPIO", {
    defaultValue: existingNumber(existing, "dc") ?? display.defaults.dc,
  }))!;
  const rst = (await promptInt(rl, "RST (reset) GPIO", {
    defaultValue: existingNumber(existing, "rst") ?? display.defaults.rst,
  }))!;

  const backlightDefault = existingNumber(existing, "backlight");
  const backlightHint = display.defaults.backlightProfileDefault !== undefined
    ? `blank = profile default ${display.defaults.backlightProfileDefault}`
    : "blank = not controlled";
  const backlight = await promptInt(rl, `Backlight GPIO (${backlightHint})`, {
    defaultValue: backlightDefault,
    allowBlank: backlightDefault === undefined,
  });

  const defaultMhz =
    (existingNumber(existing, "spiFrequency") ?? display.defaults.spiFrequency ?? 40_000_000) / 1_000_000;
  const frequencyMhz = await promptText(rl, "SPI frequency in MHz", {
    defaultValue: String(defaultMhz),
    validate: (value) => {
      const mhz = Number(value);
      if (!Number.isFinite(mhz) || mhz <= 0 || mhz > 200) return "Enter a frequency between 1 and 200 MHz.";
      return null;
    },
  });

  let spiPins: SpiWiring["spiPins"];
  const overridePins = await promptConfirm(
    rl,
    "Override the SPI data pins (SCK/MOSI/MISO)?",
    existing.spiPins !== undefined,
  );
  if (overridePins) {
    const current = asRecord(existing.spiPins);
    const sck = (await promptInt(rl, "  SCK GPIO", { defaultValue: existingNumber(current, "sck") ?? 18 }))!;
    const mosi = (await promptInt(rl, "  MOSI GPIO", { defaultValue: existingNumber(current, "mosi") ?? 23 }))!;
    const miso = await promptInt(rl, "  MISO GPIO (blank = write-only)", {
      defaultValue: existingNumber(current, "miso"),
      allowBlank: existingNumber(current, "miso") === undefined,
    });
    spiPins = { mosi, sck, miso: miso ?? -1 };
  }

  return {
    cs,
    dc,
    rst,
    ...(backlight !== undefined ? { backlight } : {}),
    spiFrequency: Math.round(Number(frequencyMhz) * 1_000_000),
    ...(spiPins ? { spiPins } : {}),
  };
}

async function promptTouch(
  rl: ReadlineInterface,
  touchEntry: TouchCatalogEntry,
  context: { existingTouch: ConfigRecord; panelWidth: number; panelHeight: number },
): Promise<ConfigRecord> {
  const { existingTouch, panelWidth, panelHeight } = context;
  const touch: ConfigRecord = {};

  if (touchEntry.kind === "adapter") {
    touch.adapter = await promptText(rl, "Adapter file path (relative to project root)", {
      defaultValue: existingString(existingTouch, "adapter") ?? "./touch-adapter",
    });
    const identity = { xMin: 0, xMax: panelWidth, yMin: 0, yMax: panelHeight };
    const useIdentity = await promptConfirm(
      rl,
      "Use identity pixel calibration?",
      existingTouch.calibration === undefined,
    );
    touch.calibration = useIdentity ? identity : await promptCalibration(rl, asCalibration(existingTouch.calibration) ?? identity);
    return touch;
  }

  touch.library = touchEntry.id;

  if (touchEntry.kind === "spi") {
    touch.cs = (await promptInt(rl, "Touch CS GPIO", {
      defaultValue: existingNumber(existingTouch, "cs") ?? touchEntry.defaults.cs,
    }))!;
    const irq = await promptInt(rl, "Touch IRQ GPIO (blank = none)", {
      defaultValue: existingNumber(existingTouch, "irq"),
      allowBlank: existingNumber(existingTouch, "irq") === undefined,
    });
    if (irq !== undefined) touch.irq = irq;
  } else if (touchEntry.kind === "i2c") {
    const addressText = await promptText(rl, "Touch I2C address", {
      defaultValue: `0x${(existingNumber(existingTouch, "i2cAddress") ?? touchEntry.defaults.i2cAddress ?? 0x38).toString(16)}`,
      validate: (value) => (parseNumeric(value) === undefined ? "Enter an address like 0x38 or 56." : null),
    });
    touch.i2cAddress = parseNumeric(addressText)!;
    const defaultKhz =
      (existingNumber(existingTouch, "i2cFrequency") ?? touchEntry.defaults.i2cFrequency ?? 400_000) / 1000;
    const frequencyKhz = await promptText(rl, "I2C bus speed in kHz", {
      defaultValue: String(defaultKhz),
      validate: (value) => {
        const khz = Number(value);
        if (!Number.isFinite(khz) || khz <= 0 || khz > 3400) return "Enter a speed between 1 and 3400 kHz.";
        return null;
      },
    });
    touch.i2cFrequency = Math.round(Number(frequencyKhz) * 1000);
    const irq = await promptInt(rl, "Touch IRQ GPIO (blank = none)", {
      defaultValue: existingNumber(existingTouch, "irq"),
      allowBlank: existingNumber(existingTouch, "irq") === undefined,
    });
    if (irq !== undefined) touch.irq = irq;
    const resetPin = await promptInt(rl, "Touch reset GPIO (blank = none)", {
      defaultValue: existingNumber(existingTouch, "resetPin"),
      allowBlank: existingNumber(existingTouch, "resetPin") === undefined,
    });
    if (resetPin !== undefined) touch.resetPin = resetPin;
  } else if (touchEntry.kind === "analog") {
    const current = asRecord(existingTouch.analogPins);
    const defaults = touchEntry.defaults.analogPins!;
    touch.analogPins = {
      xp: (await promptInt(rl, "XP GPIO", { defaultValue: existingNumber(current, "xp") ?? defaults.xp }))!,
      yp: (await promptInt(rl, "YP GPIO", { defaultValue: existingNumber(current, "yp") ?? defaults.yp }))!,
      xm: (await promptInt(rl, "XM GPIO", { defaultValue: existingNumber(current, "xm") ?? defaults.xm }))!,
      ym: (await promptInt(rl, "YM GPIO", { defaultValue: existingNumber(current, "ym") ?? defaults.ym }))!,
      rx: (await promptInt(rl, "Rx resistance (ohms)", { defaultValue: existingNumber(current, "rx") ?? defaults.rx }))!,
    };
  }

  if (touchEntry.kind === "spi" || touchEntry.kind === "analog") {
    // Resistive controllers report raw ADC values — typical defaults exist but
    // per-panel calibration is expected sooner or later.
    const typical = touchEntry.defaults.calibration ?? { xMin: 0, xMax: 4095, yMin: 0, yMax: 4095 };
    const useTypical = await promptConfirm(
      rl,
      "Use typical raw-ADC calibration values?",
      existingTouch.calibration === undefined,
    );
    touch.calibration = useTypical
      ? typical
      : await promptCalibration(rl, asCalibration(existingTouch.calibration) ?? typical);
  } else {
    // Capacitive controllers report pixel coordinates; default to the panel's
    // native (unrotated) size — the runtime applies rotation after mapping.
    const pixel = { xMin: 0, xMax: panelWidth, yMin: 0, yMax: panelHeight };
    const useDefault = await promptConfirm(
      rl,
      `Use pixel calibration (0..${panelWidth} × 0..${panelHeight})?`,
      existingTouch.calibration === undefined,
    );
    touch.calibration = useDefault
      ? pixel
      : await promptCalibration(rl, asCalibration(existingTouch.calibration) ?? pixel);
  }

  return touch;
}

export interface WizardRunResult {
  exitCode: number;
  /** Absolute path of the config that was written, when a write happened. */
  configPath?: string;
  /** Absolute path of the package.json holding the preview script, when the
   *  script was added or already present. */
  packageJsonPath?: string;
}

/** Optional stream overrides so tests can drive the interactive flow. */
export interface WizardStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Run the interactive integration wizard. Returns a process exit code
 * (0 = wrote (or deliberately declined), 1 = blocked before writing).
 */
export async function runIntegrationWizard(
  cwd: string = process.cwd(),
  streams: WizardStreams = {},
): Promise<WizardRunResult> {
  const rl = createPromptInterface(streams.input, streams.output);
  try {
    console.log();
    console.log(chalk.cyan("⤳ @typecad/ui") + chalk.dim(" — Display Integration Wizard"));
    console.log(chalk.dim("  Configure a display + touch hardware for cuttlefish."));
    console.log();

    const configPath = findTypecadConfig(cwd);
    if (!configPath) {
      console.log(`${chalk.yellow("!")} No ${chalk.white("typecad-hal.config.ts")} found in ${chalk.dim(cwd)} (or any parent).`);
      console.log();
      console.log("  Create a cuttlefish project first, then re-run the wizard:");
      console.log();
      console.log(`    ${chalk.cyan("npx @typecad/cuttlefish init")}`);
      console.log(`    ${chalk.cyan("npx @typecad/ui --config")}`);
      console.log();
      return { exitCode: 1 };
    }

    const sourceText = fs.readFileSync(configPath, "utf-8");
    const existingDisplay = readConfigSection(sourceText, "display");
    const existing = existingDisplay ?? {};
    const existingTouch = asRecord(existing.touch);
    const entryPath = readEntryPath(sourceText);

    console.log(`${chalk.green("✓")} Config: ${chalk.white(path.relative(cwd, configPath))}`);
    if (existingDisplay) {
      console.log(chalk.dim("  An existing display section was found — answers below are prefilled from it."));
    }
    if (entryPath) {
      const entryAbs = path.resolve(path.dirname(configPath), entryPath);
      console.log(
        `${chalk.dim(`  Entry: ${entryPath} `)}${fs.existsSync(entryAbs) ? chalk.green("(exists)") : chalk.yellow("(missing — the wizard can create it)")}`,
      );
    }
    console.log();

    // --- 1. Display selection -------------------------------------------------
    const displayId = await promptSelect(
      rl,
      "Which display are you integrating?",
      DISPLAY_CATALOG.map((entry) => ({ label: entry.label, value: entry.id, hint: entry.hint })),
    );
    const displayEntry = DISPLAY_CATALOG.find((entry) => entry.id === displayId)!;

    const record: ConfigRecord = {};
    const comments: Record<string, string> = {};

    if (displayEntry.profile) {
      record.profile = displayEntry.profile;
    }

    // --- 2. Driver-specific basics ---------------------------------------------
    let customBus: "spi" | "i2c" | undefined;
    if (displayId === "custom") {
      record.driver = await promptText(rl, "Driver name", {
        defaultValue: existingString(existing, "driver") ?? "ili9341",
      });
      customBus = await promptSelect<"spi" | "i2c">(rl, "Bus", [
        { label: "SPI", value: "spi", hint: "TFT-style panels" },
        { label: "I2C", value: "i2c", hint: "small OLED/mono panels" },
      ]);
      record.width = (await promptInt(rl, "Panel width in px", {
        defaultValue: existingNumber(existing, "width") ?? 320,
      }))!;
      record.height = (await promptInt(rl, "Panel height in px", {
        defaultValue: existingNumber(existing, "height") ?? 240,
      }))!;
      const colorFormat = await promptSelect(rl, "Color format", [
        { label: "rgb565 — 16-bit color TFT", value: "rgb565" },
        { label: "rgb888 — 24-bit color", value: "rgb888" },
        { label: "mono — 1-bit monochrome", value: "mono" },
      ]);
      record.colorFormat = colorFormat;
      if (colorFormat === "mono") {
        record.displayClass = await promptSelect(rl, "Panel class", [
          { label: "oled — page-buffered OLED", value: "oled" },
          { label: "eink — bistable e-paper", value: "eink" },
        ]);
      }
    } else if (displayId === "sdl") {
      record.driver = "sdl";
      record.width = (await promptInt(rl, "Window width in px", {
        defaultValue: existingNumber(existing, "width") ?? 320,
      }))!;
      record.height = (await promptInt(rl, "Window height in px", {
        defaultValue: existingNumber(existing, "height") ?? 240,
      }))!;
      record.colorFormat = "rgb888";
    }

    // --- 3. Bus wiring ----------------------------------------------------------
    const bus = displayId === "custom" ? customBus! : displayEntry.bus;

    if (bus === "spi" && displayId !== "sdl") {
      const wiring = await promptSpiWiring(rl, displayEntry, existing);
      record.cs = wiring.cs;
      record.dc = wiring.dc;
      record.rst = wiring.rst;
      if (wiring.backlight !== undefined) record.backlight = wiring.backlight;
      record.spiFrequency = wiring.spiFrequency;
      comments.spiFrequency = "Hz — lower this if the panel glitches";
      if (wiring.spiPins) record.spiPins = wiring.spiPins;
    } else if (bus === "i2c") {
      record.bus = "I2C";
      const addressText = await promptText(rl, "I2C address", {
        defaultValue: `0x${(existingNumber(existing, "address") ?? displayEntry.defaults.address ?? 0x3c).toString(16)}`,
        validate: (value) => (parseNumeric(value) === undefined ? "Enter an address like 0x3C or 60." : null),
      });
      record.address = parseNumeric(addressText)!;
      const resetPin = await promptInt(rl, "Reset GPIO (blank = none)", {
        defaultValue: existingNumber(existing, "reset"),
        allowBlank: existingNumber(existing, "reset") === undefined,
      });
      if (resetPin !== undefined) record.reset = resetPin;
    }

    // --- 4. Orientation + rendering ---------------------------------------------
    record.rotation = (await promptInt(rl, "Rotation (0=portrait, 1=landscape, 2=180°, 3=270°)", {
      defaultValue: existingNumber(existing, "rotation") ?? displayEntry.defaults.rotation ?? 0,
      min: 0,
      max: 3,
    }))!;

    const antialias = await promptConfirm(
      rl,
      "Enable antialiased rendering (smoother text and edges, uses more RAM)?",
      existing.antialias !== undefined ? existing.antialias === true : (displayEntry.defaults.antialias ?? false),
    );
    if (antialias) record.antialias = true;

    const advanced = await promptConfirm(rl, "Configure advanced color options (color order / inversion)?", false);
    if (advanced) {
      const colorOrder = await promptSelect(rl, "Pixel color order", [
        { label: "rgb — normal", value: "rgb" },
        { label: "bgr — swapped (red and blue flipped)", value: "bgr" },
      ]);
      record.colorOrder = colorOrder;
      if (await promptConfirm(rl, "Invert display colors?", false)) {
        record.invertDisplay = true;
      }
    } else if (displayEntry.defaults.colorOrder === "bgr") {
      // ST7796S modules expect BGR — carry the proven default like the demos.
      record.colorOrder = "bgr";
    }
    if (displayEntry.defaults.invert === false && record.invertDisplay === undefined) {
      // ST7796S panels ship non-inverted; pin it so a future profile change
      // cannot silently flip colors (matches demos/demo-display).
      record.invertDisplay = false;
    }

    // --- 5. Touch ----------------------------------------------------------------
    let touchRecord: ConfigRecord | undefined;
    let touchEntry: TouchCatalogEntry | undefined;

    if (displayId === "sdl") {
      touchRecord = {
        library: "sdl",
        calibration: { xMin: 0, xMax: record.width ?? 320, yMin: 0, yMax: record.height ?? 240 },
      };
      touchEntry = TOUCH_CATALOG.find((entry) => entry.id === "none")!;
      console.log(`${chalk.cyan("?")} Touch: ${chalk.white("mouse via SDL (configured automatically)")}`);
    } else {
      const touchId = await promptSelect(
        rl,
        "Touch controller",
        TOUCH_CATALOG.map((entry) => ({ label: entry.label, value: entry.id, hint: entry.hint })),
      );
      touchEntry = TOUCH_CATALOG.find((entry) => entry.id === touchId)!;
      if (touchId !== "none") {
        touchRecord = await promptTouch(rl, touchEntry, {
          existingTouch,
          panelWidth:
            displayEntry.defaults.nativeWidth
            ?? displayEntry.defaults.width
            ?? (typeof record.width === "number" ? record.width : 320),
          panelHeight:
            displayEntry.defaults.nativeHeight
            ?? displayEntry.defaults.height
            ?? (typeof record.height === "number" ? record.height : 240),
        });
      }
    }

    // --- 6. Theme ------------------------------------------------------------------
    const themeCss = await promptText(rl, "Theme CSS file path (blank = none)", {
      defaultValue: existingString(existing, "themeCss") ?? "",
      allowBlank: true,
    });
    if (themeCss) record.themeCss = themeCss;
    const themeClass = await promptText(rl, "Theme class (e.g. dark; blank = none)", {
      defaultValue: existingString(existing, "themeClass") ?? "",
      allowBlank: true,
    });
    if (themeClass) record.themeClass = themeClass;

    // Carry over display keys the wizard does not manage (scroll, scanlineSync,
    // capabilities, …) so a re-run never silently drops user configuration.
    const carried: string[] = [];
    for (const [key, value] of Object.entries(existing)) {
      if (MANAGED_DISPLAY_KEYS.has(key) || value === undefined) continue;
      record[key] = value;
      carried.push(key);
    }

    if (touchRecord) record.touch = touchRecord;

    // --- 7. Pin conflict check -------------------------------------------------------
    const conflicts = findPinConflicts(
      {
        cs: typeof record.cs === "number" ? record.cs : undefined,
        dc: typeof record.dc === "number" ? record.dc : undefined,
        rst: typeof record.rst === "number" ? record.rst : undefined,
        backlight: typeof record.backlight === "number" ? record.backlight : undefined,
      },
      {
        cs: existingNumber(touchRecord ?? {}, "cs"),
        irq: existingNumber(touchRecord ?? {}, "irq"),
        resetPin: existingNumber(touchRecord ?? {}, "resetPin"),
      },
    );
    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        console.log(`  ${chalk.yellow("!")} ${conflict}`);
      }
      if (!(await promptConfirm(rl, "Continue with these conflicting pins anyway?", false))) {
        console.log(chalk.dim("  Aborted — nothing was written."));
        return { exitCode: 1 };
      }
    }

    // --- 8. package.json preview script ------------------------------------------
    // `npm run preview` should start the desktop preview renderer, pointing at
    // the config the wizard just verified. An existing identical script is
    // left untouched; a differing one is only replaced with consent.
    let packageJsonPath: string | undefined;
    let packageJsonText: string | undefined;
    let previewCommand: string | undefined;
    let existingPreview: string | undefined;
    let replacePreview = false;

    const foundPackageJson = findPackageJson(path.dirname(configPath));
    if (foundPackageJson) {
      try {
        packageJsonText = fs.readFileSync(foundPackageJson, "utf-8");
        existingPreview = readPackageScript(packageJsonText, "preview");
        packageJsonPath = foundPackageJson;
        previewCommand = previewScriptCommand(foundPackageJson, configPath);
      } catch (err) {
        console.log(`  ${chalk.yellow("!")} ${err instanceof Error ? err.message : String(err)} — skipping the npm preview script.`);
      }
      if (previewCommand && existingPreview !== undefined && existingPreview !== previewCommand) {
        console.log(`  ${chalk.yellow("!")} package.json already has a preview script: ${chalk.white(existingPreview)}`);
        replacePreview = await promptConfirm(rl, "Replace it with the wizard's preview command?", true);
      }
    } else {
      console.log(`${chalk.yellow("!")} No package.json found next to ${path.relative(cwd, configPath)} — skipping the npm preview script.`);
    }

    // --- 9. Summary + write -------------------------------------------------------
    console.log();
    console.log(chalk.dim("  The following display section will be written to"));
    console.log(chalk.dim(`  ${path.relative(cwd, configPath)}:`));
    console.log();
    console.log(
      renderDisplayProperty(record, { comments })
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    );
    console.log();
    if (displayEntry.wiringNote) {
      console.log(`  ${chalk.dim(displayEntry.wiringNote)}`);
    }
    if (carried.length > 0) {
      console.log(
        `  ${chalk.dim(`Kept existing display settings the wizard does not manage: ${carried.join(", ")}`)}`,
      );
    }
    if (previewCommand && packageJsonPath) {
      if (existingPreview === previewCommand) {
        console.log(`  ${chalk.dim(`npm script already configured: preview — "${previewCommand}"`)}`);
      } else if (existingPreview === undefined || replacePreview) {
        console.log(`  ${chalk.dim("Also writes npm script:")} ${chalk.white("preview")}${chalk.dim(` — "${previewCommand}"`)}`);
      } else {
        console.log(`  ${chalk.dim(`Kept existing preview script: "${existingPreview}"`)}`);
      }
    }
    console.log();

    if (!(await promptConfirm(rl, "Write this configuration?", true))) {
      console.log(chalk.dim("  Aborted — nothing was written."));
      return { exitCode: 0 };
    }

    const updated = upsertDisplaySection(sourceText, record, { comments });
    const syntaxError = findSyntaxError(updated.text);
    if (syntaxError) {
      console.log(`  ${chalk.red("✗")} Refusing to write — the edited config no longer parses: ${syntaxError}`);
      return { exitCode: 1 };
    }
    fs.writeFileSync(configPath, updated.text, "utf-8");
    console.log(
      `${chalk.green("✓")} ${updated.mode === "replaced" ? "Updated" : "Added"} the display section in ${chalk.white(path.relative(cwd, configPath))}`,
    );

    // The preview script rides along with the confirmed write: added when
    // missing, confirmed verbatim when already the wizard's command, and only
    // replaced when the user consented above.
    if (packageJsonPath && packageJsonText !== undefined && previewCommand
      && (existingPreview === undefined || existingPreview === previewCommand || replacePreview)) {
      const scriptUpsert = upsertPackageScript(packageJsonText, "preview", previewCommand);
      if (scriptUpsert.changed) {
        fs.writeFileSync(packageJsonPath, scriptUpsert.text, "utf-8");
        console.log(
          `${chalk.green("✓")} ${scriptUpsert.previous !== undefined ? "Updated" : "Added"} npm script ${chalk.white("preview")} in ${chalk.white(path.relative(cwd, packageJsonPath))}`,
        );
      } else {
        console.log(
          `${chalk.green("✓")} npm script ${chalk.white("preview")} already configured in ${chalk.white(path.relative(cwd, packageJsonPath))}`,
        );
      }
    }

    // --- 10. Starter entry file ------------------------------------------------------
    if (entryPath) {
      const entryAbs = path.resolve(path.dirname(configPath), entryPath);
      if (!fs.existsSync(entryAbs) && entryAbs.endsWith(".ui")) {
        if (await promptConfirm(rl, `Create a starter ${entryPath}?`, true)) {
          fs.mkdirSync(path.dirname(entryAbs), { recursive: true });
          fs.writeFileSync(
            entryAbs,
            renderStarterUi(
              typeof record.width === "number" ? record.width : 320,
              typeof record.height === "number" ? record.height : 240,
            ),
            "utf-8",
          );
          console.log(`${chalk.green("✓")} Created ${chalk.white(entryPath)} — open it and start editing your UI.`);
        }
      }
    }

    // --- 11. Next steps ---------------------------------------------------------------
    console.log();
    console.log(chalk.cyan("Next steps"));
    console.log();

    const firstStep = 1;
    console.log(`  ${firstStep}. Preview your UI on the desktop:`);
    console.log();
    console.log(`     ${chalk.cyan(previewCommand ? "npm run preview" : "npx @typecad/cuttlefish preview")}`);
    console.log();
    console.log(`  ${firstStep + 1}. Compile for your board:`);
    console.log();
    console.log(`     ${chalk.cyan("npx @typecad/typecad-hal build --compile")}`);
    console.log();
    console.log(`  ${firstStep + 2}. Flash it (pass --port, or set TYPECAD_HAL_PORT):`);
    console.log();
    console.log(`     ${chalk.cyan("npx @typecad/typecad-hal build --compile --upload")}`);
    console.log();

    if (touchRecord && touchRecord.library === "XPT2046_Touchscreen") {
      console.log(chalk.dim("  Touch tip: the written calibration uses typical raw-ADC values. If taps land"));
      console.log(chalk.dim("  off-target, calibrate your panel and update display.touch.calibration."));
      console.log();
    }

    return {
      exitCode: 0,
      configPath,
      ...(packageJsonPath && previewCommand ? { packageJsonPath } : {}),
    };
  } finally {
    rl.close();
  }
}
