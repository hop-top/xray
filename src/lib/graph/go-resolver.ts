/**
 * Go package resolution for the graph builder.
 *
 * Maps a Go import path to a directory inside the scanned tree using the
 * module path declared in `go.mod`. Only the single-module layout is
 * supported: `go.work` workspaces and nested `go.mod` files disable
 * resolution (see {@link detectGoModule}). Packages outside the module
 * (stdlib, third-party) never resolve.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { Import } from '../parser/types';

export interface GoModule {
  /** `module` directive of go.mod. */
  modulePath: string;
  /** Absolute directory containing go.mod. */
  moduleDir: string;
  /** Absolute scan root. */
  root: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.hg']);

function parseModulePath(goMod: string): string | null {
  const m = /^\s*module\s+(?:"([^"]+)"|`([^`]+)`|(\S+))/m.exec(goMod);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function hasNestedGoMod(dir: string, moduleDir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (hasNestedGoMod(path.join(dir, e.name), moduleDir)) return true;
    } else if (e.name === 'go.mod' && dir !== moduleDir) {
      return true;
    }
  }
  return false;
}

/**
 * Find the module governing `root` (nearest go.mod at or above it).
 * Returns null when there is none or when the layout is unsupported
 * (go.work, or another go.mod below the module root).
 */
export function detectGoModule(root: string): GoModule | null {
  const absRoot = path.resolve(root);
  let dir = absRoot;
  for (;;) {
    const goMod = path.join(dir, 'go.mod');
    if (fs.existsSync(goMod)) {
      let modulePath: string | null = null;
      try {
        modulePath = parseModulePath(fs.readFileSync(goMod, 'utf-8'));
      } catch {
        /* unreadable go.mod: treat as absent */
      }
      if (!modulePath) return null;
      if (fs.existsSync(path.join(dir, 'go.work')) || fs.existsSync(path.join(path.dirname(dir), 'go.work'))) {
        Logger.warn('go.work workspace detected: Go package-qualified call resolution is disabled');
        return null;
      }
      if (hasNestedGoMod(dir, dir)) {
        Logger.warn('Nested go.mod detected: Go package-qualified call resolution is disabled');
        return null;
      }
      return { modulePath, moduleDir: dir, root: absRoot };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Directory (posix, relative to the scan root) holding the package for
 * `importPath`, or null for packages outside the module / the scan root.
 */
export function goPackageDir(mod: GoModule, importPath: string): string | null {
  if (importPath !== mod.modulePath && !importPath.startsWith(mod.modulePath + '/')) return null;
  const rest = importPath.slice(mod.modulePath.length).replace(/^\//, '');
  const rel = path.relative(mod.root, path.join(mod.moduleDir, rest));
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/') || '.';
}

/** Package name an import binds when it has no explicit alias. */
export function goDefaultName(importPath: string): string {
  const parts = importPath.split('/');
  let last = parts[parts.length - 1];
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts[parts.length - 2];
  return last;
}

/**
 * Imports that map (through the go.mod module path) to a package directory
 * under the scan root. Blank imports (`_`) bind nothing and are dropped.
 */
export function goLocalImports(mod: GoModule, imports: Import[]): Array<{ imp: Import; dir: string }> {
  const out: Array<{ imp: Import; dir: string }> = [];
  for (const imp of imports) {
    if (imp.alias === '_') continue;
    const dir = goPackageDir(mod, imp.source);
    if (dir !== null) out.push({ imp, dir });
  }
  return out;
}

/**
 * Go file -> files of the module-local packages it imports. Files importing
 * no module-local package are absent. `dotOnly` keeps `import . "pkg"` only.
 */
export function goImportedFiles(
  mod: GoModule | null,
  importsByFile: Map<string, Import[]>,
  goFiles: string[],
  dotOnly: boolean
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!mod || importsByFile.size === 0) return out;
  const filesByDir = new Map<string, string[]>();
  for (const f of goFiles) {
    const dir = path.posix.dirname(f.split(path.sep).join('/'));
    const list = filesByDir.get(dir);
    if (list) list.push(f); else filesByDir.set(dir, [f]);
  }
  for (const [file, imports] of importsByFile) {
    const set = new Set<string>();
    for (const { imp, dir } of goLocalImports(mod, imports)) {
      if (dotOnly && imp.alias !== '.') continue;
      for (const f of filesByDir.get(dir) ?? []) if (f !== file) set.add(f);
    }
    if (set.size > 0) out.set(file, set);
  }
  return out;
}

/**
 * Go visibility: a declaration in another package is reachable only when
 * exported (upper-case initial) and not declared in a `_test.go` file (test
 * files are never part of an importable package). Same directory: always.
 */
export function goVisibleFrom(callerFile: string, declFile: string, name: string): boolean {
  const dir = (f: string) => path.posix.dirname(f.split(path.sep).join('/'));
  if (dir(callerFile) === dir(declFile)) return true;
  return /^\p{Lu}/u.test(name) && !declFile.endsWith('_test.go');
}
