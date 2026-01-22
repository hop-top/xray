
import Parser from 'tree-sitter';
import { RustGraphGenerator } from '../../../src/parser/graphs/rust';
const Rust = require('tree-sitter-rust');

describe('RustGraphGenerator', () => {
  let parser: Parser;
  let generator: RustGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Rust);
    generator = new RustGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
      fn test(x: i32) -> i32 {
        if x > 0 {
          return 1;
        } else {
          return 0;
        }
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_item')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.rs', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
  });

  it('should generate CFG for loops', async () => {
    const code = `
        fn loop_test() {
            for i in 0..10 {
                do_something();
            }
        }
      `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_item')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.rs', code });
    expect(cflogram.nodes.some(n => n.kind === 'loop')).toBe(true);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
      fn test() {
        let a = 1;
        let b = a + 1;
      }
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_item')[0];

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.rs', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
  });
});
