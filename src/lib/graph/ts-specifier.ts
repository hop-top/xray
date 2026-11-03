/**
 * TS/JS relative specifier resolution against a known file set, shared by
 * the graph builder (`imports` edges) and the imports contract resolver.
 *
 * Only relative (`.`, `..`) and absolute (`/`, read as root-relative)
 * specifiers resolve: exact path, then common TS/JS extensions, then
 * `/index.*`. No alias / tsconfig-paths / package.json `exports` handling.
 */
import * as path from 'path';

export const TS_SPECIFIER_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;
export const TS_INDEX_SUFFIXES = TS_SPECIFIER_EXTENSIONS.map(e => `/index${e}`);

/** True for specifiers this resolver handles (relative or absolute). */
export function isPathSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

/**
 * Root-relative posix path `specifier` names from `fromFile`, or null when
 * it is not a path specifier or no candidate is in `has`.
 */
export function resolveTsSpecifier(fromFile: string, specifier: string, has: (file: string) => boolean): string | null {
  if (!isPathSpecifier(specifier)) return null;
  const fromDir = path.posix.dirname(fromFile.split(path.sep).join('/'));
  const spec = specifier.split(path.sep).join('/');
  const base = spec.startsWith('/')
    ? path.posix.normalize(spec.slice(1))
    : path.posix.normalize(path.posix.join(fromDir, spec));
  if (has(base)) return base;
  for (const ext of TS_SPECIFIER_EXTENSIONS) if (has(base + ext)) return base + ext;
  for (const idx of TS_INDEX_SUFFIXES) if (has(base + idx)) return base + idx;
  return null;
}
