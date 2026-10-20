import Parser from 'tree-sitter';
import { PythonGraphGenerator } from '../../../src/lib/parser/graphs/python';
const Python = require('tree-sitter-python');

describe('PythonGraphGenerator', () => {
  let parser: Parser;
  let generator: PythonGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Python);
    generator = new PythonGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
def test(x):
  if x > 0:
    return 1
  else:
    return 0
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_definition')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.py', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
    expect(cflogram.edges.length).toBeGreaterThan(0);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
def test():
  a = 1
  b = a + 1
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_definition')[0];

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.py', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
    expect(dflogram.nodes.some(n => n.label === 'b')).toBe(true);
  });
});