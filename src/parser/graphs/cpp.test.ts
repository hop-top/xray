
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

    const cfg = await generator.generateCFG({ node: funcDef, file: 'test.cpp', code });

    expect(cfg.nodes.length).toBeGreaterThan(0);
    expect(cfg.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cfg.nodes.some(n => n.kind === 'condition')).toBe(true);
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

    const cfg = await generator.generateCFG({ node: funcDef, file: 'test.cpp', code });
    expect(cfg.nodes.some(n => n.kind === 'loop')).toBe(true);
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

    const dfg = await generator.generateDFG({ node: funcDef, file: 'test.cpp', code });

    expect(dfg.nodes.length).toBeGreaterThan(0);
    expect(dfg.nodes.some(n => n.label === 'a')).toBe(true);
  });
});
