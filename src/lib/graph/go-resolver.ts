/**
 * Go package resolution for the graph builder.
 *
 * Maps a Go import path to a directory inside the scanned tree using the
 * module paths declared in `go.mod` files. Multi-module layouts are
 * supported: each file belongs to its nearest enclosing go.mod, an import
 * maps to the module with the longest matching module path, and a `go.work`
 * at or above the root narrows the module set to its `use` entries.
 * Packages outside every module (stdlib, third-party) never resolve.
 */
import * as fs from 'fs';
import { readTextSafe } from '../safe-read';
import * as path from 'path';
import { Import } from '../parser/types';

export interface GoModule {
  /** `module` directive of go.mod. */
  modulePath: string;
  /** Absolute directory containing go.mod. */
  moduleDir: string;
}

/** Go modules of one scan. */
export interface GoModules {
  /** Absolute scan root. */
  root: string;
  /** Modules imports may resolve into, longest module path first. */
  modules: GoModule[];
  /** Every discovered go.mod directory (file ownership, incl. modules go.work leaves out). */
  moduleDirs: string[];
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.hg']);

/*
 * go.mod / go.work directive parsing, line by line and regex-free across
 * lines: `^\s*` / `[^)]*` patterns over the whole file backtrack
 * quadratically on long runs of blank lines or unclosed blocks.
 */

/** Lines with `//` comments removed (quotes not considered, as before). */
function goLines(text: string): string[] {
  return text.split('\n').map(l => {
    const i = l.indexOf('//');
    return i < 0 ? l : l.slice(0, i);
  });
}

/** Text after `keyword` on a trimmed line when the keyword is followed by whitespace or `(`; else undefined. */
function afterKeyword(line: string, keyword: string): string | undefined {
  if (!line.startsWith(keyword)) return undefined;
  const rest = line.slice(keyword.length);
  return rest === '' || /^[\s(]/.test(rest) ? rest : undefined;
}

/**
 * Arguments of `keyword` directives: each line of `keyword ( ... )` blocks
 * (text after `(` through the first `)`; an unclosed block yields nothing),
 * then each single-line `keyword arg...`. Linear in the text.
 */
function goDirectiveArgs(text: string, keyword: string): string[] {
  const blocks: string[] = [];
  const singles: string[] = [];
  let open: string[] | undefined;
  for (const raw of goLines(text)) {
    if (open) {
      const close = raw.indexOf(')');
      open.push(close < 0 ? raw : raw.slice(0, close));
      if (close >= 0) {
        blocks.push(...open);
        open = undefined;
      }
      continue;
    }
    const rest = afterKeyword(raw.trim(), keyword);
    if (rest === undefined) continue;
    const arg = rest.trimStart();
    if (arg.startsWith('(')) {
      const body = arg.slice(1);
      const close = body.indexOf(')');
      if (close >= 0) blocks.push(body.slice(0, close));
      else open = [body];
    } else if (arg !== '' && arg.length < rest.length) {
      singles.push(arg);
    }
  }
  return [...blocks, ...singles];
}

export function parseModulePath(goMod: string): string | null {
  for (const raw of goMod.split('\n')) {
    const rest = afterKeyword(raw.trim(), 'module');
    if (rest === undefined) continue;
    const arg = rest.trimStart();
    if (arg === '' || arg.length === rest.length) continue;
    for (const q of ['"', '`']) {
      if (!arg.startsWith(q)) continue;
      const end = arg.indexOf(q, 1);
      if (end > 1) return arg.slice(1, end);
    }
    return arg.split(/\s/, 1)[0];
  }
  return null;
}

/** Absolute directories named by the `use` directives of a go.work file. */
export function parseGoWorkUses(goWork: string, workDir: string): Set<string> {
  const out = new Set<string>();
  for (const arg of goDirectiveArgs(goWork, 'use')) {
    const dir = arg.trim().replace(/^["`]|["`]$/g, '');
    if (dir) out.add(path.resolve(workDir, dir));
  }
  return out;
}

/** Module paths of `require` directives (single-line and blocks). */
export function parseGoModRequires(goMod: string): string[] {
  const out: string[] = [];
  for (const line of goDirectiveArgs(goMod, 'require')) {
    const m = /^\s*(?:"([^"]+)"|`([^`]+)`|(\S+))\s+\S/.exec(line);
    if (m) out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function readModule(dir: string): GoModule | null {
  try {
    const modulePath = parseModulePath(readTextSafe(dir, 'go.mod'));
    return modulePath ? { modulePath, moduleDir: dir } : null;
  } catch {
    return null; // unreadable go.mod: treat as absent
  }
}

function findUp(start: string, name: string): string | null {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, name))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

function walkGoModDirs(dir: string, out: Set<string>) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkGoModDirs(path.join(dir, e.name), out);
    } else if (e.name === 'go.mod') {
      out.add(dir);
    }
  }
}

/**
 * Go modules governing the scan of `root`. With `files` (root-relative scan
 * results) the module of each scanned Go file's directory is its nearest
 * go.mod at or above it, so ignored trees never contribute modules; without
 * it the tree is walked. Returns null when no module is found.
 */
export function detectGoModules(root: string, files?: string[]): GoModules | null {
  const absRoot = path.resolve(root);
  const dirs = new Set<string>();
  if (files) {
    const seen = new Set<string>();
    for (const f of files) {
      if (!f.endsWith('.go')) continue;
      const start = path.dirname(path.resolve(absRoot, f));
      if (seen.has(start)) continue;
      seen.add(start);
      const found = findUp(start, 'go.mod');
      if (found) dirs.add(found);
    }
  } else {
    const enclosing = findUp(absRoot, 'go.mod');
    if (enclosing) dirs.add(enclosing);
    walkGoModDirs(absRoot, dirs);
  }

  const all: GoModule[] = [];
  for (const d of dirs) {
    const mod = readModule(d);
    if (mod) all.push(mod);
  }
  let modules = all;
  const workDir = findUp(absRoot, 'go.work');
  if (workDir) {
    try {
      const uses = parseGoWorkUses(readTextSafe(workDir, 'go.work'), workDir);
      modules = all.filter(m => uses.has(m.moduleDir));
    } catch {
      /* unreadable go.work: fall back to every discovered module */
    }
  }
  if (modules.length === 0) return null;
  modules.sort((a, b) => b.modulePath.length - a.modulePath.length);
  return { root: absRoot, modules, moduleDirs: all.map(m => m.moduleDir) };
}

/** Module set holding a single module (tests, single-module callers). */
export function goSingleModule(modulePath: string, moduleDir: string, root: string = moduleDir): GoModules {
  const dir = path.resolve(moduleDir);
  return { root: path.resolve(root), modules: [{ modulePath, moduleDir: dir }], moduleDirs: [dir] };
}

export function ownerModuleDir(mods: GoModules, abs: string): string | null {
  let best: string | null = null;
  for (const d of mods.moduleDirs) {
    if ((abs === d || abs.startsWith(d + path.sep)) && (best === null || d.length > best.length)) best = d;
  }
  return best;
}

/**
 * Directory (posix, relative to the scan root) holding the package for
 * `importPath`, or null for packages outside every module / the scan root.
 * The module with the longest matching module path provides the package; a
 * directory owned by another (nested) go.mod is not part of it.
 */
export function goPackageDir(mods: GoModules, importPath: string): string | null {
  const mod = mods.modules.find(
    m => importPath === m.modulePath || importPath.startsWith(m.modulePath + '/')
  );
  if (!mod) return null;
  const rest = importPath.slice(mod.modulePath.length).replace(/^\//, '');
  const abs = path.join(mod.moduleDir, rest);
  if (ownerModuleDir(mods, abs) !== mod.moduleDir) return null;
  const rel = path.relative(mods.root, abs);
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
export function goLocalImports(mod: GoModules, imports: Import[]): Array<{ imp: Import; dir: string }> {
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
  mod: GoModules | null,
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
