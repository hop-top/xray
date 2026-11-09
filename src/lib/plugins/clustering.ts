/**
 * ClusteringPlugin — runs Louvain community detection on the built graph.
 *
 * Hooks `graph:complete`, invokes `cluster()`, logs the resulting community
 * count and modularity, and relies on `cluster()`'s internal side effects
 * to stamp `community` node attributes plus the `clusteringModularity`
 * graph attribute.
 *
 * Upstream plumbing track (`xray-plumbing-init`) guarantees that
 * `graph:complete` is dispatched via `emitAsync` (sequential, attach-order),
 * so this plugin's mutation of node attributes is safe — no other listener
 * races against it.
 */
import { XrayPlugin, XrayLike } from '../events/plugin';
import { Logger } from '../logger';
import { cluster, ClusterOptions } from '../graph/cluster';
import { XrayGraph } from '../../types/graph';

export interface ClusteringPluginOptions extends ClusterOptions {
  /**
   * Modularity threshold below which the plugin emits a `log.warn`.
   * Defaults to `0.1`, matching the spec's "trivial partition" guardrail.
   */
  warnBelowModularity?: number;
}

export class ClusteringPlugin implements XrayPlugin {
  name = 'clustering';
  version = '1.0.0';

  private readonly clusterOpts: ClusterOptions;
  private readonly warnBelow: number;

  constructor(opts: ClusteringPluginOptions = {}) {
    const { warnBelowModularity, ...rest } = opts;
    this.clusterOpts = rest;
    this.warnBelow = warnBelowModularity ?? 0.1;
  }

  apply(xray: XrayLike): void {
    xray.on('graph:complete', async (event) => {
      try {
        const graph = event.graph as XrayGraph;
        const result = cluster(graph, this.clusterOpts);
        Logger.debug(
          `[clustering] communities=${result.count} modularity=${result.modularity.toFixed(4)}`
        );
        if (result.modularity < this.warnBelow) {
          Logger.warn(
            `Clustering modularity ${result.modularity.toFixed(4)} below ` +
              `${this.warnBelow} — partition is near-trivial (see spec R2).`
          );
        }
      } catch (err) {
        Logger.error('ClusteringPlugin failed', err);
      }
    });
  }
}
