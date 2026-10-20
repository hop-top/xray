// __tests__/integration/confidence-enricher-snapshot.test.ts
//
// T-0027 — Snapshot non-regression for default `xray map` with the
// ConfidenceEnricherPlugin registered at empty-ruleset.
//
// Goal: prove that registering `ConfidenceEnricherPlugin({ rules: [] })`
// is a pure no-op on the rendered text output. Any future refactor that
// accidentally mutates event payloads, reorders listeners, or otherwise
// perturbs the rendered chunks will flip a hash and fail loudly.
//
// Strategy mirrors `xray-map-snapshot.test.ts` (T-0018): we compare
// chunk-level structural hashes, not full byte-for-byte content, so the
// test is robust to non-deterministic paths and timestamps. We explicitly
// exclude `SerializedGraph.metadata.timestamp` by normalizing ISO
// timestamps before hashing.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { ChunkedRenderer } from '../../src/lib/renderer/chunked-renderer';
import { ConfidenceEnricherPlugin } from '../../src/lib/plugins/confidence-enricher';

const ISO_TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const EPOCH_MS_RE = /"timestamp"\s*:\s*\d{10,}/g;

function normalizeContent(s: string, tmpBase: string): string {
  return s
    .split(tmpBase)
    .join('<TMP>')
    .replace(ISO_TIMESTAMP_RE, '<TIMESTAMP>')
    .replace(EPOCH_MS_RE, '"timestamp":<TIMESTAMP>');
}

function hashContent(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

interface ChunkShape {
  key: string;
  hash: string;
}

async function renderChunks(
  targetDir: string,
  tmpDir: string,
  withPlugin: boolean
): Promise<ChunkShape[]> {
  const xray = new Xray({
    path: targetDir,
    cachePath: path.join(
      tmpDir,
      `.xray_cache_${withPlugin ? 'with' : 'without'}.db`
    ),
    chunked: true,
  });

  if (withPlugin) {
    const plugin = new ConfidenceEnricherPlugin({ rules: [] });
    // `apply` is part of the plugin contract; calling it directly avoids
    // any coupling to internal PluginManager wiring since Xray does not
    // expose a public register method for ad-hoc plugins in this track.
    plugin.apply(xray as any);
  }

  const { rankedNodes, graph } = await xray.buildGraph();

  const renderer = new ChunkedRenderer({
    root: targetDir,
    ranked: rankedNodes,
    graph,
    tokenLimit: 4096,
    includeImports: false,
  });

  const outputBasePath = path.join(
    tmpDir,
    `map_${withPlugin ? 'with' : 'without'}`
  );
  const result = await renderer.renderChunked(outputBasePath);

  const chunks: ChunkShape[] = [];
  for (const [absKey, content] of result.chunks.entries()) {
    const relKey = path.relative(tmpDir, absKey) || path.basename(absKey);
    // Strip the plugin-variant suffix so the two runs share a comparable
    // key space (they write into different output bases by design).
    const normalizedKey = relKey.replace(/^map_(without|with)/, 'map');
    const normalized = normalizeContent(content, tmpDir);
    chunks.push({ key: normalizedKey, hash: hashContent(normalized) });
  }
  chunks.sort((a, b) => a.key.localeCompare(b.key));
  return chunks;
}

describe('ConfidenceEnricherPlugin — snapshot non-regression (T-0027)', () => {
  const examplesDir = path.resolve(__dirname, '../../examples');
  const fallbackFixture = path.resolve(__dirname, '../fixtures/plumbing');
  const targetDir = fs.existsSync(examplesDir) ? examplesDir : fallbackFixture;

  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-confidence-snap-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rendered text output is identical with and without an empty-ruleset plugin', async () => {
    const withoutPlugin = await renderChunks(targetDir, tmpDir, false);
    const withPlugin = await renderChunks(targetDir, tmpDir, true);

    // Same set of chunks, same rendered content hashes. An empty ruleset
    // must be a pure no-op over the default `xray map` path.
    expect(withPlugin).toEqual(withoutPlugin);
  });
});
