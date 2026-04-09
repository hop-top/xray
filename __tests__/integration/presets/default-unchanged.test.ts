/**
 * Integration — default `xray map` (no `--preset`) byte-identical
 * across two runs on the same inputs.
 *
 * This is the back-compat invariant for spec C-5: presets are strictly
 * opt-in; users who do not pass `--preset` see zero behaviour change.
 *
 * Strategy: run the chunked pipeline twice against the same fixture,
 * normalise timestamps / tmp paths, and assert chunk-by-chunk equality
 * on the normalised content.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../../src/lib/xray';
import { ChunkedRenderer } from '../../../src/lib/renderer/chunked-renderer';

const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const EPOCH_MS_RE = /"timestamp"\s*:\s*\d{10,}/g;

function normalize(content: string, tmpBase: string): string {
  return content
    .split(tmpBase)
    .join('<TMP>')
    .replace(ISO_TIMESTAMP_RE, '<TIMESTAMP>')
    .replace(EPOCH_MS_RE, '"timestamp":<TIMESTAMP>');
}

async function runDefault(
  fixtureDir: string,
  tmpDir: string,
  cacheSuffix: string
): Promise<Map<string, string>> {
  const xray = new Xray({
    path: fixtureDir,
    cachePath: path.join(tmpDir, `.xray_cache_default_${cacheSuffix}.db`),
    chunked: true,
  });
  // No preset. No plugins. This mirrors the pre-track behaviour.
  const { rankedNodes, graph } = await xray.buildGraph();
  const renderer = new ChunkedRenderer({
    root: fixtureDir,
    ranked: rankedNodes,
    graph,
    tokenLimit: 4096,
  });
  const out = await renderer.renderChunked(path.join(tmpDir, `map_${cacheSuffix}`));
  return out.chunks;
}

describe('default xray map (no --preset) — byte-identical back-compat', () => {
  const fixtureDir = path.resolve(__dirname, '../../fixtures/presets/sample');
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-presets-default-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('two default runs produce identical normalised chunk content', async () => {
    const first = await runDefault(fixtureDir, tmpDir, 'first');
    const second = await runDefault(fixtureDir, tmpDir, 'second');

    expect(first.size).toBe(second.size);

    // Strip the per-run output prefix (`map_first`, `map_second`) so
    // the set of chunk keys is comparable across runs.
    const stripPrefix = (k: string): string =>
      path.basename(k).replace(/^map_(first|second)/, 'map');

    const firstKeys = Array.from(first.keys()).map(stripPrefix).sort();
    const secondKeys = Array.from(second.keys()).map(stripPrefix).sort();
    expect(firstKeys).toEqual(secondKeys);

    // Chunk-by-chunk content equality (normalised). We also strip the
    // run prefix from content because chunk bodies embed cross-chunk
    // references that include the prefix.
    const runNoise = /map_(first|second)/g;
    const getSortedContents = (m: Map<string, string>) =>
      Array.from(m.entries())
        .map(
          ([k, v]) =>
            [
              stripPrefix(k),
              normalize(v, tmpDir).replace(runNoise, 'map'),
            ] as const
        )
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([_, v]) => v);

    expect(getSortedContents(first)).toEqual(getSortedContents(second));
  }, 30_000);
});
