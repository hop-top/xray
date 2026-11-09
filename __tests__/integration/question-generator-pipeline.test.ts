/**
 * Integration test — full question-generator pipeline on xray's own `src/`.
 *
 * Wires confidence + clustering + surprise + question-generator plugins in
 * the spec-mandated order, runs `xray.buildGraph()` on `src/`, captures the
 * renderer emitted via `render:start`, and renders the chunked output.
 *
 * Assertions are structural only — the task contract forbids locking exact
 * wording because templates evolve. We check:
 *   - the root chunk contains the "Suggested Questions for Exploration"
 *     insight block header
 *   - at least 2 `### ` question headings appear inside the insight block
 *
 * Hard blockers: ConfidenceEnricher (T-0023), Clustering (T-0032), Surprise
 * (T-0048), QuestionGenerator (T-0059) — all landed upstream of this test.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { ChunkedRenderer } from '../../src/lib/renderer/chunked-renderer';
import { applyStashedInsights } from '../../src/lib/renderer/insight';
import { ConfidenceEnricherPlugin } from '../../src/lib/plugins/confidence-enricher';
import { ClusteringPlugin } from '../../src/lib/plugins/clustering';
import { SurpriseAnalyzerPlugin } from '../../src/lib/plugins/surprise-analyzer';
import { QuestionGeneratorPlugin } from '../../src/lib/plugins/question-generator';

const INSIGHT_TITLE_HEADER = '## Suggested Questions for Exploration';

describe('question-generator full-pipeline integration (T-0061)', () => {
  const srcDir = path.resolve(__dirname, '../../src');
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-qgen-pipeline-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('produces >= 2 questions on xray src/ with full plugin stack', async () => {
    const xray = new Xray({
      path: srcDir,
      cachePath: path.join(tmpDir, '.xray_cache.db'),
      chunked: true,
    });

    // Spec-mandated plugin order: confidence enricher -> clustering ->
    // surprise analyzer -> question generator.
    await xray.use(new ConfidenceEnricherPlugin({ rules: [] }));
    await xray.use(new ClusteringPlugin());
    await xray.use(new SurpriseAnalyzerPlugin());
    await xray.use(new QuestionGeneratorPlugin());

    // Capture the renderer instance that buildGraph() emits via
    // render:start so we can actually render chunks after the plugin
    // has attached its insight. The plugin runs during
    // emitAsync('render:start', ...) inside buildGraph(), so by the
    // time this spy fires the insight is already on the renderer.
    let capturedRenderer: ChunkedRenderer | null = null;
    xray.on('render:start', (ev) => {
      capturedRenderer = ev.renderer as ChunkedRenderer;
    });

    await xray.buildGraph();

    expect(capturedRenderer).not.toBeNull();
    const renderer = capturedRenderer as unknown as ChunkedRenderer;

    const insights = renderer.getInsights();
    expect(insights.length).toBeGreaterThanOrEqual(1);

    const out = await renderer.renderChunked(path.join(tmpDir, 'map'));
    const rootContent = out.chunks.get(out.rootChunk);
    expect(rootContent).toBeDefined();
    expect(rootContent!).toContain(INSIGHT_TITLE_HEADER);

    // Count question headings (### ) inside the insight block (between
    // the insight title and the next ## or end of string).
    const titleIdx = rootContent!.indexOf(INSIGHT_TITLE_HEADER);
    const after = rootContent!.slice(titleIdx + INSIGHT_TITLE_HEADER.length);
    const nextH2 = after.search(/\n## /);
    const block = nextH2 === -1 ? after : after.slice(0, nextH2);
    const questionHeadings = block.match(/^### /gm) ?? [];
    expect(questionHeadings.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  // US-0001 regression: insight survives the chunked dual-renderer handoff.
  // Mirrors `src/commands/generate.ts` exactly: buildGraph() emits an
  // observability-only renderer, then we construct a SECOND renderer
  // (the one that actually writes chunks) and call applyStashedInsights
  // before renderChunked. This is the path real CLI users hit; the
  // captured-renderer assertion above only proves the plugin runs.
  it('insight survives buildGraph -> fresh ChunkedRenderer handoff (US-0001)', async () => {
    const xray = new Xray({
      path: srcDir,
      cachePath: path.join(tmpDir, '.xray_cache_us0001.db'),
      chunked: true,
    });

    await xray.use(new ConfidenceEnricherPlugin({ rules: [] }));
    await xray.use(new ClusteringPlugin());
    await xray.use(new SurpriseAnalyzerPlugin());
    await xray.use(new QuestionGeneratorPlugin());

    // Step 1: build graph. Plugin runs on render:start and stashes
    // its insight under the 'insights' namespace (also calls
    // addInsight on the observability-only renderer, which we
    // deliberately discard here).
    const { rankedNodes, graph } = await xray.buildGraph();

    // Step 2: construct a fresh ChunkedRenderer — exactly what
    // src/commands/generate.ts does. This is NOT the renderer the
    // plugin saw at render:start.
    const realRenderer = new ChunkedRenderer({
      root: srcDir,
      ranked: rankedNodes,
      graph,
      tokenLimit: 4096,
    });

    // Sanity: the real renderer has zero insights at this point.
    // The plugin's direct addInsight call landed on a different
    // (observability-only) instance.
    expect(realRenderer.getInsights().length).toBe(0);

    // Step 3: drain the stash into the real renderer.
    applyStashedInsights(xray, realRenderer);

    // Now the real renderer carries the insight.
    const realInsights = realRenderer.getInsights();
    expect(realInsights.length).toBeGreaterThanOrEqual(1);
    expect(realInsights[0]!.title).toBe('Suggested Questions for Exploration');

    // Step 4: render and assert the root chunk on disk contains the
    // insight section. This is the user-visible output.
    const out = await realRenderer.renderChunked(path.join(tmpDir, 'map_us0001'));
    const rootContent = out.chunks.get(out.rootChunk);
    expect(rootContent).toBeDefined();
    expect(rootContent!).toContain(INSIGHT_TITLE_HEADER);
    const titleIdx = rootContent!.indexOf(INSIGHT_TITLE_HEADER);
    const after = rootContent!.slice(titleIdx + INSIGHT_TITLE_HEADER.length);
    const nextH2 = after.search(/\n## /);
    const block = nextH2 === -1 ? after : after.slice(0, nextH2);
    const questionHeadings = block.match(/^### /gm) ?? [];
    expect(questionHeadings.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
