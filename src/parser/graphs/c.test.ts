
import Parser from 'tree-sitter';
import { CGraphGenerator } from './c';
const C = require('tree-sitter-c');

describe('CGraphGenerator', () => {
  let parser: Parser;
  let generator: CGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(C);
    generator = new CGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
      void test(int x) {
        if (x > 0) {
          return 1;
        } else {
          return 0;
        }
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    // Find the function definition
    const funcDef = root.descendantsOfType('function_definition')[0];

    const cfg = await generator.generateCFG({ node: funcDef, file: 'test.c', code });

    expect(cfg.nodes.length).toBeGreaterThan(0);
    expect(cfg.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cfg.nodes.some(n => n.kind === 'condition')).toBe(true);
    // We expect edges from entry -> condition -> true/false blocks
    expect(cfg.edges.length).toBeGreaterThan(0);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
      void test() {
        int a = 1;
        int b = a + 1;
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_definition')[0];

    const dfg = await generator.generateDFG({ node: funcDef, file: 'test.c', code });

    expect(dfg.nodes.length).toBeGreaterThan(0);
    expect(dfg.nodes.some(n => n.label === 'a')).toBe(true);
    expect(dfg.nodes.some(n => n.label === 'b')).toBe(true);
  });
});
