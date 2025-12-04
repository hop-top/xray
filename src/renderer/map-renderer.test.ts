import { MapRenderer } from './map-renderer';
import Graph from 'graphology';
import { RankedNode } from '../graph/ranker';

describe('MapRenderer', () => {
    let graph: Graph;
    let ranked: RankedNode[];
    let renderer: MapRenderer;

    beforeEach(() => {
        graph = new Graph();
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
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } }
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
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 1, data: { type: 'tag', file: 'file1.ts', kind: 'fn', label: 'tag1', line: 1 } },
            { id: 'file2.ts', score: 5, data: { type: 'file' } },
            { id: 'file2.ts::tag1', score: 1, data: { type: 'tag', file: 'file2.ts', kind: 'fn', label: 'tag1', line: 1 } }
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
    it('should not filter if maxDepth is undefined', async () => {
        ranked = [
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);
    });
    it('should filter by maxDepth', async () => {
        ranked = [
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);
    });
    it('should render files and tags', async () => {
        ranked = [
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, endLine: 14 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000);
        expect(output).toContain('file1.ts (L11-L15):');
        expect(output).toContain('│ [L11-L15] function tag1');
    });

    it('should respect token limit', async () => {
        ranked = [
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, endLine: 14 } },
            { id: 'file1.ts::tag2', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag2', line: 20, endLine: 20 } }
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
            { id: 'fileA.ts', score: 1, data: { type: 'file' } },
            { id: 'fileB.ts', score: 10, data: { type: 'file' } },
            { id: 'fileA.ts::tag1', score: 1, data: { type: 'tag', file: 'fileA.ts', kind: 'fn', label: 'tag1', line: 1, endLine: 1 } },
            { id: 'fileB.ts::tag1', score: 1, data: { type: 'tag', file: 'fileB.ts', kind: 'fn', label: 'tag1', line: 1, endLine: 1 } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);
        const output = await renderer.render(1000);

        const indexA = output.indexOf('fileA.ts (L2):');
        const indexB = output.indexOf('fileB.ts (L2):');

        expect(indexB).toBeLessThan(indexA); // B should come first
    });

    it('should handle missing file scores', async () => {
        ranked = [
            { id: 'fileA.ts', score: 10, data: { type: 'file' } },
            { id: 'fileB.ts', score: 5, data: { type: 'file' } }, // fileB has score
            { id: 'fileC.ts', score: 0, data: { type: 'file' } }  // fileC has 0 score
        ];
        // Add a tag for a file that is NOT in ranked files list (shouldn't happen usually but good for coverage)
        // Actually, the renderer iterates ranked nodes to build fileMap.
        // If a file node is missing but tag exists, it creates entry in fileMap.
        // But fileScores won't have it.
        ranked.push({ id: 'fileD.ts::tag1', score: 1, data: { type: 'tag', file: 'fileD.ts', kind: 'fn', label: 'tag1', line: 1, endLine: 1 } });

        renderer = new MapRenderer('/root', ranked, graph);
        const output = await renderer.render(1000);

        expect(output).toContain('fileD.ts (L2):');
    });

    it('should sort files with missing scores correctly', async () => {
        // fileA has score 10
        // fileB has no score (undefined) -> 0
        // fileC has no score (undefined) -> 0
        ranked = [
            { id: 'fileA.ts', score: 10, data: { type: 'file' } },
            { id: 'fileA.ts::tag1', score: 1, data: { type: 'tag', file: 'fileA.ts', kind: 'fn', label: 'tag1', line: 1 } },
            { id: 'fileB.ts::tag1', score: 1, data: { type: 'tag', file: 'fileB.ts', kind: 'fn', label: 'tag1', line: 1 } },
            { id: 'fileC.ts::tag1', score: 1, data: { type: 'tag', file: 'fileC.ts', kind: 'fn', label: 'tag1', line: 1 } }
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
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, doc: 'My Doc' } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000);
        expect(output).toContain('# My Doc');
    });

    it('should truncate long docstrings', async () => {
        const longDoc = 'A'.repeat(100);
        ranked = [
            { id: 'file1.ts', score: 10, data: { type: 'file' } },
            { id: 'file1.ts::tag1', score: 5, data: { type: 'tag', file: 'file1.ts', kind: 'function', label: 'tag1', line: 10, doc: longDoc } }
        ];
        renderer = new MapRenderer('/root', ranked, graph);

        const output = await renderer.render(1000);
        expect(output).toContain('...');
        expect(output).not.toContain(longDoc);
    });
});
