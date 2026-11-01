/**
 * Surprise analyzer — deterministic heuristic scoring over graph edges.
 *
 * This file holds the type surface (ReasonCode enum, Heuristic signature,
 * RankIndex), individual heuristics, and the composing `scoreEdges`
 * function. Each heuristic is a pure function over graph topology +
 * rankings; `scoreEdges` does NOT mutate the graph. The plugin wrapper
 * at `src/lib/plugins/surprise-analyzer.ts` is the only writer of
 * `surpriseScore` / `surpriseReasons` edge attributes.
 *
 * Structured reasons (`ReasonCode` enum) are the stable contract with
 * downstream consumers — `question-generator-init` matches by
 * `reason.code`, never by substring.
 */

import { XrayGraph, EdgeAttributes, NodeAttributes, Confidence, RankedNode } from '../../types/graph';

/**
 * Stable reason codes — the contract with downstream consumers.
 * Changing any value is a breaking change for `question-generator-init`.
 */
export type ReasonCode =
  | 'cross-community'
  | 'confidence-gradient'
  | 'peripheral-hub'
  | 'cross-type-kind'
  | 'missing-input';

/** A structured reason produced by a heuristic. */
export interface Reason {
  code: ReasonCode;
  detail: string;
}

/** Per-heuristic return: a partial score + reason, or `null` (N/A). */
export type HeuristicResult = { score: number; reason: Reason } | null;

/** Rank-band classification for a single node, used by peripheral-hub. */
export type RankBand = 'top-decile' | 'top-quartile' | 'mid' | 'bottom-quartile';

/** Precomputed indices shared across heuristic invocations within one run. */
export interface RankIndex {
  /** Map from nodeId → numeric rank. */
  rankByNode: Map<string, number>;
  /** Top-decile threshold (rank >= this → top decile). */
  topDecile: number;
  /** Top-quartile threshold. */
  topQuartile: number;
  /** Bottom-quartile threshold (rank <= this → bottom quartile). */
  bottomQuartile: number;
  /** Helper: classify a node id into a `RankBand`. */
  bandOf(nodeId: string): RankBand | null;
}

/** Options bag passed to heuristics and scoreEdges. */
export interface SurpriseOptions {
  /**
   * Whether `focusNode` was set at rank time. When truthy, peripheral→hub
   * quartiles are anchor-relative (see spec R3) and the heuristic appends
   * ` (anchor-relative)` to its reason detail.
   */
  focusNode?: string;
  /** Experimental / gated heuristics. */
  experimental?: {
    /** Enable the cross-type-kind heuristic. Default: false. */
    crossKind?: boolean;
  };
  /** Optional per-heuristic weight overrides. Default: uniform 1.0. */
  weights?: Partial<Record<string, number>>;
}

/** Context handed to every heuristic invocation. */
export interface HeuristicContext {
  graph: XrayGraph;
  edgeId: string;
  source: string;
  target: string;
  attrs: EdgeAttributes;
  rankings: RankedNode[];
  rankIndex: RankIndex;
  opts: SurpriseOptions;
}

/**
 * Heuristic signature. A heuristic is a callable function with a `name`
 * property so the scorer can key weights, `heuristicsActive`, and tests
 * by a stable identifier. Heuristics MUST be deterministic and MUST NOT
 * mutate the graph.
 */
export interface Heuristic {
  readonly name: string;
  (ctx: HeuristicContext): HeuristicResult;
}

/**
 * Build a Heuristic by attaching a stable `name` to a plain function.
 *
 * Why `Object.defineProperty` and not `Object.assign({ name })`:
 * `Function.prototype.name` is `{ writable: false, configurable: true }`
 * per ES2015. `Object.assign` uses `[[Set]]` which throws in strict mode
 * (TypeScript emits `"use strict"`), so the module would fail to load on
 * first import. `Object.defineProperty` bypasses the writable check by
 * redefining the property, which is allowed because it is configurable.
 */
function defineHeuristic(
  name: string,
  fn: (ctx: HeuristicContext) => HeuristicResult
): Heuristic {
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  return fn as Heuristic;
}

// ---------------------------------------------------------------------------
// Heuristic: cross-community
// ---------------------------------------------------------------------------

/**
 * Cross-community heuristic.
 *
 * An edge whose source and target nodes live in different `community` ids
 * scores 1.0 — these are the bridge edges that stitch clusters together
 * and are almost always the most informative non-obvious connections.
 *
 * Missing `community` on either side is a degradation: the heuristic
 * returns a result with `score = 0` and reason
 * `{ code: 'missing-input', detail: 'community' }` so the scorer can
 * surface the degradation in its output without dropping the edge
 * entirely. The scorer treats `missing-input` reasons as non-active
 * (they do not push the heuristic name into `heuristicsActive`).
 */
export const crossCommunityHeuristic: Heuristic = defineHeuristic(
  'cross-community',
  (ctx: HeuristicContext): HeuristicResult => {
    const { graph, source, target } = ctx;
    const sAttrs = graph.getNodeAttributes(source) as NodeAttributes;
    const tAttrs = graph.getNodeAttributes(target) as NodeAttributes;
    const sc = (sAttrs as { community?: number }).community;
    const tc = (tAttrs as { community?: number }).community;

    // CLUSTER_SENTINEL (-1) means the node fell outside the clustering
    // subgraph (filtered out, no real community membership). Treat it
    // the same as a missing community so we don't report meaningless
    // boundaries between clustered and unclustered nodes.
    const sMissing = typeof sc !== 'number' || sc === -1;
    const tMissing = typeof tc !== 'number' || tc === -1;
    if (sMissing || tMissing) {
      return {
        score: 0,
        reason: { code: 'missing-input', detail: 'community' },
      };
    }

    if (sc !== tc) {
      return {
        score: 1.0,
        reason: { code: 'cross-community', detail: `${sc}→${tc}` },
      };
    }

    return null;
  }
);

// ---------------------------------------------------------------------------
// Heuristic: confidence-gradient
// ---------------------------------------------------------------------------

/**
 * Confidence-gradient heuristic.
 *
 * Maps the edge's `confidence` attribute (produced by
 * `confidence-level-init`) into a surprise score:
 *
 *   AMBIGUOUS → 1.0  (unresolved — almost certainly worth surfacing)
 *   INFERRED  → null (global name-match fallback — noise, not signal)
 *   EXTRACTED → null (ground truth, not a surprise — do not contribute)
 *
 * INFERRED edges are the builder's unscoped name-match fallback; on real
 * repos they are numerous and mostly false positives, so scoring them
 * floods surprises/questions. `scoreEdges` skips them entirely; this
 * branch keeps direct callers consistent. Returning `null` keeps
 * `heuristicsActive` honest: the heuristic is only "active" for edges
 * whose confidence is actually suspect. Missing the field entirely is a degradation, reported as
 * `{ code: 'missing-input', detail: 'confidence' }` with score 0 so
 * the scorer composition logic stays uniform with cross-community.
 */
export const confidenceGradientHeuristic: Heuristic = defineHeuristic(
  'confidence-gradient',
  (ctx: HeuristicContext): HeuristicResult => {
    const { attrs } = ctx;
    const c = attrs.confidence;

    if (c === undefined || c === null) {
      return {
        score: 0,
        reason: { code: 'missing-input', detail: 'confidence' },
      };
    }

    switch (c) {
      case Confidence.AMBIGUOUS:
        return {
          score: 1.0,
          reason: { code: 'confidence-gradient', detail: String(c) },
        };
      case Confidence.INFERRED:
      case Confidence.EXTRACTED:
        return null;
      default:
        // Unknown value — treat as missing input rather than silently
        // returning 0, so the degradation is surfaced on the edge.
        return {
          score: 0,
          reason: { code: 'missing-input', detail: 'confidence' },
        };
    }
  }
);

// ---------------------------------------------------------------------------
// Rank index + peripheral→hub heuristic
// ---------------------------------------------------------------------------

/**
 * Build a `RankIndex` from a `RankedNode[]`. Precomputes thresholds once
 * per run so per-edge classification is O(1). An empty rankings array
 * yields an index whose `bandOf` always returns `null`.
 *
 * Quantiles are computed over the ranks as emitted by the ranker. When
 * `focusNode` was set at rank time, those ranks carry a 100× focus boost
 * and 10× neighbour boost (see `src/lib/graph/ranker.ts#37-44`), so
 * quartiles measure "near the anchor", not "structurally central". The
 * peripheral→hub heuristic reads `opts.focusNode` to annotate its reason
 * detail accordingly (spec R3).
 */
export function buildRankIndex(rankings: RankedNode[]): RankIndex {
  const rankByNode = new Map<string, number>();
  const sortedRanks: number[] = [];
  for (const r of rankings) {
    rankByNode.set(r.id, r.rank);
    sortedRanks.push(r.rank);
  }
  sortedRanks.sort((a, b) => a - b);

  const quantile = (q: number): number => {
    if (sortedRanks.length === 0) return 0;
    const idx = Math.floor(q * (sortedRanks.length - 1));
    return sortedRanks[idx]!;
  };

  const bottomQuartile = quantile(0.25);
  const topQuartile = quantile(0.75);
  const topDecile = quantile(0.9);

  const bandOf = (nodeId: string): RankBand | null => {
    const r = rankByNode.get(nodeId);
    if (r === undefined) return null;
    if (r >= topDecile) return 'top-decile';
    if (r >= topQuartile) return 'top-quartile';
    if (r <= bottomQuartile) return 'bottom-quartile';
    return 'mid';
  };

  return { rankByNode, topDecile, topQuartile, bottomQuartile, bandOf };
}

/**
 * Peripheral→hub heuristic.
 *
 * An edge scores 1.0 when one endpoint is in the bottom quartile of
 * rankings and the other is in the top decile — i.e. a "forgotten"
 * peripheral node is directly wired to a structural hub. All other
 * configurations score 0 (return null, no reason).
 *
 * ANCHOR-RELATIVE CAVEAT (spec R3): when `opts.focusNode` is set,
 * rankings were boosted around the anchor by the ranker, so the
 * quartiles are anchor-relative (e.g. "bottom quartile near this
 * module", not "global periphery"). The heuristic suffixes the reason
 * detail with ` (anchor-relative)` so downstream consumers understand
 * the framing — we do NOT attempt to reconstruct pre-boost PageRank.
 */
export const peripheralHubHeuristic: Heuristic = defineHeuristic(
  'peripheral-hub',
  (ctx: HeuristicContext): HeuristicResult => {
    const { source, target, rankIndex, opts } = ctx;
    const sBand = rankIndex.bandOf(source);
    const tBand = rankIndex.bandOf(target);
    if (!sBand || !tBand) return null;

    const isHit = (a: RankBand, b: RankBand): boolean =>
      (a === 'bottom-quartile' && b === 'top-decile') ||
      (a === 'top-decile' && b === 'bottom-quartile');

    if (!isHit(sBand, tBand)) return null;

    const suffix = opts.focusNode ? ' (anchor-relative)' : '';
    return {
      score: 1.0,
      reason: {
        code: 'peripheral-hub',
        detail: `${sBand}→${tBand}${suffix}`,
      },
    };
  }
);

// ---------------------------------------------------------------------------
// Heuristic: cross-type-kind (EXPERIMENTAL, opt-in)
// ---------------------------------------------------------------------------

/**
 * Cross-type-kind heuristic (EXPERIMENTAL).
 *
 * Fires on tag→tag edges whose endpoints have different `kind` values
 * AND live in different communities — e.g. a `class` in one package
 * reaching directly into a `function` in another. Scores 1.0 when both
 * conditions hold.
 *
 * Guards:
 * - Gated behind `opts.experimental.crossKind`; returns null by default
 *   to keep default output noise-free until real-repo validation
 *   confirms signal quality (spec R2).
 * - If either endpoint is a `file` node, returns null — file nodes have
 *   no `kind` attribute, and this heuristic is N/A rather than degraded
 *   for file edges (no `missing-input` reason emitted).
 * - Cross-kind within the same community is ignored: the "interesting"
 *   cases are the ones that also bridge clusters.
 */
export const crossTypeKindHeuristic: Heuristic = defineHeuristic(
  'cross-type-kind',
  (ctx: HeuristicContext): HeuristicResult => {
    const { graph, source, target, opts } = ctx;
    if (!opts.experimental?.crossKind) return null;

    const sAttrs = graph.getNodeAttributes(source) as NodeAttributes;
    const tAttrs = graph.getNodeAttributes(target) as NodeAttributes;
    if (sAttrs.type === 'file' || tAttrs.type === 'file') return null;

    const sKind = sAttrs.kind;
    const tKind = tAttrs.kind;
    if (!sKind || !tKind || sKind === tKind) return null;

    // Only fire when communities also differ (already a bridge).
    // Treat sentinel (-1) the same as missing (per cross-community heuristic).
    const sc = (sAttrs as { community?: number }).community;
    const tc = (tAttrs as { community?: number }).community;
    const sMissing = typeof sc !== 'number' || sc === -1;
    const tMissing = typeof tc !== 'number' || tc === -1;
    if (sMissing || tMissing || sc === tc) {
      return null;
    }

    return {
      score: 1.0,
      reason: { code: 'cross-type-kind', detail: `${sKind}→${tKind}` },
    };
  }
);

/**
 * Default heuristic set used by `scoreEdges` when none is supplied.
 * Exported as a mutable array on purpose so downstream tracks can extend
 * it at plugin registration time without forking this file.
 */
export const DEFAULT_HEURISTICS: Heuristic[] = [
  crossCommunityHeuristic,
  confidenceGradientHeuristic,
  peripheralHubHeuristic,
  crossTypeKindHeuristic,
];

// ---------------------------------------------------------------------------
// scoreEdges — composition + per-run min-max normalisation
// ---------------------------------------------------------------------------

/** One scored edge in the output of `scoreEdges`. */
export interface ScoredEdge {
  edgeId: string;
  source: string;
  target: string;
  score: number;
  reasons: Reason[];
}

/** Return shape of `scoreEdges`. */
export interface ScoreEdgesResult {
  scored: ScoredEdge[];
  heuristicsActive: string[];
}

/**
 * Deterministic surprise scorer.
 *
 * Runs every heuristic over every edge in `graph`, sums the weighted
 * partial scores, collects reasons, and per-run min-max normalises into
 * `[0, 1]`. Returns a sorted-desc array of scored edges plus the set of
 * heuristic names that produced at least one non-null, non-`missing-input`
 * result across the whole run (`heuristicsActive`).
 *
 * Contract:
 * - INFERRED edges are skipped before any heuristic runs: they never
 *   appear in `scored` and never mark a heuristic active.
 * - Does NOT mutate the graph. Tests assert deep-equality pre/post.
 * - Every returned edge has `reasons.length >= 1`. Edges where every
 *   heuristic returned `null` are dropped from the output.
 * - Degenerate case: if `rawMax === rawMin` (all-zero or all-equal raw
 *   scores) every normalised score is 0 — never `NaN` / `Infinity`.
 * - `heuristicsActive` is alphabetically sorted so output is
 *   byte-identical across runs with the same inputs.
 * - Tie-break on equal scores is `edgeId.localeCompare` for determinism.
 */
export function scoreEdges(
  graph: XrayGraph,
  rankings: RankedNode[],
  opts: SurpriseOptions = {},
  heuristics: readonly Heuristic[] = DEFAULT_HEURISTICS
): ScoreEdgesResult {
  const rankIndex = buildRankIndex(rankings);
  const activeNames = new Set<string>();

  interface RawEntry {
    edgeId: string;
    source: string;
    target: string;
    rawScore: number;
    reasons: Reason[];
  }
  const raw: RawEntry[] = [];

  graph.forEachEdge((edgeId: string, attrs: EdgeAttributes, source: string, target: string) => {
    if (attrs.confidence === Confidence.INFERRED) return;

    const ctx: HeuristicContext = {
      graph,
      edgeId,
      source,
      target,
      attrs: attrs as EdgeAttributes,
      rankings,
      rankIndex,
      opts,
    };

    let rawScore = 0;
    const reasons: Reason[] = [];

    for (const h of heuristics) {
      const result = h(ctx);
      if (result === null) continue;
      // Defensive: weights are user input. Reject NaN, ±Infinity, and
      // non-numbers. Negative weights are also rejected because the
      // min-max normalisation downstream assumes non-negative raw scores
      // (composing with a negative would invert the surprise ordering).
      // Fall back to 1.0 (the default) for any invalid value.
      const rawWeight = opts.weights?.[h.name];
      const weight =
        typeof rawWeight === 'number' && Number.isFinite(rawWeight) && rawWeight >= 0
          ? rawWeight
          : 1.0;
      rawScore += result.score * weight;
      reasons.push(result.reason);
      // Only mark "active" if this was a real signal, not a degradation.
      if (result.reason.code !== 'missing-input') {
        activeNames.add(h.name);
      }
    }

    if (reasons.length === 0) return;

    raw.push({ edgeId, source, target, rawScore, reasons });
  });

  if (raw.length === 0) {
    return { scored: [], heuristicsActive: [] };
  }

  // Per-run min-max normalisation. Guard against div-by-zero.
  let rawMin = Infinity;
  let rawMax = -Infinity;
  for (const e of raw) {
    if (e.rawScore < rawMin) rawMin = e.rawScore;
    if (e.rawScore > rawMax) rawMax = e.rawScore;
  }
  const span = rawMax - rawMin;

  const scored: ScoredEdge[] = raw.map((e) => ({
    edgeId: e.edgeId,
    source: e.source,
    target: e.target,
    score: span > 0 ? (e.rawScore - rawMin) / span : 0,
    reasons: e.reasons,
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.edgeId.localeCompare(b.edgeId);
  });

  const heuristicsActive = Array.from(activeNames).sort();

  return { scored, heuristicsActive };
}
