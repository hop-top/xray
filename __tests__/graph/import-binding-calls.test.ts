import { ParserManager } from '../../src/lib/parser/manager';
import { GraphBuilder } from '../../src/lib/graph/builder';
import { Confidence } from '../../src/types/graph';

/**
 * Parser + builder: a call on an import-bound module name links only when the
 * module is in the repo, and then through the import tier.
 */
describe('calls on import-bound modules (parser + builder)', () => {
  const files: Record<string, string> = {
    'src/app/main.ts': [
      "import * as path from 'path';",
      "import * as util from '../lib/util';",
      'export function findConfigPath(dir: string) { return path.parse(dir); }',
      'export function run() { return util.helper(); }',
    ].join('\n'),
    'src/lib/util.ts': 'export function helper() { return 1; }\n',
    'src/other/cfg.ts': 'export class Cfg { parse(s: string) { return s; } }\nexport function helper() { return 2; }\n',
  };

  async function callEdges() {
    const parser = new ParserManager('/root');
    const builder = new GraphBuilder();
    for (const [file, src] of Object.entries(files)) {
      const { tags, imports } = await parser.parse(file, src);
      await builder.addFile(file, tags, imports);
    }
    const graph = await builder.getGraph();
    const edges: Array<{ from: string; to: string; toFile: string; confidence: Confidence }> = [];
    graph.forEachEdge((_e: string, attrs: any, source: string, target: string) => {
      if (attrs.type !== 'calls') return;
      edges.push({
        from: graph.getNodeAttributes(source).label,
        to: graph.getNodeAttributes(target).label,
        toFile: graph.getNodeAttributes(target).file,
        confidence: attrs.confidence,
      });
    });
    return edges;
  }

  it('path.parse() on an external module links to no user parse method', async () => {
    const edges = await callEdges();
    expect(edges.filter(e => e.from === 'findConfigPath')).toEqual([]);
  });

  it('util.helper() on a repo module links EXTRACTED to the imported file only', async () => {
    const edges = await callEdges();
    expect(edges.filter(e => e.from === 'run')).toEqual([
      { from: 'run', to: 'helper', toFile: 'src/lib/util.ts', confidence: Confidence.EXTRACTED },
    ]);
  });
});
