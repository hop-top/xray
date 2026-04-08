/**
 * Performance sanity test for `scoreEdges`.
 *
 * Builds xray's own graph via the existing build path, then runs
 * `scoreEdges(graph, rankings)` and asserts wall-clock completion under
 * a budget. Captures regression if any heuristic becomes O(V^2) or
 * normalisation loses linearity.
 *
 * The budget is intentionally generous (default 2000ms) so the test is
 * a regression *guardrail*, not a microbenchmark. CI runners with CPU
 * contention or modest hardware should still pass comfortably; a 10x
 * slowdown will trip the alarm. Tighten via the
 * `XRAY_SURPRISE_PERF_BUDGET_MS` env var if your local box is fast and
 * you want a tighter check.
 *
 * Why this lives in `__tests__/graph/` rather than a standalone benchmark
 * directory: it's a guardrail asserted as part of the regular test
 * gate, not a freeform benchmark. Keeps the perf invariant in the same
 * place as the unit tests so a regression cannot slip past CI.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { scoreEdges } from '../../src/lib/graph/analyzer';
import { XrayGraph } from '../../src/types/graph';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const DEFAULT_BUDGET_MS = 2000;
const envBudget = Number(process.env.XRAY_SURPRISE_PERF_BUDGET_MS);
const PERF_BUDGET_MS =
  Number.isFinite(envBudget) && envBudget > 0 ? envBudget : DEFAULT_BUDGET_MS;

describe('scoreEdges performance (T-0051)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-surprise-perf-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it(`scores xray's own src/ graph in under ${PERF_BUDGET_MS}ms`, async () => {
    const xray = new Xray({
      path: SRC_DIR,
      cachePath: path.join(tmpDir, '.xray_cache.db'),
      chunked: true,
    });

    const { rankedNodes, graph } = await xray.buildGraph();

    const start = Date.now();
    const { scored } = scoreEdges(graph as XrayGraph, rankedNodes);
    const elapsed = Date.now() - start;

    // Sanity: we should have scored at least one edge on a real repo.
    expect(scored.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  }, 60_000);
});
