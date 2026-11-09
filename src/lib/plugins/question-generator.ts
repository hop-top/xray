/**
 * QuestionGeneratorPlugin — onboarding-style question surface.
 *
 * Pipeline position: listens on `render:start`, which fires after
 * `graph:complete` and `rank:complete` (i.e. after confidence,
 * clustering, and surprise plugins have populated the graph +
 * stashed their side data). `xray-plumbing-init#4` guarantees the
 * `render:start` payload carries a `renderer` reference and that
 * emission is sequential, so we can safely call `addInsight` and
 * trust it lands on the renderer that will actually drive output.
 *
 * What it does:
 *   1. Reads `xray.getLastGraph()` for the final built graph.
 *   2. Reads the scan root from `event.renderer.getRoot()` — both
 *      MapRenderer and ChunkedRenderer expose it additively (see
 *      `src/lib/renderer/map-renderer.ts` / `chunked-renderer.ts`).
 *      Spec refers to `xray.getConfig().path`, but Xray core does
 *      not (and intentionally will not) expose a typed `getConfig`
 *      on `XrayLike`; the renderer instance already carries the
 *      root and is the natural single source of truth at this
 *      lifecycle stage.
 *   3. Calls the pure `generateQuestions` generator.
 *   4. Formats via `formatQuestionsMarkdown`.
 *   5. Pushes one insight block titled "Suggested Questions for
 *      Exploration" via `event.renderer.addInsight(...)`.
 *
 * Degradation:
 *   - Missing graph → log + return.
 *   - Zero questions → return silently (no empty insight block).
 *   - Missing upstream surprises/modularity → individual templates
 *     handle their own fall-through and log warnings.
 *
 * Listener is `async` because `render:start` is emitted via
 * `emitAsync` (sequential). The body is sync-only work, but using
 * `async` matches the lifecycle contract and keeps the door open
 * for future IO (e.g. cached template lookup) without a signature
 * break.
 */

import { XrayPlugin, XrayLike } from '../events/plugin';
import { Logger } from '../logger';
import { generateQuestions, GenerateQuestionsOptions } from '../graph/questions';
import { formatQuestionsMarkdown } from '../graph/questions-format';
import { INSIGHT_STASH_NAMESPACE, Insight } from '../renderer/insight';

export interface QuestionGeneratorPluginOptions {
  /** Maximum number of questions to emit. Default: 5. */
  max?: number;
  /** Override the low-cohesion median threshold (spec R2). */
  lowCohesionMedian?: number;
  /** Override the low-cohesion minimum community size (spec R2). */
  lowCohesionMinSize?: number;
  /**
   * Override the insight title. Defaults to the spec-mandated
   * "Suggested Questions for Exploration".
   */
  insightTitle?: string;
}

const DEFAULT_INSIGHT_TITLE = 'Suggested Questions for Exploration';

export class QuestionGeneratorPlugin implements XrayPlugin {
  /** Mandatory constant — guards against double-register. */
  readonly name = 'question-generator';
  readonly version = '0.1.0';

  private readonly max: number;
  private readonly lowCohesionMedian?: number;
  private readonly lowCohesionMinSize?: number;
  private readonly insightTitle: string;

  constructor(opts: QuestionGeneratorPluginOptions = {}) {
    const rawMax = opts.max ?? 5;
    this.max =
      typeof rawMax === 'number' && Number.isFinite(rawMax)
        ? Math.max(0, Math.floor(rawMax))
        : 5;
    this.lowCohesionMedian = opts.lowCohesionMedian;
    this.lowCohesionMinSize = opts.lowCohesionMinSize;
    this.insightTitle = opts.insightTitle ?? DEFAULT_INSIGHT_TITLE;
  }

  apply(xray: XrayLike): void {
    xray.on('render:start', async (event) => {
      try {
        const { graph } = xray.getLastGraph();
        if (!graph) {
          Logger.warn(
            '[question-generator] render:start fired with no last graph — skipping'
          );
          return;
        }

        const root = event.renderer.getRoot();
        const genOpts: GenerateQuestionsOptions = {
          max: this.max,
          root,
        };
        if (this.lowCohesionMedian !== undefined) {
          genOpts.lowCohesionMedian = this.lowCohesionMedian;
        }
        if (this.lowCohesionMinSize !== undefined) {
          genOpts.lowCohesionMinSize = this.lowCohesionMinSize;
        }

        const questions = generateQuestions(graph, xray, genOpts);
        if (questions.length === 0) {
          Logger.debug(
            '[question-generator] no questions produced — skipping addInsight'
          );
          return;
        }

        const body = formatQuestionsMarkdown(questions, { root });
        const insight: Insight = { title: this.insightTitle, body };

        // Two writes, by design:
        //
        //   1) Direct addInsight on the renderer instance carried by
        //      `render:start`. This is the renderer that actually drives
        //      output in the non-chunked `Xray.run()` path.
        //
        //   2) Stash under the `'insights'` namespace. The chunked CLI
        //      path (`src/commands/generate.ts`) constructs its OWN
        //      `ChunkedRenderer` after `buildGraph()` and never re-emits
        //      `render:start`, so the renderer we just called addInsight
        //      on is observability-only in chunked mode (see the
        //      docstring on `Xray.buildGraph()`). The CLI drains the
        //      stash via `applyStashedInsights(xray, realRenderer)` so
        //      questions actually land in the real chunk output.
        //
        // Both code paths see the insight exactly once on the right
        // renderer instance — no dedup needed.
        event.renderer.addInsight(insight);
        xray.stash(INSIGHT_STASH_NAMESPACE, [insight]);

        Logger.debug(
          `[question-generator] pushed insight with ${questions.length} question(s)`
        );
      } catch (err) {
        Logger.error('QuestionGeneratorPlugin failed', err);
      }
    });
  }
}
