import Parser from 'tree-sitter';
import { TypeScriptGraphGenerator } from '../../../src/parser/graphs/typescript';
const TypeScript = require('tree-sitter-typescript').typescript;

describe('TypeScriptGraphGenerator', () => {
  let parser: Parser;
  let generator: TypeScriptGraphGenerator;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(TypeScript);
    generator = new TypeScriptGraphGenerator();
  });

  it('should generate CFG for a simple function', async () => {
    const code = `
function test(x: number): number {
  if (x > 0) {
    return 1;
  } else {
    return 0;
  }
}
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_declaration')[0];

    const cflogram = await generator.generateCFG({ node: funcDef, file: 'test.ts', code });

    expect(cflogram.nodes.length).toBeGreaterThan(0);
    expect(cflogram.nodes.some(n => n.kind === 'entry')).toBe(true);
    expect(cflogram.nodes.some(n => n.kind === 'condition')).toBe(true);
    expect(cflogram.edges.length).toBeGreaterThan(0);
  });

  it('should generate DFG for variable usage', async () => {
    const code = `
function test() {
  let a = 1;
  let b = a + 1;
}
    `;
    const tree = parser.parse(code);
    const root = tree.rootNode;
    const funcDef = root.descendantsOfType('function_declaration')[0];

    const dflogram = await generator.generateDFG({ node: funcDef, file: 'test.ts', code });

    expect(dflogram.nodes.length).toBeGreaterThan(0);
    expect(dflogram.nodes.some(n => n.label === 'a')).toBe(true);
    expect(dflogram.nodes.some(n => n.label === 'b')).toBe(true);
  });
});