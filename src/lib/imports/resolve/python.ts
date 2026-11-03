/**
 * Python resolution.
 *
 * A file's package comes from the `__init__.py` chain above it: the topmost
 * directory of the chain is the top-level package, its parent the package
 * root. A chain reaching the scan root has no known name (the root's own
 * name is not part of the tree), so such files count as not in a package.
 *
 * - Relative (`relative` set, `normalized` null): absolute dotted name from
 *   the file's package, `level - 1` packages up -> local. Not in a package,
 *   or more levels than packages: stays `normalized: null`, unknown.
 * - First segment in the vendored stdlib list -> stdlib.
 * - Absolute name resolving to `<r>/a/b.py` or `<r>/a/b/__init__.py`, for
 *   r = the importing file's package root, the scan root, `src/` -> local.
 * - Else unknown.
 */

import type { ImportRecord } from '../types';
import { dirOf, join, type FileSet, type Resolution } from './context';
import { PYTHON_STDLIB } from './python-stdlib';

const INIT = '__init__.py';

interface PackageInfo {
  /** Directory above the top-level package ('' = scan root). */
  root: string;
  /** Dotted name of the file's own package. */
  name: string;
}

export function pythonResolver(files: FileSet): (r: ImportRecord, file: string) => Resolution | undefined {
  const packages = new Map<string, PackageInfo | null>();
  const packageOf = (dir: string): PackageInfo | null => {
    let info = packages.get(dir);
    if (info === undefined) {
      info = null;
      if (dir !== '' && files.has(join(dir, INIT))) {
        let top = dir;
        while (top !== '' && files.has(join(dirOf(top), INIT))) top = dirOf(top);
        // `top === ''` only when the root itself holds __init__.py: name unknown.
        if (top !== '' || !files.has(INIT)) {
          const root = dirOf(top);
          const rel = root === '' ? dir : dir.slice(root.length + 1);
          info = { root, name: rel.split('/').join('.') };
        }
      }
      packages.set(dir, info);
    }
    return info;
  };

  const locate = (dotted: string, roots: string[]): string | undefined => {
    const rel = dotted.split('.').join('/');
    for (const r of roots) {
      for (const candidate of [`${join(r, rel)}.py`, join(join(r, rel), INIT)]) if (files.has(candidate)) return candidate;
    }
    return undefined;
  };

  return (r, file) => {
    const pkg = packageOf(dirOf(file));
    let normalized = r.normalized;
    let relative = false;
    if (r.relative && normalized === null) {
      if (!pkg) return undefined;
      const segs = pkg.name.split('.');
      const up = r.relative.level - 1;
      if (up >= segs.length) return undefined;
      const base = segs.slice(0, segs.length - up).join('.');
      normalized = r.relative.module ? `${base}.${r.relative.module}` : base;
      relative = true;
    }
    if (normalized === null || normalized === '') return undefined;
    const first = normalized.split('.')[0];
    const res: Resolution = { normalized, package: first };
    if (!relative && PYTHON_STDLIB.has(first)) return { ...res, locality: 'stdlib' };
    const roots = [...new Set([...(pkg ? [pkg.root] : []), '', 'src'])];
    const target = locate(normalized, roots);
    if (target !== undefined) return { ...res, locality: 'local', resolved: { file: target } };
    return relative ? { ...res, locality: 'local' } : undefined;
  };
}
