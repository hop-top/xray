/**
 * ConfidenceEnricherPlugin
 * ========================
 *
 * Overrides the builder-stamped `Confidence.EXTRACTED` default on
 * `graph:add-edge` events via a user-supplied synchronous rule chain.
 *
 * Rules are walked in registration order. The first rule returning a
 * non-`undefined` value wins — its result is written to
 * `event.attrs.confidence` and the chain short-circuits. No match leaves
 * the default untouched.
 *
 * ## Sync-only invariant
 *
 * Rules MUST be synchronous. `GraphBuilder` emits `edge:add` events
 * sequentially (see `src/lib/graph/builder.ts` `addFile()` and
 * `buildReferenceEdges()`), and the listener's mutation must complete
 * before `addEdge` reads `event.attrs` back. A rule that returns a
 * thenable would not be awaited inside this listener and would silently
 * fail to mutate `attrs`. We therefore assert at runtime that the result
 * is not a thenable (matching `AsyncEventEmitter`'s own duck-type check).
 *
 * TypeScript cannot enforce this at the type level because
 * `T | undefined` and `T | undefined | Promise<T>` are indistinguishable
 * without help, so the runtime assertion is the guard of record.
 *
 * ## Cross-plugin priority
 *
 * Within this plugin, the first rule wins. Across plugins, registration
 * order through `PluginManager.register` defines priority: earlier
 * plugins see the event first, and later plugins may overwrite the value
 * if their own rule matches.
 */

import { XrayPlugin, XrayLike } from '../events/plugin';
import { Confidence, EdgeAttributes } from '../../types/graph';

/**
 * Context handed to each confidence rule. Mirrors the subset of the
 * `graph:add-edge` payload relevant to confidence decisions.
 */
export interface ConfidenceRuleContext {
  source: string;
  target: string;
  type: 'defines' | 'calls' | 'imports';
  attrs: EdgeAttributes | undefined;
}

/**
 * A confidence rule. Returns a `Confidence` value to override the edge,
 * or `undefined` to delegate to the next rule.
 *
 * Rules MUST be synchronous. Returning a `Promise` throws at runtime.
 */
export type ConfidenceRule = (
  ctx: ConfidenceRuleContext
) => Confidence | undefined;

export interface ConfidenceEnricherOptions {
  rules: ConfidenceRule[];
}

export class ConfidenceEnricherPlugin implements XrayPlugin {
  readonly name = 'confidence-enricher';
  readonly version = '0.1.0';

  private readonly rules: ConfidenceRule[];

  constructor(options: ConfidenceEnricherOptions) {
    this.rules = options.rules;
  }

  apply(xray: XrayLike): void {
    xray.on('graph:add-edge', (event) => {
      const ctx: ConfidenceRuleContext = {
        source: event.source,
        target: event.target,
        type: event.type,
        attrs: event.attrs,
      };

      for (const rule of this.rules) {
        // Cast to `unknown` so the runtime thenable check still compiles
        // after TS narrows the declared return type to `Confidence | undefined`.
        const result: unknown = (rule as (c: ConfidenceRuleContext) => unknown)(ctx);

        // Sync-only invariant. Duck-type for any thenable rather than a
        // bare `instanceof Promise` so non-native promise libraries
        // (Bluebird, etc.) and polyfills are also caught. Matches the
        // detection pattern used by `AsyncEventEmitter`.
        if (
          result !== null &&
          typeof result === 'object' &&
          typeof (result as { then?: unknown }).then === 'function'
        ) {
          throw new Error(
            'ConfidenceEnricherPlugin: confidence rules MUST be synchronous ' +
              '(rule returned a thenable). Rewrite the rule without async/await.'
          );
        }

        if (result !== undefined) {
          // GraphBuilder reads `event.attrs` back from this same event
          // object after the emit returns to construct the edge. If a
          // rule matched but `attrs` is missing (e.g. for a future
          // event source that does not pre-stamp attrs), initialize it
          // here so the override is not silently dropped. The `type`
          // field is required by `BaseEdgeAttributes` and is always
          // present on the event itself.
          if (!event.attrs) {
            event.attrs = {
              type: event.type,
              confidence: result as Confidence,
            };
          } else {
            event.attrs.confidence = result as Confidence;
          }
          return; // short-circuit on first hit
        }
      }
      // No rule matched → leave builder-stamped EXTRACTED default.
    });
  }
}
