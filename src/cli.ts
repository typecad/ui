#!/usr/bin/env node
// ---------------------------------------------------------------------------
// @typecad/ui CLI — display integration wizard.
//
//   npx @typecad/ui --config    Run the interactive integration wizard
//   npx @typecad/ui --help      Show usage
//   npx @typecad/ui --version   Show the installed version
// ---------------------------------------------------------------------------

import { runIntegrationWizard } from "./wizard/integration-wizard.js";

const USAGE = `
@typecad/ui — HTML/CSS-driven graphics for microcontrollers

Usage:
  npx @typecad/ui --config        Configure a display (+ touch) for your
                                  cuttlefish project interactively. Writes the
                                  \`display\` section of typecad-hal.config.ts
                                  and a \`preview\` npm script.

Options:
  --config            Run the integration wizard
  --help, -h          Show this help
  --version, -v       Print the installed @typecad/ui version

The wizard asks which display module you are using (ILI9341 / ST7796S SPI TFT,
SSD1309 I2C OLED, desktop simulator, or custom), then walks through bus pins,
SPI/I2C speed, rotation, and touch controller wiring with hardware-aware
defaults. It never touches the rest of your typecad-hal.config.ts, and adds a
\`preview\` script to package.json so the desktop preview renderer starts with
\`npm run preview\`.

Docs: https://github.com/justind000/typecode/tree/main/packages/ui
`.trim();

function printUsage(): void {
  console.log(USAGE);
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    // Lazily read the version so importing this module stays side-effect free.
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    try {
      const packageJson = JSON.parse(
        await readFile(join(dirname(dirname(fileURLToPath(import.meta.url))), "package.json"), "utf-8"),
      ) as { version?: string };
      console.log(packageJson.version ?? "unknown");
      return 0;
    } catch {
      console.log("unknown");
      return 0;
    }
  }

  if (args.length === 0 || (args.length === 1 && (args[0] === "--config" || args[0] === "config"))) {
    if (!process.stdin.isTTY) {
      console.error("The integration wizard is interactive and needs a terminal.");
      console.error("Run `npx @typecad/ui --config` from your project directory, or configure");
      console.error("the `display` section of typecad-hal.config.ts manually:");
      console.error("https://github.com/justind000/typecode/tree/main/packages/ui#display-configuration");
      return 1;
    }
    const result = await runIntegrationWizard(process.cwd());
    return result.exitCode;
  }

  console.error(`Unknown option${args.length > 1 ? "s" : ""}: ${args.join(" ")}\n`);
  printUsage();
  return 2;
}

main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
