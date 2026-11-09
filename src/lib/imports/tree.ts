/**
 * Contract records from a tree the caller already parsed (map's parser),
 * so a file is parsed once. Same per-language extractors and ordering as
 * extractImports; no hashing, no resolution (that pass needs the file set).
 * The tree must come from the grammar grammarForExtension picks for `file`.
 */

import * as path from 'path';
import { capModules, type SyntaxNode } from './record';
import { IMPORT_LANGUAGES, importLanguageFor } from './languages';
import type { ImportRecord } from './types';

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** Contract language of a root-relative path, or undefined (not a contract language). */
export function contractLanguageOf(file: string): string | undefined {
  return importLanguageFor(path.posix.extname(file));
}

/** Records of `file` (posix, root-relative) in contract order, or undefined for a non-contract language. */
export function extractTreeImports(root: SyntaxNode, file: string): ImportRecord[] | undefined {
  const language = contractLanguageOf(file);
  if (language === undefined) return undefined;
  const records = IMPORT_LANGUAGES[language].extract(root, { path: file, language });
  capModules(records);
  return records.sort((a, b) => cmp(a.line, b.line) || cmp(a.column, b.column) || cmp(a.module, b.module));
}
