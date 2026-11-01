import { GraphBuilder } from '../../src/lib/graph/builder';
import { Tag } from '../../src/lib/parser/types';

describe('GraphBuilder', () => {
    let builder: GraphBuilder;

    beforeEach(() => {
        builder = new GraphBuilder();
    });

    it('should create an empty graph', async () => {
        const graph = await builder.getGraph();
        expect(graph.order).toBe(0);
        expect(graph.size).toBe(0);
    });

    it('should add a file node', async () => {
        await builder.addFile('test.ts', [], []);
        const graph = await builder.getGraph();
        expect(graph.hasNode('test.ts')).toBe(true);
        expect(graph.getNodeAttribute('test.ts', 'type')).toBe('file');
    });

    it('should add tag nodes and edges', async () => {
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
        await builder.addFile('test.ts', tags, []);
        const graph = await builder.getGraph();

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

    it('should not duplicate file nodes', async () => {
        await builder.addFile('test.ts', [], []);
        await builder.addFile('test.ts', [], []);
        const graph = await builder.getGraph();
        expect(graph.order).toBe(1);
    });

    it('should not duplicate tag nodes', async () => {
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
        await builder.addFile('test.ts', tags, []);
        await builder.addFile('test.ts', tags, []);
        const graph = await builder.getGraph();
        expect(graph.order).toBe(2); // 1 file + 1 tag
    });

    it('should store imports on file node', async () => {
        const imports = [
            { source: 'fs', line: 1, file: 'test.ts' },
            { source: './utils', line: 2, file: 'test.ts' }
        ];
        await builder.addFile('test.ts', [], imports);
        const graph = await builder.getGraph();

        const fileImports = graph.getNodeAttribute('test.ts', 'imports');
        expect(fileImports).toBeDefined();
        expect(fileImports).toHaveLength(2);
        expect(fileImports[0].source).toBe('fs');
    });

    it('should create reference edges between tags', async () => {
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
        await builder.addFile('test.ts', tags, []);
        const graph = await builder.getGraph();

        const callerId = 'test.ts::caller';
        const calleeId = 'test.ts::callee';

        expect(graph.hasEdge(callerId, calleeId)).toBe(true);
        const edges = graph.edges(callerId, calleeId);
        expect(edges.length).toBeGreaterThan(0);
        expect(graph.getEdgeAttribute(edges[0], 'type')).toBe('calls');
    });

    it('should avoid self-references', async () => {
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
        await builder.addFile('test.ts', tags, []);
        const graph = await builder.getGraph();

        const tagId = 'test.ts::recursive';
        expect(graph.hasEdge(tagId, tagId)).toBe(false);
    });

    it('should handle multiple references from one tag', async () => {
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
        await builder.addFile('test.ts', tags, []);
        const graph = await builder.getGraph();

        const callerId = 'test.ts::caller';
        expect(graph.hasEdge(callerId, 'test.ts::funcA')).toBe(true);
        expect(graph.hasEdge(callerId, 'test.ts::funcB')).toBe(true);
    });

    it('should use loadFromCache method', async () => {
        const tags: Tag[] = [
            {
                name: 'cachedFunc',
                kind: 'function',
                line: 1,
                col: 0,
                file: 'cached.ts'
            }
        ];
        await builder.loadFromCache('cached.ts', tags, []);
        const graph = await builder.getGraph();

        expect(graph.hasNode('cached.ts')).toBe(true);
        expect(graph.hasNode('cached.ts::cachedFunc')).toBe(true);
    });

    it('should handle large number of tags efficiently', async () => {
        // Generate 100 tags to test batching performance
        const tags: Tag[] = [];
        for (let i = 0; i < 100; i++) {
            tags.push({
                name: `func${i}`,
                kind: 'function',
                line: i * 10,
                col: 0,
                file: 'large.ts',
                references: i > 0 ? [`func${i - 1}`] : undefined
            });
        }

        const start = performance.now();
        await builder.addFile('large.ts', tags, []);
        const graph = await builder.getGraph();
        const duration = performance.now() - start;

        // Should complete in reasonable time (< 1 second for 100 tags)
        expect(duration).toBeLessThan(1000);
        expect(graph.hasNode('large.ts')).toBe(true);
        expect(graph.order).toBe(101); // 1 file + 100 tags
    });

    describe('scoped reference resolution', () => {
        const fn = (file: string, name: string, references?: string[]): Tag => ({
            name, kind: 'function', line: 1, col: 0, file, references
        });
        const callsFrom = (graph: any, source: string) =>
            graph.outEdges(source)
                .filter((e: string) => graph.getEdgeAttribute(e, 'type') === 'calls')
                .map((e: string) => ({
                    target: graph.target(e),
                    confidence: graph.getEdgeAttribute(e, 'confidence')
                }))
                .sort((a: any, b: any) => a.target.localeCompare(b.target));

        it('prefers a same-file definition over same-named tags elsewhere', async () => {
            await builder.addFile('pkg/a/x.go', [fn('pkg/a/x.go', 'run', ['New']), fn('pkg/a/x.go', 'New')], []);
            await builder.addFile('pkg/a/y.go', [fn('pkg/a/y.go', 'New')], []);
            await builder.addFile('pkg/b/z.go', [fn('pkg/b/z.go', 'New')], []);
            const graph = await builder.getGraph();

            expect(callsFrom(graph, 'pkg/a/x.go::run')).toEqual([
                { target: 'pkg/a/x.go::New', confidence: 'EXTRACTED' }
            ]);
        });

        it('links a caller only to the same-directory definition', async () => {
            await builder.addFile('pkg/a/main.go', [fn('pkg/a/main.go', 'run', ['New'])], []);
            await builder.addFile('pkg/a/util.go', [fn('pkg/a/util.go', 'New')], []);
            await builder.addFile('pkg/b/util.go', [fn('pkg/b/util.go', 'New')], []);
            const graph = await builder.getGraph();

            expect(callsFrom(graph, 'pkg/a/main.go::run')).toEqual([
                { target: 'pkg/a/util.go::New', confidence: 'EXTRACTED' }
            ]);
        });

        it('links a caller to the definition in a file it imports', async () => {
            await builder.addFile(
                'src/app/main.ts',
                [fn('src/app/main.ts', 'run', ['helper'])],
                [{ source: '../lib/b', file: 'src/app/main.ts' }]
            );
            await builder.addFile('src/lib/b.ts', [fn('src/lib/b.ts', 'helper')], []);
            await builder.addFile('src/other/c.ts', [fn('src/other/c.ts', 'helper')], []);
            const graph = await builder.getGraph();

            expect(callsFrom(graph, 'src/app/main.ts::run')).toEqual([
                { target: 'src/lib/b.ts::helper', confidence: 'EXTRACTED' }
            ]);
        });

        it('falls back to every global match stamped INFERRED when no scope matches', async () => {
            await builder.addFile('x/main.ts', [fn('x/main.ts', 'run', ['helper'])], []);
            await builder.addFile('y/a.ts', [fn('y/a.ts', 'helper')], []);
            await builder.addFile('z/b.ts', [fn('z/b.ts', 'helper')], []);
            const graph = await builder.getGraph();

            expect(callsFrom(graph, 'x/main.ts::run')).toEqual([
                { target: 'y/a.ts::helper', confidence: 'INFERRED' },
                { target: 'z/b.ts::helper', confidence: 'INFERRED' }
            ]);
        });

        it('gives same-named definitions in different packages distinct callers', async () => {
            await builder.addFile('pkg/a/main.go', [fn('pkg/a/main.go', 'runA', ['New'])], []);
            await builder.addFile('pkg/a/new.go', [fn('pkg/a/new.go', 'New')], []);
            await builder.addFile('pkg/b/main.go', [fn('pkg/b/main.go', 'runB', ['New'])], []);
            await builder.addFile('pkg/b/new.go', [fn('pkg/b/new.go', 'New')], []);
            const graph = await builder.getGraph();

            expect(graph.inNeighbors('pkg/a/new.go::New')).toEqual(expect.arrayContaining(['pkg/a/main.go::runA']));
            expect(graph.inNeighbors('pkg/a/new.go::New')).not.toContain('pkg/b/main.go::runB');
            expect(graph.inNeighbors('pkg/b/new.go::New')).not.toContain('pkg/a/main.go::runA');
        });

        it('emits reference:resolve with only the best-ranked candidates', async () => {
            const seen: string[][] = [];
            builder.on('reference:resolve', (event) => { seen.push([...event.resolved]); });
            await builder.addFile('pkg/a/main.go', [fn('pkg/a/main.go', 'run', ['New'])], []);
            await builder.addFile('pkg/a/util.go', [fn('pkg/a/util.go', 'New')], []);
            await builder.addFile('pkg/b/util.go', [fn('pkg/b/util.go', 'New')], []);
            await builder.getGraph();

            expect(seen).toEqual([['pkg/a/util.go::New']]);
        });
    });

    it('should handle large number of references efficiently', async () => {
        // Create a tag that references many other tags
        const tags: Tag[] = [
            {
                name: 'mainFunc',
                kind: 'function',
                line: 1,
                col: 0,
                file: 'test.ts',
                references: Array.from({ length: 50 }, (_, i) => `helper${i}`)
            }
        ];

        // Add the referenced tags
        for (let i = 0; i < 50; i++) {
            tags.push({
                name: `helper${i}`,
                kind: 'function',
                line: (i + 2) * 10,
                col: 0,
                file: 'test.ts'
            });
        }

        const start = performance.now();
        await builder.addFile('test.ts', tags, []);
        const graph = await builder.getGraph();
        const duration = performance.now() - start;

        // Should complete in reasonable time (< 500ms for 50 references)
        expect(duration).toBeLessThan(500);

        const mainFuncId = 'test.ts::mainFunc';
        // Verify all reference edges were created
        const outEdges = graph.outEdges(mainFuncId);
        expect(outEdges.length).toBe(50);
    });
});
