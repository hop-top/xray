import type { Cfg, Dfg } from '../flow/types';

export interface Tag {
  file: string;
  name: string;
  kind: string;
  line: number;
  endLine?: number;
  col: number;
  signature?: string; // Optional signature for functions/methods
  doc?: string; // Optional docstring
  references?: string[]; // Function names called by this tag
  cfg?: Cfg; // Control flow graph (functions/methods, `--with cf`)
  dfg?: Dfg; // Data flow graph (functions/methods, `--with df`)
}

/**
 * Map/graph import entry. Contract languages (src/lib/imports) derive it
 * from the extractor's records: `source` = record `module`, `text` = record
 * `evidence` (whitespace-collapsed statement); `line` and `kind` are set for
 * them only. Other languages come from the `.scm` `@import.*` captures.
 */
export interface Import {
  file: string;
  source: string; // The module being imported
  text?: string; // The import statement text
  alias?: string; // Local name bound by the import (Go: `alias`, `.`, `_`)
  line?: number; // 0-based start line (graph convention, like tag `line`)
  kind?: string; // Contract kind: static | require | dynamic | include
}
