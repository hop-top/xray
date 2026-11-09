/**
 * Shared insight type + stash drain helper.
 *
 * Plugins push insight blocks via `renderer.addInsight(insight)` on the
 * `render:start` event. In the non-chunked `run()` path the renderer
 * instance emitted at `render:start` IS the renderer that produces
 * output, so the direct call lands. In the chunked CLI path
 * (`src/commands/generate.ts`), `buildGraph()` emits a different
 * `ChunkedRenderer` instance from the one `generate.ts` constructs and
 * actually drives — see the docstring on `Xray.buildGraph()`. To keep
 * insights flowing in chunked mode, plugins ALSO stash the same insight
 * payload under the `'insights'` namespace, and `generate.ts` calls
 * `applyStashedInsights(xray, realRenderer)` after constructing the
 * real renderer.
 *
 * The stash + apply pattern is renderer-agnostic and decouples
 * insight-emitting plugins from the dual-renderer chunked-mode design.
 */

import type { XrayLike } from '../events/plugin';

export interface Insight {
  title: string;
  body: string;
}

/** Renderer surface required by `applyStashedInsights`. Both
 *  `MapRenderer` and `ChunkedRenderer` implement this additively. */
export interface InsightSink {
  addInsight(insight: Insight): void;
}

/** Namespace under which insight blocks are stashed. */
export const INSIGHT_STASH_NAMESPACE = 'insights';

/**
 * Drain the insight stash from `xray` and push every entry into
 * `renderer` via `addInsight`. Safe to call multiple times — once
 * drained, the stash is reset on the next pipeline run via
 * `Xray.buildPipeline()`'s `stashes.clear()`.
 *
 * No-op when nothing has been stashed.
 */
export function applyStashedInsights(xray: XrayLike, renderer: InsightSink): void {
  const stashed = xray.retrieve(INSIGHT_STASH_NAMESPACE) as Insight[];
  if (!stashed || stashed.length === 0) return;
  for (const insight of stashed) {
    if (insight && typeof insight.title === 'string' && typeof insight.body === 'string') {
      renderer.addInsight(insight);
    }
  }
}
