/**
 * `xray imports [paths...]`: the `xray.imports/v1` document for one root
 * (schemas/xray.imports.v1.json, docs/user/imports-contract.md). Parses
 * only: no tags, references or graph. Reads the tree, writes stdout (or
 * `-o`) and the per-file cache outside the tree (lib/imports/cache.ts,
 * off with --no-cache); never anything under the root.
 */
import type { Command } from 'commander';
import { terminalSafe } from '../lib/terminal-safe';
import { extractImports, type FileImports, type ImportsDoc } from '../lib/imports';
import { openImportsCache } from '../lib/imports/cache';
import { collectImportFiles } from '../lib/imports/collect';
import { Logger } from '../lib/logger';
import { IMPORTS_SCHEMA_ID } from '../lib/imports/types';
import { declareEffect } from './side-effect';
import {
  adaptFormatter, addOutputFlags, assertFormat, colsRequested, columns, emit, formatterOf,
  outputRegistry, textFormatter,
} from '../lib/output';

/** Published schema for the json/yaml document (package-relative). */
export const IMPORTS_SCHEMA_PATH = 'schemas/xray.imports.v1.json';

export interface ImportsCommandOptions {
  path?: string;
  lang?: string[];
  format?: string;
  /** false with --no-cache; the per-file cache is on otherwise. */
  cache?: boolean;
  /** false with --no-ignore: list git-ignored files and nested repos too. */
  ignore?: boolean;
}

/** Table/csv columns (and the `--cols` vocabulary): one row per import record. */
export const IMPORTS_COLUMNS = columns(
  'file', 'language', 'line', 'column', 'endLine', 'endColumn', 'kind', 'form', 'module',
  'normalized', 'package', 'locality', 'alias', 'typeOnly', 'confidence', 'evidence'
);
const DEFAULT_IMPORTS_COLUMNS = columns('file', 'line', 'column', 'kind', 'form', 'module', 'normalized', 'locality');

/** Flat rows for table/csv. */
export function importRows(doc: ImportsDoc): Array<Record<string, unknown>> {
  return doc.files.flatMap(f => f.imports.map(r => ({
    file: f.path,
    language: f.language,
    line: r.line,
    column: r.column,
    endLine: r.endLine,
    endColumn: r.endColumn,
    kind: r.kind,
    form: r.form,
    module: r.module,
    normalized: r.normalized,
    package: r.package,
    locality: r.locality,
    alias: r.alias,
    typeOnly: r.typeOnly,
    confidence: r.confidence,
    evidence: r.evidence,
  })));
}

function fileHeading(f: FileImports): string {
  const state = f.complete ? f.status : `${f.status}, incomplete`;
  return `${terminalSafe(f.path)} (${f.language}, ${state})`;
}

/** Human summary: per file its imports, unsupported constructs and parse errors. */
export function renderImportsText(doc: ImportsDoc, put: (line?: string) => void): void {
  for (const f of doc.files) {
    put(fileHeading(f));
    for (const r of f.imports) {
      const target = r.normalized && r.normalized !== r.module ? ` -> ${r.normalized}` : '';
      put(`  ${r.line}:${r.column}  ${r.kind} ${r.form}  ${terminalSafe(String(r.module))}${terminalSafe(target)}  [${r.locality}]`);
    }
    for (const u of f.unsupported) {
      put(`  ${u.line}:${u.column}  unsupported ${terminalSafe(String(u.construct))}${u.detail ? `: ${terminalSafe(String(u.detail))}` : ''}`);
    }
    for (const e of f.parseErrors) put(`  ${e.start.line}:${e.start.column}  parse ${e.kind}`);
  }
  const s = doc.summary;
  put(`${s.files} files, ${s.complete} complete · ${s.imports} imports · ${s.unsupported} unsupported · ${s.parseErrors} parse errors`);
}

function buildRegistry() {
  const base = outputRegistry();
  return outputRegistry(
    adaptFormatter<ImportsDoc>(formatterOf(base, 'json'), (d) => d, true),
    adaptFormatter<ImportsDoc>(formatterOf(base, 'yaml'), (d) => d, true),
    adaptFormatter<ImportsDoc>(formatterOf(base, 'table'), importRows),
    adaptFormatter<ImportsDoc>(formatterOf(base, 'csv'), importRows),
    textFormatter<ImportsDoc>('text', (d, put) => renderImportsText(d, put))
  );
}
const importsRegistry = buildRegistry();

/** Build the document (no rendering). */
export function handleImportsAction(paths: readonly string[], options: ImportsCommandOptions): ImportsDoc {
  const root = options.path ?? '.';
  const files = collectImportFiles(root, { paths, languages: options.lang ?? [], includeIgnored: options.ignore === false });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { version } = require('../../package.json') as { version: string };
  const cache = options.cache === false ? undefined : openImportsCache(root);
  try {
    return extractImports(files, { root, xrayVersion: version, cache });
  } finally {
    if (cache) {
      cache.close();
      const s = cache.stats;
      Logger.debug(`imports cache: ${s.hits} hits, ${s.misses} misses (${s.invalid} invalid), ${s.writes} written; ${cache.file}`);
    }
  }
}

/** Commander action: build, then render through the kit format registry. */
export async function runImportsCommand(paths: string[], options: ImportsCommandOptions, cmd: Command): Promise<void> {
  assertFormat(cmd, importsRegistry);
  const doc = handleImportsAction(paths ?? [], options);
  await emit(cmd, doc, {
    registry: importsRegistry,
    columns: colsRequested(cmd) ? IMPORTS_COLUMNS : DEFAULT_IMPORTS_COLUMNS,
    defaultFormat: 'json',
  });
}

const HELP_AFTER = `Emits the ${IMPORTS_SCHEMA_ID} document (${IMPORTS_SCHEMA_PATH}): per file
its imports with 1-based line/column (UTF-16 columns), normalized module,
package and locality, plus parse errors and constructs xray cannot follow.
Languages: python, go, rust, typescript (ts), javascript (js), php.

Files are listed as \`explore\` lists them (git ls-files, else .gitignore),
relative to the root (-p, default: current directory). [paths...] narrow
the scan to files or directories inside the root (relative to the current
directory). --lang and [paths...] select the files reported; manifests
(go.mod, go.work, package.json, Cargo.toml) anywhere under the root are
always read for resolution. Parses only: no graph. Unchanged files are
read from a per-file cache in xray's cache directory (\`xray paths\`,
cache-dir/imports), never under the root; output is identical with or
without it. --no-cache parses every file and writes no cache. Cache
hits/misses show at --verbose (stderr).

--no-ignore lists every source under the root instead: git-ignored files,
nested repos and vendored dirs (node_modules, dist, build) included; only
.git is skipped. Directory symlinks are not followed. Sources in a language
outside the contract are listed with status unsupported-language, those
without an installed grammar with grammar-missing. package.json files under
node_modules are not read for resolution. The cache is keyed per file, so
both modes share it safely.

Exit 0 whenever a document is produced: parse errors and unsupported
constructs are data (\`complete: false\` on the file), not failures.
Exit 2 on usage errors (unknown --lang, a path outside the root), 3 when
the root or a path does not exist.

--format json/yaml: the whole document. table/csv: one row per import.
text: per-file summary.

Examples:
  xray imports
  xray imports -p ../svc --lang go,rust
  xray imports src/api --format table
  xray imports -o imports.json
`;

/** Register `xray imports`. */
export function registerImportsCommand(program: Command): Command {
  const cmd = program
    .command('imports')
    .description(`List every file's imports as the ${IMPORTS_SCHEMA_ID} JSON contract`)
    .argument('[paths...]', 'Files or directories inside the root to narrow the scan to')
    .option('-p, --path <root>', 'Root directory (file paths are relative to it) [default: current directory]')
    .option('--lang <list>', 'Languages to include, comma-separated: python, go, rust, typescript|ts, javascript|js, php (repeatable)',
      (value: string, previous: string[]) => previous.concat(value.split(',').map(s => s.trim()).filter(Boolean)), [])
    .option('--no-ignore', 'List every source under the root, git-ignored files, nested repos and node_modules included (.git skipped)')
    .option('--no-cache', 'Parse every file; do not read or write the per-file cache');
  addOutputFlags(cmd, importsRegistry, {
    defaultFormat: 'json',
    description: 'Output format: json, yaml, table, csv, text',
    showInHelp: ['cols', 'output'],
  });
  return declareEffect(cmd.addHelpText('after', HELP_AFTER).action(runImportsCommand), 'read', 'yes');
}
