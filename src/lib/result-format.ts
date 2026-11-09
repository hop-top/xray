/**
 * `--format text|json` for commands that report what they did rather than
 * a table of records (alias set, cache clear, strategy create, ...).
 *
 * Every command accepts `--format` so a script can always ask for JSON
 * errors (see ./error/report). A command given `--format json` must also
 * succeed in JSON: its result goes to stdout as one document, and the prose
 * it would print (human lines on stdout) is skipped. Diagnostics stay on
 * stderr either way.
 *
 * Record-producing commands use `addOutputFlags` (./output) instead.
 */
import type { Command } from 'commander';
import type * as KitCompletion from '@hop-top/kit/dist/completion';
import type * as KitValues from '@hop-top/kit/dist/completion-values';
import { UsageError } from './error/types';
import { jsonErrorsEnabled } from './error/report';

export type ResultFormat = 'text' | 'json';

const RESULT_FORMATS: readonly ResultFormat[] = ['text', 'json'];

/**
 * Give `cmd` a `--format <fmt>` option (text or json). Returns `cmd`.
 * `description` overrides the help text; `values` the completion values.
 */
export function addResultFormat<C extends Command>(
  cmd: C,
  description = 'Output format: text (default) or json',
  values: readonly string[] = RESULT_FORMATS
): C {
  cmd.option('--format <fmt>', description);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindFlag } = require('@hop-top/kit/completion') as typeof KitCompletion;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { staticValues } = require('@hop-top/kit/completion-values') as typeof KitValues;
  bindFlag(cmd, 'format', staticValues(...values));
  return cmd;
}

/** The format `cmd` was given: text unless `--format json`; anything else is a usage error. */
export function resultFormat(cmd: Command): ResultFormat {
  const raw = cmd.opts().format;
  if (raw === undefined) return 'text';
  const fmt = String(raw).toLowerCase();
  if (!(RESULT_FORMATS as readonly string[]).includes(fmt)) {
    throw new UsageError(`invalid --format '${raw}' (expected one of: ${RESULT_FORMATS.join(', ')})`);
  }
  return fmt as ResultFormat;
}

/** Fail fast on a bad `--format`, before the command does any work. */
export function assertResultFormat(cmd: Command): void {
  resultFormat(cmd);
}

/** Whether `cmd` was asked for JSON. */
export function wantsJson(cmd: Command): boolean {
  return resultFormat(cmd) === 'json';
}

/**
 * Report `result`: one JSON document on stdout under `--format json`,
 * otherwise `text()` prints the command's usual lines.
 */
export function emitResult(cmd: Command, result: unknown, text: () => void): void {
  if (wantsJson(cmd)) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else text();
}

/**
 * Stdio for a child process whose own output is not the command's result
 * (npm): its stdout joins stderr when the run speaks JSON, so stdout holds
 * the document alone.
 */
export function childStdio(): 'inherit' | ['ignore', number, number] {
  return jsonErrorsEnabled() ? ['ignore', 2, 2] : 'inherit';
}
