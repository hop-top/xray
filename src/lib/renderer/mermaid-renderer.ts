import { createHash } from 'crypto';
import * as path from 'path';
import type { Cfg, Dfg } from '../flow/types';
import type { SerializedEdge, SerializedGraph, SerializedNode } from '../query/types';
import { Confidence, type XrayGraph } from '../../types/graph';

export type MermaidView = 'architecture' | 'calls' | 'cfg' | 'dfg';

export interface MermaidRenderOptions {
  view?: MermaidView;
  anchor?: string;
  catch?: string[];
  depth?: number;
  maxNodes?: number;
  root?: string;
  files?: string[];
}

interface NormNode {
  id: string;
  type: 'file' | 'tag';
  label: string;
  kind?: string;
  file?: string;
  line?: number;
  rank: number;
  community?: number;
  cfg?: Cfg;
  dfg?: Dfg;
}

interface NormEdge {
  source: string;
  target: string;
  type: 'defines' | 'calls' | 'imports';
  confidence?: Confidence | string;
}

const DEFAULT_MAX_NODES = 60;

const RESERVED_MERMAID_IDS = new Set([
  'end',
  'subgraph',
  'graph',
  'flowchart',
  'style',
  'class',
  'click',
  'call',
  'default',
  'direction',
  'linkstyle',
  'classdef',
  'interpolate',
]);

function isGraphology(g: XrayGraph | SerializedGraph): g is XrayGraph {
  return typeof (g as XrayGraph).forEachNode === 'function';
}

function normalizeGraph(input: XrayGraph | SerializedGraph): { nodes: NormNode[]; edges: NormEdge[] } {
  const nodes: NormNode[] = [];
  const edges: NormEdge[] = [];

  if (isGraphology(input)) {
    input.forEachNode((id, attrs) => {
      const a = attrs as Record<string, any>;
      nodes.push({
        id,
        type: a.type === 'file' ? 'file' : 'tag',
        label: String(a.label ?? id),
        kind: typeof a.kind === 'string' ? a.kind : undefined,
        file: typeof a.file === 'string' ? a.file : undefined,
        line: typeof a.line === 'number' ? a.line : undefined,
        rank: typeof a.rank === 'number' ? a.rank : 0,
        community: typeof a.community === 'number' ? a.community : undefined,
        cfg: a.cfg as Cfg | undefined,
        dfg: a.dfg as Dfg | undefined,
      });
    });
    input.forEachEdge((_edgeKey, attrs, source, target) => {
      const a = attrs as Record<string, any>;
      edges.push({
        source,
        target,
        type: (a.type as NormEdge['type']) ?? 'calls',
        confidence: a.confidence,
      });
    });
  } else {
    for (const n of input.nodes as SerializedNode[]) {
      nodes.push({
        id: n.id,
        type: n.type === 'file' ? 'file' : 'tag',
        label: String(n.label ?? n.id),
        kind: n.kind,
        file: n.file,
        line: n.line,
        rank: typeof n.rank === 'number' ? n.rank : 0,
        community: typeof n.community === 'number' ? n.community : undefined,
        cfg: n.cfg,
        dfg: n.dfg,
      });
    }
    for (const e of input.edges as SerializedEdge[]) {
      edges.push({
        source: e.source,
        target: e.target,
        type: e.type ?? 'calls',
        confidence: e.confidence,
      });
    }
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.type.localeCompare(b.type) ||
      String(a.confidence ?? '').localeCompare(String(b.confidence ?? ''))
  );

  return { nodes, edges };
}

function createIdSanitizer(): (rawId: string) => string {
  const assigned = new Map<string, string>();
  const used = new Set<string>();

  return (rawId: string): string => {
    const existing = assigned.get(rawId);
    if (existing) return existing;

    let base = rawId.replace(/[^A-Za-z0-9_]/g, '_');
    if (!base || /^[0-9]/.test(base) || RESERVED_MERMAID_IDS.has(base.toLowerCase())) {
      base = `n_${base || 'node'}`;
    }

    let candidate = base;
    if (used.has(candidate)) {
      const hash = createHash('sha256').update(rawId).digest('hex').slice(0, 6);
      candidate = `${base}_${hash}`;
      let counter = 2;
      while (used.has(candidate)) {
        candidate = `${base}_${hash}_${counter++}`;
      }
    }

    used.add(candidate);
    assigned.set(rawId, candidate);
    return candidate;
  };
}

export function sanitizeMermaidLabel(raw: string): string {
  const stripped = raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return stripped.replace(/"/g, '\\"');
}

function normalizeFileRel(filePath: string, root?: string): string {
  const rel = root && path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath;
  return rel.split(path.sep).join('/');
}

function matchesCatchPattern(text: string, pattern: string): boolean {
  const needle = pattern.toLowerCase();
  const hay = text.toLowerCase();
  if (needle.includes('*') || needle.includes('?')) {
    const escaped = needle.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`).test(hay) || new RegExp(escaped).test(hay);
  }
  return hay.includes(needle);
}

function filterByCatch(nodes: NormNode[], patterns?: string[]): NormNode[] {
  if (!patterns || patterns.length === 0) return nodes;
  const positives: string[] = [];
  const negatives: string[] = [];
  for (const p of patterns) {
    if (!p) continue;
    if (p.startsWith('!')) negatives.push(p.slice(1));
    else positives.push(p);
  }
  return nodes.filter((n) => {
    const target = `${n.label} ${n.id}`;
    if (negatives.some((neg) => matchesCatchPattern(target, neg))) return false;
    if (positives.length > 0) {
      return positives.some((pos) => matchesCatchPattern(target, pos));
    }
    return true;
  });
}

function findAnchorSeeds(nodes: NormNode[], anchor: string, root?: string): NormNode[] {
  const normAnchor = normalizeFileRel(anchor, root).toLowerCase();
  const exact = nodes.filter(
    (n) =>
      n.id.toLowerCase() === anchor.toLowerCase() ||
      normalizeFileRel(n.id, root).toLowerCase() === normAnchor ||
      n.label.toLowerCase() === anchor.toLowerCase()
  );
  if (exact.length > 0) return exact;

  const suffix = nodes.filter((n) => {
    const rel = normalizeFileRel(n.id, root).toLowerCase();
    return rel.endsWith(`/${normAnchor}`) || n.label.toLowerCase().includes(normAnchor);
  });
  if (suffix.length > 0) return suffix;

  return nodes.filter((n) => n.id.toLowerCase().includes(normAnchor) || n.label.toLowerCase().includes(normAnchor));
}

function selectNodes(
  candidates: NormNode[],
  edges: NormEdge[],
  opts: MermaidRenderOptions
): { selected: NormNode[]; omitted: number } {
  const maxNodes = typeof opts.maxNodes === 'number' && opts.maxNodes > 0 ? Math.floor(opts.maxNodes) : DEFAULT_MAX_NODES;
  const candidateIds = new Set(candidates.map((n) => n.id));
  const byId = new Map(candidates.map((n) => [n.id, n]));

  if (opts.anchor && opts.anchor.trim()) {
    const seeds = findAnchorSeeds(candidates, opts.anchor.trim(), opts.root);
    if (seeds.length > 0) {
      const maxDepth = typeof opts.depth === 'number' && opts.depth >= 0 ? Math.floor(opts.depth) : Infinity;
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (!candidateIds.has(e.source) || !candidateIds.has(e.target)) continue;
        const fwd = adj.get(e.source) ?? [];
        fwd.push(e.target);
        adj.set(e.source, fwd);
        const rev = adj.get(e.target) ?? [];
        rev.push(e.source);
        adj.set(e.target, rev);
      }
      for (const list of adj.values()) list.sort();

      const visited = new Set<string>();
      const queue: Array<{ id: string; dist: number }> = [];
      for (const s of seeds) {
        if (!visited.has(s.id)) {
          visited.add(s.id);
          queue.push({ id: s.id, dist: 0 });
        }
      }

      const ordered: NormNode[] = [];
      let head = 0;
      while (head < queue.length && ordered.length < maxNodes) {
        const { id, dist } = queue[head++];
        const node = byId.get(id);
        if (node) ordered.push(node);
        if (dist >= maxDepth) continue;
        for (const nbr of adj.get(id) ?? []) {
          if (!visited.has(nbr)) {
            visited.add(nbr);
            queue.push({ id: nbr, dist: dist + 1 });
          }
        }
      }

      // Count total reachable within depth to report omitted accurately if capped at maxNodes.
      while (head < queue.length) {
        const { id, dist } = queue[head++];
        if (dist >= maxDepth) continue;
        for (const nbr of adj.get(id) ?? []) {
          if (!visited.has(nbr)) {
            visited.add(nbr);
            queue.push({ id: nbr, dist: dist + 1 });
          }
        }
      }

      const totalReachable = visited.size;
      const omitted = Math.max(0, totalReachable - ordered.length);
      return { selected: ordered, omitted };
    }
  }

  const ranked = [...candidates].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  if (ranked.length <= maxNodes) {
    return { selected: ranked, omitted: 0 };
  }
  return {
    selected: ranked.slice(0, maxNodes),
    omitted: ranked.length - maxNodes,
  };
}

function edgeArrow(confidence?: Confidence | string): string {
  return confidence === Confidence.INFERRED || confidence === 'INFERRED' ? '-.->' : '-->';
}

function renderArchitecture(
  nodes: NormNode[],
  edges: NormEdge[],
  opts: MermaidRenderOptions
): string {
  const sanitizeId = createIdSanitizer();
  const hasFileNodes = nodes.some((n) => n.type === 'file');
  const hasCatch = Boolean(opts.catch && opts.catch.length > 0);
  const useFileLevel = hasFileNodes && (!hasCatch || Boolean(opts.files));

  let archNodes: NormNode[];
  let archEdges: NormEdge[];

  if (useFileLevel) {
    const fileNodes = nodes.filter((n) => n.type === 'file');
    const tagToFile = new Map<string, string>();
    const fileTagComms = new Map<string, Map<number, number>>();

    for (const n of nodes) {
      if (n.type === 'tag' && n.file) {
        tagToFile.set(n.id, n.file);
        if (typeof n.community === 'number' && n.community >= 0) {
          const counts = fileTagComms.get(n.file) ?? new Map<number, number>();
          counts.set(n.community, (counts.get(n.community) ?? 0) + 1);
          fileTagComms.set(n.file, counts);
        }
      }
    }

    archNodes = fileNodes.map((f) => {
      let comm = f.community;
      if (comm === undefined || comm < 0) {
        const counts = fileTagComms.get(f.id);
        if (counts && counts.size > 0) {
          comm = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        }
      }
      const relLabel = normalizeFileRel(f.label || f.id, opts.root);
      return { ...f, label: relLabel, community: comm };
    });

    if (opts.files && opts.files.length > 0) {
      const allowed = new Set(opts.files.map((f) => normalizeFileRel(f, opts.root)));
      archNodes = archNodes.filter(
        (n) => allowed.has(normalizeFileRel(n.id, opts.root)) || allowed.has(n.label)
      );
    }

    const lifted = new Map<string, NormEdge>();
    for (const e of edges) {
      if (e.type === 'imports') {
        const key = `${e.source}\0${e.target}\0${e.confidence ?? ''}`;
        if (!lifted.has(key)) lifted.set(key, e);
      } else if (e.type === 'calls') {
        const srcFile = tagToFile.get(e.source) ?? e.source;
        const tgtFile = tagToFile.get(e.target) ?? e.target;
        if (srcFile !== tgtFile) {
          const key = `${srcFile}\0${tgtFile}\0${e.confidence ?? ''}`;
          if (!lifted.has(key)) {
            lifted.set(key, {
              source: srcFile,
              target: tgtFile,
              type: 'calls',
              confidence: e.confidence,
            });
          }
        }
      }
    }
    archEdges = [...lifted.values()].sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
    );
  } else {
    archNodes = filterByCatch(nodes, opts.catch);
    archEdges = edges.filter((e) => e.type === 'calls' || e.type === 'imports');
  }

  // Pre-assign deterministic sanitized IDs in sorted order
  for (const n of archNodes) sanitizeId(n.id);

  const { selected, omitted } = selectNodes(archNodes, archEdges, opts);
  const selectedIds = new Set(selected.map((n) => n.id));

  const byComm = new Map<number, NormNode[]>();
  const ungrouped: NormNode[] = [];
  for (const n of selected) {
    if (typeof n.community === 'number' && n.community >= 0) {
      const list = byComm.get(n.community) ?? [];
      list.push(n);
      byComm.set(n.community, list);
    } else {
      ungrouped.push(n);
    }
  }

  const lines: string[] = ['flowchart LR'];
  const sortedComms = [...byComm.keys()].sort((a, b) => a - b);
  for (const cid of sortedComms) {
    const members = byComm.get(cid)!.sort((a, b) => a.id.localeCompare(b.id));
    lines.push(`  subgraph community_${cid}["Community ${cid}"]`);
    for (const m of members) {
      lines.push(`    ${sanitizeId(m.id)}["${sanitizeMermaidLabel(m.label)}"]`);
    }
    lines.push('  end');
  }

  for (const u of ungrouped.sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  ${sanitizeId(u.id)}["${sanitizeMermaidLabel(u.label)}"]`);
  }

  const seenEdges = new Set<string>();
  for (const e of archEdges) {
    if (!selectedIds.has(e.source) || !selectedIds.has(e.target)) continue;
    const arrow = edgeArrow(e.confidence);
    const sid = sanitizeId(e.source);
    const tid = sanitizeId(e.target);
    const line = `  ${sid} ${arrow} ${tid}`;
    if (!seenEdges.has(line)) {
      seenEdges.add(line);
      lines.push(line);
    }
  }

  if (omitted > 0) {
    lines.push(`  %% truncated: ${omitted} nodes omitted`);
  }

  return lines.join('\n') + '\n';
}

function renderCalls(nodes: NormNode[], edges: NormEdge[], opts: MermaidRenderOptions): string {
  const sanitizeId = createIdSanitizer();
  const tagNodes = nodes.filter((n) => n.type === 'tag');
  const pool = tagNodes.length > 0 ? tagNodes : nodes;
  const filtered = filterByCatch(pool, opts.catch);
  for (const n of filtered) sanitizeId(n.id);

  const callEdges = edges.filter((e) => e.type === 'calls');
  const { selected, omitted } = selectNodes(filtered, callEdges, opts);
  const selectedIds = new Set(selected.map((n) => n.id));

  const lines: string[] = ['flowchart TD'];
  for (const n of [...selected].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  ${sanitizeId(n.id)}["${sanitizeMermaidLabel(n.label)}"]`);
  }

  const seen = new Set<string>();
  for (const e of callEdges) {
    if (!selectedIds.has(e.source) || !selectedIds.has(e.target)) continue;
    const line = `  ${sanitizeId(e.source)} ${edgeArrow(e.confidence)} ${sanitizeId(e.target)}`;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }

  if (omitted > 0) {
    lines.push(`  %% truncated: ${omitted} nodes omitted`);
  }

  return lines.join('\n') + '\n';
}

function selectFlowFunctions(
  nodes: NormNode[],
  kind: 'cfg' | 'dfg',
  opts: MermaidRenderOptions
): { fns: NormNode[]; hasFlow: boolean } {
  const withFlow = nodes.filter((n) => (kind === 'cfg' ? Boolean(n.cfg) : Boolean(n.dfg)));
  let matched = filterByCatch(withFlow, opts.catch);
  if (opts.anchor && opts.anchor.trim()) {
    const anchored = findAnchorSeeds(matched, opts.anchor.trim(), opts.root);
    if (anchored.length > 0) matched = anchored;
  }
  const fns = matched.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  return { fns, hasFlow: withFlow.length > 0 };
}

/** Comment line for an empty cfg/dfg view; separates "graph lacks flow data" from "no function matched". */
function emptyFlowMessage(
  kind: 'cfg' | 'dfg',
  hasFlow: boolean,
  patterns: string[] | undefined
): string {
  const label = kind === 'cfg' ? 'CFG' : 'DFG';
  const shown = (patterns ?? []).filter(Boolean);
  if (hasFlow && shown.length > 0) {
    const list = shown.map((p) => p.replace(/[\r\n]+/g, ' ')).join(', ');
    return `flowchart TD\n  %% no function with ${label} data matched pattern(s): ${list}\n`;
  }
  const withName = kind === 'cfg' ? 'control-flow' : 'data-flow';
  return `flowchart TD\n  %% no ${label} data found (run with --flow or --with ${withName})\n`;
}

function renderCfg(nodes: NormNode[], opts: MermaidRenderOptions): string {
  const sanitizeId = createIdSanitizer();
  const maxNodes = typeof opts.maxNodes === 'number' && opts.maxNodes > 0 ? Math.floor(opts.maxNodes) : DEFAULT_MAX_NODES;
  const { fns, hasFlow } = selectFlowFunctions(nodes, 'cfg', opts);

  if (fns.length === 0) return emptyFlowMessage('cfg', hasFlow, opts.catch);

  const lines: string[] = ['flowchart TD'];
  let totalRendered = 0;
  let totalAvailable = 0;
  for (const fn of fns) totalAvailable += fn.cfg!.nodes.length;

  for (const fn of fns) {
    if (totalRendered >= maxNodes) break;
    const cfg = fn.cfg!;
    const subId = sanitizeId(`fn_${fn.id}`);
    const fnLabel = sanitizeMermaidLabel(fn.label);
    lines.push(`  subgraph ${subId}["${fnLabel}"]`);

    const budget = maxNodes - totalRendered;
    const keptNodes = cfg.nodes.slice(0, budget);
    const keptIds = new Set(keptNodes.map((n) => n.id));
    totalRendered += keptNodes.length;

    for (const n of keptNodes) {
      const nid = sanitizeId(`${fn.id}::${n.id}`);
      const lbl = sanitizeMermaidLabel(n.label || n.kind);
      lines.push(`    ${nid}["${lbl}"]`);
    }

    for (const e of cfg.edges) {
      if (!keptIds.has(e.from) || !keptIds.has(e.to)) continue;
      const fromId = sanitizeId(`${fn.id}::${e.from}`);
      const toId = sanitizeId(`${fn.id}::${e.to}`);
      if (e.label) {
        lines.push(`    ${fromId} -->|"${sanitizeMermaidLabel(e.label)}"| ${toId}`);
      } else {
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }

    lines.push('  end');
  }

  const omitted = Math.max(0, totalAvailable - totalRendered);
  if (omitted > 0) {
    lines.push(`  %% truncated: ${omitted} nodes omitted`);
  }

  return lines.join('\n') + '\n';
}

function renderDfg(nodes: NormNode[], opts: MermaidRenderOptions): string {
  const sanitizeId = createIdSanitizer();
  const maxNodes = typeof opts.maxNodes === 'number' && opts.maxNodes > 0 ? Math.floor(opts.maxNodes) : DEFAULT_MAX_NODES;
  const { fns, hasFlow } = selectFlowFunctions(nodes, 'dfg', opts);

  if (fns.length === 0) return emptyFlowMessage('dfg', hasFlow, opts.catch);

  const lines: string[] = ['flowchart TD'];
  let totalRendered = 0;
  let totalAvailable = 0;
  for (const fn of fns) {
    totalAvailable += fn.dfg!.nodes.length + fn.dfg!.sites.length;
  }

  for (const fn of fns) {
    if (totalRendered >= maxNodes) break;
    const dfg = fn.dfg!;
    const subId = sanitizeId(`fn_${fn.id}`);
    const fnLabel = sanitizeMermaidLabel(fn.label);
    lines.push(`  subgraph ${subId}["${fnLabel}"]`);

    const keptDefs = new Set<string>();
    const keptSites = new Set<string>();

    for (const d of dfg.nodes) {
      if (totalRendered >= maxNodes) break;
      keptDefs.add(d.id);
      totalRendered++;
      const did = sanitizeId(`${fn.id}::def::${d.id}`);
      const lbl = sanitizeMermaidLabel(`${d.name} (${d.kind})`);
      lines.push(`    ${did}["${lbl}"]`);
    }

    for (const s of dfg.sites) {
      if (totalRendered >= maxNodes) break;
      keptSites.add(s.id);
      totalRendered++;
      const sid = sanitizeId(`${fn.id}::site::${s.id}`);
      const lbl = sanitizeMermaidLabel(s.label || s.id);
      lines.push(`    ${sid}["${lbl}"]`);
    }

    for (const e of dfg.edges) {
      if (!keptDefs.has(e.from) || !keptSites.has(e.to)) continue;
      const fromId = sanitizeId(`${fn.id}::def::${e.from}`);
      const toId = sanitizeId(`${fn.id}::site::${e.to}`);
      lines.push(`    ${fromId} --> ${toId}`);
    }

    lines.push('  end');
  }

  const omitted = Math.max(0, totalAvailable - totalRendered);
  if (omitted > 0) {
    lines.push(`  %% truncated: ${omitted} nodes omitted`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Render an XrayGraph or SerializedGraph as deterministic Mermaid flowchart syntax.
 */
export function renderMermaid(
  graph: XrayGraph | SerializedGraph,
  opts: MermaidRenderOptions = {}
): string {
  const { nodes, edges } = normalizeGraph(graph);
  const view = opts.view ?? 'architecture';

  switch (view) {
    case 'calls':
      return renderCalls(nodes, edges, opts);
    case 'cfg':
      return renderCfg(nodes, opts);
    case 'dfg':
      return renderDfg(nodes, opts);
    case 'architecture':
    default:
      return renderArchitecture(nodes, edges, opts);
  }
}
