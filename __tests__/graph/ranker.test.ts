const Graph = require('graphology');
import { Ranker } from '../../src/lib/graph/ranker';

describe('Ranker', () => {
    let graph: any;
    let ranker: Ranker;

    beforeEach(() => {
        graph = new Graph({ multi: true, type: 'directed' });
        ranker = new Ranker(graph);
    });

    it('should return an empty ranking for an empty graph', () => {
        expect(ranker.rank()).toEqual([]);
    });

    it('should rank nodes', () => {
        graph.addNode('A', { type: 'file' });
        graph.addNode('B', { type: 'tag' });
        graph.addEdge('A', 'B');

        const ranked = ranker.rank();
        expect(ranked.length).toBe(2);
        expect(ranked[0].rank).toBeGreaterThan(0);
    });

    it('should boost file nodes', () => {
        graph.addNode('A', { type: 'file' });
        graph.addNode('B', { type: 'tag' });
        // Disconnected, so base PR should be equal (1/N)
        // But we boost files by 1.2

        const ranked = ranker.rank();
        const fileNode = ranked.find(n => n.id === 'A');
        const tagNode = ranked.find(n => n.id === 'B');

        expect(fileNode!.rank).toBeGreaterThan(tagNode!.rank);
    });

    it('should penalize private members', () => {
        graph.addNode('A', { type: 'tag', label: 'public' });
        graph.addNode('B', { type: 'tag', label: '_private' });

        const ranked = ranker.rank();
        const publicNode = ranked.find(n => n.id === 'A');
        const privateNode = ranked.find(n => n.id === 'B');

        expect(publicNode!.rank).toBeGreaterThan(privateNode!.rank);
    });

    it('should boost focus node and neighbors', () => {
        graph.addNode('Focus', { type: 'file' });
        graph.addNode('Neighbor', { type: 'file' });
        graph.addNode('Other', { type: 'file' });

        graph.addEdge('Focus', 'Neighbor');

        const ranked = ranker.rank('Focus');

        const focusNode = ranked.find(n => n.id === 'Focus');
        const neighborNode = ranked.find(n => n.id === 'Neighbor');
        const otherNode = ranked.find(n => n.id === 'Other');

        expect(focusNode!.rank).toBeGreaterThan(neighborNode!.rank);
        expect(neighborNode!.rank).toBeGreaterThan(otherNode!.rank);
    });
});
