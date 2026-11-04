/**
 * Imports extractor: source files -> `xray.imports/v1` document.
 *
 * Contract: schemas/xray.imports.v1.json, docs/user/imports-contract.md.
 * Languages come from ./languages (one entry per language). A file whose
 * extension no entry claims is listed as `unsupported-language` when the
 * scanner's grammar catalog knows the extension (source in another
 * language), else omitted; resolution-only manifests (IMPORT_MANIFESTS) are
 * never listed. A missing grammar yields `status: grammar-missing`.
 *
 * Module strings longer than MODULE_MAX are truncated and reported as
 * `oversized-module` (record.ts capModules), before the cache.
 *
 * Per-file isolation: an exception while parsing or extracting one file
 * yields that file as `parse-error` with one whole-file `error` range and no
 * imports; the run continues.
 */

import { createHash } from 'crypto';
import * as path from 'path';
import Parser from 'tree-sitter';
import { Logger } from '../logger';
import { getGrammar, grammarForExtension, packForExtension } from '../parser/grammars';
import { IMPORT_MANIFESTS } from './collect';
import { IMPORT_LANGUAGES, importLanguageFor } from './languages';
import type { ImportsCache } from './cache';
import { capModules } from './record';
import { resolveImports } from './resolve';
import { cargoBuildScripts, endOf, parseErrors } from './unsupported';
import {
  IMPORTS_SCHEMA_ID, POSITIONS,
  type FileImports, type GrammarInfo, type ImportRecord, type ImportsDoc, type UnsupportedRecord,
} from './types';

export * from './types';

/** Semver; bump on any output change for the same input (minor additive, patch fix). */
export const IMPORTS_EXTRACTOR_VERSION = '0.6.0';

export interface ImportsSourceFile {
  /** Posix path relative to `root`. */
  path: string;
  content: string | Buffer;
}

export interface ExtractImportsOptions {
  /** Scan root as given by the caller; echoed in the document. */
  root: string;
  /** xray package version for the header. */
  xrayVersion: string;
  /** Per-file entry cache (./cache); absent = parse every file. */
  cache?: ImportsCache;
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

function byPosition(a: ImportRecord, b: ImportRecord): number {
  return cmp(a.line, b.line) || cmp(a.column, b.column) || cmp(a.module, b.module);
}

function byStart(a: UnsupportedRecord, b: UnsupportedRecord): number {
  return cmp(a.line, b.line) || cmp(a.column, b.column) || cmp(a.construct, b.construct);
}

/** Per-run state shared by file extractions. */
interface RunState {
  grammars: Record<string, GrammarInfo>;
  parsers: Map<unknown, Parser>;
  /** Cargo build scripts by path (filename rule). */
  buildScripts: Map<string, UnsupportedRecord>;
  cache: ImportsCache | undefined;
}

const bytesOf = (file: ImportsSourceFile) => (typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content);
const sha256Of = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Exceptions stop at the file: no message, stack or path leaves this
 * function. Isolation covers the cache lookup and the extraction; an entry
 * whose extraction threw is never written to the cache.
 */
function extractFile(file: ImportsSourceFile, language: string, run: RunState): FileImports {
  const bytes = bytesOf(file);
  const sha256 = sha256Of(bytes);
  const entry = { path: file.path, language, sha256 };
  try {
    const lang = IMPORT_LANGUAGES[language];
    const status = getGrammar(lang.pack);
    const grammar = grammarForExtension(status, path.posix.extname(file.path));
    if (!grammar) {
      return { ...entry, status: 'grammar-missing', complete: false, parseErrors: [], imports: [], unsupported: [] };
    }
    run.grammars[language] = { module: status.module, version: status.version ?? 'unknown', source: status.source ?? 'xray' };
    const key = { path: file.path, sha256, extractor: IMPORTS_EXTRACTOR_VERSION, language, grammar: run.grammars[language] };
    const hit = run.cache?.get(key);
    if (hit) return withBuildScript({ path: file.path, ...hit }, run);
    const result = parseFile(file, bytes, entry, grammar, run);
    if (run.cache) {
      const { path: _path, ...rest } = result;
      run.cache.set(key, rest);
    }
    return withBuildScript(result, run);
  } catch (err) {
    Logger.debug(`imports: extraction failed for ${file.path} (${err instanceof Error ? err.name : typeof err})`);
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    return {
      ...entry, status: 'parse-error', complete: false,
      parseErrors: [{ kind: 'error', start: { line: 1, column: 1 }, end: endOf(text) }],
      imports: [], unsupported: [],
    };
  }
}

/**
 * Cargo build scripts depend on the file set (Cargo.toml), not the file's
 * content, so they are applied after the cache, never stored in it.
 */
function withBuildScript(result: FileImports, run: RunState): FileImports {
  const script = result.language === 'rust' ? run.buildScripts.get(result.path) : undefined;
  if (!script) return result;
  const unsupported = [...result.unsupported, { ...script }].sort(byStart);
  return { ...result, complete: false, unsupported };
}

/** Content-only entry: depends on path, bytes, extractor and grammar (the cache key). */
function parseFile(
  file: ImportsSourceFile,
  bytes: Buffer,
  entry: Pick<FileImports, 'path' | 'language' | 'sha256'>,
  grammar: ReturnType<typeof grammarForExtension>,
  run: RunState
): FileImports {
  const { language } = entry;
  const lang = IMPORT_LANGUAGES[language];
  let parser = run.parsers.get(grammar);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(grammar);
    run.parsers.set(grammar, parser);
  }
  // A BOM is not a column in any editor; the hash above still covers it.
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const tree = parser.parse(text);
  const unsupported: UnsupportedRecord[] = [];
  const imports = lang.extract(tree.rootNode, { path: file.path, language, unsupported });
  capModules(imports, unsupported);
  imports.sort(byPosition);
  unsupported.sort(byStart);
  const errors = parseErrors(tree.rootNode);
  const fileStatus = errors.length > 0 ? 'parse-error' : 'ok';
  return { ...entry, status: fileStatus, complete: fileStatus === 'ok' && unsupported.length === 0, parseErrors: errors, imports, unsupported };
}

const MANIFESTS = new Set(IMPORT_MANIFESTS);

/** Entry for a file in a language outside the contract, or undefined when it is not source the scanner knows. */
function unclaimedFile(file: ImportsSourceFile): FileImports | undefined {
  if (MANIFESTS.has(path.posix.basename(file.path))) return undefined;
  const pack = packForExtension(path.posix.extname(file.path));
  if (!pack) return undefined;
  return {
    path: file.path, language: pack.name, sha256: sha256Of(bytesOf(file)), status: 'unsupported-language',
    complete: false, parseErrors: [], imports: [], unsupported: [],
  };
}

export function extractImports(files: readonly ImportsSourceFile[], opts: ExtractImportsOptions): ImportsDoc {
  const grammars: Record<string, GrammarInfo> = {};
  const run: RunState = { grammars, parsers: new Map(), buildScripts: cargoBuildScripts(files), cache: opts.cache };
  const out: FileImports[] = [];
  for (const f of [...files].sort((a, b) => cmp(a.path, b.path))) {
    const language = importLanguageFor(path.posix.extname(f.path));
    const entry = language ? extractFile(f, language, run) : unclaimedFile(f);
    if (entry) out.push(entry);
  }
  resolveImports(out, files);
  const sortedGrammars: Record<string, GrammarInfo> = {};
  for (const k of Object.keys(grammars).sort()) sortedGrammars[k] = grammars[k];
  return {
    schema: IMPORTS_SCHEMA_ID,
    xray: { version: opts.xrayVersion, extractor: IMPORTS_EXTRACTOR_VERSION },
    grammars: sortedGrammars,
    root: opts.root,
    positions: { ...POSITIONS },
    files: out,
    summary: {
      files: out.length,
      complete: out.filter(f => f.complete).length,
      imports: out.reduce((n, f) => n + f.imports.length, 0),
      unsupported: out.reduce((n, f) => n + f.unsupported.length, 0),
      parseErrors: out.reduce((n, f) => n + f.parseErrors.length, 0),
    },
  };
}
