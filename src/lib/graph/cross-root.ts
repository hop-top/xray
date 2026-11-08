/**
 * Cross-root call resolution for merged multi-root graphs.
 *
 * Each root is analyzed by its own GraphBuilder, so a call into another
 * root resolves to nothing there; the builder keeps such references on the
 * tag node (`references`). This pass runs once on the merged graph and
 * resolves them against the OTHER roots, with the builder's tiers:
 *
 * - An import of the caller's file maps to another root: a Go import path
 *   through that root's go.mod module path(s) (to one package directory),
 *   an npm specifier through that root's package.json `name` (to the whole
 *   root). Matches inside a mapped scope are EXTRACTED.
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
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../query/types';
import { Confidence } from '../../types/graph';
import { detectGoModules, goDefaultName, goPackageDir, goVisibleFrom, type GoModules } from './go-resolver';
import { languageOf } from '../parser/language-registry';

interface RootInfo {
  label: string;
  path: string;
  go: GoModules | null;
  npmName: string | null;
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
  /** Go: exact package directory. npm: null (whole root). */
  dir: string | null;
}

const posixDir = (f: string) => path.posix.dirname(f);
const isGoFile = (f: string) => f.endsWith('.go');

function readNpmName(root: string): string | null {
  try {
    const pkg = JSON.parse(readTextSafe(root, 'package.json'));
    return typeof pkg?.name === 'string' && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    return null;
  }
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

  // Root-relative files per root (for go.mod ownership).
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
      go: files.some(isGoFile) ? detectGoModules(r.path, files) : null,
      npmName: readNpmName(r.path),
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
    const out: Mapped[] = [];
    for (const imp of imports) {
      if (!imp || typeof imp.source !== 'string') continue;
      for (const r of info.values()) {
        if (r.label === callerRoot) continue;
        if (isGoFile(callerFile)) {
          if (imp.alias === '_' || !r.go) continue;
          const dir = goPackageDir(r.go, imp.source);
          if (dir !== null) out.push({ imp, root: r.label, dir });
        } else if (r.npmName && (imp.source === r.npmName || imp.source.startsWith(r.npmName + '/'))) {
          out.push({ imp, root: r.label, dir: null });
        }
      }
    }
    return out;
  };
  const inScope = (t: TagInfo, m: Mapped) => t.root === m.root && (m.dir === null || t.dir === m.dir);

  const existing = new Set(g.edges.filter(e => e.type === 'calls').map(e => `${e.source}\x00${e.target}`));
  const added: SerializedEdge[] = [];
  const link = (source: string, targets: TagInfo[], confidence: Confidence) => {
    for (const t of targets) {
      const key = `${source}\x00${t.id}`;
      if (existing.has(key)) continue;
      existing.add(key);
      added.push({ source, target: t.id, type: 'calls', confidence, crossRoot: true });
    }
  };

  for (const n of g.nodes) {
    if (n.type !== 'tag' || !n.references || n.references.length === 0 || n.file === undefined) continue;
    const callerRoot = labelOf(n.id);
    const callerFile = relOf(n.file);
    const callerLang = languageOf(path.extname(callerFile));
    const goCaller = isGoFile(callerFile);
    const mapped = mapImports(callerRoot, callerFile, importsByFile.get(n.file) ?? []);
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
