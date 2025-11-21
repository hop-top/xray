
import Parser from 'tree-sitter';
import { CPPGraphGenerator } from './cpp';
const CPP = require('tree-sitter-cpp');

describe('CPPGraphGenerator', () => {
  let parser: Parser;
  let generator: CPPGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(CPP);
    generator = new CPPGraphGenerator();
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
    const funcDef = root.descendantsOfType('function_definition')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.cpp', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
  });

  it('should generate CFG for loops', async () => {
    const code = `
        void loopTest() {
            for (int i = 0; i < 10; i++) {
                doSomething();
            }
        }
      `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_definition')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.cpp', code });
    expect(cflogram.nodes.some(n => n.kind === 'loop')).toBe(true);
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

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.cpp', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
  });
});
