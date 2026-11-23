/**
 * Output-format classification. Machine formats (consumed by programs) keep
 * advisory stderr hints quiet unless verbose; human formats show them.
 */
import { UsageError } from './error/types';

const MACHINE_FORMATS = new Set(['json', 'ndjson', 'jsonl', 'yaml', 'yml', 'csv', 'tsv', 'xml']);

/** True for machine-oriented formats (json, yaml, csv, tsv, xml, ...). Unset = human. */
export function isMachineFormat(format?: string): boolean {
  return !!format && MACHINE_FORMATS.has(format.toLowerCase());
}

// ---------------------------------------------------------------------------
// Output flag resolution (`map`)
// ---------------------------------------------------------------------------

export type DataFormat = 'txt' | 'csv' | 'xml' | 'json';

const DATA_FORMATS: readonly DataFormat[] = ['txt', 'csv', 'xml', 'json'];

export interface FormatFlagOptions {
  format?: string;
}

export interface ResolvedFormat {
  /** Data format; undefined when the user selected none (caller defaults). */
  format?: DataFormat;
}

/**
 * Resolve `--format <fmt>` for `map`. Unknown values fail with UsageError (exit 2).
 */
export function resolveFormatFlags(opts: FormatFlagOptions): ResolvedFormat {
  if (opts.format === undefined) return {};
  const value = String(opts.format).toLowerCase();
  if ((DATA_FORMATS as readonly string[]).includes(value)) {
    return { format: value as DataFormat };
  }
  throw new UsageError(
    `invalid --format '${opts.format}' (expected one of: ${DATA_FORMATS.join(', ')})`
  );
}
