// __tests__/integration/xray-map-snapshot.test.ts
//
// T-0018 — Backward-compat snapshot for default `xray map`.
//
// Locks the structural shape of `xray map`'s chunked output so accidental
// format drift (renderer changes, edge-type additions, serializer tweaks)
// shows up as a failing snapshot in CI / `just check` (or `npm test`, since
// this project has no justfile — jest auto-discovers this file).
//
// Strategy
// --------
// We snapshot STRUCTURE, not full chunk content:
//   - chunk count
//   - sorted list of chunk keys (relative to the tmp output dir)
//   - per-chunk byte length
//   - per-chunk content hash (sha1, first 12 hex chars) of
//     content with non-deterministic bits stripped
//
// Why structural and not full content?
//   1. Full chunk bodies contain absolute paths, timestamps (renderer
//      header), PageRank scores sensitive to tiny graph changes, etc.
//      That makes a byte-for-byte snapshot too brittle.
//   2. Chunk count + sorted keys + byte lengths + normalized-content hashes
//      still catch every interesting regression class: added/removed
//      chunks, renamed chunks, large content shifts, reordering.
//   3. `metadata.timestamp` in SerializedGraph
//      (`src/lib/query/types.ts#45`) is explicitly excluded here — we
//      normalize any ISO timestamp we see before hashing.
//
// Why not run `xray.run()` directly?
//   In chunked mode `run()` returns a placeholder
//   (`{ chunks: new Map(), rootChunk: '' }`) — the actual chunk writing is
//   driven by `src/commands/generate.ts`. To exercise the same code path
//   (and to lock the real output shape), we mimic what `generate.ts` does:
//     1. `xray.buildGraph()`   → shared pipeline, fires lifecycle events
//     2. construct `ChunkedRenderer` with the same inputs
//     3. `renderer.renderChunked(tmpOutputBasePath)`

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { ChunkedRenderer } from '../../src/lib/renderer/chunked-renderer';

// Deterministic ordering for keys and content normalization.
const ISO_TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const EPOCH_MS_RE = /"timestamp"\s*:\s*\d{10,}/g;

interface ChunkShape {
  key: string; // path relative to tmp base dir
  bytes: number;
  hash: string; // first 12 hex chars of sha1 of normalized content
}

interface SnapshotShape {
  chunkCount: number;
  rootChunkKey: string;
  chunks: ChunkShape[]; // sorted by key
}

function normalizeContent(s: string, tmpBase: string): string {
  return s
    // Strip absolute tmp path so snapshot is tmpdir-agnostic.
    .split(tmpBase)
    .join('<TMP>')
    // Strip ISO 8601 timestamps (renderer headers, SerializedGraph.metadata).
    .replace(ISO_TIMESTAMP_RE, '<TIMESTAMP>')
    // Strip epoch-ms "timestamp": fields in any embedded JSON.
    .replace(EPOCH_MS_RE, '"timestamp":<TIMESTAMP>');
}

function hashContent(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

describe('xray map — backward-compat snapshot (T-0018)', () => {
  const examplesDir = path.resolve(__dirname, '../../examples');

  // Fallback fixture if `examples/` ever disappears. Keeps the test honest
  // under reorganization.
  const fallbackFixture = path.resolve(
    __dirname,
    '../fixtures/plumbing'
  );

  const targetDir = fs.existsSync(examplesDir)
    ? examplesDir
    : fallbackFixture;

  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-map-snap-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('produces a stable chunk structure over examples/', async () => {
    const xray = new Xray({
      path: targetDir,
      // Force a cache path inside tmpDir so we don't pollute cwd.
      cachePath: path.join(tmpDir, '.xray_cache.db'),
      chunked: true,
    });

    const { rankedNodes, graph } = await xray.buildGraph();

    const includeIncs = false;
    const renderer = new ChunkedRenderer({
      root: targetDir,
      ranked: rankedNodes,
      graph,
      tokenLimit: 4096,
      includeImports: includeIncs,
    });

    const outputBasePath = path.join(tmpDir, 'map');
    const result = await renderer.renderChunked(outputBasePath);

    const chunkEntries: ChunkShape[] = [];
    for (const [absKey, content] of result.chunks.entries()) {
      const relKey = path.relative(tmpDir, absKey) || path.basename(absKey);
      const normalized = normalizeContent(content, tmpDir);
      chunkEntries.push({
        key: relKey,
        bytes: Buffer.byteLength(normalized, 'utf8'),
        hash: hashContent(normalized),
      });
    }

    chunkEntries.sort((a, b) => a.key.localeCompare(b.key));

    const snapshot: SnapshotShape = {
      chunkCount: chunkEntries.length,
      rootChunkKey:
        path.relative(tmpDir, result.rootChunk) ||
        path.basename(result.rootChunk),
      chunks: chunkEntries,
    };

    expect(snapshot).toMatchSnapshot();
  });

  // T-0038 — confirm that `grouping: 'directory'` (new options-bag default)
  // produces byte-identical chunk content to omitting the `grouping` field.
  // This guards against the clustering track's renderer refactor silently
  // altering the default chunked output.
  it('default grouping is byte-identical to explicit grouping: "directory"', async () => {
    const xray = new Xray({
      path: targetDir,
      cachePath: path.join(tmpDir, '.xray_cache_identity.db'),
      chunked: true,
    });

    const { rankedNodes, graph } = await xray.buildGraph();

    const defaultRenderer = new ChunkedRenderer({
      root: targetDir,
      ranked: rankedNodes,
      graph,
      tokenLimit: 4096,
    });

    const explicitRenderer = new ChunkedRenderer({
      root: targetDir,
      ranked: rankedNodes,
      graph,
      tokenLimit: 4096,
      grouping: 'directory',
    });

    const outDefault = await defaultRenderer.renderChunked(path.join(tmpDir, 'map_default'));
    const outExplicit = await explicitRenderer.renderChunked(path.join(tmpDir, 'map_explicit'));

    expect(outDefault.chunks.size).toBe(outExplicit.chunks.size);
    expect(outDefault.metadata.length).toBe(outExplicit.metadata.length);
    // Compare the set of keys modulo the prefix so we can detect any shape
    // drift between the two renderer instances.
    const keysOf = (m: Map<string, string>) =>
      Array.from(m.keys())
        .map((k) => path.basename(k).replace(/^map_(default|explicit)/, 'map'))
        .sort();
    expect(keysOf(outDefault.chunks)).toEqual(keysOf(outExplicit.chunks));
    // Byte-length equality for every normalized chunk content.
    const contentOf = (m: Map<string, string>) =>
      Array.from(m.entries())
        .map(([k, v]) => [path.basename(k).replace(/^map_(default|explicit)/, 'map'), v] as const)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([_, v]) => v);
    expect(contentOf(outDefault.chunks)).toEqual(contentOf(outExplicit.chunks));
  });
});
