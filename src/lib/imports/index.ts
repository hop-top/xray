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
import { resolveImports } from './resolve';
import { cargoBuildScripts, endOf, parseErrors } from './unsupported';
import {
  IMPORTS_SCHEMA_ID, POSITIONS,
  type FileImports, type GrammarInfo, type ImportRecord, type ImportsDoc, type UnsupportedRecord,
} from './types';

export * from './types';

/** Semver; bump on any output change for the same input (minor additive, patch fix). */
export const IMPORTS_EXTRACTOR_VERSION = '0.3.0';

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
}

const bytesOf = (file: ImportsSourceFile) => (typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content);
const sha256Of = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Exceptions stop at the file: no message, stack or path leaves this function. */
function extractFile(file: ImportsSourceFile, language: string, run: RunState): FileImports {
  const bytes = bytesOf(file);
  const sha256 = sha256Of(bytes);
  try {
    return parseFile(file, bytes, { path: file.path, language, sha256 }, run);
  } catch (err) {
    Logger.debug(`imports: extraction failed for ${file.path} (${err instanceof Error ? err.name : typeof err})`);
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    return {
      path: file.path, language, sha256, status: 'parse-error', complete: false,
      parseErrors: [{ kind: 'error', start: { line: 1, column: 1 }, end: endOf(text) }],
      imports: [], unsupported: [],
    };
  }
}

function parseFile(
  file: ImportsSourceFile,
  bytes: Buffer,
  entry: Pick<FileImports, 'path' | 'language' | 'sha256'>,
  run: RunState
): FileImports {
  const { language } = entry;
  const { grammars, parsers } = run;
  const lang = IMPORT_LANGUAGES[language];
  const status = getGrammar(lang.pack);
  const grammar = grammarForExtension(status, path.posix.extname(file.path));
  if (!grammar) {
    return { ...entry, status: 'grammar-missing', complete: false, parseErrors: [], imports: [], unsupported: [] };
  }
  grammars[language] = { module: status.module, version: status.version ?? 'unknown', source: status.source ?? 'xray' };

  let parser = parsers.get(grammar);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(grammar);
    parsers.set(grammar, parser);
  }
  // A BOM is not a column in any editor; the hash above still covers it.
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const tree = parser.parse(text);
  const unsupported: UnsupportedRecord[] = [];
  const imports = lang.extract(tree.rootNode, { path: file.path, language, unsupported }).sort(byPosition);
  const script = language === 'rust' ? run.buildScripts.get(file.path) : undefined;
  if (script) unsupported.push({ ...script });
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
  const run: RunState = { grammars, parsers: new Map(), buildScripts: cargoBuildScripts(files) };
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
