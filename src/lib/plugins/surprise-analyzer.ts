/**
 * SurpriseAnalyzerPlugin — scores surprise over graph edges on `rank:complete`.
 *
 * Pipeline position: AFTER the ranker and AFTER the clustering plugin
 * (ClusteringPlugin runs on `graph:complete`, Ranker runs after graph
 * build). This plugin listens on `rank:complete`, which the umbrella
 * preset enforces as the last lifecycle stage before rendering.
 *
 * What it does:
 *  1. Reads `event.graph` (augmented onto `rank:complete` by
 *     `xray-plumbing-init#3`) and `event.rankedNodes`.
 *  2. Calls the pure `scoreEdges(graph, rankings, opts)` scorer.
 *  3. Writes `surpriseScore` and `surpriseReasons` onto each scored edge
 *     via `graph.setEdgeAttribute`. Non-scored edges are left untouched.
 *  4. Stashes the top-N scored edges via `xray.stash('surprise', ...)`
 *     — the generic plumbing primitive landed by `xray-plumbing-init`.
 *     Typed sugar (`stashSurprises` / `getSurprises`) is exported from
 *     this module so downstream callers don't need to know the namespace
 *     string or re-implement the wrapper.
 *
 * Name: the mandatory constant `'surprise-analyzer'`. Duplicate-name
 * detection in `PluginManager.register` (`src/lib/events/plugin.ts`)
 * blocks double-register, which guards against the double-write /
 * stash-overwrite hazard.
 */

import { XrayPlugin, XrayLike } from '../events/plugin';
import { Logger } from '../logger';
import {
  scoreEdges,
  DEFAULT_HEURISTICS,
  Heuristic,
  ScoredEdge,
  SurpriseOptions,
} from '../graph/analyzer';
import { XrayGraph } from '../../types/graph';

/** Namespace under which scored surprise items are stashed. */
export const SURPRISE_STASH_NAMESPACE = 'surprise';

/** Typed sugar around `xray.stash` for surprise items. */
export function stashSurprises(xray: XrayLike, items: ScoredEdge[]): void {
  xray.stash(SURPRISE_STASH_NAMESPACE, items);
}

/** Typed sugar around `xray.retrieve` for surprise items. */
export function getSurprises(xray: XrayLike, n?: number): ScoredEdge[] {
  return xray.retrieve(SURPRISE_STASH_NAMESPACE, n) as ScoredEdge[];
}

export interface SurpriseAnalyzerPluginOptions {
  /** Number of top-scored edges to stash. Default: 5. */
  topN?: number;
  /** Override the default heuristic set. Default: `DEFAULT_HEURISTICS`. */
  heuristics?: readonly Heuristic[];
  /** Pass-through options to the scorer. */
  surpriseOptions?: SurpriseOptions;
}

export class SurpriseAnalyzerPlugin implements XrayPlugin {
  /** Mandatory constant — see plugin.ts duplicate-name guard. */
  readonly name = 'surprise-analyzer';
  readonly version = '0.1.0';

  private readonly topN: number;
  private readonly heuristics: readonly Heuristic[];
  private readonly surpriseOptions: SurpriseOptions;

  constructor(opts: SurpriseAnalyzerPluginOptions = {}) {
    // Defensive: topN is user input. Clamp to a non-negative integer.
    // Negative values would otherwise drop items from the end of the
    // sorted list via Array.prototype.slice's negative-index semantics,
    // and non-finite / non-number values would silently break the
    // stash. Default 5.
    const rawTopN = opts.topN ?? 5;
    this.topN =
      typeof rawTopN === 'number' && Number.isFinite(rawTopN)
        ? Math.max(0, Math.floor(rawTopN))
        : 5;
    this.heuristics = opts.heuristics ?? DEFAULT_HEURISTICS;
    this.surpriseOptions = opts.surpriseOptions ?? {};
  }

  apply(xray: XrayLike): void {
    xray.on('rank:complete', (event) => {
      try {
        const graph = event.graph as XrayGraph;
        const rankings = event.rankedNodes;

        const { scored, heuristicsActive } = scoreEdges(
          graph,
          rankings,
          this.surpriseOptions,
          this.heuristics
        );

        // Write per-edge attributes directly on the graph so downstream
        // renderers / serializers can read them without re-scoring.
        for (const s of scored) {
          graph.setEdgeAttribute(s.edgeId, 'surpriseScore', s.score);
          graph.setEdgeAttribute(s.edgeId, 'surpriseReasons', s.reasons);
        }

        // Stash the top-N via typed sugar — no casts, no private access.
        stashSurprises(xray, scored.slice(0, this.topN));

        Logger.debug(
          `[surprise-analyzer] scored=${scored.length} ` +
            `top=${Math.min(this.topN, scored.length)} ` +
            `heuristicsActive=[${heuristicsActive.join(',')}]`
        );
      } catch (err) {
        Logger.error('SurpriseAnalyzerPlugin failed', err);
      }
    });
  }
}
