import { GraphBuilder } from './builder';
import { Tag } from '../parser/types';

describe('GraphBuilder', () => {
    let builder: GraphBuilder;

    beforeEach(() => {
        builder = new GraphBuilder();
    });

    it('should create an empty graph', () => {
        const graph = builder.getGraph();
        expect(graph.order).toBe(0);
        expect(graph.size).toBe(0);
    });

    it('should add a file node', () => {
        builder.addFile('test.ts', [], []);
        const graph = builder.getGraph();
        expect(graph.hasNode('test.ts')).toBe(true);
        expect(graph.getNodeAttribute('test.ts', 'type')).toBe('file');
    });

    it('should add tag nodes and edges', () => {
        const tags: Tag[] = [
            {
                name: 'myFunction',
                kind: 'function',
                line: 10,
                col: 0,
                file: 'test.ts',
                signature: '() => void',
                doc: 'A test function'
            }
        ];
        builder.addFile('test.ts', tags, []);
        const graph = builder.getGraph();

        const tagId = 'test.ts::myFunction';
        expect(graph.hasNode(tagId)).toBe(true);
        expect(graph.getNodeAttribute(tagId, 'type')).toBe('tag');
        expect(graph.getNodeAttribute(tagId, 'kind')).toBe('function');
        expect(graph.getNodeAttribute(tagId, 'doc')).toBe('A test function');

        expect(graph.hasEdge('test.ts', tagId)).toBe(true);
        // In MultiGraph, getEdgeAttribute with source/target is ambiguous.
        // We can check if there is an edge with this type.
        const edges = graph.edges('test.ts', tagId);
        expect(edges.length).toBeGreaterThan(0);
        const edge = edges[0];
        expect(graph.getEdgeAttribute(edge, 'type')).toBe('defines');
    });

    it('should not duplicate file nodes', () => {
        builder.addFile('test.ts', [], []);
        builder.addFile('test.ts', [], []);
        const graph = builder.getGraph();
        expect(graph.order).toBe(1);
    });

    it('should not duplicate tag nodes', () => {
        const tags: Tag[] = [
            {
                name: 'myFunction',
                kind: 'function',
                line: 10,
                col: 0,
                file: 'test.ts',
                signature: '() => void',
                doc: 'A test function'
            }
        ];
        builder.addFile('test.ts', tags, []);
        builder.addFile('test.ts', tags, []);
        const graph = builder.getGraph();
        expect(graph.order).toBe(2); // 1 file + 1 tag
    });
});
