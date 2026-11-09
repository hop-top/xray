/**
 * Integration test — insights surface at top of root chunk.
 *
 * Contract under test (T-0052):
 *   - Both `MapRenderer` and `ChunkedRenderer` expose
 *     `addInsight({ title, body })`.
 *   - `MapRenderer.render()` prepends insights at the top of its output.
 *   - `ChunkedRenderer.renderChunked()` prepends insights onto the root
 *     chunk content, in BOTH `grouping: 'directory'` and
 *     `grouping: 'community'` modes.
 *
 * If any assertion here fails, the upstream contract (xray-plumbing-init)
 * has drifted — investigate before patching this file.
 */
import Graph from 'graphology';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MapRenderer } from '../../src/lib/renderer/map-renderer';
import { ChunkedRenderer } from '../../src/lib/renderer/chunked-renderer';
import { RankedNode, XrayGraph } from '../../src/types/graph';

function buildFixture(): { graph: XrayGraph; ranked: RankedNode[] } {
  const graph = new Graph() as XrayGraph;

  graph.addNode('src/a.ts', { type: 'file', label: 'src/a.ts', community: 0 });
  graph.addNode('src/b.ts', { type: 'file', label: 'src/b.ts', community: 0 });
  graph.addNode('src/a.ts::foo', {
    type: 'tag',
    file: 'src/a.ts',
    label: 'foo',
    kind: 'function',
    line: 0,
    endLine: 5,
    community: 0,
  });
  graph.addNode('src/b.ts::bar', {
    type: 'tag',
    file: 'src/b.ts',
    label: 'bar',
    kind: 'function',
    line: 0,
    endLine: 5,
    community: 0,
  });

  const ranked: RankedNode[] = [
    { id: 'src/a.ts', rank: 1.0, attributes: { type: 'file', label: 'src/a.ts' } },
    { id: 'src/b.ts', rank: 0.9, attributes: { type: 'file', label: 'src/b.ts' } },
    {
      id: 'src/a.ts::foo',
      rank: 0.8,
      attributes: {
        type: 'tag',
        file: 'src/a.ts',
        label: 'foo',
        kind: 'function',
        line: 0,
        endLine: 5,
      },
    },
    {
      id: 'src/b.ts::bar',
      rank: 0.7,
      attributes: {
        type: 'tag',
        file: 'src/b.ts',
        label: 'bar',
        kind: 'function',
        line: 0,
        endLine: 5,
      },
    },
  ];
  return { graph, ranked };
}

describe('renderer insights integration', () => {
  const TITLE = 'Suggested Questions for Exploration';
  const BODY = '### Is src/a.ts still used?\n**Why:** no inbound edges';

  it('MapRenderer prepends insight block at top of output', async () => {
    const { graph, ranked } = buildFixture();
    const r = new MapRenderer('.', ranked, graph);
    r.addInsight({ title: TITLE, body: BODY });
    const out = await r.render(4096);
    expect(out.startsWith(`## ${TITLE}`)).toBe(true);
    expect(out).toContain(BODY);
    // Body still present below.
    expect(out).toContain('src/a.ts');
  });

  it('ChunkedRenderer directory mode prepends insight on root chunk', async () => {
    const { graph, ranked } = buildFixture();
    const r = new ChunkedRenderer({
      root: '.',
      ranked,
      graph,
      tokenLimit: 4096,
      grouping: 'directory',
    });
    r.addInsight({ title: TITLE, body: BODY });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-insight-'));
    try {
      const out = await r.renderChunked(path.join(tmp, 'map.md'));
      const rootContent = out.chunks.get(out.rootChunk);
      expect(rootContent).toBeDefined();
      expect(rootContent!.startsWith(`## ${TITLE}`)).toBe(true);
      expect(rootContent!).toContain(BODY);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('ChunkedRenderer community mode prepends insight on root chunk', async () => {
    const { graph, ranked } = buildFixture();
    const r = new ChunkedRenderer({
      root: '.',
      ranked,
      graph,
      tokenLimit: 4096,
      grouping: 'community',
    });
    r.addInsight({ title: TITLE, body: BODY });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-insight-'));
    try {
      const out = await r.renderChunked(path.join(tmp, 'map.md'));
      const rootContent = out.chunks.get(out.rootChunk);
      expect(rootContent).toBeDefined();
      expect(rootContent!.startsWith(`## ${TITLE}`)).toBe(true);
      expect(rootContent!).toContain(BODY);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('no insights → no prepended block', async () => {
    const { graph, ranked } = buildFixture();
    const r = new MapRenderer('.', ranked, graph);
    const out = await r.render(4096);
    expect(out.startsWith('## ')).toBe(false);
  });
});
