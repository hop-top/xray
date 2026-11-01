import { GraphBuilder } from '../../src/lib/graph/builder';
import { Tag, Import } from '../../src/lib/parser/types';
import type { EdgeAttributes } from '../../src/types/graph';

describe('GraphBuilder Events', () => {
    let builder: GraphBuilder;

    beforeEach(() => {
        builder = new GraphBuilder();
    });

    describe('node:add event emission', () => {
        it('should emit node:add event when adding file nodes', async () => {
            const listener = jest.fn();
            builder.on('node:add', listener);

            await builder.addFile('test.ts', [], []);

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    nodeId: 'test.ts',
                    attrs: expect.objectContaining({
                        type: 'file',
                        label: 'test.ts'
                    }),
                    skip: false
                })
            );
        });

        it('should emit node:add event for each tag', async () => {
            const listener = jest.fn();
            builder.on('node:add', listener);

            const tags: Tag[] = [
                {
                    file: 'test.ts',
                    name: 'func1',
                    kind: 'function',
                    line: 1,
                    col: 0
                },
                {
                    file: 'test.ts',
                    name: 'func2',
                    kind: 'function',
                    line: 10,
                    col: 0
                }
            ];

            await builder.addFile('test.ts', tags, []);

            // Should emit for file + 2 tags = 3 emissions
            expect(listener).toHaveBeenCalledTimes(3);

            // Check tag node emissions
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    nodeId: 'test.ts::func1',
                    attrs: expect.objectContaining({
                        type: 'tag',
                        label: 'func1',
                        kind: 'function'
                    })
                })
            );
        });

        it('should allow listeners to skip node addition with skip flag', async () => {
            builder.on('node:add', (event) => {
                if (event.nodeId === 'test.ts::skipMe') {
                    event.skip = true;
                }
            });

            const tags: Tag[] = [
                {
                    file: 'test.ts',
                    name: 'skipMe',
                    kind: 'function',
                    line: 1,
                    col: 0
                },
                {
                    file: 'test.ts',
                    name: 'keepMe',
                    kind: 'function',
                    line: 10,
                    col: 0
                }
            ];

            await builder.addFile('test.ts', tags, []);
            const graph = await builder.getGraph();

            expect(graph.hasNode('test.ts::skipMe')).toBe(false);
            expect(graph.hasNode('test.ts::keepMe')).toBe(true);
        });

        it('should allow listeners to modify node attributes', async () => {
            builder.on('node:add', (event) => {
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

        it('should not emit duplicate node:add for existing nodes', async () => {
            const listener = jest.fn();
            builder.on('node:add', listener);

            await builder.addFile('test.ts', [], []);
            await builder.addFile('test.ts', [], []);

            // Should only emit once for the file node
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('edge:add event emission', () => {
        it('should emit edge:add event for defines edges', async () => {
            const listener = jest.fn();
            builder.on('edge:add', listener);

            const tags: Tag[] = [{
                file: 'test.ts',
                name: 'myFunc',
                kind: 'function',
                line: 1,
                col: 0
            }];

            await builder.addFile('test.ts', tags, []);

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: 'test.ts',
                    target: 'test.ts::myFunc',
                    type: 'defines',
                    skip: false
                })
            );
        });

        it('should emit edge:add event for calls edges', async () => {
            const listener = jest.fn();
            builder.on('edge:add', listener);

            const tags: Tag[] = [
                {
                    file: 'test.ts',
                    name: 'caller',
                    kind: 'function',
                    line: 1,
                    col: 0,
                    references: ['callee']
                },
                {
                    file: 'test.ts',
                    name: 'callee',
                    kind: 'function',
                    line: 10,
                    col: 0
                }
            ];

            await builder.addFile('test.ts', tags, []);
            await builder.getGraph(); // Trigger reference edge building

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: 'test.ts::caller',
                    target: 'test.ts::callee',
                    type: 'calls'
                })
            );
        });

        it('should allow listeners to skip edge addition', async () => {
            builder.on('edge:add', (event) => {
                if (event.type === 'defines' && event.target === 'test.ts::skipEdge') {
                    event.skip = true;
                }
            });

            const tags: Tag[] = [
                {
                    file: 'test.ts',
                    name: 'skipEdge',
                    kind: 'function',
                    line: 1,
                    col: 0
                },
                {
                    file: 'test.ts',
                    name: 'keepEdge',
                    kind: 'function',
                    line: 10,
                    col: 0
                }
            ];

            await builder.addFile('test.ts', tags, []);
            const graph = await builder.getGraph();

            // Nodes should exist
            expect(graph.hasNode('test.ts::skipEdge')).toBe(true);
            expect(graph.hasNode('test.ts::keepEdge')).toBe(true);

            // Edge should be skipped
            expect(graph.hasEdge('test.ts', 'test.ts::skipEdge')).toBe(false);
            expect(graph.hasEdge('test.ts', 'test.ts::keepEdge')).toBe(true);
        });

        it('should allow listeners to modify edge attributes', async () => {
            builder.on('edge:add', (event) => {
                if (!event.attrs) {
                    event.attrs = {} as EdgeAttributes;
                }
                event.attrs.weight = 5;
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
            const attrs = graph.getEdgeAttributes(edges[0]);
            expect(attrs.weight).toBe(5);
        });
    });

    describe('reference:resolve event emission', () => {
        it('should emit reference:resolve event when resolving references', async () => {
            const listener = jest.fn();
            builder.on('reference:resolve', listener);

            const tags: Tag[] = [
                {
                    file: 'test.ts',
                    name: 'caller',
                    kind: 'function',
                    line: 1,
                    col: 0,
                    references: ['callee']
                },
                {
                    file: 'test.ts',
                    name: 'callee',
                    kind: 'function',
                    line: 10,
                    col: 0
                }
            ];

            await builder.addFile('test.ts', tags, []);
            await builder.getGraph();

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceTag: 'test.ts::caller',
                    targetName: 'callee',
                    resolved: ['test.ts::callee']
                })
            );
        });

        it('should allow listeners to modify resolved targets', async () => {
            const offered: string[][] = [];
            builder.on('reference:resolve', (event) => {
                offered.push([...event.resolved]);
                // Filter out certain resolved targets
                event.resolved = event.resolved.filter(id => !id.includes('filtered'));
            });

            const tags: Tag[] = [
                {
                    file: 'test.ts',
                    name: 'caller',
                    kind: 'function',
                    line: 1,
                    col: 0,
                    references: ['target']
                },
                {
                    file: 'target.ts',
                    name: 'target',
                    kind: 'function',
                    line: 10,
                    col: 0
                },
                {
                    file: 'filtered.ts',
                    name: 'target',
                    kind: 'function',
                    line: 10,
                    col: 0
                }
            ];

            // Each file receives only its own tags: node ids are
            // `<file>::<name>`, so passing all tags to test.ts duplicated
            // `test.ts::target`.
            // Both targets share the caller's directory, so both reach the
            // listener and only the listener's filter separates them.
            await builder.addFile('test.ts', tags.slice(0, 1), []);
            await builder.addFile('target.ts', tags.slice(1, 2), []);
            await builder.addFile('filtered.ts', tags.slice(2), []);
            const graph = await builder.getGraph();

            // Listener saw both candidates, so the filter is what drops one.
            expect(offered).toEqual([['target.ts::target', 'filtered.ts::target']]);
            // Should only have edge to target.ts::target, not filtered.ts::target
            expect(graph.hasEdge('test.ts::caller', 'target.ts::target')).toBe(true);
            expect(graph.hasEdge('test.ts::caller', 'filtered.ts::target')).toBe(false);
        });

        it('should handle multiple references to same name', async () => {
            const listener = jest.fn();
            builder.on('reference:resolve', listener);

            const tags: Tag[] = [
                {
                    file: 'test.ts',
                    name: 'caller',
                    kind: 'function',
                    line: 1,
                    col: 0,
                    references: ['helper']
                },
                {
                    file: 'a.ts',
                    name: 'helper',
                    kind: 'function',
                    line: 10,
                    col: 0
                },
                {
                    file: 'b.ts',
                    name: 'helper',
                    kind: 'function',
                    line: 10,
                    col: 0
                }
            ];

            await builder.addFile('test.ts', tags.slice(0, 1), []);
            await builder.addFile('a.ts', tags.slice(1, 2), []);
            await builder.addFile('b.ts', tags.slice(2, 3), []);
            await builder.getGraph();

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceTag: 'test.ts::caller',
                    targetName: 'helper',
                    resolved: expect.arrayContaining(['a.ts::helper', 'b.ts::helper'])
                })
            );
        });
    });

    describe('async event handling', () => {
        it('should support async event listeners', async () => {
            const results: string[] = [];

            builder.on('node:add', async (event) => {
                await new Promise(resolve => setTimeout(resolve, 10));
                results.push(event.nodeId);
            });

            const tags: Tag[] = [{
                file: 'test.ts',
                name: 'myFunc',
                kind: 'function',
                line: 1,
                col: 0
            }];

            await builder.addFile('test.ts', tags, []);

            expect(results).toContain('test.ts');
            expect(results).toContain('test.ts::myFunc');
        });

        it('should handle listener errors gracefully', async () => {
            builder.on('node:add', () => {
                throw new Error('Listener error');
            });

            const errorHandler = jest.fn();
            builder.on('error', errorHandler);

            const tags: Tag[] = [{
                file: 'test.ts',
                name: 'myFunc',
                kind: 'function',
                line: 1,
                col: 0
            }];

            await builder.addFile('test.ts', tags, []);

            // Should have emitted error events
            expect(errorHandler).toHaveBeenCalled();
        });
    });
});
