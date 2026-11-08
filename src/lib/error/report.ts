/**
 * Machine-readable fatal errors.
 *
 * When the caller asked for JSON (`--format json`, `--format=json`, or the
 * `--json` alias on a command that has one), a failing command writes one
 * `@hop-top/kit` error envelope to stderr and leaves stdout empty. The
 * envelope is kit's own (`output/error`: code, message, exit_code,
 * transience); this module only picks the code and renders it with kit's
 * `renderError`. Text mode keeps its `✖ <message>` line.
 *
 * Stream: 12-Factor AI-CLI Apps, Factor 3 (Channel discipline) puts
 * structured errors on stderr, and kit's `renderError` doc says the same
 * ("rendered to stderr").
 */
import type { Command } from 'commander';
import type { CliError } from '@hop-top/kit/dist/output';
import { CodedError, EXIT_GENERIC } from './types';

// Legacy `node` resolution ignores kit's `exports` map (see ./types).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const kit = require('@hop-top/kit/output') as typeof import('@hop-top/kit/dist/output');

let jsonErrors = false;

/** Turn machine-readable fatal errors on or off for this process. */
export function setJsonErrors(on: boolean): void {
  jsonErrors = on;
}

/** Whether fatal errors render as a JSON envelope on stderr. */
export function jsonErrorsEnabled(): boolean {
  return jsonErrors;
}

/** Long and short spellings of every option that takes a value, tree-wide. */
export function valueOptionNames(program: Command): Set<string> {
  const names = new Set<string>();
  const walk = (cmd: Command): void => {
    for (const o of cmd.options) {
      if (!o.required && !o.optional) continue;
      if (o.long) names.add(o.long);
      if (o.short) names.add(o.short);
    }
    for (const sub of cmd.commands) walk(sub);
  };
  walk(program);
  return names;
}

/**
 * Commands whose output defaults to JSON: their errors are JSON too unless
 * a `--format` other than json says otherwise.
 */
export const JSON_DEFAULT_COMMANDS: readonly string[] = ['imports'];

/**
 * Whether argv asks for JSON output. `--format` is an option of the
 * subcommands, not of the root, so the command is not known yet: scan every
 * token up to `--`, skipping the value of any option that takes one, so
 * `--path json` or `--query --json` do not count. The last `--format`
 * wins, as in commander; `--json` is the alias on commands that define it.
 * A command in JSON_DEFAULT_COMMANDS asks for JSON unless `--format` names
 * something else.
 */
export function jsonRequested(argv: readonly string[], valueOptions: ReadonlySet<string>): boolean {
  const args = argv.slice(2);
  const end = args.indexOf('--');
  const scan = end === -1 ? args : args.slice(0, end);
  let format: string | undefined;
  let alias = false;
  let command: string | undefined;
  for (let i = 0; i < scan.length; i++) {
    const a = scan[i];
    if (!a.startsWith('-') && command === undefined) {
      command = a;
    } else if (a === '--format') {
      if (i + 1 < scan.length) format = scan[++i];
    } else if (a.startsWith('--format=')) {
      format = a.slice('--format='.length);
    } else if (a === '--json') {
      alias = true;
    } else if (valueOptions.has(a)) {
      i++;
    }
  }
  if (format === undefined && command !== undefined && JSON_DEFAULT_COMMANDS.includes(command)) return true;
  return format === 'json' || (alias && format === undefined);
}

/**
 * Kit envelope for a thrown value: a CodedError keeps its code and exit
 * code; anything else is the generic failure (exit 1). Message only: no
 * stack, no cause.
 */
export function toCliError(err: unknown): CliError {
  if (err instanceof CodedError) {
    const env = kit.wrapError(err, err.code, err.exitCode) as CliError;
    if (err.suggestedFix) env.suggested_fix = err.suggestedFix;
    if (err.alternatives && err.alternatives.length > 0) env.alternatives = [...err.alternatives];
    return env;
  }
  const message = err && (err as Error).message ? (err as Error).message : String(err);
  return kit.wrapError(message, kit.CODE_GENERIC, EXIT_GENERIC) as CliError;
}

/** Envelope for a commander parse failure (exit 2). */
export function usageEnvelope(message: string): CliError {
  return kit.usageError(message.replace(/^error: /, ''));
}

/**
 * Write `envelope` to stderr as JSON. Returns the exit code to use.
 */
export function writeEnvelope(envelope: CliError): number {
  kit.renderError(process.stderr, 'json', envelope);
  return envelope.exit_code;
}

/**
 * For a command that reports its own generic failure (log, then
 * `process.exit(1)`): in JSON mode write the envelope for `err`, otherwise
 * run `text`, the command's usual log lines. The caller still exits.
 */
export function reportFailure(err: unknown, text: () => void): void {
  if (jsonErrors) writeEnvelope(toCliError(err));
  else text();
}
