import { XrayEvents } from '../../src/lib/events/types';
import { Tag, Import } from '../../src/lib/parser/types';
import type { RankedNode } from '../../src/types/graph';
import Graph from 'graphology';

describe('XrayEvents Type Schema', () => {
    describe('Scan Stage Events', () => {
        it('should define scan:start event with path and config', () => {
            const event: XrayEvents['scan:start'] = {
                path: '/path/to/project',
                config: {
                    path: '/path/to/project',
                    limit: 100
                }
            };

            expect(event.path).toBeDefined();
            expect(event.config).toBeDefined();
        });

        it('should define scan:file event with file and optional skip flag', () => {
            const event: XrayEvents['scan:file'] = {
                file: 'src/index.ts'
            };

            expect(event.file).toBeDefined();
            expect(event.skip).toBeUndefined();

            const skippedEvent: XrayEvents['scan:file'] = {
                file: 'src/test.ts',
                skip: true
            };

            expect(skippedEvent.skip).toBe(true);
        });

        it('should define scan:complete event with files array', () => {
            const event: XrayEvents['scan:complete'] = {
                files: ['file1.ts', 'file2.ts']
            };

            expect(Array.isArray(event.files)).toBe(true);
        });
    });

    describe('Cache Stage Events', () => {
        it('should define cache:check event with file and mtime', () => {
            const event: XrayEvents['cache:check'] = {
                file: 'src/index.ts',
                mtime: Date.now()
            };

            expect(event.file).toBeDefined();
            expect(event.mtime).toBeDefined();
        });

        it('should define cache:hit event with mutable tags and imports', () => {
            const tags: Tag[] = [{
                file: 'test.ts',
                name: 'myFunc',
                kind: 'function',
                line: 1,
                col: 0
            }];

            const imports: Import[] = [{
                file: 'test.ts',
                source: 'fs'
            }];

            const event: XrayEvents['cache:hit'] = {
                file: 'test.ts',
                tags,
                imports
            };

            // Verify it's mutable
            event.tags.push({
                file: 'test.ts',
                name: 'anotherFunc',
                kind: 'function',
                line: 10,
                col: 0
            });

            expect(event.tags.length).toBe(2);
        });

        it('should define cache:miss event', () => {
            const event: XrayEvents['cache:miss'] = {
                file: 'src/index.ts'
            };

            expect(event.file).toBeDefined();
        });

        it('should define cache:write event with mutable data', () => {
            const event: XrayEvents['cache:write'] = {
                file: 'test.ts',
                tags: [],
                imports: []
            };

            expect(event.tags).toBeDefined();
            expect(event.imports).toBeDefined();
        });
    });

    describe('Parse Stage Events', () => {
        it('should define parse:before event with mutable content and skip flag', () => {
            const event: XrayEvents['parse:before'] = {
                file: 'test.ts',
                content: 'const x = 1;'
            };

            // Verify content is mutable
            event.content = event.content.replace('1', '2');
            expect(event.content).toBe('const x = 2;');

            // Verify skip flag works
            event.skip = true;
            expect(event.skip).toBe(true);
        });

        it('should define parse:after event with mutable tags and imports', () => {
            const event: XrayEvents['parse:after'] = {
                file: 'test.ts',
                tags: [],
                imports: []
            };

            // Verify tags are mutable
            event.tags.push({
                file: 'test.ts',
                name: 'testFunc',
                kind: 'function',
                line: 1,
                col: 0
            });

            expect(event.tags.length).toBe(1);
        });

        it('should define parse:error event with error and recovery flag', () => {
            const event: XrayEvents['parse:error'] = {
                file: 'test.ts',
                error: new Error('Parse failed')
            };

            expect(event.error).toBeInstanceOf(Error);
            expect(event.recovered).toBeUndefined();

            const recoveredEvent: XrayEvents['parse:error'] = {
                file: 'test.ts',
                error: new Error('Parse failed'),
                recovered: true
            };

            expect(recoveredEvent.recovered).toBe(true);
        });
    });

    describe('Graph Building Stage Events', () => {
        it('should define graph:add-file event with skip flag', () => {
            const event: XrayEvents['graph:add-file'] = {
                file: 'test.ts',
                tags: [],
                imports: []
            };

            expect(event.skip).toBeUndefined();

            event.skip = true;
            expect(event.skip).toBe(true);
        });

        it('should define graph:add-node event with mutable attrs and skip flag', () => {
            const event: XrayEvents['graph:add-node'] = {
                nodeId: 'test.ts::myFunc',
                attrs: {
                    type: 'tag',
                    label: 'myFunc'
                }
            };

            // Verify attrs are mutable
            event.attrs.customField = 'value';
            expect(event.attrs.customField).toBe('value');

            // Verify skip flag
            event.skip = true;
            expect(event.skip).toBe(true);
        });

        it('should define graph:add-edge event with skip flag and optional attrs', () => {
            const event: XrayEvents['graph:add-edge'] = {
                source: 'file.ts',
                target: 'file.ts::func',
                type: 'defines'
            };

            expect(event.type).toBe('defines');
            expect(event.skip).toBeUndefined();
            expect(event.attrs).toBeUndefined();

            const callsEvent: XrayEvents['graph:add-edge'] = {
                source: 'file.ts::caller',
                target: 'file.ts::callee',
                type: 'calls',
                skip: false,
                attrs: { type: 'calls', confidence: 'EXTRACTED', weight: 1 }
            };

            expect(callsEvent.type).toBe('calls');
            expect(callsEvent.attrs).toBeDefined();
        });

        it('should define graph:complete event with graph and counts', () => {
            const graph: any = new Graph();
            graph.addNode('node1');
            graph.addNode('node2');
            graph.addEdge('node1', 'node2');

            const event: XrayEvents['graph:complete'] = {
                graph,
                nodeCount: graph.order,
                edgeCount: graph.size
            };

            expect(event.nodeCount).toBe(2);
            expect(event.edgeCount).toBe(1);
        });
    });

    describe('Ranking Stage Events', () => {
        it('should define rank:start event with optional anchor', () => {
            const graph: any = new Graph();

            const event: XrayEvents['rank:start'] = {
                graph
            };

            expect(event.graph).toBeDefined();
            expect(event.anchor).toBeUndefined();

            const anchoredEvent: XrayEvents['rank:start'] = {
                graph,
                anchor: 'main.ts::main'
            };

            expect(anchoredEvent.anchor).toBe('main.ts::main');
        });

        it('should define rank:complete event with mutable rankedNodes', () => {
            const rankedNodes: RankedNode[] = [
                { id: 'node1', rank: 0.5, attributes: { type: 'file', label: 'node1' } },
                { id: 'node2', rank: 0.3, attributes: { type: 'file', label: 'node2' } }
            ];

            const event: XrayEvents['rank:complete'] = {
                graph: new Graph(),
                rankedNodes
            };

            // Verify rankedNodes are mutable (can be reordered)
            event.rankedNodes.sort((a: RankedNode, b: RankedNode) => b.rank - a.rank);
            expect(event.rankedNodes[0].id).toBe('node1');

            // Can modify scores
            event.rankedNodes[0].rank = 0.9;
            expect(event.rankedNodes[0].rank).toBe(0.9);
        });
    });

    describe('Rendering Stage Events', () => {
        it('should define render:start event', () => {
            const event: XrayEvents['render:start'] = {
                format: 'markdown',
                chunked: true,
                outputPath: '/path/to/output',
                renderer: {} as XrayEvents['render:start']['renderer']
            };

            expect(event.format).toBe('markdown');
            expect(event.chunked).toBe(true);
        });

        it('should define render:chunk event with mutable content', () => {
            const event: XrayEvents['render:chunk'] = {
                chunkPath: 'chunk1.md',
                content: '# Header\n\nContent'
            };

            // Verify content is mutable
            event.content = event.content.replace('Header', 'Modified Header');
            expect(event.content).toContain('Modified Header');
        });

        it('should define render:complete event', () => {
            const event: XrayEvents['render:complete'] = {
                outputPath: '/output/analysis.md',
                filesWritten: 5
            };

            expect(event.filesWritten).toBe(5);
        });
    });

    describe('Special Events', () => {
        it('should define error event', () => {
            const event: XrayEvents['error'] = {
                event: 'parse:after',
                error: new Error('Something failed'),
                payload: { file: 'test.ts' }
            };

            expect(event.event).toBe('parse:after');
            expect(event.error).toBeInstanceOf(Error);
            expect(event.payload).toBeDefined();

            const recoveredEvent: XrayEvents['error'] = {
                event: 'parse:error',
                error: new Error('Parse failed'),
                payload: {},
                recovered: true
            };

            expect(recoveredEvent.recovered).toBe(true);
        });

        it('should define progress event', () => {
            const event: XrayEvents['progress'] = {
                stage: 'parsing',
                current: 50,
                total: 100,
                message: 'Parsing files...'
            };

            expect(event.current).toBe(50);
            expect(event.total).toBe(100);
            expect(event.message).toBeDefined();
        });
    });

    describe('Event Count', () => {
        it('should have all 21 lifecycle events defined', () => {
            const events: (keyof XrayEvents)[] = [
                // Scan (3)
                'scan:start',
                'scan:file',
                'scan:complete',
                // Cache (4)
                'cache:check',
                'cache:hit',
                'cache:miss',
                'cache:write',
                // Parse (3)
                'parse:before',
                'parse:after',
                'parse:error',
                // Graph (4)
                'graph:add-file',
                'graph:add-node',
                'graph:add-edge',
                'graph:complete',
                // Rank (2)
                'rank:start',
                'rank:complete',
                // Render (3)
                'render:start',
                'render:chunk',
                'render:complete',
                // Special (2)
                'error',
                'progress'
            ];

            expect(events.length).toBe(21);

            // Type check - ensure all are valid keys
            events.forEach(event => {
                expect(typeof event).toBe('string');
            });
        });
    });
});
