const Graph = require('graphology');
import { Ranker } from './ranker';

describe('Ranker', () => {
    let graph: any;
    let ranker: Ranker;

    beforeEach(() => {
        graph = new Graph({ multi: true, type: 'directed' });
        ranker = new Ranker(graph);
    });

    it('should rank nodes', () => {
        graph.addNode('A', { type: 'file' });
        graph.addNode('B', { type: 'tag' });
        graph.addEdge('A', 'B');

        const ranked = ranker.rank();
        expect(ranked.length).toBe(2);
        expect(ranked[0].score).toBeGreaterThan(0);
    });

    it('should boost file nodes', () => {
        graph.addNode('A', { type: 'file' });
        graph.addNode('B', { type: 'tag' });
        // Disconnected, so base PR should be equal (1/N)
        // But we boost files by 1.2

        const ranked = ranker.rank();
        const fileNode = ranked.find(n => n.id === 'A');
        const tagNode = ranked.find(n => n.id === 'B');

        expect(fileNode!.score).toBeGreaterThan(tagNode!.score);
    });

    it('should penalize private members', () => {
        graph.addNode('A', { type: 'tag', label: 'public' });
        graph.addNode('B', { type: 'tag', label: '_private' });

        const ranked = ranker.rank();
        const publicNode = ranked.find(n => n.id === 'A');
        const privateNode = ranked.find(n => n.id === 'B');

        expect(publicNode!.score).toBeGreaterThan(privateNode!.score);
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

        expect(focusNode!.score).toBeGreaterThan(neighborNode!.score);
        expect(neighborNode!.score).toBeGreaterThan(otherNode!.score);
    });
});
