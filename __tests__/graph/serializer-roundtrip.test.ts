const Graph = require('graphology');
import { GraphSerializer } from '../../src/lib/graph/serializer';
import { Confidence } from '../../src/types/graph';

describe('GraphSerializer round-trip', () => {
    let graph: any;
    let serializer: GraphSerializer;

    beforeEach(() => {
        graph = new Graph({ multi: true, type: 'directed' });
        serializer = new GraphSerializer();
    });

    it('preserves well-known edge keys (type, confidence, community) through serialize/deserialize', () => {
        // File nodes
        graph.addNode('src/a.ts', { type: 'file', label: 'a.ts' });
        graph.addNode('src/b.ts', { type: 'file', label: 'b.ts' });
        // Tag node
        graph.addNode('src/a.ts::foo', {
            type: 'tag',
            label: 'foo',
            kind: 'function',
            file: 'src/a.ts',
            line: 1,
        });

        // defines edge (file -> tag)
        graph.addEdge('src/a.ts', 'src/a.ts::foo', {
            type: 'defines',
            confidence: Confidence.EXTRACTED,
            community: 'ui',
        });

        // imports edge (file -> file) with well-known keys
        graph.addEdge('src/a.ts', 'src/b.ts', {
            type: 'imports',
            confidence: Confidence.INFERRED,
            community: 'core',
        });

        // calls edge (tag -> tag) with only confidence
        graph.addNode('src/b.ts::bar', {
            type: 'tag',
            label: 'bar',
            kind: 'function',
            file: 'src/b.ts',
            line: 2,
        });
        graph.addEdge('src/a.ts::foo', 'src/b.ts::bar', {
            type: 'calls',
            confidence: Confidence.AMBIGUOUS,
        });

        const serialized = serializer.serialize(graph, '/project');

        // Assert well-known keys survive serialization
        const importsEdge = serialized.edges.find(
            (e) => e.source === 'src/a.ts' && e.target === 'src/b.ts'
        );
        expect(importsEdge).toBeDefined();
        expect(importsEdge!.type).toBe('imports');
        expect(importsEdge!.confidence).toBe(Confidence.INFERRED);
        expect(importsEdge!.community).toBe('core');

        const definesEdge = serialized.edges.find(
            (e) => e.source === 'src/a.ts' && e.target === 'src/a.ts::foo'
        );
        expect(definesEdge).toBeDefined();
        expect(definesEdge!.type).toBe('defines');
        expect(definesEdge!.confidence).toBe(Confidence.EXTRACTED);
        expect(definesEdge!.community).toBe('ui');

        const callsEdge = serialized.edges.find(
            (e) => e.source === 'src/a.ts::foo' && e.target === 'src/b.ts::bar'
        );
        expect(callsEdge).toBeDefined();
        expect(callsEdge!.type).toBe('calls');
        expect(callsEdge!.confidence).toBe(Confidence.AMBIGUOUS);
        expect(callsEdge!.community).toBeUndefined();

        // Round-trip through deserialize
        const restored = serializer.deserialize(serialized);

        expect(restored.order).toBe(graph.order);
        expect(restored.size).toBe(graph.size);

        // Check restored edge attributes
        const importsAttrs = restored.getEdgeAttributes(
            restored.edges('src/a.ts', 'src/b.ts')[0]
        );
        expect(importsAttrs.type).toBe('imports');
        expect(importsAttrs.confidence).toBe(Confidence.INFERRED);
        expect(importsAttrs.community).toBe('core');

        const definesAttrs = restored.getEdgeAttributes(
            restored.edges('src/a.ts', 'src/a.ts::foo')[0]
        );
        expect(definesAttrs.type).toBe('defines');
        expect(definesAttrs.confidence).toBe(Confidence.EXTRACTED);
        expect(definesAttrs.community).toBe('ui');

        const callsAttrs = restored.getEdgeAttributes(
            restored.edges('src/a.ts::foo', 'src/b.ts::bar')[0]
        );
        expect(callsAttrs.type).toBe('calls');
        // community is undefined on the source edge, so the deserialized
        // attrs should also lack it (not be the string 'undefined').
        expect(callsAttrs.confidence).toBe(Confidence.AMBIGUOUS);
        expect(callsAttrs.community).toBeUndefined();
    });

    it('round-trips an imports-typed edge without losing it', () => {
        graph.addNode('src/x.ts', { type: 'file', label: 'x.ts' });
        graph.addNode('src/y.ts', { type: 'file', label: 'y.ts' });
        graph.addEdge('src/x.ts', 'src/y.ts', { type: 'imports' });

        const serialized = serializer.serialize(graph, '/project');
        const restored = serializer.deserialize(serialized);

        expect(restored.hasEdge('src/x.ts', 'src/y.ts')).toBe(true);
        const attrs = restored.getEdgeAttributes(
            restored.edges('src/x.ts', 'src/y.ts')[0]
        );
        expect(attrs.type).toBe('imports');
    });

    it('does not emit undefined well-known keys when attributes are absent', () => {
        graph.addNode('src/a.ts', { type: 'file', label: 'a.ts' });
        graph.addNode('src/b.ts', { type: 'file', label: 'b.ts' });
        graph.addEdge('src/a.ts', 'src/b.ts', { type: 'imports' });

        const serialized = serializer.serialize(graph, '/project');
        const edge = serialized.edges[0];
        expect(edge.type).toBe('imports');
        expect('confidence' in edge).toBe(false);
        expect('community' in edge).toBe(false);
    });
});
