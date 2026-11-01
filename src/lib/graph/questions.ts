/**
 * Question generator — pure functions over graph state + upstream
 * plugin metadata that produce onboarding-style questions for humans.
 *
 * Design tenets:
 *  - Pure: no IO, no mutation of graph, no async. Deterministic for
 *    fixed graph state + fixed upstream signals.
 *  - Template-driven: each template is a standalone function with its
 *    own degradation path (`return []` when required signals absent).
 *  - Fixed order: ambiguous → bridge → isolated → cohesion. Truncated
 *    to `opts.max` (default 5) at the top level.
 *  - Reason matching is by `reason.code` (the stable enum contract
 *    from `src/lib/graph/analyzer.ts`), NEVER substring on `detail`.
 *
 * Consumers: `QuestionGeneratorPlugin`
 * (`src/lib/plugins/question-generator.ts`) wires this into the
 * `render:start` event and hands the formatted markdown off to the
 * renderer via `addInsight`.
 */

import { XrayGraph, NodeAttributes, EdgeAttributes } from '../../types/graph';
import { XrayLike } from '../events/plugin';
import { Logger } from '../logger';
import { getSurprises } from '../plugins/surprise-analyzer';
import { ScoredEdge, Reason } from './analyzer';
import { isClusteringEdge } from './cluster';
import { escapeMarkdown } from './questions-format';

/** Discriminated kind of question. */
export type QuestionType =
  | 'ambiguous-edge'
  | 'bridge-node'
  | 'isolated-file'
  | 'low-cohesion';

/** Anchor pointing at a file (+ optional line) for the formatter to link. */
export interface QuestionAnchor {
  file: string;
  line?: number;
}

/** A single onboarding question. */
export interface Question {
  type: QuestionType;
  question: string;
  why: string;
  howToInvestigate: string;
  anchors?: QuestionAnchor[];
}

/** Options passed to `generateQuestions`. */
export interface GenerateQuestionsOptions {
  /** Maximum number of questions to return. Default: 5. */
  max?: number;
  /**
   * Scan root (`xray.getConfig().path`). Retained on the options bag
   * so downstream formatter calls can strip the prefix without
   * re-reading config. Required.
   */
  root: string;
  /**
   * Low-cohesion threshold for median intra-community edges per node.
   * Default: 2 (spec R2 — exposed as an option).
   */
  lowCohesionMedian?: number;
  /** Low-cohesion minimum community size. Default: 5 (spec R2). */
  lowCohesionMinSize?: number;
}

/**
 * Generate onboarding questions from graph state + plugin metadata.
 *
 * Runs the four templates in fixed order (ambiguous → bridge →
 * isolated → cohesion) and truncates to `opts.max`. Each template
 * degrades to `[]` when its required upstream signal is missing; the
 * overall call never throws.
 */
export function generateQuestions(
  graph: XrayGraph,
  xray: XrayLike,
  opts: GenerateQuestionsOptions
): Question[] {
  const max = Math.max(0, opts.max ?? 5);
  const out: Question[] = [];

  const push = (qs: Question[]): void => {
    for (const q of qs) {
      if (out.length >= max) return;
      out.push(q);
    }
  };

  try {
    push(ambiguousEdgeTemplate(graph, xray));
  } catch (err) {
    Logger.warn(`[question-generator] ambiguous-edge template failed: ${(err as Error).message}`);
  }

  try {
    push(bridgeNodeTemplate(graph, xray));
  } catch (err) {
    Logger.warn(`[question-generator] bridge-node template failed: ${(err as Error).message}`);
  }

  try {
    push(isolatedFileTemplate(graph));
  } catch (err) {
    Logger.warn(`[question-generator] isolated-file template failed: ${(err as Error).message}`);
  }

  try {
    push(lowCohesionTemplate(graph, opts));
  } catch (err) {
    Logger.warn(`[question-generator] low-cohesion template failed: ${(err as Error).message}`);
  }

  return out.slice(0, max);
}

// ---------------------------------------------------------------------------
// Template: ambiguous-edge
// ---------------------------------------------------------------------------

/**
 * Ambiguous-edge template.
 *
 * Consumes `xray.getSurprises()` and filters results whose reasons
 * contain `code === 'confidence-gradient'`. These are edges where the
 * upstream confidence enricher flagged the relationship as `AMBIGUOUS`
 * — i.e. the tool isn't sure the call/import is real, and a human review
 * is the highest-value next action. INFERRED edges never reach here:
 * `scoreEdges` skips them.
 *
 * Emits up to 2 questions referencing the endpoint node IDs and their
 * parent files (best-effort anchor extraction). Reason matching is by
 * `reason.code` ONLY — the `detail` field is free-form human text and
 * may drift between analyzer versions.
 */
export function ambiguousEdgeTemplate(
  graph: XrayGraph,
  xray: XrayLike
): Question[] {
  const surprises = safeGetSurprises(xray);
  if (surprises.length === 0) return [];

  const matches = surprises.filter((s) =>
    s.reasons.some((r: Reason) => r.code === 'confidence-gradient')
  );
  if (matches.length === 0) return [];

  const out: Question[] = [];
  for (const edge of matches.slice(0, 2)) {
    const srcLabel = nodeLabel(graph, edge.source);
    const tgtLabel = nodeLabel(graph, edge.target);
    out.push({
      type: 'ambiguous-edge',
      question: `What is the actual relationship between ${srcLabel} and ${tgtLabel}?`,
      why: `The edge confidence is ambiguous — not extracted from source. Human review can confirm or remove it.`,
      howToInvestigate: `Open ${srcLabel} and ${tgtLabel}; check whether the reference is a real call/import or a pattern-match artefact.`,
      anchors: anchorsFor(graph, [edge.source, edge.target]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Template: bridge-node
// ---------------------------------------------------------------------------

/**
 * Bridge-node template.
 *
 * Filters `xray.getSurprises()` by `reason.code === 'cross-community'`
 * and picks the node that appears most often as an endpoint across
 * those results. That node is the proxy "bridge" — heuristic, not true
 * betweenness centrality.
 *
 * FUTURE UPGRADE: swap endpoint-frequency for
 * `graphology-metrics/betweenness-centrality` once real-repo
 * validation confirms the proxy is lossy on typical graphs (spec R1).
 * The present implementation intentionally avoids that dep.
 *
 * One question maximum per run.
 */
export function bridgeNodeTemplate(
  graph: XrayGraph,
  xray: XrayLike
): Question[] {
  const surprises = safeGetSurprises(xray);
  if (surprises.length === 0) return [];

  const crossCommunity = surprises.filter((s) =>
    s.reasons.some((r: Reason) => r.code === 'cross-community')
  );
  if (crossCommunity.length === 0) return [];

  const freq = new Map<string, number>();
  for (const edge of crossCommunity) {
    freq.set(edge.source, (freq.get(edge.source) ?? 0) + 1);
    freq.set(edge.target, (freq.get(edge.target) ?? 0) + 1);
  }

  // Pick the most-frequent node; tie-break deterministically on node
  // id via localeCompare so output is byte-stable across runs.
  let best: string | null = null;
  let bestCount = -1;
  for (const [nodeId, count] of freq.entries()) {
    if (
      count > bestCount ||
      (count === bestCount && best !== null && nodeId.localeCompare(best) < 0)
    ) {
      best = nodeId;
      bestCount = count;
    }
  }
  if (!best) return [];

  const label = nodeLabel(graph, best);
  const communities = describeCommunities(graph, best, crossCommunity);
  return [
    {
      type: 'bridge-node',
      question: `Why does ${label} bridge ${communities}?`,
      why: `${label} appears on ${bestCount} cross-community edge(s). It may be a shared utility, a leaky abstraction, or a seam worth splitting.`,
      howToInvestigate: `Inspect which communities reach ${label} and whether those dependencies reflect intent or accident.`,
      anchors: anchorsFor(graph, [best]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Template: isolated-file
// ---------------------------------------------------------------------------

/**
 * Isolated-file template.
 *
 * A file is "isolated" when no other file imports it (zero imports
 * in-degree) AND it imports nothing (zero imports out-degree) AND it
 * defines nothing (zero `defines` out-degree — which guards against
 * flagging newly-added stubs).
 *
 * Detection: counts inbound and outbound `imports`-typed edges plus
 * outbound `defines` edges per file node. Requires real `imports` edges
 * (emitted by `GraphBuilder.buildImportEdges` since the plumbing track).
 * No fallback to the unresolved `imports` node attribute array — those
 * entries carry module specifiers (e.g. `'./foo'`), not file-node ids,
 * so a naive `imports.source === fileNode` lookup almost never matches
 * and produces false positives. When the graph has no imports edges
 * (legacy serialized graph, or extraction failure), this template
 * silently returns no questions rather than guessing.
 *
 * Emits at most one question. Small synthetic graphs commonly trigger
 * this spuriously; the cap limits noise.
 */
export function isolatedFileTemplate(graph: XrayGraph): Question[] {
  const fileNodes: string[] = [];
  graph.forEachNode((nodeId: string, attrs: NodeAttributes) => {
    if (attrs.type === 'file') fileNodes.push(nodeId);
  });
  if (fileNodes.length === 0) return [];

  const usesImportEdges = graph
    .edges()
    .some((e: string) => graph.getEdgeAttribute(e, 'type') === 'imports');
  // No imports edges → cannot reliably detect isolation. Bail rather
  // than guess from unresolved specifier strings on the `imports` node
  // attribute (those are module specifiers, not file-node ids).
  if (!usesImportEdges) return [];

  const isolated: string[] = [];
  for (const nodeId of fileNodes) {
    const importsIn = countTypedEdges(graph, nodeId, 'imports', 'in');
    const importsOut = countTypedEdges(graph, nodeId, 'imports', 'out');
    const definesOut = countTypedEdges(graph, nodeId, 'defines', 'out');
    if (importsIn === 0 && importsOut === 0 && definesOut === 0) {
      isolated.push(nodeId);
    }
  }

  if (isolated.length === 0) return [];

  // Deterministic pick: lexicographically smallest path first.
  isolated.sort();
  const pick = isolated[0];
  return [
    {
      type: 'isolated-file',
      question: `Is ${pick} still used, or should it be removed?`,
      why: `No file imports or is imported by this file, and it defines no symbols reachable from the rest of the graph.`,
      howToInvestigate: `Search for references across the repo (including dynamic imports, config files, and build scripts) before deleting.`,
      anchors: [{ file: pick }],
    },
  ];
}

// ---------------------------------------------------------------------------
// Template: low-cohesion community
// ---------------------------------------------------------------------------

/**
 * Low-cohesion community template.
 *
 * Groups nodes by `attrs.community`, filters to communities with size
 * ≥ `lowCohesionMinSize` (default 5), computes the median count of
 * intra-community edges per node (non-INFERRED `calls` edges, the same
 * subset `cluster()` partitions on), and flags communities whose median
 * is below `lowCohesionMedian` (default 2).
 *
 * Guard: if `clusteringModularity` is below 0.1, the clustering signal
 * is too weak to act on. Returns `[]` and logs a warning. This also
 * covers the case where `logical-clustering-init` did not run at all
 * (in which case the attribute is missing, treated as 0).
 *
 * Emits at most one question, naming the community by its highest-
 * ranked node label.
 */
export function lowCohesionTemplate(
  graph: XrayGraph,
  opts: GenerateQuestionsOptions
): Question[] {
  const modularity = graph.getAttribute('clusteringModularity') as
    | number
    | undefined;
  if (typeof modularity !== 'number' || modularity < 0.1) {
    if (modularity === undefined) {
      Logger.warn(
        '[question-generator] low-cohesion template: no clusteringModularity attribute — skipping'
      );
    } else {
      Logger.warn(
        `[question-generator] low-cohesion template: modularity ${modularity.toFixed(3)} < 0.1 — signal too weak, skipping`
      );
    }
    return [];
  }

  const minSize = opts.lowCohesionMinSize ?? 5;
  const medianThreshold = opts.lowCohesionMedian ?? 2;

  // Group nodes by community, dropping sentinel (-1) and missing.
  const byCommunity = new Map<number, string[]>();
  graph.forEachNode((nodeId: string, attrs: NodeAttributes) => {
    const c = (attrs as { community?: number }).community;
    if (typeof c !== 'number' || c === -1) return;
    const bucket = byCommunity.get(c);
    if (bucket) bucket.push(nodeId);
    else byCommunity.set(c, [nodeId]);
  });

  for (const [cid, members] of byCommunity.entries()) {
    if (members.length < minSize) continue;
    const memberSet = new Set(members);

    // Intra-community edge count per node, over the same edge subset
    // clustering uses (non-INFERRED `calls` edges).
    const intraCounts: number[] = [];
    for (const nodeId of members) {
      let count = 0;
      graph.forEachEdge(
        nodeId,
        (
          _edgeId: string,
          attrs: EdgeAttributes,
          source: string,
          target: string
        ) => {
          if (!isClusteringEdge(attrs)) return;
          const other = source === nodeId ? target : source;
          if (memberSet.has(other)) count += 1;
        }
      );
      intraCounts.push(count);
    }

    const median = computeMedian(intraCounts);
    if (median >= medianThreshold) continue;

    // Pick a representative label (highest-degree node in the community).
    let repLabel: string = members[0];
    let bestDeg = -1;
    for (const nodeId of members) {
      const deg = graph.degree(nodeId);
      if (deg > bestDeg) {
        bestDeg = deg;
        repLabel = nodeLabel(graph, nodeId);
      }
    }

    return [
      {
        type: 'low-cohesion',
        question: `Should community ${cid} (${members.length} nodes, around ${repLabel}) be split?`,
        why: `Median intra-community call edges per node is ${median} (< ${medianThreshold}). The members are grouped but don't talk to each other much — the grouping may not reflect real coupling.`,
        howToInvestigate: `List the files in community ${cid}; check whether they form a coherent subsystem or whether Louvain pulled together unrelated files by weak signals.`,
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeGetSurprises(xray: XrayLike): ScoredEdge[] {
  try {
    return getSurprises(xray);
  } catch {
    return [];
  }
}

/**
 * Count edges of a given type incident to a node in the given
 * direction. Uses `forEachEdge` variants rather than `graph.degree`
 * because the typed-degree option we want (`{ type: ... }`) is not
 * uniformly available across graphology versions.
 */
function countTypedEdges(
  graph: XrayGraph,
  nodeId: string,
  edgeType: 'imports' | 'calls' | 'defines',
  direction: 'in' | 'out'
): number {
  let count = 0;
  const visitor = (_edgeId: string, attrs: EdgeAttributes): void => {
    if (attrs.type === edgeType) count += 1;
  };
  if (direction === 'in') {
    graph.forEachInEdge(nodeId, visitor);
  } else {
    graph.forEachOutEdge(nodeId, visitor);
  }
  return count;
}

/**
 * Extract a short, markdown-safe human label for a node id.
 *
 * For tag nodes, prefers `attrs.label`; for file nodes, uses the node
 * id (which is the relative path). Falls back to the id itself on any
 * lookup failure. The returned string is already run through
 * `escapeMarkdown()` so callers can interpolate it verbatim into
 * question text without re-escaping (spec R3). Any additional
 * presentation (e.g. wrapping the label in backticks) is a caller
 * choice — current templates interpolate bare to keep questions
 * scannable as plain prose.
 */
function nodeLabel(graph: XrayGraph, nodeId: string): string {
  const raw = rawNodeLabel(graph, nodeId);
  return escapeMarkdown(raw);
}

function rawNodeLabel(graph: XrayGraph, nodeId: string): string {
  try {
    if (!graph.hasNode(nodeId)) return nodeId;
    const attrs = graph.getNodeAttributes(nodeId) as {
      type?: string;
      label?: string;
    };
    if (attrs.type === 'tag' && typeof attrs.label === 'string' && attrs.label) {
      return attrs.label;
    }
    return nodeId;
  } catch {
    return nodeId;
  }
}

/**
 * Build anchors (file, line) for a set of node ids. Tag nodes resolve
 * to their parent file via `attrs.file` + `attrs.line`. File nodes map
 * to themselves with no line. Deduplicates by file path.
 */
function anchorsFor(graph: XrayGraph, nodeIds: string[]): QuestionAnchor[] {
  const seen = new Set<string>();
  const out: QuestionAnchor[] = [];
  for (const id of nodeIds) {
    try {
      if (!graph.hasNode(id)) continue;
      const attrs = graph.getNodeAttributes(id) as {
        type?: string;
        file?: string;
        line?: number;
      };
      if (attrs.type === 'file') {
        if (!seen.has(id)) {
          seen.add(id);
          out.push({ file: id });
        }
      } else if (attrs.type === 'tag' && typeof attrs.file === 'string') {
        const key = `${attrs.file}:${attrs.line ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            file: attrs.file,
            line:
              typeof attrs.line === 'number' ? attrs.line + 1 : undefined,
          });
        }
      }
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Build a short human description like "community 3 and 7" from a node
 * plus the cross-community surprises it participated in.
 */
function describeCommunities(
  graph: XrayGraph,
  nodeId: string,
  crossCommunity: ScoredEdge[]
): string {
  const others = new Set<number>();
  const nodeCommunity = nodeCommunityId(graph, nodeId);
  for (const edge of crossCommunity) {
    if (edge.source === nodeId) {
      const c = nodeCommunityId(graph, edge.target);
      if (c !== null && c !== nodeCommunity) others.add(c);
    } else if (edge.target === nodeId) {
      const c = nodeCommunityId(graph, edge.source);
      if (c !== null && c !== nodeCommunity) others.add(c);
    }
  }
  if (others.size === 0) return 'multiple communities';
  const sorted = Array.from(others).sort((a, b) => a - b);
  if (sorted.length === 1) {
    if (nodeCommunity !== null) {
      return `community ${nodeCommunity} and community ${sorted[0]}`;
    }
    return `community ${sorted[0]}`;
  }
  return `communities ${sorted.join(', ')}`;
}

function nodeCommunityId(graph: XrayGraph, nodeId: string): number | null {
  try {
    if (!graph.hasNode(nodeId)) return null;
    const attrs = graph.getNodeAttributes(nodeId) as { community?: number };
    return typeof attrs.community === 'number' ? attrs.community : null;
  } catch {
    return null;
  }
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
