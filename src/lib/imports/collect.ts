/**
 * Files for `xray imports`: one root, optionally narrowed to paths under
 * it and to contract languages. Listing is the scanner's (git ls-files,
 * else glob + .gitignore, same as `scan`) widened to the contract
 * extensions; order is posix path, byte-wise. Manifests (IMPORT_MANIFESTS)
 * anywhere under the root are always included as resolution inputs; the
 * narrowing applies to source files only. Reads only.
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateScanRoots } from '../config';
import { NotFoundError, UsageError } from '../error/types';
import { FileScanner } from '../scanner';
import type { ImportsSourceFile } from './index';
import { IMPORT_LANGUAGES, importLanguageFor } from './languages';

/**
 * Manifests resolution reads (module roots, workspaces, packages). Inputs
 * only: no language claims them, so they are not listed in `files`. Taken
 * from the whole root whatever `paths` / `languages` narrow to.
 */
export const IMPORT_MANIFESTS: readonly string[] = ['Cargo.toml', 'go.mod', 'go.work', 'package.json'];

/** Short names accepted by `--lang` besides the registry keys. */
const LANG_ALIASES: Readonly<Record<string, string>> = { js: 'javascript', ts: 'typescript', py: 'python', rs: 'rust' };

export interface CollectImportsOptions {
  /** Narrow to these files/dirs (absolute, or relative to `cwd`); each must be inside `root`. */
  paths?: readonly string[];
  /** Contract languages (registry keys or aliases); empty = all. */
  languages?: readonly string[];
  /** Base for relative `root` and `paths`; default process.cwd(). */
  cwd?: string;
}

/** `--lang` values -> registry keys (sorted, unique); unknown -> UsageError. */
export function resolveImportLanguages(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    const v = raw.trim().toLowerCase();
    if (v === '') continue;
    const key = LANG_ALIASES[v] ?? v;
    if (!Object.prototype.hasOwnProperty.call(IMPORT_LANGUAGES, key)) {
      const valid = [...Object.keys(IMPORT_LANGUAGES), ...Object.keys(LANG_ALIASES)].sort();
      throw new UsageError(`unknown --lang '${raw}' (valid: ${valid.join(', ')})`);
    }
    out.add(key);
  }
  return [...out].sort();
}

const toPosix = (p: string) => p.split(path.sep).join('/');

function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Each narrowing path as a root-relative posix prefix ('' = the whole root). */
function narrowPrefixes(rootReal: string, paths: readonly string[], cwd: string): string[] {
  return paths.map((p) => {
    const abs = path.resolve(cwd, p);
    if (!fs.existsSync(abs)) throw new NotFoundError(`Path does not exist: ${p}`);
    const rel = path.relative(rootReal, realpath(abs));
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new UsageError(`path '${p}' is outside the root ${rootReal}`);
    }
    return toPosix(rel);
  });
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Source files under `root` for extractImports, paths posix and relative
 * to `root`. Missing root or path -> NotFoundError (exit 3); a path
 * outside the root or an unknown language -> UsageError (exit 2).
 */
export function collectImportFiles(root: string, opts: CollectImportsOptions = {}): ImportsSourceFile[] {
  const cwd = opts.cwd ?? process.cwd();
  const rootAbs = path.resolve(cwd, root);
  validateScanRoots([rootAbs], 'cli');
  const rootReal = realpath(rootAbs);
  const prefixes = narrowPrefixes(rootReal, opts.paths ?? [], cwd);
  const langs = new Set(resolveImportLanguages(opts.languages ?? []));

  const sources = new Set(FileScanner.supportedExtensions());
  for (const l of Object.values(IMPORT_LANGUAGES)) for (const e of l.extensions) sources.add(e);
  const manifests = new Set(IMPORT_MANIFESTS);
  const listed = new Set([...sources, ...IMPORT_MANIFESTS.map((m) => path.extname(m))]);

  const inScope = (rel: string): boolean => {
    if (prefixes.length > 0 && !prefixes.some((p) => p === '' || rel === p || rel.startsWith(`${p}/`))) return false;
    if (langs.size === 0) return true;
    const lang = importLanguageFor(path.posix.extname(rel));
    return lang !== undefined && langs.has(lang);
  };

  const out: ImportsSourceFile[] = [];
  for (const f of new FileScanner(rootReal).scan(listed)) {
    const rel = toPosix(f);
    // Manifests are resolution inputs: kept whatever paths / --lang narrow to.
    const keep = manifests.has(path.posix.basename(rel)) || (sources.has(path.posix.extname(rel)) && inScope(rel));
    if (!keep) continue;
    let content: Buffer;
    try {
      content = fs.readFileSync(path.join(rootReal, f));
    } catch (err) {
      // Tracked but deleted in the working tree, or a submodule dir: nothing to read.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') continue;
      throw err;
    }
    out.push({ path: rel, content });
  }
  return out.sort((a, b) => cmp(a.path, b.path));
}
