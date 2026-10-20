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
// Output flag resolution (map / scan / graph / generate)
// ---------------------------------------------------------------------------

export type DataFormat = 'txt' | 'csv' | 'xml' | 'json';
export type DiagramFormat = 'mermaid' | 'dot';

const DATA_FORMATS: readonly DataFormat[] = ['txt', 'csv', 'xml', 'json'];
const DIAGRAM_FORMATS: readonly DiagramFormat[] = ['mermaid', 'dot'];

export interface FormatFlagOptions {
  format?: string;
  txt?: boolean;
  csv?: boolean;
  xml?: boolean;
  json?: boolean;
  mermaid?: boolean;
  dot?: boolean;
}

export interface ResolvedFormat {
  /** Data format; undefined when the user selected none (caller defaults). */
  format?: DataFormat;
  /** Diagram flavour; undefined when the user selected none. */
  diagram?: DiagramFormat;
}

/**
 * Fold `--format <fmt>` and the legacy per-format flags (`--json`, `--csv`,
 * `--xml`, `--txt`, `--mermaid`, `--dot`) into one resolved selection.
 *
 * - Two axes: data (txt|csv|xml|json) and diagram (mermaid|dot); they combine
 *   (`--csv --dot` is valid), as before.
 * - `--format` wins over legacy flags on the same axis.
 * - Two different legacy flags on one axis (`--json --csv`) are ambiguous:
 *   UsageError (exit 2).
 * - Unknown `--format` value: UsageError.
 */
export function resolveFormatFlags(opts: FormatFlagOptions): ResolvedFormat {
  const pick = <T extends string>(names: readonly T[]): T[] =>
    names.filter(n => (opts as Record<string, unknown>)[n] === true);

  const dataFlags = pick(DATA_FORMATS);
  const diagramFlags = pick(DIAGRAM_FORMATS);
  if (dataFlags.length > 1) {
    throw new UsageError(
      `conflicting output flags: ${dataFlags.map(f => '--' + f).join(', ')} (choose one, or use --format <fmt>)`
    );
  }
  if (diagramFlags.length > 1) {
    throw new UsageError(
      `conflicting diagram flags: ${diagramFlags.map(f => '--' + f).join(', ')} (choose one, or use --format <fmt>)`
    );
  }

  const resolved: ResolvedFormat = { format: dataFlags[0], diagram: diagramFlags[0] };
  for (const f of [...dataFlags, ...diagramFlags]) {
    Logger.debug(`--${f} is an alias of --format ${f}`);
  }

  if (opts.format !== undefined) {
    const value = String(opts.format).toLowerCase();
    if ((DATA_FORMATS as readonly string[]).includes(value)) {
      resolved.format = value as DataFormat;
    } else if ((DIAGRAM_FORMATS as readonly string[]).includes(value)) {
      resolved.diagram = value as DiagramFormat;
    } else {
      throw new UsageError(
        `invalid --format '${opts.format}' (expected one of: ${[...DATA_FORMATS, ...DIAGRAM_FORMATS].join(', ')})`
      );
    }
  }
  return resolved;
}
