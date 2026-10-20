import { GraphBuilder } from '../src/lib/graph/builder';
import { Xray } from '../src/lib/xray';
import { Tag } from '../src/lib/parser/types';
import type { EdgeAttributes } from '../src/types/graph';

// Mock dependencies to avoid tree-sitter issues
jest.mock('tree-sitter', () => jest.fn());
jest.mock('../src/lib/parser/language-registry', () => ({
  getLanguageConfig: jest.fn(),
  updateLanguageQuery: jest.fn()
}));

describe('Xray GraphBuilder Event Forwarding (Unit Tests)', () => {
  describe('buildGraphWithEvents event forwarding setup', () => {
    it('should set up GraphBuilder event forwarding when graph builder is created', async () => {
      // We can't easily test buildGraphWithEvents internals without integration,
      // but we can test that GraphBuilder events properly forward to Xray events

      const xray = new Xray({
        path: '/tmp/test',
        cachePath: ':memory:'
      });

      const builder = new GraphBuilder();

      // Set up the same forwarding logic that buildGraphWithEvents uses
      builder.on('node:add', async (event) => {
        await xray.emitAsync('graph:add-node', event);
      });

      builder.on('edge:add', async (event) => {
        await xray.emitAsync('graph:add-edge', event);
      });

      builder.on('error', async (event) => {
        await xray.emitAsync('error', event);
      });

      // Now test that Xray listeners receive forwarded events
      const nodeListener = jest.fn();
      const edgeListener = jest.fn();
      const errorListener = jest.fn();

      xray.on('graph:add-node', nodeListener);
      xray.on('graph:add-edge', edgeListener);
      xray.on('error', errorListener);

      // Add a file with a tag to trigger events
      const tags: Tag[] = [{
        file: 'test.ts',
        name: 'myFunc',
        kind: 'function',
        line: 1,
        col: 0
      }];

      await builder.addFile('test.ts', tags, []);
      await builder.getGraph();

      // Verify forwarding worked
      expect(nodeListener).toHaveBeenCalled();
      expect(nodeListener).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'test.ts',
          attrs: expect.objectContaining({
            type: 'file'
          })
        })
      );

      expect(nodeListener).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'test.ts::myFunc',
          attrs: expect.objectContaining({
            type: 'tag',
            kind: 'function'
          })
        })
      );

      expect(edgeListener).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'test.ts',
          target: 'test.ts::myFunc',
          type: 'defines'
        })
      );
    });

    it('should forward skip flags from Xray listeners back to GraphBuilder', async () => {
      const xray = new Xray({
        path: '/tmp/test',
        cachePath: ':memory:'
      });

      const builder = new GraphBuilder();

      // Set up forwarding
      builder.on('node:add', async (event) => {
        await xray.emitAsync('graph:add-node', event);
      });

      // Xray listener modifies the event
      xray.on('graph:add-node', (event) => {
        if (event.attrs.type === 'tag') {
          event.skip = true;
        }
      });

      const tags: Tag[] = [{
        file: 'test.ts',
        name: 'skipMe',
        kind: 'function',
        line: 1,
        col: 0
      }];

      await builder.addFile('test.ts', tags, []);
      const graph = await builder.getGraph();

      // Tag node should have been skipped
      expect(graph.hasNode('test.ts')).toBe(true);
      expect(graph.hasNode('test.ts::skipMe')).toBe(false);
    });

    it('should forward attribute modifications from Xray listeners to GraphBuilder', async () => {
      const xray = new Xray({
        path: '/tmp/test',
        cachePath: ':memory:'
      });

      const builder = new GraphBuilder();

      // Set up forwarding
      builder.on('node:add', async (event) => {
        await xray.emitAsync('graph:add-node', event);
      });

      // Xray listener modifies attributes
      xray.on('graph:add-node', (event) => {
        if (event.attrs.type === 'tag') {
          event.attrs.customField = 'customValue';
        }
      });

      const tags: Tag[] = [{
        file: 'test.ts',
        name: 'myFunc',
        kind: 'function',
        line: 1,
        col: 0
      }];

      await builder.addFile('test.ts', tags, []);
      const graph = await builder.getGraph();

      const attrs = graph.getNodeAttributes('test.ts::myFunc');
      expect(attrs.customField).toBe('customValue');
    });

    it('should forward edge modifications from Xray listeners to GraphBuilder', async () => {
      const xray = new Xray({
        path: '/tmp/test',
        cachePath: ':memory:'
      });

      const builder = new GraphBuilder();

      // Set up forwarding
      builder.on('edge:add', async (event) => {
        await xray.emitAsync('graph:add-edge', event);
      });

      // Xray listener modifies edge attributes
      xray.on('graph:add-edge', (event) => {
        if (!event.attrs) {
          event.attrs = {} as EdgeAttributes;
        }
        event.attrs.weight = 10;
      });

      const tags: Tag[] = [{
        file: 'test.ts',
        name: 'myFunc',
        kind: 'function',
        line: 1,
        col: 0
      }];

      await builder.addFile('test.ts', tags, []);
      const graph = await builder.getGraph();

      const edges = graph.edges('test.ts', 'test.ts::myFunc');
      const edgeAttrs = graph.getEdgeAttributes(edges[0]);
      expect(edgeAttrs.weight).toBe(10);
    });

    it('should forward errors from GraphBuilder to Xray error event', async () => {
      const xray = new Xray({
        path: '/tmp/test',
        cachePath: ':memory:'
      });

      const builder = new GraphBuilder();

      // Set up forwarding
      builder.on('node:add', async (event) => {
        await xray.emitAsync('graph:add-node', event);
      });

      builder.on('error', async (event) => {
        await xray.emitAsync('error', event);
      });

      const errorHandler = jest.fn();
      xray.on('error', errorHandler);

      // Make a node listener throw an error
      builder.on('node:add', () => {
        throw new Error('Test error');
      });

      const tags: Tag[] = [{
        file: 'test.ts',
        name: 'myFunc',
        kind: 'function',
        line: 1,
        col: 0
      }];

      await builder.addFile('test.ts', tags, []);

      // Error should have been forwarded to Xray
      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Test error'
          })
        })
      );
    });
  });
});
