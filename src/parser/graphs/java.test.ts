
import Parser from 'tree-sitter';
import { JavaGraphGenerator } from './java';
const Java = require('tree-sitter-java');

describe('JavaGraphGenerator', () => {
  let parser: Parser;
  let generator: JavaGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Java);
    generator = new JavaGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
      class Test {
        int test(int x) {
          if (x > 0) {
            return 1;
          } else {
            return 0;
          }
        }
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('method_declaration')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.java', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
  });

  it('should generate CFG for loops', async () => {
    const code = `
        class LoopTest {
            void loopTest() {
                for (int i = 0; i < 10; i++) {
                    doSomething();
                }
            }
        }
      `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('method_declaration')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.java', code });
    expect(cflogram.nodes.some(n => n.kind === 'loop')).toBe(true);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
      class VarTest {
        void test() {
            int a = 1;
            int b = a + 1;
        }
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('method_declaration')[0];

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.java', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
  });
});
