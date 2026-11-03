/**
 * Imports extractor: source files -> `xray.imports/v1` document.
 *
 * Contract: schemas/xray.imports.v1.json, docs/user/imports-contract.md.
 * Languages come from ./languages (one entry per language). Files whose
 * extension no entry claims are not listed yet; a missing grammar yields
 * `status: grammar-missing`.
 */

import { createHash } from 'crypto';
import * as path from 'path';
import Parser from 'tree-sitter';
import { getGrammar, grammarForExtension } from '../parser/grammars';
import { IMPORT_LANGUAGES, importLanguageFor } from './languages';
import { IMPORTS_SCHEMA_ID, POSITIONS, type FileImports, type GrammarInfo, type ImportRecord, type ImportsDoc } from './types';

export * from './types';

/** Semver; bump on any output change for the same input (minor additive, patch fix). */
export const IMPORTS_EXTRACTOR_VERSION = '0.2.0';

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

function extractFile(
  file: ImportsSourceFile,
  language: string,
  grammars: Record<string, GrammarInfo>,
  parsers: Map<unknown, Parser>
): FileImports {
  const bytes = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const entry = { path: file.path, language, sha256 };
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
  const imports = lang.extract(tree.rootNode, { path: file.path, language }).sort(byPosition);
  return { ...entry, status: 'ok', complete: true, parseErrors: [], imports, unsupported: [] };
}

export function extractImports(files: readonly ImportsSourceFile[], opts: ExtractImportsOptions): ImportsDoc {
  const grammars: Record<string, GrammarInfo> = {};
  const parsers = new Map<unknown, Parser>();
  const out: FileImports[] = [];
  for (const f of [...files].sort((a, b) => cmp(a.path, b.path))) {
    const language = importLanguageFor(path.posix.extname(f.path));
    if (language) out.push(extractFile(f, language, grammars, parsers));
  }
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
