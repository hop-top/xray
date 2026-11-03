/**
 * PHP resolution: literal `require` / `include*` paths only.
 *
 * - `__DIR__ . '/x'`: `normalized` is already folded to a root-relative
 *   path; resolves when that file is scanned.
 * - Plain relative literal: tried against the including file's directory
 *   (PHP's fallback after `include_path`); resolves when that file is
 *   scanned. Absolute paths and stream wrappers never resolve.
 * - Resolved -> local + `resolved.file`; else unknown.
 *
 * Namespaces (`use`, FQN references) stay unknown: no composer psr-4 in v1.
 */

import type { ImportRecord } from '../types';
import { dirOf, inRoot, join, type FileSet, type Resolution } from './context';

export function phpResolver(files: FileSet): (r: ImportRecord, file: string) => Resolution | undefined {
  return (r, file) => {
    if (r.kind !== 'require' && r.kind !== 'include') return undefined;
    const value = r.normalized;
    if (value === null || value === '' || value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return undefined;
    const target = r.module.startsWith('__DIR__') ? inRoot(value) : inRoot(join(dirOf(file), value));
    if (target === undefined || !files.has(target)) return undefined;
    return { locality: 'local', resolved: { file: target } };
  };
}
