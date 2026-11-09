/**
 * `xray.imports/v1` contract types.
 *
 * Mirrors schemas/xray.imports.v1.json; __tests__/imports/schema.test.ts
 * asserts every enum and every field set here equals the schema. Change both
 * together, additive-only within v1 (docs/user/imports-contract.md).
 */

export const IMPORTS_SCHEMA_ID = 'xray.imports/v1' as const;

/** Closed: a new kind is a breaking change (v2). */
export const IMPORT_KINDS = ['static', 'require', 'dynamic', 'include', 'reference'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const LOCALITIES = ['stdlib', 'local', 'external', 'unknown'] as const;
export type Locality = (typeof LOCALITIES)[number];

/** `inferred`: Rust path roots without a leading `::` (heuristic). */
export const CONFIDENCES = ['syntactic', 'inferred'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const FILE_STATUSES = ['ok', 'parse-error', 'grammar-missing', 'unsupported-language'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const UNSUPPORTED_CONSTRUCTS = [
  // Go
  'linkname', 'cgo', 'plugin',
  // Rust
  'build-script', 'include-macro', 'include-data',
  // PHP (eval shared with TS/JS and Python)
  'eval', 'dynamic-include', 'dynamic-new', 'dynamic-static-call',
  // TS/JS (dynamic-import shared with Python)
  'dynamic-require', 'dynamic-import', 'create-require',
  // Python
  'exec', 'sys-path',
  // PHP, additive: variable functions, call_user_func* with a non-literal callable
  'dynamic-call',
  // All languages, additive: a module string longer than MODULE_MAX, truncated
  'oversized-module',
  // TS/JS and Go, additive: a module string with an escape the language rejects (`normalized` null)
  'invalid-escape',
] as const;
export type UnsupportedConstruct = (typeof UNSUPPORTED_CONSTRUCTS)[number];

export const PARSE_ERROR_KINDS = ['error', 'missing'] as const;
export type ParseErrorKind = (typeof PARSE_ERROR_KINDS)[number];

export const POSITIONS = { line: '1-based', column: '1-based, UTF-16 code units' } as const;

/**
 * Initial `form` values. Open list: a new form is additive, so the schema
 * types `form` as a string and consumers must accept unknown forms.
 */
export const KNOWN_IMPORT_FORMS = [
  'import', 'from', 'export-from', 'import-equals', 'import-type',
  'use', 'group-use', 'use-function', 'use-const', 'extern-crate', 'mod',
  'require', 'import()', '__import__', 'import_module',
  'require_once', 'include', 'include_once', 'path-root', 'fqn',
] as const;
export type ImportForm = (typeof KNOWN_IMPORT_FORMS)[number] | (string & {});

export interface Position {
  line: number;
  column: number;
}

export interface ImportName {
  name: string;
  alias?: string;
}

/** Python relative import: `from ..pkg.mod` = { level: 2, module: 'pkg.mod' }. */
export interface RelativeRef {
  level: number;
  module?: string;
}

export type Resolved = { file: string } | { dir: string };

export interface ImportRecord {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  kind: ImportKind;
  form: ImportForm;
  /** As written, lexically cleaned (quotes, whitespace, leading `\` / `::`). */
  module: string;
  /** Canonical absolute id; null when not derivable. */
  normalized: string | null;
  package?: string;
  locality: Locality;
  relative?: RelativeRef;
  alias?: string;
  names?: ImportName[];
  wildcard?: boolean;
  typeOnly?: boolean;
  resolved?: Resolved;
  confidence: Confidence;
  /** kind `reference` only. */
  occurrences?: number;
  /** Statement text, whitespace-collapsed, at most 240 code points. */
  evidence: string;
}

export interface UnsupportedRecord {
  line: number;
  column: number;
  construct: UnsupportedConstruct;
  detail?: string;
  evidence: string;
}

export interface ParseError {
  kind: ParseErrorKind;
  start: Position;
  end: Position;
}

export interface FileImports {
  /** Posix, relative to root. */
  path: string;
  language: string;
  sha256: string;
  status: FileStatus;
  /** status `ok` and `unsupported` empty. */
  complete: boolean;
  parseErrors: ParseError[];
  imports: ImportRecord[];
  unsupported: UnsupportedRecord[];
}

export interface GrammarInfo {
  module: string;
  version: string;
  source: string;
}

export interface ImportsSummary {
  files: number;
  complete: number;
  imports: number;
  unsupported: number;
  parseErrors: number;
}

export interface ImportsDoc {
  schema: typeof IMPORTS_SCHEMA_ID;
  xray: { version: string; extractor: string };
  grammars: Record<string, GrammarInfo>;
  root: string;
  positions: typeof POSITIONS;
  files: FileImports[];
  summary: ImportsSummary;
}
