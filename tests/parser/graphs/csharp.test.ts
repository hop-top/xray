
import Parser from 'tree-sitter';
import { CSharpGraphGenerator } from '../../../src/parser/graphs/csharp';
const CSharp = require('tree-sitter-c-sharp');

describe('CSharpGraphGenerator', () => {
  let parser: Parser;
  let generator: CSharpGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(CSharp);
    generator = new CSharpGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
      public class TestClass {
          public void Test(int x) {
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
    if (!root) throw new Error('Failed to parse C# code: rootNode is missing');

    // console.log(root.toString());
    const funcDef = root.descendantsOfType('method_declaration')[0] || root.descendantsOfType('local_function_statement')[0];

    if (!funcDef) {
      console.log('Tree:', root.toString());
      throw new Error('Function definition not found');
    }

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.cs', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
  });

  it('should generate CFG for loops', async () => {
    const code = `
        void LoopTest() {
            for (int i = 0; i < 10; i++) {
                DoSomething();
            }
        }
      `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('local_function_statement')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.cs', code });
    expect(cflogram.nodes.some(n => n.kind === 'loop')).toBe(true);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
      void Test() {
        int a = 1;
        int b = a + 1;
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('local_function_statement')[0];

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.cs', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
  });
});
