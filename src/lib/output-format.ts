/**
 * Output-format classification. Machine formats (consumed by programs) keep
 * advisory stderr hints quiet unless verbose; human formats show them.
 */
const MACHINE_FORMATS = new Set(['json', 'ndjson', 'jsonl', 'yaml', 'yml', 'csv', 'tsv', 'xml']);

/** True for machine-oriented formats (json, yaml, csv, tsv, xml, ...). Unset = human. */
export function isMachineFormat(format?: string): boolean {
  return !!format && MACHINE_FORMATS.has(format.toLowerCase());
}
