import * as path from 'path';
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../query/types';

export interface GraphRoot {
  label: string;
  path: string;
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

/**
 * Derive a stable, unique label per root, in input order. Labels never
 * contain `/`, so the first segment of a namespaced id always identifies
 * its root (nested roots like `pkg` and `pkg/api` cannot collide).
 *
 * - Root inside `cwd` (and not cwd itself): its cwd-relative path with
 *   separators flattened to `-` (`pkg-api`).
 * - Otherwise: its basename (`other-repo`); `root` if that is empty.
 * - A label already taken gets `-2`, `-3`, ... (first come keeps the plain
 *   label), so equal basenames from different directories stay distinct.
 *
 * Callers must pass distinct, absolute root paths.
 */
export function deriveRootLabels(roots: string[], cwd: string = process.cwd()): GraphRoot[] {
  const taken = new Set<string>();
  return roots.map(root => {
    const rel = path.relative(cwd, root);
    const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    const base = inside ? toPosix(rel).split('/').join('-') : path.basename(root) || 'root';
    let label = base;
    for (let n = 2; taken.has(label); n++) label = `${base}-${n}`;
    taken.add(label);
    return { label, path: root };
  });
}

/** Deepest directory containing every root. */
function commonAncestor(roots: string[]): string {
  const split = roots.map(r => path.resolve(r).split(path.sep));
  const first = split[0];
  let n = first.length;
  for (const parts of split) {
    let i = 0;
    while (i < n && i < parts.length && parts[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join(path.sep) || path.sep;
}

/**
 * Merge per-root graphs into ONE SerializedGraph: the union of all nodes
 * and edges, with every id (and node `file`, and import `file`) namespaced
 * `<label>/<id>` so identical root-relative ids from different roots cannot
 * collide. No edges are created between roots: only those each root's own
 * analysis produced. PageRank `rank` values stay per-root.
 *
 * A single part is returned untouched (no prefixing, no `roots`), keeping
 * single-root output byte-identical to the pre-merge behaviour.
 */
export function mergeSerializedGraphs(
  parts: Array<{ root: string; graph: SerializedGraph }>,
  cwd: string = process.cwd()
): SerializedGraph {
  if (parts.length === 1) return parts[0].graph;

  const roots = deriveRootLabels(parts.map(p => p.root), cwd);
  const nodes: SerializedNode[] = [];
  const edges: SerializedEdge[] = [];

  parts.forEach((part, i) => {
    const prefix = `${roots[i].label}/`;
    for (const node of part.graph.nodes) {
      const merged: SerializedNode = { ...node, id: prefix + node.id };
      if (node.file !== undefined) merged.file = prefix + node.file;
      if (node.imports !== undefined) {
        merged.imports = node.imports.map(imp =>
          typeof (imp as any).file === 'string' ? { ...imp, file: prefix + (imp as any).file } : imp
        );
      }
      nodes.push(merged);
    }
    for (const edge of part.graph.edges) {
      edges.push({ ...edge, source: prefix + edge.source, target: prefix + edge.target });
    }
  });

  return {
    metadata: {
      version: parts[0].graph.metadata.version,
      timestamp: new Date().toISOString(),
      projectPath: commonAncestor(parts.map(p => p.root)),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      roots,
    },
    nodes,
    edges,
  };
}
