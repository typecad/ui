// ---------------------------------------------------------------------------
// Display + touch hardware catalog for the @typecad/ui integration wizard.
//
// Mirrors the built-in display profiles exported by the active framework
// (BUILT_IN_PROFILES) and the TouchLibrary union in
// @typecad/cuttlefish's display-profile.ts. The wizard asks questions and
// fills defaults from these entries; the resulting object literal is written
// into the project's typecad-hal.config.ts `display` section.
//
// Keep this catalog in sync with the framework's BUILT_IN_PROFILES when a
// display or touch library is added there.
// ---------------------------------------------------------------------------

export type WizardBus = "spi" | "i2c" | "none";
export type WizardTouchKind = "none" | "spi" | "i2c" | "analog" | "adapter" | "sdl";

export interface DisplayCatalogEntry {
  /** Catalog id — also the `display.profile` value for built-ins. */
  id: string;
  label: string;
  hint: string;
  /** Built-in profile name written to config (omitted for custom/sdl). */
  profile?: string;
  /** Driver name written when no built-in profile applies. */
  driver?: string;
  bus: WizardBus;
  /** Wizard question defaults. */
  defaults: {
    cs?: number;
    dc?: number;
    rst?: number;
    /** Backlight GPIO; undefined = don't ask, null = ask but default blank. */
    backlight?: number | null;
    /** Backlight pin the built-in profile drives when `backlight` is omitted. */
    backlightProfileDefault?: number;
    spiFrequency?: number;
    address?: number;
    width?: number;
    height?: number;
    /** Native panel size before rotation (used for capacitive touch calibration). */
    nativeWidth?: number;
    nativeHeight?: number;
    rotation?: number;
    colorOrder?: "rgb" | "bgr";
    invert?: boolean;
    antialias?: boolean;
  };
  /** A wiring note printed with the summary. */
  wiringNote?: string;
}

export const DISPLAY_CATALOG: readonly DisplayCatalogEntry[] = [
  {
    id: "ili9341-spi",
    label: "ILI9341 320×240 SPI TFT",
    hint: '2.2"–3.2" color TFT modules, often with resistive touch',
    profile: "ili9341-spi",
    bus: "spi",
    defaults: {
      // ESP32 VSPI wiring used by the repo demos and the framework profile.
      cs: 5,
      dc: 21,
      rst: 22,
      // The ILI9341 built-in profile drives backlight GPIO 17 when the config
      // omits `backlight` — surface that in the wizard's blank-answer hint.
      backlightProfileDefault: 17,
      spiFrequency: 40_000_000,
      width: 320,
      height: 240,
      rotation: 1,
      colorOrder: "rgb",
      antialias: true,
    },
    wiringNote: "Defaults assume ESP32 VSPI: SCK=18, MOSI=23, MISO=19.",
  },
  {
    id: "st7796-spi",
    label: "ST7796S 320×480 SPI TFT",
    hint: '3.5"/4" color TFT modules, often with FT6336U capacitive touch',
    profile: "st7796-spi",
    bus: "spi",
    defaults: {
      // Wiring proven on the repo's ESP32-S3 demo hardware (demos/demo-st).
      cs: 5,
      dc: 17,
      rst: 16,
      backlight: null,
      spiFrequency: 80_000_000,
      width: 480,
      height: 320,
      nativeWidth: 320,
      nativeHeight: 480,
      rotation: 1,
      colorOrder: "bgr",
      invert: false,
      antialias: true,
    },
    wiringNote:
      "Defaults assume ESP32 VSPI: SCK=18, MOSI=23, MISO=19. Adafruit_ST7796S.h comes from the" +
      " Adafruit_ST7735_and_ST7789 fork bundled in the typecode demos (demos/demo-st/lib) —" +
      " copy it into your libraries/ folder if your Library Manager copy lacks the class.",
  },
  {
    id: "ssd1309-i2c",
    label: "SSD1309 128×64 monochrome OLED (I2C)",
    hint: "1-bit OLED panels driven via the Adafruit_SSD1306 API",
    profile: "ssd1309-i2c",
    bus: "i2c",
    defaults: {
      address: 0x3c,
      width: 128,
      height: 64,
      rotation: 0,
      antialias: false,
    },
  },
  {
    id: "sdl",
    label: "Desktop simulator window (no hardware)",
    hint: "native target — renders your UI in an SDL2 window",
    driver: "sdl",
    bus: "none",
    defaults: {
      width: 320,
      height: 240,
      rotation: 0,
      antialias: true,
    },
  },
  {
    id: "custom",
    label: "Custom display — enter driver, bus, and pins manually",
    hint: "any controller not listed above",
    bus: "spi",
    defaults: {},
  },
];

export interface TouchCatalogEntry {
  /** `touch.library` value written to config (built-in libraries only). */
  id: string;
  label: string;
  hint: string;
  kind: WizardTouchKind;
  defaults: {
    cs?: number;
    irq?: number;
    i2cAddress?: number;
    i2cFrequency?: number;
    resetPin?: number;
    /** Resistive raw-ADC calibration (capacitive uses panel pixel space). */
    calibration?: { xMin: number; xMax: number; yMin: number; yMax: number };
    analogPins?: { xp: number; yp: number; xm: number; ym: number; rx: number };
  };
}

export const TOUCH_CATALOG: readonly TouchCatalogEntry[] = [
  {
    id: "none",
    label: "No touch (display only)",
    hint: "skip touch configuration",
    kind: "none",
    defaults: {},
  },
  {
    id: "XPT2046_Touchscreen",
    label: "XPT2046 resistive (SPI)",
    hint: "the resistive controller on most ILI9341 modules",
    kind: "spi",
    defaults: {
      cs: 15,
      // Typical raw-ADC range for 320×240 modules; refine per panel.
      calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
    },
  },
  {
    id: "FT6336U",
    label: "FT6336U capacitive (I2C)",
    hint: "on many ST7796S 320×480 modules",
    kind: "i2c",
    defaults: {
      i2cAddress: 0x38,
      i2cFrequency: 400_000,
    },
    // The framework's FT6336U adapter includes RAK14014_FT6336U.h.
  },
  {
    id: "GT911",
    label: "GT911 capacitive (I2C)",
    hint: "common on larger IPS panels",
    kind: "i2c",
    defaults: {
      i2cAddress: 0x5d,
      i2cFrequency: 400_000,
    },
  },
  {
    id: "CST816S",
    label: "CST816S capacitive (I2C)",
    hint: "on many compact ESP32 display boards",
    kind: "i2c",
    defaults: {
      i2cAddress: 0x15,
      i2cFrequency: 400_000,
    },
  },
  {
    id: "Adafruit_TouchScreen",
    label: "Adafruit 4-wire resistive (analog pins)",
    hint: '2.4"/2.8" Adafruit shields with XP/YP/XM/YM analog pins',
    kind: "analog",
    defaults: {
      analogPins: { xp: 24, yp: 25, xm: 26, ym: 27, rx: 300 },
      calibration: { xMin: 100, xMax: 900, yMin: 120, yMax: 900 },
    },
  },
  {
    id: "Adafruit_STMPE610",
    label: "STMPE610 resistive (SPI)",
    hint: 'Adafruit 2.8" TFT touch cape controller',
    kind: "spi",
    defaults: {
      cs: 14,
      calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
    },
  },
  {
    id: "adapter",
    label: "Custom touch adapter file",
    hint: "path to your own TypeScript adapter",
    kind: "adapter",
    defaults: {},
  },
];

/**
 * Collect GPIO collisions between the display wiring and the touch wiring so
 * the wizard can warn before writing the config (a shared pin is almost
 * always a mis-entered default rather than real hardware).
 */
export function findPinConflicts(
  displayPins: Record<string, number | undefined>,
  touchPins: Record<string, number | undefined>,
): string[] {
  const conflicts: string[] = [];
  const claimed = new Map<number, string>();
  for (const [displayKey, displayValue] of Object.entries(displayPins)) {
    if (displayValue === undefined) continue;
    claimed.set(displayValue, displayKey);
  }
  for (const [touchKey, touchValue] of Object.entries(touchPins)) {
    if (touchValue === undefined) continue;
    const owner = claimed.get(touchValue);
    if (owner !== undefined) {
      conflicts.push(
        `display.${owner} and touch.${touchKey} are both wired to GPIO ${touchValue}`,
      );
    }
  }
  return conflicts;
}
