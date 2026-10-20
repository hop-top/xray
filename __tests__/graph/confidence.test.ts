import { GraphBuilder } from '../../src/lib/graph/builder';
import { Confidence, EdgeAttributes } from '../../src/types/graph';
import { GraphSerializer } from '../../src/lib/graph/serializer';
import { Tag, Import } from '../../src/lib/parser/types';
import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';
import { XrayEvents } from '../../src/lib/events/types';
import { XrayLike } from '../../src/lib/events/plugin';
import {
  ConfidenceEnricherPlugin,
  ConfidenceRule,
} from '../../src/lib/plugins/confidence-enricher';

/**
 * Minimal XrayLike stub for isolated plugin tests — avoids booting the
 * full Xray pipeline. Provides just enough surface area
 * (`on`, `emitAsync`, `getLastGraph`, `stash`, `retrieve`) for the
 * ConfidenceEnricherPlugin's `apply()` contract.
 */
class FakeXray
  extends AsyncEventEmitter<XrayEvents>
  implements XrayLike
{
  getLastGraph() {
    return {};
  }
  stash(_namespace: string, _items: unknown[]) {
    /* no-op */
  }
  retrieve(_namespace: string, _n?: number): unknown[] {
    return [];
  }
}

describe('confidence — default stamping', () => {
  it('stamps EXTRACTED on defines edges', async () => {
    const builder = new GraphBuilder();
    const tags: Tag[] = [
      {
        name: 'foo',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'a.ts',
        signature: '() => void',
        doc: ''
      } as Tag
    ];
    await builder.addFile('a.ts', tags, []);
    const graph = await builder.getGraph();

    let definesSeen = 0;
    graph.forEachEdge((_edge: string, attrs: any) => {
      if (attrs.type === 'defines') {
        definesSeen++;
        expect(attrs.confidence).toBe(Confidence.EXTRACTED);
      }
    });
    expect(definesSeen).toBeGreaterThan(0);
  });

  it('stamps EXTRACTED on calls edges', async () => {
    const builder = new GraphBuilder();
    const tagsA: Tag[] = [
      {
        name: 'caller',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'a.ts',
        signature: '() => void',
        doc: '',
        references: ['callee']
      } as Tag
    ];
    const tagsB: Tag[] = [
      {
        name: 'callee',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'b.ts',
        signature: '() => void',
        doc: ''
      } as Tag
    ];
    await builder.addFile('a.ts', tagsA, []);
    await builder.addFile('b.ts', tagsB, []);
    const graph = await builder.getGraph();

    let callsSeen = 0;
    graph.forEachEdge((_edge: string, attrs: any) => {
      if (attrs.type === 'calls') {
        callsSeen++;
        expect(attrs.confidence).toBe(Confidence.EXTRACTED);
      }
    });
    expect(callsSeen).toBeGreaterThan(0);
  });

  it('stamps EXTRACTED on imports edges', async () => {
    const builder = new GraphBuilder();
    const imports: Import[] = [
      { file: 'a.ts', source: './b', text: "import { named as b } from './b';" }
    ];
    await builder.addFile('a.ts', [], imports);
    await builder.addFile('b.ts', [], []);
    const graph = await builder.getGraph();

    let importsSeen = 0;
    graph.forEachEdge((_edge: string, attrs: any) => {
      if (attrs.type === 'imports') {
        importsSeen++;
        expect(attrs.confidence).toBe(Confidence.EXTRACTED);
      }
    });
    expect(importsSeen).toBeGreaterThan(0);
  });

  it('every edge in a fresh scan carries confidence === EXTRACTED (combined)', async () => {
    const builder = new GraphBuilder();
    const tagsA: Tag[] = [
      {
        name: 'caller',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'a.ts',
        signature: '() => void',
        doc: '',
        references: ['callee']
      } as Tag
    ];
    const tagsB: Tag[] = [
      {
        name: 'callee',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'b.ts',
        signature: '() => void',
        doc: ''
      } as Tag
    ];
    const imports: Import[] = [
      { file: 'a.ts', source: './b', text: "import { named as b } from './b';" }
    ];
    await builder.addFile('a.ts', tagsA, imports);
    await builder.addFile('b.ts', tagsB, []);
    const graph = await builder.getGraph();

    expect(graph.size).toBeGreaterThan(0);
    graph.forEachEdge((_edge: string, attrs: any) => {
      expect(attrs.confidence).toBe(Confidence.EXTRACTED);
    });
  });
});

describe('ConfidenceEnricherPlugin — override semantics', () => {
  const baseAttrs = (): EdgeAttributes => ({
    type: 'calls',
    confidence: Confidence.EXTRACTED,
  });

  it('overrides matching edges and leaves others at the default', async () => {
    const xray = new FakeXray();
    const rule: ConfidenceRule = (ctx) =>
      ctx.source === 'foo.ts' ? Confidence.INFERRED : undefined;
    const plugin = new ConfidenceEnricherPlugin({ rules: [rule] });
    plugin.apply(xray);

    const matching = {
      source: 'foo.ts',
      target: 'bar.ts',
      type: 'calls' as const,
      attrs: baseAttrs(),
    };
    const nonMatching = {
      source: 'baz.ts',
      target: 'qux.ts',
      type: 'calls' as const,
      attrs: baseAttrs(),
    };

    await xray.emitAsync('graph:add-edge', matching);
    await xray.emitAsync('graph:add-edge', nonMatching);

    expect(matching.attrs.confidence).toBe(Confidence.INFERRED);
    expect(nonMatching.attrs.confidence).toBe(Confidence.EXTRACTED);
  });

  it('short-circuits on first non-undefined rule result', async () => {
    const xray = new FakeXray();
    const calls: string[] = [];

    const ruleA: ConfidenceRule = (ctx) => {
      calls.push('A');
      return ctx.source === 'foo.ts' ? Confidence.AMBIGUOUS : undefined;
    };
    const ruleB: ConfidenceRule = () => {
      calls.push('B');
      return Confidence.INFERRED;
    };

    const plugin = new ConfidenceEnricherPlugin({ rules: [ruleA, ruleB] });
    plugin.apply(xray);

    const matching = {
      source: 'foo.ts',
      target: 'bar.ts',
      type: 'calls' as const,
      attrs: baseAttrs(),
    };
    await xray.emitAsync('graph:add-edge', matching);

    // First rule matched → second rule must NOT have been invoked.
    expect(calls).toEqual(['A']);
    expect(matching.attrs.confidence).toBe(Confidence.AMBIGUOUS);
  });

  it('walks rules in order until one matches', async () => {
    const xray = new FakeXray();
    const calls: string[] = [];

    const ruleA: ConfidenceRule = () => {
      calls.push('A');
      return undefined;
    };
    const ruleB: ConfidenceRule = () => {
      calls.push('B');
      return Confidence.INFERRED;
    };
    const ruleC: ConfidenceRule = () => {
      calls.push('C');
      return Confidence.AMBIGUOUS;
    };

    const plugin = new ConfidenceEnricherPlugin({
      rules: [ruleA, ruleB, ruleC],
    });
    plugin.apply(xray);

    const edge = {
      source: 'foo.ts',
      target: 'bar.ts',
      type: 'calls' as const,
      attrs: baseAttrs(),
    };
    await xray.emitAsync('graph:add-edge', edge);

    expect(calls).toEqual(['A', 'B']);
    expect(edge.attrs.confidence).toBe(Confidence.INFERRED);
  });

  it('throws when a rule returns a Promise (sync-only invariant)', async () => {
    const xray = new FakeXray();
    // Deliberately typed as any so TS lets us hand in a Promise-returning rule.
    const asyncRule: any = async () => Confidence.INFERRED;
    const plugin = new ConfidenceEnricherPlugin({ rules: [asyncRule] });
    plugin.apply(xray);

    // AsyncEventEmitter catches listener throws and routes them to the
    // 'error' event — capture it there to assert on the message.
    const errors: any[] = [];
    xray.on('error', (err: any) => {
      errors.push(err);
    });

    const edge = {
      source: 'foo.ts',
      target: 'bar.ts',
      type: 'calls' as const,
      attrs: baseAttrs(),
    };
    await xray.emitAsync('graph:add-edge', edge);

    expect(errors.length).toBe(1);
    expect(String(errors[0].error.message)).toMatch(/synchronous/);
    // Default must be left untouched (plugin bailed out).
    expect(edge.attrs.confidence).toBe(Confidence.EXTRACTED);
  });

  it('registers under the required plugin name', () => {
    const plugin = new ConfidenceEnricherPlugin({ rules: [] });
    expect(plugin.name).toBe('confidence-enricher');
  });
});

describe('confidence — serializer round-trip', () => {
  it('preserves Confidence values on every edge through serialize/deserialize', async () => {
    // Build a real graph via GraphBuilder so edges carry the default
    // Confidence.EXTRACTED stamp applied at emission.
    const builder = new GraphBuilder();
    const tagsA: Tag[] = [
      {
        name: 'caller',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'a.ts',
        signature: '() => void',
        doc: '',
        references: ['callee'],
      } as Tag,
    ];
    const tagsB: Tag[] = [
      {
        name: 'callee',
        kind: 'function',
        line: 1,
        col: 0,
        file: 'b.ts',
        signature: '() => void',
        doc: '',
      } as Tag,
    ];
    const imports: Import[] = [
      { file: 'a.ts', source: './b', text: "import { named as b } from './b';" },
    ];
    await builder.addFile('a.ts', tagsA, imports);
    await builder.addFile('b.ts', tagsB, []);
    const graph = await builder.getGraph();

    const serializer = new GraphSerializer();
    const serialized = serializer.serialize(graph, '/project');

    // Every serialized edge must carry the Confidence tag.
    expect(serialized.edges.length).toBeGreaterThan(0);
    for (const edge of serialized.edges) {
      expect(edge.confidence).toBe(Confidence.EXTRACTED);
    }

    // Round-trip through deserialize.
    const restored = serializer.deserialize(serialized);
    expect(restored.size).toBe(graph.size);

    restored.forEachEdge((_edge: string, attrs: any) => {
      expect(attrs.confidence).toBe(Confidence.EXTRACTED);
    });
  });

  it('preserves plugin-overridden Confidence (INFERRED) through round-trip', () => {
    // Construct a graph directly and assign INFERRED to simulate a
    // downstream plugin that tags edges via the ConfidenceEnricherPlugin.
    const Graph = require('graphology');
    const graph: any = new Graph({ multi: true, type: 'directed' });
    graph.addNode('a.ts', { type: 'file', label: 'a.ts' });
    graph.addNode('b.ts', { type: 'file', label: 'b.ts' });
    graph.addEdge('a.ts', 'b.ts', {
      type: 'imports',
      confidence: Confidence.INFERRED,
    });

    const serializer = new GraphSerializer();
    const serialized = serializer.serialize(graph, '/project');
    const importsEdge = serialized.edges.find(
      (e) => e.source === 'a.ts' && e.target === 'b.ts'
    );
    expect(importsEdge).toBeDefined();
    expect(importsEdge!.confidence).toBe(Confidence.INFERRED);

    const restored = serializer.deserialize(serialized);
    const edgeId = restored.edges('a.ts', 'b.ts')[0];
    const attrs = restored.getEdgeAttributes(edgeId);
    expect(attrs.confidence).toBe(Confidence.INFERRED);
  });
});
