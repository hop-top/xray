import { ParserManager } from '../../src/lib/parser/manager';

// Strict: no try/catch skipping; grammars are installed in the test env.
describe('symbol signatures and generators', () => {
  const m = new ParserManager('/root');
  const tag = async (file: string, src: string, name: string) => {
    const r = await m.parse(file, src);
    const t = r.tags.find(x => x.name === name);
    expect(t).toBeDefined();
    return t!;
  };

  it('extracts js generator functions', async () => {
    const t = await tag('a.js', 'function* gen(a, b) { yield a; }\n', 'gen');
    expect(t.kind).toBe('function');
    expect(t.signature).toBe('(a, b)');
  });

  it('extracts exported ts generator functions', async () => {
    const t = await tag('a.ts', 'export function* gen(n: number): Generator<number> { yield n; }\n', 'gen');
    expect(t.kind).toBe('function');
    expect(t.signature).toContain('n: number');
  });

  it('python functions show params', async () => {
    const t = await tag('a.py', 'def add(a, b: int = 1) -> int:\n    return a\n', 'add');
    expect(t.signature).toBe('(a, b: int = 1) -> int');
  });

  it('go methods show params, not ()', async () => {
    const t = await tag('a.go', 'package p\nfunc (s *S) Do(x int, y string) error { return nil }\n', 'Do');
    expect(t.signature).toBe('(x int, y string) error');
  });

  it('arrow functions show params', async () => {
    const t = await tag('a.ts', 'export const f = (a: number, b: string): void => {};\n', 'f');
    expect(t.signature).toBe('(a: number, b: string) : void');
  });

  it('single-param arrow without parens', async () => {
    const t = await tag('a.js', 'const g = x => x;\n', 'g');
    expect(t.signature).toBe('(x)');
  });

  it('arrow nested in a function does not borrow the outer signature', async () => {
    const t = await tag('a.ts', 'function outer(p: number) { const inner = (q: string) => q; }\n', 'inner');
    expect(t.signature).toContain('q: string');
  });
});
