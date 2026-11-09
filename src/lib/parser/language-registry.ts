import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { getGrammar, grammarForExtension, isLanguageEnabled, packForExtension, recordSkipped } from './grammars';
import { goDefaultName } from '../graph/go-resolver';
import { BUILTIN_RECEIVERS, BuiltinReceivers } from './builtin-receivers';
import { ImportBinding, jsImportBindings, rustImportBindings } from './import-bindings';
import type Parser from 'tree-sitter';

/**
 * How a grammar spells a call, so references can record the called name.
 * Paths: a field name, or `#first` / `#last` (first / last named child).
 *
 * Reference forms recorded:
 * - `name`      plain or scoped call (`f()`, `Foo::bar()`), or a member call
 *               whose receiver is an import-bound name (`np.array()`); an
 *               aliased repo import records its exported name (`h` -> `helper`)
 * - `.name`     member call on a value receiver (`r.run()`, `this.m()`)
 * - `pkg.name`  `qualifyImports` grammars only (Go): receiver is an import
 * - nothing     the receiver / scope chain starts at a builtin (`builtins`)
 *               or at a name bound to an external module (`bindings`)
 * Only the called name is kept; the receiver itself never is.
 */
export interface CallShape {
  /** Call node type -> path to its callee. */
  calls: Record<string, string>;
  /** Callee wrapper type (member access, scope, generics) -> path toward the name. */
  steps: Record<string, string>;
  /** Node types holding the called name. */
  leaves: string[];
  /** Member-access node type (callee wrapper or the call itself) -> path to its receiver. */
  receivers: Record<string, string>;
  /** Scoped-name node type (`a::b`, `Foo::bar()`) -> path to its qualifier. */
  scopes?: Record<string, string>;
  /** Receivers / qualifiers that are language builtins (see builtin-receivers.ts). */
  builtins?: BuiltinReceivers;
  /** Name an import binds when it has no explicit alias. */
  importName?: (source: string) => string | undefined;
  /** Record import-receiver calls as `pkg.name` (graph builder resolves them via imports). */
  qualifyImports?: boolean;
  /** Names the file's imports bind, read from its tree (grammars whose Import has no alias). */
  bindings?: (root: Parser.SyntaxNode) => ImportBinding[];
}

const JS_CALLS: CallShape = {
  calls: { call_expression: 'function' },
  steps: { member_expression: 'property' },
  leaves: ['identifier', 'property_identifier', 'private_property_identifier'],
  receivers: { member_expression: 'object' },
  bindings: jsImportBindings,
};

const KOTLIN_CALLS: CallShape = {
  calls: { call_expression: '#first' },
  steps: { navigation_expression: '#last', navigation_suffix: '#last' },
  leaves: ['simple_identifier'],
  receivers: { navigation_expression: '#first' },
};

/**
 * Call shapes by language pack name (see LANGUAGE_PACKS). Adding a grammar
 * means adding a row here. No row:
 * - bash: commands, no call expressions / method-call syntax
 * - haskell: function application only, no method-call syntax
 * - elixir: no definition tags extracted (elixir.scm has imports only)
 * Unsupported shapes (no reference recorded): calls through call results or
 * parenthesised callees (`f()()`, `(a || b)()`), Rust macros (`m!()`),
 * constructor calls (`new Foo()`), Rust turbofish paths (`Foo::<T>::bar()`).
 * Import-bound receivers are only known where an import names them
 * (explicit alias, Go package name, Python top-level module, TS/JS and Rust
 * `bindings`); elsewhere every member call is recorded as `.name`.
 */
/** Language packs sharing one call namespace (a call in one can reach the other). */
const LANGUAGE_FAMILY: Record<string, string> = { javascript: 'typescript', c: 'cpp' };

/**
 * Language a file extension (`.ts`, `.go`, ...) belongs to, for deciding
 * whether a call can reach a definition: TS/JS count as one language, C/C++
 * as one. Undefined for unknown extensions.
 */
export function languageOf(ext: string): string | undefined {
  const name = packForExtension(ext)?.name;
  return name === undefined ? undefined : (LANGUAGE_FAMILY[name] ?? name);
}

const SHAPES: Record<string, CallShape> = {
  typescript: JS_CALLS,
  javascript: JS_CALLS,
  python: {
    calls: { call: 'function' },
    steps: { attribute: 'attribute' },
    leaves: ['identifier'],
    receivers: { attribute: 'object' },
    importName: source => (source.startsWith('.') ? undefined : source.split('.')[0]),
  },
  java: {
    calls: { method_invocation: 'name' },
    steps: {},
    leaves: ['identifier'],
    receivers: { method_invocation: 'object', field_access: 'object' },
  },
  csharp: {
    calls: { invocation_expression: 'function' },
    steps: {
      member_access_expression: 'name',
      generic_name: '#first',
      conditional_access_expression: '#last',
      member_binding_expression: 'name',
    },
    leaves: ['identifier'],
    receivers: { member_access_expression: 'expression', conditional_access_expression: 'condition' },
  },
  cpp: {
    calls: { call_expression: 'function' },
    steps: { field_expression: 'field', qualified_identifier: 'name', template_method: 'name', template_function: 'name' },
    leaves: ['identifier', 'field_identifier'],
    receivers: { field_expression: 'argument' },
    scopes: { qualified_identifier: 'scope' },
  },
  c: {
    calls: { call_expression: 'function' },
    steps: { field_expression: 'field' },
    leaves: ['identifier', 'field_identifier'],
    receivers: { field_expression: 'argument' },
  },
  go: {
    calls: { call_expression: 'function' },
    steps: { selector_expression: 'field' },
    leaves: ['identifier', 'field_identifier'],
    receivers: { selector_expression: 'operand' },
    importName: goDefaultName,
    qualifyImports: true,
  },
  rust: {
    calls: { call_expression: 'function' },
    steps: { field_expression: 'field', scoped_identifier: 'name', generic_function: 'function' },
    leaves: ['identifier', 'field_identifier'],
    receivers: { field_expression: 'value' },
    scopes: { scoped_identifier: 'path' },
    bindings: rustImportBindings,
  },
  php: {
    calls: {
      function_call_expression: 'function',
      member_call_expression: 'name',
      nullsafe_member_call_expression: 'name',
      scoped_call_expression: 'name',
    },
    steps: { qualified_name: '#last' },
    leaves: ['name'],
    receivers: { member_call_expression: 'object', nullsafe_member_call_expression: 'object' },
    scopes: { scoped_call_expression: 'scope' },
  },
  ruby: {
    calls: { call: 'method' },
    steps: {},
    leaves: ['identifier', 'constant'],
    receivers: { call: 'receiver' },
    scopes: { scope_resolution: 'scope' },
  },
  swift: {
    calls: { call_expression: '#first' },
    steps: { navigation_expression: 'suffix', navigation_suffix: 'suffix' },
    leaves: ['simple_identifier'],
    receivers: { navigation_expression: 'target' },
  },
  kotlin: KOTLIN_CALLS,
  scala: {
    calls: { call_expression: 'function' },
    steps: { field_expression: 'field', generic_function: 'function' },
    leaves: ['identifier'],
    receivers: { field_expression: 'value' },
  },
};

export const CALL_SHAPES: Record<string, CallShape> = Object.fromEntries(
  Object.entries(SHAPES).map(([lang, shape]) => [lang, { ...shape, builtins: BUILTIN_RECEIVERS[lang] }]),
);

interface LanguageConfig {
  grammar: any;
  tagsQuery: string;
  importsQuery?: string;
  callShape?: CallShape;
}

// Grammars load lazily (see grammars.ts); resolved configs are cached per extension.
const resolved = new Map<string, LanguageConfig>();
// Custom queries (from config) survive until the grammar is first loaded.
const queryOverrides = new Map<string, string>();

// Helper to load queries
function loadQuery(name: string): string {
  const p = path.join(__dirname, 'queries', name);
  if (fs.existsSync(p)) {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch (err: any) {
      Logger.warn(`Failed to load query file ${name}: ${err.message}`);
      return '';
    }
  }
  return '';
}

/**
 * Config for a file extension, or undefined when the extension is unknown,
 * the language is not enabled, or its grammar is not installed. In the
 * missing-grammar case the skip is recorded (with `file`, when given) so the
 * run can report it once (see reportSkippedLanguages).
 */
export function getLanguageConfig(ext: string, file?: string): LanguageConfig | undefined {
  const pack = packForExtension(ext);
  if (!pack || !isLanguageEnabled(pack.name)) return undefined;

  const hit = resolved.get(ext);
  if (hit && getGrammar(pack.name).ok) return hit;

  const status = getGrammar(pack.name);
  if (!status.ok) {
    resolved.delete(ext);
    recordSkipped(pack.name, ext, file);
    return undefined;
  }

  // Note: we reuse tagsQuery for importsQuery for now as we added import captures to the same files
  const query = loadQuery(pack.query);
  const config: LanguageConfig = {
    grammar: grammarForExtension(status, ext),
    tagsQuery: queryOverrides.get(ext) ?? query,
    importsQuery: query,
    callShape: CALL_SHAPES[pack.name],
  };
  resolved.set(ext, config);
  return config;
}

export function updateLanguageQuery(ext: string, query: string): void {
  if (!packForExtension(ext)) {
    Logger.warn(`Warning: Cannot update query for unknown extension '${ext}'`);
    return;
  }

  if (!looksLikeTreeSitterQuery(query)) {
    Logger.warn(`Warning: Custom query for '${ext}' does not look like a tree-sitter query (no @capture); keeping default.`);
    return;
  }

  queryOverrides.set(ext, query);
  const config = resolved.get(ext);
  if (config) config.tagsQuery = query;
}

// Cheap structural sniff: a usable tree-sitter query must contain `@capture`
// patterns outside of string literals. Source files in every supported
// language fail this (a stray `"user@example.com"` is rejected because the
// quoted string is stripped first). We deliberately avoid invoking the native
// Parser.Query constructor for validation: it throws on many malformed inputs
// but segfaults on some pathological ones (e.g. raw Go source), which no JS
// try/catch can recover from.
function looksLikeTreeSitterQuery(query: string): boolean {
  if (!query || query.length === 0) return false;
  const stripped = query
    // Strip line comments — tree-sitter query (`;`), C-style (`//`).
    .replace(/;[^\n]*/g, '')
    .replace(/\/\/[^\n]*/g, '')
    // Strip block comments (covers Go/JS/Java/...).
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Strip quoted strings so embedded `@`s in source files don't count.
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`[^`]*`/g, '``');
  return stripped.includes('(') && /@[a-zA-Z_][\w.]*/.test(stripped);
}
