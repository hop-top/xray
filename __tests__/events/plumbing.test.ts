import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { MapRenderer } from '../../src/lib/renderer/map-renderer';
import { ChunkedRenderer } from '../../src/lib/renderer/chunked-renderer';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'plumbing');

function makeXray(chunked = false): Xray {
  return new Xray({
    path: FIXTURE,
    cachePath: ':memory:',
    chunked
  });
}

describe('events plumbing (run path)', () => {
  it('graph:complete listeners fire in attach order', async () => {
    const xray = makeXray(false);
    const order: string[] = [];

    xray.on('graph:complete', async () => {
      order.push('first');
    });
    xray.on('graph:complete', async () => {
      order.push('second');
    });
    xray.on('graph:complete', async () => {
      order.push('third');
    });

    await xray.run();

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('rank:complete payload .graph matches graph:complete node/edge counts', async () => {
    const xray = makeXray(false);
    let graphCompleteCounts: { nodes: number; edges: number } | null = null;
    let rankCompleteCounts: { nodes: number; edges: number } | null = null;

    xray.on('graph:complete', async ({ nodeCount, edgeCount }) => {
      graphCompleteCounts = { nodes: nodeCount, edges: edgeCount };
    });

    xray.on('rank:complete', async ({ graph }) => {
      expect(graph).toBeDefined();
      rankCompleteCounts = { nodes: graph.order, edges: graph.size };
    });

    await xray.run();

    expect(graphCompleteCounts).not.toBeNull();
    expect(rankCompleteCounts).not.toBeNull();
    expect(rankCompleteCounts).toEqual(graphCompleteCounts);
  });

  it('render:start payload .renderer is a renderer instance (MapRenderer)', async () => {
    const xray = makeXray(false);
    let captured: unknown = null;

    xray.on('render:start', async ({ renderer }) => {
      captured = renderer;
    });

    await xray.run();

    expect(captured).toBeInstanceOf(MapRenderer);
  });

  it('render:start payload .renderer is a ChunkedRenderer when chunked=true', async () => {
    const xray = makeXray(true);
    let captured: unknown = null;

    xray.on('render:start', async ({ renderer }) => {
      captured = renderer;
    });

    await xray.run();

    expect(captured).toBeInstanceOf(ChunkedRenderer);
  });
});

describe('events plumbing (buildGraph chunked path)', () => {
  it('fires graph:complete, rank:complete, render:start with well-formed payloads', async () => {
    const xray = makeXray(true);

    let graphComplete: { nodeCount: number; edgeCount: number } | null = null;
    let rankComplete: { nodes: number; rankedLen: number } | null = null;
    let renderStart: { chunked: boolean; isRenderer: boolean } | null = null;

    xray.on('graph:complete', async ({ nodeCount, edgeCount }) => {
      graphComplete = { nodeCount, edgeCount };
    });

    xray.on('rank:complete', async ({ graph, rankedNodes }) => {
      rankComplete = { nodes: graph.order, rankedLen: rankedNodes.length };
    });

    xray.on('render:start', async ({ chunked, renderer }) => {
      renderStart = {
        chunked,
        isRenderer: renderer instanceof ChunkedRenderer || renderer instanceof MapRenderer
      };
    });

    await xray.buildGraph();

    expect(graphComplete).not.toBeNull();
    expect(rankComplete).not.toBeNull();
    expect(renderStart).not.toBeNull();

    expect(graphComplete!.nodeCount).toBeGreaterThan(0);
    expect(rankComplete!.nodes).toBe(graphComplete!.nodeCount);
    expect(rankComplete!.rankedLen).toBeGreaterThan(0);
    expect(renderStart!.chunked).toBe(true);
    expect(renderStart!.isRenderer).toBe(true);
  });
});
