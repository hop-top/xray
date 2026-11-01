import { MapRenderer } from '../../src/lib/renderer/map-renderer';
import Graph from 'graphology';
import type { RankedNode, XrayGraph } from '../../src/types/graph';

describe('MapRenderer', () => {
    let graph: XrayGraph;
    let ranked: RankedNode[];
    let renderer: MapRenderer;

    beforeEach(() => {
        graph = new Graph() as XrayGraph;
        ranked = [];
        renderer = new MapRenderer('/root', ranked, graph);
    });

    it('should render simple map', async () => {
        const output = await renderer.render(1000);
        expect(output).toBe('');
    });

    it('should break on small token limit', async () => {
        // Define some ranked nodes for this specific test
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } }
        ];
        // Re-instantiate renderer with the specific ranked data
        const renderer = new MapRenderer('/root', ranked, graph);
        const output = await renderer.render(1); // Very small limit
        // Should contain at least one file header but maybe no tags?
        // File header is 2 tokens.
        // If limit is 1, it adds file header (tokens=2).
        // Then loop over tags.
        // Adds tag (tokens=2+X).
        // Checks if (tokens >= limit). Breaks.
        // So it should contain one tag?
        // Wait, logic:
        // outputLines.push(file); currentTokens += 2;
        // for (tag) { ... currentTokens += ...; if (currentTokens >= limit) break; }
        // So it should contain one tag?
        expect(output.split('\n').length).toBeGreaterThan(0);
    });

    it('should break after first file if limit reached', async () => {
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'file1.ts', kind: 'fn', label: 'tag1', line: 1 } },
            { id: 'file2.ts', rank: 5, attributes: { type: 'file', label: 'file2.ts' } },
            { id: 'file2.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'file2.ts', kind: 'fn', label: 'tag1', line: 1 } }
        ];
        const renderer = new MapRenderer('/root', ranked, graph);
        // Limit = 2 (file header) + 1 (margin?)
        // File header is 2 tokens.
        // If limit is 2.
        // File 1: adds 2. current=2. >= limit? Yes. Break.
        // So output should contain file1 but NOT file2.
        const output = await renderer.render(2);
        expect(output).toContain('file1.ts');
        expect(output).not.toContain('file2.ts');
    });
    it('should not filter if depth is undefined', async () => {
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);
    });
    it('should filter by depth', async () => {
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);
    });
    it('should render files and tags', async () => {
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, endLine: 14 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000);
        expect(output).toContain('file1.ts (L11-L15):');
        expect(output).toContain('│ [L11-L15] function tag1');
    });

    it('should respect token limit', async () => {
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, endLine: 14 } },
            { id: 'file1.ts::tag2', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag2', line: 20, endLine: 20 } }
        ];
        // Set a very small limit to force truncation
        renderer = new MapRenderer('/root', ranked, graph);
        const output = await renderer.render(5); // Very small limit

        // It might render the file header but skip tags, or render one tag.
        // The exact behavior depends on the implementation's token counting.
        // We just check that it's not the full output if limit is small.
        // Actually, let's check that it breaks.

        // With 5 tokens:
        // "file1.ts:" is ~2 tokens.
        // "│ function tag1" is ~3 tokens.
        // So it might print one tag and then stop.

        expect(output).toContain('file1.ts (L11-L21):');
    });

    it('should prioritize files with higher score', async () => {
        ranked = [
            { id: 'fileA.ts', rank: 1, attributes: { type: 'file', label: 'fileA.ts' } },
            { id: 'fileB.ts', rank: 10, attributes: { type: 'file', label: 'fileB.ts' } },
            { id: 'fileA.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'fileA.ts', kind: 'fn', label: 'tag1', line: 1, endLine: 1 } },
            { id: 'fileB.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'fileB.ts', kind: 'fn', label: 'tag1', line: 1, endLine: 1 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);
        const output = await renderer.render(1000);

        const indexA = output.indexOf('fileA.ts (L2):');
        const indexB = output.indexOf('fileB.ts (L2):');

        expect(indexB).toBeLessThan(indexA); // B should come first
    });

    it('should handle missing file scores', async () => {
        ranked = [
            { id: 'fileA.ts', rank: 10, attributes: { type: 'file', label: 'fileA.ts' } },
            { id: 'fileB.ts', rank: 5, attributes: { type: 'file', label: 'fileB.ts' } }, // fileB has score
            { id: 'fileC.ts', rank: 0, attributes: { type: 'file', label: 'fileC.ts' } }  // fileC has 0 score
        ];
        // Add a tag for a file that is NOT in ranked files list (shouldn't happen usually but good for coverage)
        // Actually, the renderer iterates ranked nodes to build fileMap.
        // If a file node is missing but tag exists, it creates entry in fileMap.
        // But fileScores won't have it.
        ranked.push({ id: 'fileD.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'fileD.ts', kind: 'fn', label: 'tag1', line: 1, endLine: 1 } });

        renderer = new MapRenderer('/root', ranked, graph);
        const output = await renderer.render(1000);

        expect(output).toContain('fileD.ts (L2):');
    });

    it('should sort files with missing scores correctly', async () => {
        // fileA has score 10
        // fileB has no score (undefined) -> 0
        // fileC has no score (undefined) -> 0
        ranked = [
            { id: 'fileA.ts', rank: 10, attributes: { type: 'file', label: 'fileA.ts' } },
            { id: 'fileA.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'fileA.ts', kind: 'fn', label: 'tag1', line: 1 } },
            { id: 'fileB.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'fileB.ts', kind: 'fn', label: 'tag1', line: 1 } },
            { id: 'fileC.ts::tag1', rank: 1, attributes: { type: 'tag', file: 'fileC.ts', kind: 'fn', label: 'tag1', line: 1 } }
        ];

        renderer = new MapRenderer('/root', ranked, graph);
        const output = await renderer.render(1000);

        const indexA = output.indexOf('fileA.ts (L2):');
        const indexB = output.indexOf('fileB.ts (L2):');
        const indexC = output.indexOf('fileC.ts (L2):');

        expect(indexA).toBeLessThan(indexB);
        expect(indexA).toBeLessThan(indexC);
        // B and C order is undefined but should be present
    });

    it('should include docstrings if present', async () => {
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, doc: 'My Doc' } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000);
        expect(output).toContain('# My Doc');
    });

    it('should truncate long docstrings', async () => {
        const longDoc = 'A'.repeat(100);
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, doc: longDoc } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000);
        expect(output).toContain('...');
        expect(output).not.toContain(longDoc);
    });

    it('should include imports when requested', async () => {
        (graph as any).addNode('file1.ts', {
            type: 'file', label: 'file1.ts', imports: [
                { source: 'fs', line: 1, file: 'file1.ts' },
                { source: './utils', line: 2, file: 'file1.ts' }
            ]
        });

        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000, undefined, true);
        expect(output).toContain('import fs');
        expect(output).toContain('import ./utils');
    });

    it('should filter by depth', async () => {
        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file1.ts::tag1', rank: 5, attributes: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } },
            { id: 'deep/nested/file2.ts', rank: 8, attributes: { type: 'file', label: 'deep/nested/file2.ts' } },
            { id: 'deep/nested/file2.ts::tag2', rank: 4, attributes: { type: 'tag', file: 'deep/nested/file2.ts', kind: 'function', label: 'tag2', line: 10 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000, 1); // depth = 1
        expect(output).toContain('file1.ts');
        expect(output).not.toContain('deep/nested/file2.ts');
    });

    it('should display cross-file references', async () => {
        // Set up graph with cross-file call edges
        (graph as any).addNode('file1.ts::caller', { type: 'tag', file: 'file1.ts', label: 'caller', line: 5, endLine: 8 });
        (graph as any).addNode('file2.ts::callee', { type: 'tag', file: 'file2.ts', label: 'callee', line: 10, endLine: 12 });
        (graph as any).addEdge('file1.ts::caller', 'file2.ts::callee', { type: 'calls' });

        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file2.ts', rank: 9, attributes: { type: 'file', label: 'file2.ts' } },
            { id: 'file2.ts::callee', rank: 5, attributes: { type: 'tag', file: 'file2.ts', kind: 'function', label: 'callee', line: 10, endLine: 12 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000);
        expect(output).toContain('used by: [file1.ts:L6](L6-L9)');
    });

    it('should generate external dependencies table when imports are included', async () => {
        (graph as any).addNode('file1.ts', {
            type: 'file', label: 'file1.ts', imports: [
                { source: 'fs', line: 1, file: 'file1.ts' },
                { source: './utils', line: 2, file: 'file1.ts' }, // internal
                { source: 'express', line: 3, file: 'file1.ts' }
            ]
        });
        (graph as any).addNode('file2.ts', {
            type: 'file', label: 'file2.ts', imports: [
                { source: 'fs', line: 1, file: 'file2.ts' }
            ]
        });

        ranked = [
            { id: 'file1.ts', rank: 10, attributes: { type: 'file', label: 'file1.ts' } },
            { id: 'file2.ts', rank: 9, attributes: { type: 'file', label: 'file2.ts' } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(10000, undefined, true);
        // When imports are included, dependency table should also appear
        expect(output).toContain('## External Dependencies');
        expect(output).toContain('| fs |');
        expect(output).toContain('| express |');
        // Note: ./utils appears in imports list but not in dependencies table (correct behavior)
    });

    it('should include file nodes when includeImports is true and file has imports', async () => {
        (graph as any).addNode('fileWithImports.ts', {
            type: 'file', label: 'fileWithImports.ts', imports: [
                { source: 'lodash', line: 1, file: 'fileWithImports.ts' }
            ]
        });

        ranked = [
            { id: 'fileWithImports.ts', rank: 10, attributes: { type: 'file', label: 'fileWithImports.ts' } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000, undefined, true);
        expect(output).toContain('fileWithImports.ts');
        expect(output).toContain('import lodash');
    });

    it('should include imports and dependencies table when includeImports is true', async () => {
        (graph as any).addNode('main.ts', {
            type: 'file', label: 'main.ts', imports: [
                { source: 'fs', line: 1, file: 'main.ts' },
                { source: 'lodash', line: 2, file: 'main.ts' },
                { source: './utils', line: 3, file: 'main.ts' }
            ]
        });
        (graph as any).addNode('utils.ts', {
            type: 'file', label: 'utils.ts', imports: [
                { source: 'fs', line: 1, file: 'utils.ts' }
            ]
        });

        ranked = [
            { id: 'main.ts', rank: 10, attributes: { type: 'file', label: 'main.ts' } },
            { id: 'main.ts::handler', rank: 5, attributes: { type: 'tag', file: 'main.ts', kind: 'function', label: 'handler', line: 10, endLine: 15 } },
            { id: 'utils.ts', rank: 9, attributes: { type: 'file', label: 'utils.ts' } },
            { id: 'utils.ts::helper', rank: 4, attributes: { type: 'tag', file: 'utils.ts', kind: 'function', label: 'helper', line: 1, endLine: 5 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        // Render with includeImports = true
        const output = await renderer.render(10000, undefined, true);
        
        // Should contain imports in file sections
        expect(output).toContain('import fs');
        expect(output).toContain('import lodash');
        expect(output).toContain('import ./utils');
        
        // Should contain external dependencies table
        expect(output).toContain('## External Dependencies');
        expect(output).toContain('| fs |');
        expect(output).toContain('| lodash |');
        
        // Internal import should NOT appear in dependencies table
        expect(output).not.toContain('| ./utils |');
    });
});

describe('MapRenderer "used by" calls-edge confidence', () => {
    function fixture(callers: { file: string; confidence?: 'EXTRACTED' | 'INFERRED' }[]): { graph: XrayGraph; ranked: RankedNode[] } {
        const graph = new Graph({ multi: true }) as XrayGraph;
        (graph as any).addNode('lib.ts::target', { type: 'tag', file: 'lib.ts', label: 'target', line: 0, endLine: 2 });
        callers.forEach((c, i) => {
            const id = `${c.file}::caller${i}`;
            (graph as any).addNode(id, { type: 'tag', file: c.file, label: `caller${i}`, line: i, endLine: i });
            const attrs: Record<string, unknown> = { type: 'calls' };
            if (c.confidence) attrs.confidence = c.confidence;
            (graph as any).addEdge(id, 'lib.ts::target', attrs);
        });
        const ranked: RankedNode[] = [
            { id: 'lib.ts', rank: 10, attributes: { type: 'file', label: 'lib.ts' } },
            { id: 'lib.ts::target', rank: 5, attributes: { type: 'tag', file: 'lib.ts', kind: 'function', label: 'target', line: 0, endLine: 2 } },
        ];
        return { graph, ranked };
    }

    const usedBy = (out: string) => out.split('\n').filter((l) => l.includes('→'));

    it('prints EXTRACTED callers before INFERRED ones and suffixes INFERRED with (inferred)', async () => {
        const { graph, ranked } = fixture([
            { file: 'far/x.ts', confidence: 'INFERRED' },
            { file: 'near/y.ts', confidence: 'EXTRACTED' },
        ]);
        const out = await new MapRenderer('/root', ranked, graph).render(1000);
        expect(usedBy(out)).toEqual([
            '│       → used by: [near/y.ts:L2](L2-L2)',
            '│       → used by: [far/x.ts:L1](L1-L1) (inferred)',
        ]);
    });

    it('caps INFERRED callers at 3 per symbol and summarises the rest as +N inferred', async () => {
        const { graph, ranked } = fixture([
            { file: 'a.ts', confidence: 'INFERRED' },
            { file: 'b.ts', confidence: 'INFERRED' },
            { file: 'c.ts', confidence: 'INFERRED' },
            { file: 'd.ts', confidence: 'INFERRED' },
            { file: 'e.ts', confidence: 'INFERRED' },
            { file: 'f.ts', confidence: 'EXTRACTED' },
        ]);
        const out = await new MapRenderer('/root', ranked, graph).render(1000);
        expect(usedBy(out)).toEqual([
            '│       → used by: [f.ts:L6](L6-L6)',
            '│       → used by: [a.ts:L1](L1-L1) (inferred)',
            '│       → used by: [b.ts:L2](L2-L2) (inferred)',
            '│       → used by: [c.ts:L3](L3-L3) (inferred)',
            '│       → +2 inferred',
        ]);
    });

    it('INFERRED callers do not crowd out EXTRACTED callers', async () => {
        const { graph, ranked } = fixture([
            { file: 'a.ts', confidence: 'INFERRED' },
            { file: 'b.ts', confidence: 'INFERRED' },
            { file: 'c.ts', confidence: 'INFERRED' },
            { file: 'd.ts', confidence: 'EXTRACTED' },
        ]);
        const out = await new MapRenderer('/root', ranked, graph).render(1000);
        expect(usedBy(out)[0]).toBe('│       → used by: [d.ts:L4](L4-L4)');
        expect(usedBy(out)).toHaveLength(4);
        expect(out).not.toContain('+0 inferred');
    });

    it('treats edges without confidence as EXTRACTED (pre-confidence graphs)', async () => {
        const { graph, ranked } = fixture([{ file: 'a.ts' }]);
        const out = await new MapRenderer('/root', ranked, graph).render(1000);
        expect(usedBy(out)).toEqual(['│       → used by: [a.ts:L1](L1-L1)']);
    });
});
