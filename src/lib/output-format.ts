/**
 * Output-format classification. Machine formats (consumed by programs) keep
 * advisory stderr hints quiet unless verbose; human formats show them.
 */
import { UsageError } from './error/types';
import { Logger } from './logger';

const MACHINE_FORMATS = new Set(['json', 'ndjson', 'jsonl', 'yaml', 'yml', 'csv', 'tsv', 'xml']);

/** True for machine-oriented formats (json, yaml, csv, tsv, xml, ...). Unset = human. */
export function isMachineFormat(format?: string): boolean {
  return !!format && MACHINE_FORMATS.has(format.toLowerCase());
}

// ---------------------------------------------------------------------------
// Output flag resolution (map / graph)
// ---------------------------------------------------------------------------

export type DataFormat = 'txt' | 'csv' | 'xml' | 'json';

const DATA_FORMATS: readonly DataFormat[] = ['txt', 'csv', 'xml', 'json'];

export interface FormatFlagOptions {
  format?: string;
  txt?: boolean;
  csv?: boolean;
  xml?: boolean;
  json?: boolean;
}

export interface ResolvedFormat {
  /** Data format; undefined when the user selected none (caller defaults). */
  format?: DataFormat;
}

/**
 * Fold `--format <fmt>` and the legacy per-format flags (`--json`, `--csv`,
 * `--xml`, `--txt`) into one resolved selection.
 *
 * - `--format` wins over legacy flags.
 * - Two different legacy flags (`--json --csv`) are ambiguous:
 *   UsageError (exit 2).
 * - Unknown `--format` value: UsageError listing the valid formats.
 */
export function resolveFormatFlags(opts: FormatFlagOptions): ResolvedFormat {
  const dataFlags = DATA_FORMATS.filter(n => (opts as Record<string, unknown>)[n] === true);
  if (dataFlags.length > 1) {
    throw new UsageError(
      `conflicting output flags: ${dataFlags.map(f => '--' + f).join(', ')} (choose one, or use --format <fmt>)`
    );
  }

  const resolved: ResolvedFormat = { format: dataFlags[0] };
  for (const f of dataFlags) {
    Logger.debug(`--${f} is an alias of --format ${f}`);
  }

  if (opts.format !== undefined) {
    const value = String(opts.format).toLowerCase();
    if ((DATA_FORMATS as readonly string[]).includes(value)) {
      resolved.format = value as DataFormat;
    } else {
      throw new UsageError(
        `invalid --format '${opts.format}' (expected one of: ${DATA_FORMATS.join(', ')})`
      );
    }
  }
  return resolved;
}
