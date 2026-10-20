
import Parser from 'tree-sitter';
import { SwiftGraphGenerator } from '../../../src/lib/parser/graphs/swift';
const Swift = require('tree-sitter-swift');

describe('SwiftGraphGenerator', () => {
  let parser: Parser;
  let generator: SwiftGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Swift);
    generator = new SwiftGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
      func test(x: Int) -> Int {
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

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.swift', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
  });

  it('should generate CFG for loops', async () => {
    const code = `
        func loopTest() {
            for i in 0..<10 {
                doSomething()
            }
        }
      `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_declaration')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.swift', code });
    expect(cflogram.nodes.some(n => n.kind === 'loop')).toBe(true);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
      func test() {
        let a = 1
        let b = a + 1
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_declaration')[0];

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.swift', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
  });
});
