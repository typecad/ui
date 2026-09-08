// ---------------------------------------------------------------------------
// Interactive prompt helpers for the @typecad/ui integration wizard.
//
// Deliberately mirrors the prompt vocabulary of cuttlefish's `init` wizard
// (readline/promises + chalk, numbered selects) so the two CLIs feel the same.
// No external prompt framework — embedded installs should stay light.
// ---------------------------------------------------------------------------

import * as readline from "node:readline/promises";
import chalk from "chalk";

export type ReadlineInterface = ReturnType<typeof readline.createInterface>;

export interface PromptTextOptions {
  /** Value used when the answer is blank. Omit to require input. */
  defaultValue?: string;
  /** Allow an empty answer (returns ""). Implied when defaultValue is set. */
  allowBlank?: boolean;
  validate?: (value: string) => string | null;
}

export async function promptText(
  rl: ReadlineInterface,
  prompt: string,
  options: PromptTextOptions = {},
): Promise<string> {
  // An empty-string default is "no default" for display purposes — otherwise
  // blank-allowed prompts render a stray "()" suffix.
  const hasDefault = options.defaultValue !== undefined && options.defaultValue !== "";
  while (true) {
    const suffix = hasDefault ? ` (${options.defaultValue})` : "";
    const answer = await rl.question(`${chalk.cyan("?")} ${prompt}${suffix}: `);
    const trimmed = answer.trim();
    const value = trimmed === "" && hasDefault ? options.defaultValue! : trimmed;

    if (value === "" && !options.allowBlank && !hasDefault) {
      console.log(`  ${chalk.red("✗")} Please enter a value.`);
      continue;
    }
    if (options.validate) {
      const error = options.validate(value);
      if (error) {
        console.log(`  ${chalk.red("✗")} ${error}`);
        continue;
      }
    }
    return value;
  }
}

export interface PromptIntOptions {
  defaultValue?: number;
  /** Allow a blank answer (returns undefined). */
  allowBlank?: boolean;
  min?: number;
  max?: number;
}

export async function promptInt(
  rl: ReadlineInterface,
  prompt: string,
  options: PromptIntOptions = {},
): Promise<number | undefined> {
  const hasDefault = options.defaultValue !== undefined;
  while (true) {
    const suffix = hasDefault ? ` (${options.defaultValue})` : "";
    const answer = await rl.question(`${chalk.cyan("?")} ${prompt}${suffix}: `);
    const trimmed = answer.trim();

    if (trimmed === "" ) {
      if (options.allowBlank) return undefined;
      if (hasDefault) return options.defaultValue;
      console.log(`  ${chalk.red("✗")} Please enter a number.`);
      continue;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      console.log(`  ${chalk.red("✗")} "${trimmed}" is not a number.`);
      continue;
    }
    if (options.min !== undefined && value < options.min) {
      console.log(`  ${chalk.red("✗")} Must be ≥ ${options.min}.`);
      continue;
    }
    if (options.max !== undefined && value > options.max) {
      console.log(`  ${chalk.red("✗")} Must be ≤ ${options.max}.`);
      continue;
    }
    return value;
  }
}

export interface SelectOption<T extends string> {
  label: string;
  value: T;
  hint?: string;
}

export async function promptSelect<T extends string>(
  rl: ReadlineInterface,
  prompt: string,
  options: SelectOption<T>[],
): Promise<T> {
  console.log(`${chalk.cyan("?")} ${prompt}:`);
  for (let i = 0; i < options.length; i++) {
    const option = options[i]!;
    const hint = option.hint ? chalk.dim(` — ${option.hint}`) : "";
    console.log(`  ${chalk.dim(`${i + 1})`)} ${option.label}${hint}`);
  }

  while (true) {
    const answer = await rl.question(`  Enter number (1-${options.length}): `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx]!.value;
    }
    console.log(`  ${chalk.red("✗")} Please enter a number between 1 and ${options.length}.`);
  }
}

export async function promptConfirm(
  rl: ReadlineInterface,
  prompt: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? " (Y/n)" : " (y/N)";
  const answer = await rl.question(`${chalk.cyan("?")} ${prompt}${suffix}: `);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return defaultValue;
  return trimmed === "y" || trimmed === "yes";
}

/**
 * Create the readline interface the wizard prompts run against. Streams are
 * resolved lazily and injectable so the wizard can be driven end-to-end by
 * tests (Node's readline hangs on a second question() when stdin is a pipe
 * on some platforms, so scripted pipes are fed through a PassThrough).
 */
export function createPromptInterface(
  inputStream: NodeJS.ReadableStream = process.stdin,
  outputStream: NodeJS.WritableStream = process.stdout,
): ReadlineInterface {
  return readline.createInterface({ input: inputStream, output: outputStream });
}
