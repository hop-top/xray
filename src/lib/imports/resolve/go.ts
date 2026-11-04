/**
 * Go resolution with the graph's go.mod / go.work rules (go-resolver), fed
 * from the scanned file set instead of the filesystem.
 *
 * - Path under a module of the tree (longest module path; a go.work at or
 *   above the file narrows the set to its `use` entries) -> local,
 *   `package` = module path, `resolved.dir` when the package directory
 *   holds a scanned `.go` file.
 * - First element without a dot -> stdlib, `package` = first element.
 *   `C` (cgo pseudo-package) is not stdlib: unknown.
 * - Longest `require` module path of the file's own go.mod -> external,
 *   `package` = that module path (prefix lookup, longestRequire).
 * - Else unknown.
 */

import * as path from 'path';
import { goPackageDir, ownerModuleDir, parseGoModRequires, parseGoWorkUses, parseModulePath, type GoModule, type GoModules } from '../../graph/go-resolver';
import type { ImportRecord } from '../types';
import { dirOf, join, type FileSet, type Resolution } from './context';

/**
 * Absolute stand-in for the scan root: go-resolver works on absolute dirs;
 * nothing is read from it. A go.work `use ../x` lands outside it.
 */
const VROOT = path.resolve(path.sep, '__xray_scan_root__');
const abs = (dir: string) => (dir === '' ? VROOT : path.join(VROOT, ...dir.split('/')));

/** Work counter for tests: `require` lookups made while matching. */
export interface GoResolveStats { requireProbes: number }

/**
 * Longest require module path that is `ip` or a `/`-prefix of it: one set
 * lookup per prefix of `ip` ending at a `/`, longest first. O(path depth)
 * per record, whatever the number of requires.
 */
function longestRequire(reqs: Set<string> | undefined, ip: string, stats?: GoResolveStats): string | undefined {
  if (!reqs || reqs.size === 0) return undefined;
  for (let end = ip.length; end > 0; end = ip.lastIndexOf('/', end - 1)) {
    if (stats) stats.requireProbes++;
    const prefix = ip.slice(0, end);
    if (reqs.has(prefix)) return prefix;
  }
  return undefined;
}

export function goResolver(files: FileSet, stats?: GoResolveStats): (r: ImportRecord, file: string) => Resolution | undefined {
  const all: GoModule[] = [];
  const requires = new Map<string, Set<string>>();
  for (const p of [...files.paths()].sort()) {
    if (p !== 'go.mod' && !p.endsWith('/go.mod')) continue;
    const text = files.text(p) ?? '';
    const modulePath = parseModulePath(text);
    if (modulePath) all.push({ modulePath, moduleDir: abs(dirOf(p)) });
    requires.set(abs(dirOf(p)), new Set(parseGoModRequires(text)));
  }
  const moduleDirs = all.map(m => m.moduleDir);
  const sets = new Map<string, GoModules>();
  /** Module set for a file: its go.work's `use` entries, else every go.mod of the tree. */
  const modulesFor = (dir: string): GoModules => {
    const workDir = files.nearest(dir, 'go.work');
    const key = workDir ?? '\0';
    let mods = sets.get(key);
    if (!mods) {
      let modules = all;
      if (workDir !== undefined) {
        const uses = parseGoWorkUses(files.text(join(workDir, 'go.work')) ?? '', abs(workDir));
        modules = all.filter(m => uses.has(m.moduleDir));
      }
      modules = [...modules].sort((a, b) => b.modulePath.length - a.modulePath.length);
      mods = { root: VROOT, modules, moduleDirs };
      sets.set(key, mods);
    }
    return mods;
  };
  const goDirs = new Set([...files.paths()].filter(p => p.endsWith('.go')).map(dirOf));

  return (r, file) => {
    // `module` is as written; `normalized` the decoded path (null: a bad escape).
    const ip = r.normalized;
    if (ip === null || ip === '') return undefined;
    const mods = modulesFor(dirOf(file));
    const mod = mods.modules.find(m => ip === m.modulePath || ip.startsWith(m.modulePath + '/'));
    if (mod) {
      const dir = goPackageDir(mods, ip);
      const target = dir === null ? undefined : dir === '.' ? '' : dir;
      return {
        package: mod.modulePath,
        locality: 'local',
        resolved: target !== undefined && goDirs.has(target) ? { dir: target === '' ? '.' : target } : undefined,
      };
    }
    const first = ip.split('/')[0];
    if (ip === 'C') return undefined;
    if (!first.includes('.')) return { package: first, locality: 'stdlib' };
    const owner = ownerModuleDir(mods, abs(dirOf(file)));
    const req = owner === null ? undefined : longestRequire(requires.get(owner), ip, stats);
    if (req) return { package: req, locality: 'external' };
    return undefined;
  };
}
