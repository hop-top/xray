/**
 * Imports extractor: source files -> `xray.imports/v1` document.
 *
 * Contract: schemas/xray.imports.v1.json, docs/user/imports-contract.md.
 * Draft: no language extractor is wired yet, so every call returns a valid
 * document with no files.
 */

import { IMPORTS_SCHEMA_ID, POSITIONS, type ImportsDoc } from './types';

export * from './types';

/** Semver; bump on any output change for the same input (minor additive, patch fix). */
export const IMPORTS_EXTRACTOR_VERSION = '0.1.0';

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

export function extractImports(
  _files: readonly ImportsSourceFile[],
  opts: ExtractImportsOptions
): ImportsDoc {
  return {
    schema: IMPORTS_SCHEMA_ID,
    xray: { version: opts.xrayVersion, extractor: IMPORTS_EXTRACTOR_VERSION },
    grammars: {},
    root: opts.root,
    positions: { ...POSITIONS },
    files: [],
    summary: { files: 0, complete: 0, imports: 0, unsupported: 0, parseErrors: 0 },
  };
}
