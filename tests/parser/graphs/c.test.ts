
import Parser from 'tree-sitter';
import { CGraphGenerator } from '../../../src/parser/graphs/c';
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

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.c', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
    // We expect edges from entry -> condition -> true/false blocks
    expect(cflogram.edges.length).toBeGreaterThan(0);
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

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.c', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
    expect(dflogram.nodes.some(n => n.label === 'b')).toBe(true);
  });
});
