/**
 * Rust resolution (2018+ paths). Cargo.toml is used only as the crate-root
 * marker; its dependency tables are not read.
 *
 * Crate root: nearest Cargo.toml above the file with `src/lib.rs` or
 * `src/main.rs`; files under that `src/` (not `src/bin/`) get a module path
 * from their location (`src/a/b.rs`, `src/a/b/mod.rs` -> `crate::a::b`).
 *
 * - `crate::…` -> local; `self::…` / `super::…` rewritten to `crate::…`
 *   when the module path is known (else `normalized` stays null).
 * - `mod x;` -> `normalized` `crate::<module>::x` when known; `resolved.file`
 *   = `#[path]` (relative to the declaring file's directory) or
 *   `x.rs` / `x/mod.rs` in the child directory (the file's own directory
 *   for lib.rs / main.rs / mod.rs, else `<dir>/<stem>/`).
 * - First segment std / core / alloc / proc_macro / test -> stdlib.
 * - First segment declared by a `mod x;` in the same file -> local
 *   (`crate::…` when the module path is known).
 * - Else -> external, `package` = first segment. Inline `mod x { }` and
 *   other local items are not records, so a path rooted at one reads as
 *   external.
 */

import type { FileImports, ImportRecord } from '../types';
import { dirOf, inRoot, join, type FileSet, type Resolution } from './context';

export const RUST_STDLIB = new Set(['std', 'core', 'alloc', 'proc_macro', 'test']);

const MOD_RS = new Set(['lib.rs', 'main.rs', 'mod.rs']);
const PATH_ATTR = /#\s*\[\s*path\s*=\s*"((?:[^"\\]|\\.)*)"\s*\]/;

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function rustResolver(files: FileSet): (r: ImportRecord, f: FileImports) => Resolution | undefined {
  /** Module path segments (without `crate`) or null when the crate root is unknown. */
  const modulePath = (file: string): string[] | null => {
    const cargo = files.nearest(dirOf(file), 'Cargo.toml');
    if (cargo === undefined) return null;
    const src = join(cargo, 'src');
    if (!files.has(join(src, 'lib.rs')) && !files.has(join(src, 'main.rs'))) return null;
    if (!file.startsWith(src + '/') || file.startsWith(src + '/bin/')) return null;
    const rel = file.slice(src.length + 1).replace(/\.rs$/, '');
    if (rel === 'lib' || rel === 'main') return [];
    return rel.replace(/\/mod$/, '').split('/');
  };
  const absolute = (mp: string[] | null, rest: string[]) => (mp === null ? null : ['crate', ...mp, ...rest].join('::'));

  return (r, f) => {
    const mp = modulePath(f.path);
    const segs = r.module.split('::');
    const first = segs[0];

    if (r.form === 'mod' && r.kind === 'include') {
      const dir = dirOf(f.path);
      const attr = PATH_ATTR.exec(r.evidence)?.[1];
      const childDir = MOD_RS.has(base(f.path)) || (mp !== null && mp.length === 0) ? dir : join(dir, base(f.path).replace(/\.rs$/, ''));
      const candidates = attr !== undefined
        ? [inRoot(join(dir, attr.replace(/\\(.)/g, '$1')))]
        : [join(childDir, `${r.module}.rs`), join(childDir, `${r.module}/mod.rs`)];
      const target = candidates.find(c => c !== undefined && files.has(c));
      return { normalized: absolute(mp, [r.module]), locality: 'local', resolved: target ? { file: target } : undefined };
    }
    if (first === 'crate') return { locality: 'local' };
    if (first === 'self' || first === 'super') {
      let up = 0;
      while (segs[up] === 'super') up++;
      const rest = segs.slice(first === 'self' ? 1 : up);
      const normalized = mp === null || up > mp.length ? null : absolute(mp.slice(0, mp.length - up), rest);
      return { normalized, locality: 'local' };
    }
    if (first.startsWith('$')) return undefined;
    if (RUST_STDLIB.has(first)) return { package: first, locality: 'stdlib' };
    if (f.imports.some(m => m.form === 'mod' && m.kind === 'include' && m.module === first)) {
      return { normalized: mp === null ? r.normalized : absolute(mp, segs), package: 'crate', locality: 'local' };
    }
    return { package: first, locality: 'external' };
  };
}
