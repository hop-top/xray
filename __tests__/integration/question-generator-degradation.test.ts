/**
 * Degradation test — question generator with no upstream signals.
 *
 * Two complementary checks:
 *
 *   1. SYNTHETIC fixture (deterministic): a small graph with one
 *      orphan file → asserts the isolated-file template still fires
 *      and the renderer receives an insight. This is the contract
 *      assertion: degraded mode produces output.
 *
 *   2. REAL src/ (best-effort): runs QuestionGeneratorPlugin alone
 *      against this repo's own src/ tree. Asserts only what is
 *      content-stable: no crash, the buildGraph promise resolves,
 *      and the low-cohesion template logs a warning about missing
 *      clusteringModularity. Question count is NOT asserted because
 *      it depends on real repo content and would be brittle as
 *      src/ evolves.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const Graph = require('graphology');
import { Xray } from '../../src/lib/xray';
import { ChunkedRenderer } from '../../src/lib/renderer/chunked-renderer';
import { QuestionGeneratorPlugin } from '../../src/lib/plugins/question-generator';
import { generateQuestions } from '../../src/lib/graph/questions';
import { formatQuestionsMarkdown } from '../../src/lib/graph/questions-format';
import { Logger } from '../../src/lib/logger';

const INSIGHT_TITLE_HEADER = '## Suggested Questions for Exploration';

describe('question-generator degradation — no upstream signals (T-0062)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-qgen-degrade-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('synthetic graph with an orphan file produces an isolated-file question', () => {
    // Build a tiny graph: two connected files + one orphan. No upstream
    // clustering, no surprises, no confidence enrichment beyond builder
    // defaults — purely the isolated-file template's domain.
    const g = new Graph({ multi: true, type: 'directed' });
    g.addNode('src/connected/a.ts', { type: 'file', label: 'a.ts' });
    g.addNode('src/connected/b.ts', { type: 'file', label: 'b.ts' });
    g.addNode('src/orphan.ts', { type: 'file', label: 'orphan.ts' });
    g.addNode('src/connected/a.ts::main', {
      type: 'tag', file: 'src/connected/a.ts', label: 'main',
      kind: 'function', line: 1, endLine: 5,
    });
    g.addEdge('src/connected/a.ts', 'src/connected/a.ts::main', {
      type: 'defines', confidence: 'EXTRACTED',
    });
    g.addEdge('src/connected/a.ts', 'src/connected/b.ts', {
      type: 'imports', confidence: 'EXTRACTED',
    });
    g.addEdge('src/connected/b.ts', 'src/connected/a.ts', {
      type: 'imports', confidence: 'EXTRACTED',
    });
    // src/orphan.ts has no edges in or out → isolated-file fires.

    const fakeXray = {
      retrieve: () => [],
    };
    const questions = generateQuestions(g as any, fakeXray as any, {
      max: 5,
      root: '/project',
    });

    expect(questions.length).toBeGreaterThanOrEqual(1);
    const isolated = questions.find((q) => q.type === 'isolated-file');
    expect(isolated).toBeDefined();
    expect(isolated!.anchors?.[0]?.file).toBe('src/orphan.ts');

    // Format also produces the expected markdown structure.
    const md = formatQuestionsMarkdown(questions, { root: '/project' });
    expect(md).toContain('### ');
  });

  it('running on real src/ does not throw and logs a warning when bare', async () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const xray = new Xray({
      path: srcDir,
      cachePath: path.join(tmpDir, '.xray_cache.db'),
      chunked: true,
    });

    // ONLY the question generator — no confidence, no clustering,
    // no surprise analyzer.
    await xray.use(new QuestionGeneratorPlugin());

    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});

    let capturedRenderer: ChunkedRenderer | null = null;
    xray.on('render:start', (ev) => {
      capturedRenderer = ev.renderer as ChunkedRenderer;
    });

    // Contract: no crash, promise resolves.
    await expect(xray.buildGraph()).resolves.toBeDefined();
    expect(capturedRenderer).not.toBeNull();

    // Contract: low-cohesion template logs about missing modularity
    // when no clustering plugin ran. This is the only content-stable
    // assertion against a real repo — it depends on the template
    // logic, not on src/ topology.
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0] ?? ''));
    const warnedAboutUpstream = warnCalls.some(
      (msg) =>
        msg.includes('[question-generator] low-cohesion') ||
        msg.includes('clusteringModularity')
    );
    expect(warnedAboutUpstream).toBe(true);

    // Question count on real src/ is NOT asserted — it depends on
    // repo content and would be brittle. The synthetic test above is
    // the binding contract for "still produces output in degraded mode".
    void INSIGHT_TITLE_HEADER;

    warnSpy.mockRestore();
  }, 60_000);
});
