/**
 * Structured command output on top of `@hop-top/kit/output`.
 *
 * Each record-producing command owns a formatter registry (kit json /
 * yaml / table / csv plus the command's own human formatter) and the
 * kit flag suite (`--format`, `--cols`, `-o/--output`, `--format-opt`,
 * `--format-help`, `--template`). Results go through kit `dispatch`.
 *
 * `--format` is declared here rather than by kit so each command keeps
 * its historical default (`text` / `table`) and help text.
 */
import * as path from 'path';
import type { Command, Option } from 'commander';
import type * as KitOutput from '@hop-top/kit/dist/output';
import type * as KitCompletion from '@hop-top/kit/dist/completion';
import type * as KitValues from '@hop-top/kit/dist/completion-values';
import { UsageError, FileWriteError } from './error/types';
import { styles, type Styles } from './tui';
import { terminalSafe } from './terminal-safe';
import { Logger } from './logger';

export type ColumnSpec = KitOutput.ColumnSpec;
export type Formatter<T = unknown> = KitOutput.Formatter<T>;
export type Registry = KitOutput.Registry;
export type Options = KitOutput.Options;

// Legacy `node` module resolution ignores kit's `exports` map; the runtime
// require goes through the exported subpath. Lazy: only output paths pay.
let kitMod: typeof KitOutput | undefined;
function kit(): typeof KitOutput {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (kitMod ??= require('@hop-top/kit/output') as typeof KitOutput);
}

/** ColumnSpec list from column names (kit requires header == key). */
export function columns(...names: string[]): ColumnSpec[] {
  return names.map((n) => ({ header: n, key: n }));
}

/** Kit flag names a command must not already own to receive the suite. */
export const OUTPUT_FLAG_NAMES = [
  'format', 'format-opt', 'format-help', 'cols', 'columns', 'template', 'output',
] as const;

/** Table/csv cell: nested values as compact JSON; strings made terminal-safe (json/yaml never pass here). */
function stringifyCell(v: unknown): unknown {
  if (typeof v === 'string') return terminalSafe(v);
  return v !== null && typeof v === 'object' ? terminalSafe(JSON.stringify(v)) : v;
}

/**
 * Wrap a row formatter (table/csv): nested values render as compact JSON
 * instead of `[object Object]`, and every resolved column exists on every
 * row (kit csv derives its header set from the first row's own keys, so an
 * optional field missing there would drop the whole column).
 */
function flatCells(f: Formatter): Formatter {
  return {
    key: f.key,
    extensions: f.extensions,
    options: f.options,
    render(out: NodeJS.WritableStream, data: unknown, opts: Options, cols: readonly string[]) {
      const rows = (Array.isArray(data) ? data : [data]).map((r) => {
        if (r === null || typeof r !== 'object') return r;
        const flat: Record<string, unknown> = {};
        for (const c of cols) flat[c] = undefined;
        for (const [k, v] of Object.entries(r as object)) flat[k] = stringifyCell(v);
        return flat;
      });
      return f.render(out, rows, opts, cols);
    },
  };
}

/**
 * New registry: kit json, yaml, table, csv, then `custom` (custom
 * formatters override built-ins with the same key).
 */
export function outputRegistry(...custom: Formatter<any>[]): Registry {
  const k = kit();
  const r = k.newRegistry();
  r.register(k.jsonFormatter);
  r.register(k.yamlFormatter);
  r.register(flatCells(k.tableFormatter));
  const csv = k.defaultRegistry.lookup('csv');
  if (csv) r.register(flatCells(csv));
  for (const f of custom) r.override(f);
  return r;
}

/** Look up a formatter on `registry`; throws when missing. */
export function formatterOf(registry: Registry, key: string): Formatter {
  const f = registry.lookup(key);
  if (!f) throw new Error(`output: formatter "${key}" not registered`);
  return f;
}

/**
 * Re-key a formatter onto a projection of the payload. `wholeDocument`
 * drops column projection so json/yaml emit the full document.
 */
export function adaptFormatter<T>(
  f: Formatter,
  project: (data: T) => unknown,
  wholeDocument = false
): Formatter<T> {
  return {
    key: f.key,
    extensions: f.extensions,
    options: f.options,
    render(out: NodeJS.WritableStream, data: unknown, opts: Options, cols: readonly string[]) {
      return f.render(out, project(data as T), opts, wholeDocument ? [] : cols);
    },
  };
}

export interface OutputFlagOptions {
  /** Format used when `--format` is absent. */
  defaultFormat: string;
  /** `--format` help text; defaults to the registry's keys. */
  description?: string;
  /** Kit flags (hidden by default) to list in `--help`, by long name. */
  showInHelp?: readonly string[];
}

/** Attach the kit output flag suite + a per-command `--format`. */
export function addOutputFlags(cmd: Command, registry: Registry, o: OutputFlagOptions): Command {
  kit().registerOutputFlags(cmd, { registry, disable: { format: true } });
  for (const name of o.showInHelp ?? []) {
    const opt = (cmd.options as Option[]).find((x) => x.long === `--${name}`);
    if (!opt) throw new Error(`addOutputFlags: no kit flag --${name}`);
    opt.hidden = false;
  }
  cmd.option(
    '--format <fmt>',
    o.description ?? `Output format: ${registry.keys().join(', ')}`,
    o.defaultFormat
  );
  // `--format <tab>` offers the registry's keys.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindFlag } = require('@hop-top/kit/completion') as typeof KitCompletion;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { staticValues } = require('@hop-top/kit/completion-values') as typeof KitValues;
  bindFlag(cmd, 'format', staticValues(...registry.keys()));
  return cmd;
}

/**
 * Fail fast (exit 2) on an unknown `--format`, before a command does any
 * work. `--format-help` and `-o <ext>` inference are left to dispatch.
 */
export function assertFormat(cmd: Command, registry: Registry): void {
  const opts = cmd.opts();
  if (opts.formatHelp !== undefined && opts.formatHelp !== false) return;
  const fmt = String(opts.format ?? '');
  if (fmt && !registry.lookup(fmt)) {
    throw new UsageError(`unknown output format "${fmt}" (valid: ${registry.keys().join(', ')})`);
  }
}

/**
 * ColumnSpec list for heterogeneous records: the union of row keys in
 * first-seen order. Kit otherwise derives columns from the first row only,
 * so a field missing there could be neither shown nor selected via --cols.
 * Undefined for non-record payloads (kept as-is).
 */
export function unionColumns(data: unknown): ColumnSpec[] | undefined {
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const names = new Set<string>();
  for (const row of data) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return undefined;
    for (const k of Object.keys(row)) names.add(k);
  }
  return columns(...names);
}

/** Whether the user passed `--cols` / `--columns`. */
export function colsRequested(cmd: Command): boolean {
  return kit().resolveCols(cmd.opts()).length > 0;
}

export interface EmitOptions {
  registry: Registry;
  columns?: readonly ColumnSpec[];
  defaultFormat: string;
}

const DOCUMENT_FORMATS = new Set(['json', 'yaml', 'xml']);
const EXT_FORMATS: Record<string, string> = { '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml' };

/**
 * Format `dispatch` will use: `--format`, else (format left at its
 * default) the `-o` file extension.
 */
function effectiveFormat(cmd: Command): string {
  const opts = cmd.opts();
  const fmt = String(opts.format ?? '');
  if (cmd.getOptionValueSource('format') === 'cli' || typeof opts.output !== 'string') return fmt;
  return EXT_FORMATS[path.extname(opts.output).toLowerCase()] ?? fmt;
}

/**
 * `--cols` selects table/csv columns. A document format (json, yaml, xml)
 * is the whole record: warn once (stderr, silenced by --quiet) and drop
 * the selection so stdout stays the complete document.
 */
function ignoreColsForDocuments(cmd: Command): void {
  if (!colsRequested(cmd) || !DOCUMENT_FORMATS.has(effectiveFormat(cmd))) return;
  Logger.warn(`--cols applies to table and csv output only; ignored for --format ${effectiveFormat(cmd)}`);
  cmd.setOptionValue('cols', undefined);
  cmd.setOptionValue('columns', undefined);
}

/**
 * Render `data` through kit dispatch. Kit raises plain Errors for bad
 * flags (unknown column, format/extension mismatch, bad --format-opt);
 * map them to UsageError so they exit 2, and output-file failures to
 * FileWriteError.
 */
export async function emit(cmd: Command, data: unknown, o: EmitOptions): Promise<void> {
  ignoreColsForDocuments(cmd);
  try {
    await kit().dispatch(cmd, data, {
      registry: o.registry,
      columns: o.columns,
      defaultFormat: o.defaultFormat,
    });
  } catch (err) {
    const e = err as Error;
    const m = /^open output "(.*)": /.exec(e.message ?? '');
    if (m) throw new FileWriteError(m[1], e);
    throw new UsageError(e.message ?? String(err), e);
  }
}

const PLAIN: Styles = {
  accent: (s) => s, muted: (s) => s, success: (s) => s,
  error: (s) => s, warn: (s) => s, bold: (s) => s,
};

/** Painters for a formatter's destination: never style a file. */
export function stylesFor(out: NodeJS.WritableStream): Styles {
  return out === process.stdout ? styles(process.stdout) : PLAIN;
}

/** Line writer for human formatters (console.log semantics). */
export function lineWriter(out: NodeJS.WritableStream): (line?: string) => void {
  return (line = '') => {
    out.write(line + '\n');
  };
}

/** Build a human formatter that renders through a line writer. */
export function textFormatter<T>(
  key: string,
  render: (data: T, put: (line?: string) => void, s: Styles) => void
): Formatter<T> {
  return {
    key,
    extensions: key === 'text' ? ['.txt'] : [],
    options: [],
    render(out: NodeJS.WritableStream, data: unknown) {
      render(data as T, lineWriter(out), stylesFor(out));
    },
  };
}
