
import Parser from 'tree-sitter';
import { GoGraphGenerator } from './go';
const Go = require('tree-sitter-go');

describe('GoGraphGenerator', () => {
  let parser: Parser;
  let generator: GoGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Go);
    generator = new GoGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
      func test(x int) int {
        if x > 0 {
          return 1
        } else {
          return 0
        }
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_declaration')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.go', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
  });

  it('should generate CFG for loops', async () => {
    const code = `
        func loopTest() {
            for i := 0; i < 10; i++ {
                doSomething()
            }
        }
      `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_declaration')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.go', code });
    expect(cflogram.nodes.some(n => n.kind === 'loop')).toBe(true);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
      func test() {
        a := 1
        b := a + 1
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_declaration')[0];

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.go', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
  });
});
