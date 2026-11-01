/**
 * Blast-radius engine behind `xray impact <symbol>`.
 *
 * Level-synchronous BFS over inbound `calls` edges from every tag that
 * matches <symbol> (same matching as `query`: exact label/id or glob).
 * Each caller is reported once, at its SHORTEST depth; only edges on a
 * shortest path (caller depth = callee depth + 1) are kept, so the result
 * is a DAG rooted at the matched symbol(s).
 *
 * Not built on `FunctionAdapter.traverseCallers`: that DFS shares one
 * `visited` set across branches, so a caller first reached through a
 * longer branch keeps the longer depth and, once the depth cap is hit
 * there, its own callers are never visited.
 *
 * Confidence: every kept edge carries its `confidence`. A caller is
 * EXTRACTED only when some shortest path from it to a matched symbol is
 * EXTRACTED end to end; otherwise it takes the weaker edge's level.
 * `strict` ignores every non-EXTRACTED edge during the walk.
 */
import type { Confidence } from '../../types/graph';
import type { Styles } from '../tui';
import type { QueryResult } from './types';
import { findNodes } from './match';

export const DEFAULT_IMPACT_DEPTH = 3;

/** Callers listed per group line before "…and X more". */
const LISTED_PER_GROUP = 5;

export interface ImpactRoot {
  label: string;
  path: string;
}

export interface ImpactOptions {
  /** Caller levels to follow (>= 1). Default {@link DEFAULT_IMPACT_DEPTH}. */
  depth?: number;
  /** Follow EXTRACTED edges only. */
  strict?: boolean;
  /** `metadata.roots` of a merged multi-root graph. */
  roots?: ImpactRoot[];
}

export interface ImpactSymbol {
  id: string;
  name: string;
  kind?: string;
  file?: string;
  line?: number;
}

export interface ImpactNode extends ImpactSymbol {
  depth: number;
  group: string;
  confidence: Confidence;
}

export interface ImpactEdge {
  /** Caller. */
  from: string;
  /** Callee. */
  to: string;
  type: 'calls';
  confidence: Confidence;
}

export interface ImpactGroup {
  name: string;
  count: number;
  byDepth: Record<string, number>;
}

export interface ImpactCounts {
  callers: number;
  groups: number;
  byDepth: Record<string, number>;
  EXTRACTED: number;
  INFERRED: number;
  AMBIGUOUS: number;
}

export interface ImpactResult {
  symbol: { query: string; depth: number; strict: boolean; matches: ImpactSymbol[] };
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  groups: ImpactGroup[];
  counts: ImpactCounts;
}

/**
 * Group key for a node file: the root label on a merged multi-root graph
 * (every file is prefixed `<label>/`), else the first path segment under
 * the root (`internal/dispatch/x.go` -> `internal`); `.` for root files.
 */
export function groupKey(file: string | undefined, roots?: ImpactRoot[]): string {
  if (!file) return '.';
  const slash = file.indexOf('/');
  const first = slash < 0 ? undefined : file.slice(0, slash);
  if (roots && roots.length > 1) {
    const label = roots.find(r => file.startsWith(r.label + '/'))?.label;
    return label ?? first ?? '.';
  }
  return first ?? '.';
}

function toSymbol(id: string, attrs: any): ImpactSymbol {
  const s: ImpactSymbol = { id, name: attrs.label };
  if (attrs.kind !== undefined) s.kind = attrs.kind;
  if (attrs.file !== undefined) s.file = attrs.file;
  if (attrs.line !== undefined) s.line = attrs.line;
  return s;
}

/** Compute the callers of `symbol` up to `depth` levels. */
export function computeImpact(graph: any, symbol: string, opts: ImpactOptions = {}): ImpactResult {
  const maxDepth = opts.depth ?? DEFAULT_IMPACT_DEPTH;
  const strict = Boolean(opts.strict);

  const seeds = findNodes(symbol, graph);
  const seedSet = new Set(seeds);
  const dist = new Map<string, number>();
  const conf = new Map<string, Confidence>();
  for (const s of seeds) {
    dist.set(s, 0);
    conf.set(s, 'EXTRACTED');
  }

  const edges = new Map<string, ImpactEdge>();
  let frontier = seeds;
  for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
    const next: string[] = [];
    const weakest = new Map<string, Confidence>();
    const extracted = new Set<string>();

    for (const callee of frontier) {
      graph.forEachInEdge(callee, (_e: string, attrs: any, caller: string, _t: string, callerAttrs: any) => {
        if (attrs.type !== 'calls' || callerAttrs.type !== 'tag' || seedSet.has(caller)) return;
        const c: Confidence = attrs.confidence ?? 'EXTRACTED';
        if (strict && c !== 'EXTRACTED') return;

        const known = dist.get(caller);
        if (known === undefined) {
          dist.set(caller, d + 1);
          next.push(caller);
        } else if (known !== d + 1) {
          return; // not on a shortest path
        }

        const key = caller + '\0' + callee;
        const prev = edges.get(key);
        if (!prev) edges.set(key, { from: caller, to: callee, type: 'calls', confidence: c });
        else if (c === 'EXTRACTED') prev.confidence = c;

        if (c === 'EXTRACTED' && conf.get(callee) === 'EXTRACTED') extracted.add(caller);
        else if (!weakest.has(caller)) weakest.set(caller, c === 'EXTRACTED' ? conf.get(callee)! : c);
      });
    }

    for (const n of next) conf.set(n, extracted.has(n) ? 'EXTRACTED' : weakest.get(n) ?? 'INFERRED');
    frontier = next;
  }

  const nodes: ImpactNode[] = [];
  for (const [id, depth] of dist) {
    if (depth === 0) continue;
    const attrs = graph.getNodeAttributes(id);
    nodes.push({ ...toSymbol(id, attrs), depth, group: groupKey(attrs.file, opts.roots), confidence: conf.get(id)! });
  }
  nodes.sort((a, b) =>
    a.depth - b.depth ||
    a.group.localeCompare(b.group) ||
    (a.file ?? '').localeCompare(b.file ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.name.localeCompare(b.name)
  );

  const groupMap = new Map<string, ImpactGroup>();
  const byDepth: Record<string, number> = {};
  for (const n of nodes) {
    const g = groupMap.get(n.group) ?? { name: n.group, count: 0, byDepth: {} };
    g.count++;
    g.byDepth[n.depth] = (g.byDepth[n.depth] ?? 0) + 1;
    groupMap.set(n.group, g);
    byDepth[n.depth] = (byDepth[n.depth] ?? 0) + 1;
  }
  const groups = [...groupMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const edgeList = [...edges.values()];
  const counts: ImpactCounts = {
    callers: nodes.length,
    groups: groups.length,
    byDepth,
    EXTRACTED: 0,
    INFERRED: 0,
    AMBIGUOUS: 0,
  };
  for (const e of edgeList) counts[e.confidence]++;

  return {
    symbol: {
      query: symbol,
      depth: maxDepth,
      strict,
      matches: seeds.map(id => toSymbol(id, graph.getNodeAttributes(id))),
    },
    nodes,
    edges: edgeList,
    groups,
    counts,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/*
 * Graph lines are 0-based (tree-sitter rows). Human views (text, tree)
 * show editor lines, as the map renderers do; record formats (json, yaml,
 * table, csv) carry the graph value, as `query` does.
 */
const editorLine = (line: number | undefined) => (line == null ? undefined : line + 1);

/** `file:Lline` (editor line), the form callers and the tree use. */
function locationOf(file: string, line: number | undefined): string {
  const l = editorLine(line);
  return l != null ? `${file}:L${l}` : file;
}

function definedAt(s: ImpactSymbol): string {
  const loc = s.file ? locationOf(s.file, s.line) : '';
  return [s.kind, loc].filter(Boolean).join(', ');
}

/**
 * Note for a caller not reached by an all-EXTRACTED shortest path: its
 * lowercased confidence, shown as ` (inferred)` like map "used by" lines.
 */
const confidenceNote = (c: Confidence): string | undefined =>
  c === 'EXTRACTED' ? undefined : c.toLowerCase();

/** `fn (file:Ldef)`: callers are reported with their definition line. */
function callerRef(n: ImpactNode): string {
  const ref = n.file ? `${n.name} (${locationOf(n.file, n.line)})` : n.name;
  const note = confidenceNote(n.confidence);
  return note ? `${ref} (${note})` : ref;
}

/** Render the grouped summary (default `text` format). */
export function renderImpactText(r: ImpactResult, put: (line?: string) => void, s: Styles): void {
  const { matches, query } = r.symbol;
  if (matches.length === 0) {
    put(`${s.bold(query)}: no matching symbol in the graph`);
    return;
  }

  const head =
    matches.length === 1
      ? `${s.bold(matches[0].name)}${definedAt(matches[0]) ? ' (' + definedAt(matches[0]) + ')' : ''}`
      : `${s.bold(query)} (${matches.length} definitions)`;
  const tail = r.counts.callers === 0
    ? plural(0, 'caller', 'callers')
    : `${plural(r.counts.callers, 'caller', 'callers')} across ${plural(r.counts.groups, 'group', 'groups')}`;
  put(`${head} — ${tail}`);
  if (matches.length > 1) {
    const shown = matches.slice(0, LISTED_PER_GROUP).map(definedAt).join('; ');
    const more = matches.length > LISTED_PER_GROUP ? `; …and ${matches.length - LISTED_PER_GROUP} more` : '';
    put(s.muted(`  defined: ${shown}${more}`));
  }

  const depths = Object.keys(r.counts.byDepth).map(Number).sort((a, b) => a - b);
  for (const d of depths) {
    const indent = d === 1 ? '  ' : '    ';
    if (d > 1) put(`depth ${d}:`);
    const atDepth = r.nodes.filter(n => n.depth === d);
    const groupOrder = r.groups.map(g => g.name).filter(g => atDepth.some(n => n.group === g));
    for (const g of groupOrder) {
      const members = atDepth.filter(n => n.group === g);
      const listed = members.slice(0, LISTED_PER_GROUP).map(callerRef).join(', ');
      put(`${indent}${s.accent(g)}: ${plural(members.length, 'caller', 'callers')} — ${listed}`);
      if (members.length > LISTED_PER_GROUP) {
        put(s.muted(`${indent}  …and ${members.length - LISTED_PER_GROUP} more`));
      }
    }
  }

  // counts.EXTRACTED/INFERRED/AMBIGUOUS count kept edges, not callers.
  const footer = [`EXTRACTED ${r.counts.EXTRACTED}`, `INFERRED ${r.counts.INFERRED}`];
  if (r.counts.AMBIGUOUS > 0) footer.push(`AMBIGUOUS ${r.counts.AMBIGUOUS}`);
  put(s.muted(`edges: ${footer.join(' · ')}`));
}

/**
 * QueryResult view for query.ts `formatTree`: matched symbols (depth 0)
 * + callers, with editor (1-based) lines; edges run callee -> caller so
 * the tree is rooted at the symbol.
 */
export function impactToQueryResult(r: ImpactResult): QueryResult {
  const nodes: QueryResult['nodes'] = [
    ...r.symbol.matches.map(({ id, name, kind, file, line }) => ({ id, name, kind, file, line: editorLine(line), depth: 0 })),
    ...r.nodes.map(({ id, name, kind, file, line, depth, confidence }) => ({
      id, name, kind, file, line: editorLine(line), depth, note: confidenceNote(confidence),
    })),
  ];
  return {
    nodes,
    edges: r.edges.map(e => ({ from: e.to, to: e.from, type: e.type })),
    metadata: { syntax: 'impact', queryType: 'impact', executionTime: 0, resultCount: r.nodes.length },
  };
}
