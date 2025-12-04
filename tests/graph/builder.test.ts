import { GraphBuilder } from '../../src/graph/builder';
import { Tag } from '../../src/parser/types';

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

    it('should store imports on file node', () => {
        const imports = [
            { source: 'fs', line: 1, file: 'test.ts' },
            { source: './utils', line: 2, file: 'test.ts' }
        ];
        builder.addFile('test.ts', [], imports);
        const graph = builder.getGraph();

        const fileImports = graph.getNodeAttribute('test.ts', 'imports');
        expect(fileImports).toBeDefined();
        expect(fileImports).toHaveLength(2);
        expect(fileImports[0].source).toBe('fs');
    });

    it('should create reference edges between tags', () => {
        const tags: Tag[] = [
            {
                name: 'caller',
                kind: 'function',
                line: 1,
                col: 0,
                file: 'test.ts',
                references: ['callee']
            },
            {
                name: 'callee',
                kind: 'function',
                line: 10,
                col: 0,
                file: 'test.ts'
            }
        ];
        builder.addFile('test.ts', tags, []);
        const graph = builder.getGraph();

        const callerId = 'test.ts::caller';
        const calleeId = 'test.ts::callee';

        expect(graph.hasEdge(callerId, calleeId)).toBe(true);
        const edges = graph.edges(callerId, calleeId);
        expect(edges.length).toBeGreaterThan(0);
        expect(graph.getEdgeAttribute(edges[0], 'type')).toBe('calls');
    });

    it('should avoid self-references', () => {
        const tags: Tag[] = [
            {
                name: 'recursive',
                kind: 'function',
                line: 1,
                col: 0,
                file: 'test.ts',
                references: ['recursive']
            }
        ];
        builder.addFile('test.ts', tags, []);
        const graph = builder.getGraph();

        const tagId = 'test.ts::recursive';
        expect(graph.hasEdge(tagId, tagId)).toBe(false);
    });

    it('should handle multiple references from one tag', () => {
        const tags: Tag[] = [
            {
                name: 'caller',
                kind: 'function',
                line: 1,
                col: 0,
                file: 'test.ts',
                references: ['funcA', 'funcB']
            },
            {
                name: 'funcA',
                kind: 'function',
                line: 10,
                col: 0,
                file: 'test.ts'
            },
            {
                name: 'funcB',
                kind: 'function',
                line: 20,
                col: 0,
                file: 'test.ts'
            }
        ];
        builder.addFile('test.ts', tags, []);
        const graph = builder.getGraph();

        const callerId = 'test.ts::caller';
        expect(graph.hasEdge(callerId, 'test.ts::funcA')).toBe(true);
        expect(graph.hasEdge(callerId, 'test.ts::funcB')).toBe(true);
    });

    it('should use loadFromCache method', () => {
        const tags: Tag[] = [
            {
                name: 'cachedFunc',
                kind: 'function',
                line: 1,
                col: 0,
                file: 'cached.ts'
            }
        ];
        builder.loadFromCache('cached.ts', tags, []);
        const graph = builder.getGraph();

        expect(graph.hasNode('cached.ts')).toBe(true);
        expect(graph.hasNode('cached.ts::cachedFunc')).toBe(true);
    });
});
