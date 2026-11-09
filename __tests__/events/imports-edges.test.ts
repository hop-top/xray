import * as path from 'path';
import { Xray } from '../../src/lib/xray';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'plumbing', 'imports');

function makeXray(): Xray {
  return new Xray({
    path: FIXTURE,
    cachePath: ':memory:',
    chunked: false
  });
}

interface EdgeAddEvent {
  source: string;
  target: string;
  type: 'defines' | 'calls' | 'imports';
  skip?: boolean;
}

describe('imports edges (graph:add-edge)', () => {
  it('emits at least one imports edge between fixture file nodes', async () => {
    const xray = makeXray();
    const importsEvents: EdgeAddEvent[] = [];

    xray.on('graph:add-edge', async (event) => {
      if (event.type === 'imports') {
        importsEvents.push({
          source: event.source,
          target: event.target,
          type: event.type,
          skip: event.skip
        });
      }
    });

    // Collect every file node so we can assert source/target resolve to
    // something the graph actually knows about.
    const fileNodes = new Set<string>();
    xray.on('graph:add-node', async ({ nodeId, attrs }) => {
      if (attrs.type === 'file') {
        fileNodes.add(nodeId);
      }
    });

    await xray.buildGraph();

    expect(importsEvents.length).toBeGreaterThan(0);

    for (const evt of importsEvents) {
      expect(fileNodes.has(evt.source)).toBe(true);
      expect(fileNodes.has(evt.target)).toBe(true);
    }

    // At least one edge should correspond to a.ts -> b.ts.
    const aToB = importsEvents.find(
      (e) => e.source.endsWith('a.ts') && e.target.endsWith('b.ts')
    );
    expect(aToB).toBeDefined();
  });
});
