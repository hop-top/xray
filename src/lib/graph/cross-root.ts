/**
 * Cross-root call and import resolution for merged multi-root graphs.
 *
 * Each root is analyzed by its own GraphBuilder, so a call into another
 * root resolves to nothing there; the builder keeps such references on the
 * tag node (`references`). This pass runs once on the merged graph and
 * resolves them against the OTHER roots, with the builder's tiers:
 *
 * - An import of the caller's file maps to another root:
 *   - Go: module path in `go.mod` (to one package directory)
 *   - JS/TS: `tsconfig.json` `paths` / `references`, or `package.json` `name`
 *   - Rust: `Cargo.toml` `[dependencies.<crate>].path` / `[workspace].members` / `[package].name`
 *   - Python: `pyproject.toml` `[project].name` and top-level package dir (root or `src/`)
 *   Matches inside a mapped scope are EXTRACTED; TS `tsconfig`, Rust `Cargo.toml`,
 *   and Python `pyproject.toml` mappings also emit file-level `imports` edges.
 * - Otherwise a same-named, same-language definition anywhere in another
 *   root is INFERRED (Go: only exported names; a qualified `pkg.Name` never
 *   falls back, the qualifier names a package that did not map).
 *
 * Member calls (`.name`) only reach methods. Every edge added carries
 * `crossRoot: true`. `references` is removed from every node afterwards.
 */
import * as fs from 'fs';
import { readTextSafe } from '../safe-read';
import * as path from 'path';
import * as toml from '@iarna/toml';
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../query/types';
import { Confidence } from '../../types/graph';
import { detectGoModules, goDefaultName, goPackageDir, goVisibleFrom, type GoModules } from './go-resolver';
import { languageOf } from '../parser/language-registry';
import { pythonImportBindings } from '../parser/import-bindings';
import { TS_SPECIFIER_EXTENSIONS, TS_INDEX_SUFFIXES } from './ts-specifier';

interface TsPathRule {
  prefix: string;
  suffix: string;
  hasStar: boolean;
  targets: string[];
}

interface TsConfigInfo {
  baseDir: string;
  paths: TsPathRule[];
  referenceDirs: string[];
}

interface CargoInfo {
  crateName: string | null;
  pathDeps: Map<string, string>;
  workspaceMembers: string[];
}

interface PyProjectInfo {
  projectName: string | null;
  packages: Map<string, string>;
}

interface RootInfo {
  label: string;
  path: string;
  canonPath: string;
  fileSet: Set<string>;
  go: GoModules | null;
  npmName: string | null;
  ts: TsConfigInfo | null;
  cargo: CargoInfo | null;
  py: PyProjectInfo | null;
}

interface TagInfo {
  id: string;
  name: string;
  kind?: string;
  root: string;
  /** Root-relative posix file. */
  file: string;
  /** Root-relative posix directory. */
  dir: string;
  lang?: string;
}

/** Import (as stored on file nodes by the parser). */
interface RawImport {
  source: string;
  alias?: string;
  text?: string;
}

/** Where an import of the caller lands in another root. */
interface Mapped {
  imp: RawImport;
  root: string;
  /** Go: exact package directory. Others: null (whole root). */
  dir: string | null;
  /** Resolved root-relative posix file for emitting file-level `imports` edges. */
  targetFile?: string | null;
}

const posixDir = (f: string) => path.posix.dirname(f);
const toPosix = (p: string) => p.split(path.sep).join('/');
const isGoFile = (f: string) => f.endsWith('.go');
const isRustFile = (f: string) => f.endsWith('.rs');
const isPythonFile = (f: string) => f.endsWith('.py');
const isTsJsFile = (f: string) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f);

function canonPath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isWithinDir(targetAbs: string, dirCanon: string): boolean {
  const rel = path.relative(dirCanon, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function readNpmName(root: string): string | null {
  try {
    const pkg = JSON.parse(readTextSafe(root, 'package.json'));
    return typeof pkg?.name === 'string' && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    return null;
  }
}

/** Strip `//` and `/* ... *\/` comments and trailing commas from JSONC. */
function stripJsonc(raw: string): string {
  let noComments = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      noComments += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      noComments += ch;
      continue;
    }
    if (ch === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      noComments += '\n';
      continue;
    }
    if (ch === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
      continue;
    }
    noComments += ch;
  }

  let out = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < noComments.length && /\s/.test(noComments[j])) j++;
      if (noComments[j] === '}' || noComments[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function readTsConfig(root: string): TsConfigInfo | null {
  try {
    const raw = readTextSafe(root, 'tsconfig.json');
    const parsed = JSON.parse(stripJsonc(raw));
    const compilerOptions = parsed?.compilerOptions ?? {};
    const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
    const baseDir = canonPath(path.resolve(root, baseUrl));
    const paths: TsPathRule[] = [];
    if (compilerOptions.paths && typeof compilerOptions.paths === 'object') {
      for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
        if (!Array.isArray(targets)) continue;
        const star = pattern.indexOf('*');
        const list = targets.filter((t): t is string => typeof t === 'string');
        if (list.length === 0) continue;
        paths.push({
          prefix: star >= 0 ? pattern.slice(0, star) : pattern,
          suffix: star >= 0 ? pattern.slice(star + 1) : '',
          hasStar: star >= 0,
          targets: list,
        });
      }
    }
    const referenceDirs: string[] = [];
    if (Array.isArray(parsed?.references)) {
      for (const ref of parsed.references) {
        if (typeof ref?.path !== 'string') continue;
        const resolved = path.resolve(root, ref.path);
        referenceDirs.push(canonPath(resolved.endsWith('.json') ? path.dirname(resolved) : resolved));
      }
    }
    if (paths.length === 0 && referenceDirs.length === 0) return null;
    return { baseDir, paths, referenceDirs };
  } catch {
    return null;
  }
}

function resolveTsFileInRoot(absTarget: string, targetRoot: RootInfo): string | null {
  if (!isWithinDir(absTarget, targetRoot.canonPath)) return null;
  const rel = toPosix(path.relative(targetRoot.canonPath, absTarget));
  if (!rel || rel === '.') {
    for (const idx of TS_INDEX_SUFFIXES) {
      const candidate = idx.slice(1);
      if (targetRoot.fileSet.has(candidate)) return candidate;
    }
    return null;
  }
  if (targetRoot.fileSet.has(rel)) return rel;
  for (const ext of TS_SPECIFIER_EXTENSIONS) {
    if (targetRoot.fileSet.has(rel + ext)) return rel + ext;
  }
  for (const idx of TS_INDEX_SUFFIXES) {
    if (targetRoot.fileSet.has(rel + idx)) return rel + idx;
  }
  return null;
}

function readCargoToml(root: string): CargoInfo | null {
  try {
    const raw = readTextSafe(root, 'Cargo.toml');
    const data = toml.parse(raw) as Record<string, any>;
    const rawName = data?.package?.name;
    const crateName = typeof rawName === 'string' && rawName.length > 0 ? rawName.replace(/-/g, '_') : null;
    const pathDeps = new Map<string, string>();
    for (const section of [data?.dependencies, data?.['dev-dependencies']]) {
      if (!section || typeof section !== 'object') continue;
      for (const [depKey, depVal] of Object.entries(section)) {
        if (depVal && typeof depVal === 'object' && typeof (depVal as any).path === 'string') {
          const pkg = typeof (depVal as any).package === 'string' ? (depVal as any).package : depKey;
          pathDeps.set(pkg.replace(/-/g, '_'), canonPath(path.resolve(root, (depVal as any).path)));
        }
      }
    }
    const workspaceMembers: string[] = [];
    if (Array.isArray(data?.workspace?.members)) {
      for (const m of data.workspace.members) {
        if (typeof m !== 'string') continue;
        if (m.endsWith('/*')) {
          const parent = path.resolve(root, m.slice(0, -2));
          try {
            for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
              if (entry.isDirectory()) workspaceMembers.push(canonPath(path.join(parent, entry.name)));
            }
          } catch {
            // ignore unreadable workspace dir
          }
        } else {
          workspaceMembers.push(canonPath(path.resolve(root, m)));
        }
      }
    }
    if (!crateName && pathDeps.size === 0 && workspaceMembers.length === 0) return null;
    return { crateName, pathDeps, workspaceMembers };
  } catch {
    return null;
  }
}

function resolveRustFileInRoot(impSource: string, targetRoot: RootInfo): string | null {
  const parts = impSource.split('::');
  if (parts.length >= 3) {
    const sub = parts[1];
    for (const cand of [`src/${sub}.rs`, `src/${sub}/mod.rs`, `${sub}.rs`, `${sub}/mod.rs`]) {
      if (targetRoot.fileSet.has(cand)) return cand;
    }
  }
  for (const cand of ['src/lib.rs', 'lib.rs', 'src/main.rs', 'main.rs']) {
    if (targetRoot.fileSet.has(cand)) return cand;
  }
  return null;
}

function readPyProject(root: string, files: string[]): PyProjectInfo | null {
  try {
    const raw = readTextSafe(root, 'pyproject.toml');
    const data = toml.parse(raw) as Record<string, any>;
    const rawName = data?.project?.name ?? data?.tool?.poetry?.name;
    const projectName = typeof rawName === 'string' && rawName.length > 0 ? rawName.replace(/-/g, '_') : null;
    const packages = new Map<string, string>();
    for (const f of files) {
      if (f.startsWith('src/') && f.endsWith('.py')) {
        const seg = f.split('/')[1];
        if (seg && !seg.endsWith('.py')) packages.set(seg, `src/${seg}`);
      } else if (f.endsWith('/__init__.py')) {
        const seg = f.split('/')[0];
        if (seg && seg !== 'tests' && seg !== 'test' && !packages.has(seg)) {
          packages.set(seg, seg);
        }
      }
    }
    if (projectName && !packages.has(projectName)) {
      if (files.some(f => f.startsWith(`src/${projectName}/`))) {
        packages.set(projectName, `src/${projectName}`);
      } else if (files.some(f => f.startsWith(`${projectName}/`))) {
        packages.set(projectName, projectName);
      } else {
        packages.set(projectName, '');
      }
    }
    if (!projectName && packages.size === 0) return null;
    return { projectName, packages };
  } catch {
    return null;
  }
}

function resolvePythonFileInRoot(impSource: string, targetRoot: RootInfo): string | null {
  if (!targetRoot.py || impSource.startsWith('.')) return null;
  const parts = impSource.split('.');
  const topPkg = parts[0];
  const baseDir = targetRoot.py.packages.get(topPkg);
  if (baseDir === undefined) return null;
  const sub = parts.slice(1);
  const candidates: string[] = [];
  const prefix = baseDir ? `${baseDir}/` : '';
  if (sub.length > 0) {
    candidates.push(`${prefix}${sub.join('/')}.py`, `${prefix}${sub.join('/')}/__init__.py`);
  }
  candidates.push(`${prefix}__init__.py`, `src/${topPkg}.py`, `${topPkg}.py`);
  for (const cand of candidates) {
    if (targetRoot.fileSet.has(cand)) return cand;
  }
  return null;
}

/**
 * Local names a JS/TS import statement binds (default, named, namespace),
 * or null when the statement text is unavailable / not an `import`.
 */
export function jsImportBindings(text: string | undefined): Set<string> | null {
  if (!text) return null;
  const m = /^\s*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]/.exec(text);
  if (!m) return null;
  const out = new Set<string>();
  const clause = m[1];
  const braces = /\{([\s\S]*)\}/.exec(clause);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const spec = part.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const as = /\s+as\s+([\w$]+)$/.exec(spec);
      out.add(as ? as[1] : spec);
    }
  }
  const rest = clause.replace(/\{[\s\S]*\}/, '');
  const ns = /\*\s+as\s+([\w$]+)/.exec(rest);
  if (ns) out.add(ns[1]);
  const def = /^\s*([\w$]+)/.exec(rest);
  if (def && def[1] !== 'type') out.add(def[1]);
  return out;
}

/**
 * Symbol names a Rust `use` import entry binds from its `RawImport`,
 * or null for wildcard (`*`) or whole-crate imports (`use crate_name;`).
 */
function rustImportBindingsText(imp: RawImport): Set<string> | null {
  if (imp.text?.includes('*')) return null;
  const parts = imp.source.split('::').filter(Boolean);
  if (parts.length <= 1) return null;
  const last = parts[parts.length - 1];
  if (last === 'self' && parts.length >= 2) return new Set([parts[parts.length - 2]]);
  return new Set([last]);
}

/**
 * Resolve the unresolved references of a merged graph across its roots.
 * Single-root graphs (no `metadata.roots`) only get `references` stripped.
 */
export function resolveCrossRootReferences(g: SerializedGraph): SerializedGraph {
  const roots = g.metadata.roots;
  const strip = (n: SerializedNode): SerializedNode => {
    if (n.references === undefined) return n;
    const { references: _drop, ...rest } = n;
    return rest;
  };
  if (!roots || roots.length < 2) {
    return { ...g, nodes: g.nodes.map(strip) };
  }

  const labelOf = (id: string) => id.slice(0, id.indexOf('/'));
  const relOf = (id: string) => id.slice(id.indexOf('/') + 1);

  const filesByRoot = new Map<string, string[]>();
  const importsByFile = new Map<string, RawImport[]>();
  for (const n of g.nodes) {
    if (n.type !== 'file') continue;
    const label = labelOf(n.id);
    const list = filesByRoot.get(label);
    if (list) list.push(relOf(n.id)); else filesByRoot.set(label, [relOf(n.id)]);
    if (Array.isArray(n.imports) && n.imports.length > 0) {
      importsByFile.set(n.id, n.imports as unknown as RawImport[]);
    }
  }

  const info = new Map<string, RootInfo>();
  for (const r of roots) {
    const files = filesByRoot.get(r.label) ?? [];
    info.set(r.label, {
      label: r.label,
      path: r.path,
      canonPath: canonPath(r.path),
      fileSet: new Set(files),
      go: files.some(isGoFile) ? detectGoModules(r.path, files) : null,
      npmName: readNpmName(r.path),
      ts: files.some(isTsJsFile) ? readTsConfig(r.path) : null,
      cargo: files.some(isRustFile) ? readCargoToml(r.path) : null,
      py: files.some(isPythonFile) ? readPyProject(r.path, files) : null,
    });
  }

  const byName = new Map<string, TagInfo[]>();
  for (const n of g.nodes) {
    if (n.type !== 'tag' || n.file === undefined) continue;
    const file = relOf(n.file);
    const t: TagInfo = {
      id: n.id, name: n.label, kind: n.kind, root: labelOf(n.id),
      file, dir: posixDir(file), lang: languageOf(path.extname(file)),
    };
    const list = byName.get(t.name);
    if (list) list.push(t); else byName.set(t.name, [t]);
  }

  const mapImports = (callerRoot: string, callerFile: string, imports: RawImport[]): Mapped[] => {
    const callerInfo = info.get(callerRoot);
    const out: Mapped[] = [];
    for (const imp of imports) {
      if (!imp || typeof imp.source !== 'string') continue;

      if (isGoFile(callerFile)) {
        if (imp.alias === '_') continue;
        for (const r of info.values()) {
          if (r.label === callerRoot || !r.go) continue;
          const dir = goPackageDir(r.go, imp.source);
          if (dir !== null) out.push({ imp, root: r.label, dir });
        }
        continue;
      }

      if (isRustFile(callerFile)) {
        const crateSeg = imp.source.split('::')[0];
        if (!crateSeg || crateSeg === 'crate' || crateSeg === 'self' || crateSeg === 'super') continue;
        for (const r of info.values()) {
          if (r.label === callerRoot || !r.cargo) continue;
          const depTarget = callerInfo?.cargo?.pathDeps.get(crateSeg);
          const viaPathDep = depTarget !== undefined && isWithinDir(depTarget, r.canonPath);
          const viaWorkspace =
            r.cargo.crateName === crateSeg &&
            (callerInfo?.cargo?.workspaceMembers.some(m => isWithinDir(m, r.canonPath)) ||
              r.cargo.workspaceMembers.some(m => isWithinDir(m, callerInfo?.canonPath ?? '')));
          const viaPkgName = r.cargo.crateName === crateSeg;
          if (viaPathDep || viaWorkspace || viaPkgName) {
            out.push({
              imp,
              root: r.label,
              dir: null,
              targetFile: resolveRustFileInRoot(imp.source, r),
            });
          }
        }
        continue;
      }

      if (isPythonFile(callerFile)) {
        if (imp.source.startsWith('.')) continue;
        for (const r of info.values()) {
          if (r.label === callerRoot || !r.py) continue;
          const targetFile = resolvePythonFileInRoot(imp.source, r);
          if (targetFile !== null) {
            out.push({ imp, root: r.label, dir: null, targetFile });
          }
        }
        continue;
      }

      // TS / JS: check tsconfig.json paths first, then tsconfig references / npm package name
      let tsMatched = false;
      if (isTsJsFile(callerFile) && callerInfo?.ts) {
        for (const rule of callerInfo.ts.paths) {
          const matches = rule.hasStar
            ? imp.source.startsWith(rule.prefix) &&
              imp.source.endsWith(rule.suffix) &&
              imp.source.length >= rule.prefix.length + rule.suffix.length
            : imp.source === rule.prefix;
          if (!matches) continue;
          const starVal = rule.hasStar
            ? imp.source.slice(rule.prefix.length, imp.source.length - rule.suffix.length)
            : '';
          for (const targetTpl of rule.targets) {
            const relTarget = rule.hasStar ? targetTpl.replace('*', starVal) : targetTpl;
            const absTarget = canonPath(path.resolve(callerInfo.ts.baseDir, relTarget));
            for (const r of info.values()) {
              if (r.label === callerRoot) continue;
              const targetFile = resolveTsFileInRoot(absTarget, r);
              if (targetFile !== null) {
                out.push({ imp, root: r.label, dir: null, targetFile });
                tsMatched = true;
              }
            }
          }
        }
      }

      if (!tsMatched) {
        for (const r of info.values()) {
          if (r.label === callerRoot) continue;
          if (r.npmName && (imp.source === r.npmName || imp.source.startsWith(r.npmName + '/'))) {
            const isTsRef = callerInfo?.ts?.referenceDirs.some(d => isWithinDir(d, r.canonPath)) ?? false;
            const targetFile = isTsRef ? resolveTsFileInRoot(r.canonPath, r) : undefined;
            out.push({ imp, root: r.label, dir: null, ...(targetFile ? { targetFile } : {}) });
          }
        }
      }
    }
    return out;
  };
  const inScope = (t: TagInfo, m: Mapped) => t.root === m.root && (m.dir === null || t.dir === m.dir);

  const existingCalls = new Set(g.edges.filter(e => e.type === 'calls').map(e => `${e.source}\x00${e.target}`));
  const existingImports = new Set(g.edges.filter(e => e.type === 'imports').map(e => `${e.source}\x00${e.target}`));
  const added: SerializedEdge[] = [];

  const mappedByFile = new Map<string, Mapped[]>();
  for (const [fileId, imps] of importsByFile.entries()) {
    const callerRoot = labelOf(fileId);
    const callerFile = relOf(fileId);
    const mapped = mapImports(callerRoot, callerFile, imps);
    mappedByFile.set(fileId, mapped);
    for (const m of mapped) {
      if (!m.targetFile) continue;
      const targetId = `${m.root}/${m.targetFile}`;
      const key = `${fileId}\x00${targetId}`;
      if (existingImports.has(key)) continue;
      existingImports.add(key);
      added.push({
        source: fileId,
        target: targetId,
        type: 'imports',
        confidence: Confidence.EXTRACTED,
        crossRoot: true,
      });
    }
  }

  const link = (source: string, targets: TagInfo[], confidence: Confidence) => {
    for (const t of targets) {
      const key = `${source}\x00${t.id}`;
      if (existingCalls.has(key)) continue;
      existingCalls.add(key);
      added.push({ source, target: t.id, type: 'calls', confidence, crossRoot: true });
    }
  };

  for (const n of g.nodes) {
    if (n.type !== 'tag' || !n.references || n.references.length === 0 || n.file === undefined) continue;
    const callerRoot = labelOf(n.id);
    const callerFile = relOf(n.file);
    const callerLang = languageOf(path.extname(callerFile));
    const goCaller = isGoFile(callerFile);
    const mapped = mappedByFile.get(n.file) ?? [];
    // Candidates in other roots, same language; Go: exported, non-test.
    const others = (name: string, keep: (t: TagInfo) => boolean) =>
      (byName.get(name) ?? []).filter(t =>
        t.root !== callerRoot && keep(t) &&
        (callerLang === undefined || t.lang === callerLang) &&
        (!goCaller || !isGoFile(t.file) || goVisibleFrom(`${callerRoot}/${callerFile}`, `${t.root}/${t.file}`, name)));

    for (const ref of n.references) {
      if (ref.startsWith('.')) {
        const name = ref.slice(1);
        const methods = others(name, t => t.kind === 'method');
        if (methods.length === 0) continue;
        const scoped = methods.filter(t => mapped.some(m => inScope(t, m)));
        if (scoped.length > 0) { link(n.id, scoped, Confidence.EXTRACTED); continue; }
        // Go receiver type unknown: one candidate package is a guess,
        // several are ambiguous (no edge), as within a root.
        if (goCaller && new Set(methods.map(t => `${t.root}/${t.dir}`)).size > 1) continue;
        link(n.id, methods, Confidence.INFERRED);
        continue;
      }
      if (goCaller && ref.includes('.')) {
        const dot = ref.indexOf('.');
        const qualifier = ref.slice(0, dot);
        const name = ref.slice(dot + 1);
        if (!qualifier || !name || name.includes('.')) continue;
        const scopes = mapped.filter(m =>
          m.imp.alias !== '.' && (m.imp.alias || goDefaultName(m.imp.source)) === qualifier);
        if (scopes.length === 0) continue;
        const fns = others(name, t => t.kind === 'function' && scopes.some(m => inScope(t, m)));
        link(n.id, fns, Confidence.EXTRACTED);
        continue;
      }
      const cands = others(ref, () => true);
      if (cands.length === 0) continue;
      const scopes = mapped.filter(m => {
        if (goCaller) return m.imp.alias === '.';
        if (callerLang === 'rust') {
          const bound = rustImportBindingsText(m.imp);
          return bound === null || bound.has(ref);
        }
        if (callerLang === 'python') {
          const bound = pythonImportBindings(m.imp.text);
          return bound === null || bound.has(ref);
        }
        const bound = jsImportBindings(m.imp.text);
        return bound === null || bound.has(ref);
      });
      const scoped = cands.filter(t => scopes.some(m => inScope(t, m)));
      if (scoped.length > 0) link(n.id, scoped, Confidence.EXTRACTED);
      else link(n.id, cands, Confidence.INFERRED);
    }
  }

  const edges = added.length > 0 ? [...g.edges, ...added] : g.edges;
  return {
    ...g,
    metadata: { ...g.metadata, edgeCount: edges.length },
    nodes: g.nodes.map(strip),
    edges,
  };
}
