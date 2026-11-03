/**
 * TS/JS resolution.
 *
 * - Node builtin (`module.builtinModules`, bare or `node:`; prefix-only
 *   builtins such as `node:test` need the prefix) -> stdlib, `node:`
 *   stripped from `normalized`.
 * - Relative / absolute specifier -> local; `resolved.file` by the graph
 *   builder's rules (exact, TS/JS extensions, `/index.*`).
 * - Bare specifier whose package is the `name` of a package.json in the
 *   tree (workspace package) -> local; `resolved.dir` = that package's
 *   directory, or `resolved.file` for a subpath that resolves by the same
 *   rules.
 * - Bare specifier declared in the nearest package.json (dependencies,
 *   devDependencies, peerDependencies, optionalDependencies) -> external.
 * - Anything else (undeclared, `#imports`, URL-like, tsconfig `paths`)
 *   stays unknown.
 */

import { builtinModules } from 'module';
import { resolveTsSpecifier, isPathSpecifier } from '../../graph/ts-specifier';
import { specifierPackage } from '../lang/ecmascript';
import type { ImportRecord } from '../types';
import { dirOf, join, type FileSet, type Resolution } from './context';

const PREFIX = 'node:';
/** Builtins importable without the prefix (`fs`) and only with it (`node:test`). */
const BARE_BUILTINS = new Set(builtinModules.filter(m => !m.startsWith(PREFIX)));
const PREFIXED_BUILTINS = new Set(builtinModules.map(m => (m.startsWith(PREFIX) ? m.slice(PREFIX.length) : m)));

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Builtin name (`node:` stripped) or undefined. */
export function nodeBuiltin(spec: string): string | undefined {
  if (spec.startsWith(PREFIX)) {
    const name = spec.slice(PREFIX.length);
    return PREFIXED_BUILTINS.has(name) ? name : undefined;
  }
  return BARE_BUILTINS.has(spec) ? spec : undefined;
}

export function ecmascriptResolver(files: FileSet): (r: ImportRecord, file: string) => Resolution | undefined {
  let workspaces: Map<string, string> | undefined;
  /** package name -> directory of the package.json naming it (first by path). */
  const workspacePackages = () => {
    if (!workspaces) {
      workspaces = new Map();
      for (const p of [...files.paths()].sort()) {
        if (p !== 'package.json' && !p.endsWith('/package.json')) continue;
        const name = files.jsonObject(p)?.name;
        if (typeof name === 'string' && name && !workspaces.has(name)) workspaces.set(name, dirOf(p));
      }
    }
    return workspaces;
  };
  const declared = new Map<string, Set<string>>();
  const declaredIn = (dir: string): Set<string> => {
    let set = declared.get(dir);
    if (!set) {
      set = new Set();
      const pkg = files.jsonObject(join(dir, 'package.json'));
      for (const field of DEP_FIELDS) {
        const deps = pkg?.[field];
        if (deps && typeof deps === 'object' && !Array.isArray(deps)) for (const k of Object.keys(deps)) set.add(k);
      }
      declared.set(dir, set);
    }
    return set;
  };

  return (r, file) => {
    const spec = r.module;
    const builtin = nodeBuiltin(spec);
    if (builtin !== undefined) return { normalized: builtin, package: builtin.split('/')[0], locality: 'stdlib' };
    if (isPathSpecifier(spec)) {
      const target = resolveTsSpecifier(file, spec, f => files.has(f));
      return { locality: 'local', resolved: target !== null ? { file: target } : undefined };
    }
    const pkg = specifierPackage(spec);
    if (pkg === undefined) return undefined;
    const dir = workspacePackages().get(pkg);
    if (dir !== undefined) {
      if (spec === pkg) return { locality: 'local', resolved: { dir: dir === '' ? '.' : dir } };
      const target = resolveTsSpecifier('', `/${join(dir, spec.slice(pkg.length + 1))}`, f => files.has(f));
      return { locality: 'local', resolved: target !== null ? { file: target } : undefined };
    }
    const manifestDir = files.nearest(dirOf(file), 'package.json');
    if (manifestDir !== undefined && declaredIn(manifestDir).has(pkg)) return { locality: 'external' };
    return undefined;
  };
}
