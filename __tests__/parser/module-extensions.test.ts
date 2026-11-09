import { ParserManager } from '../../src/lib/parser/manager';
import { QueryResolver } from '../../src/lib/query-resolver';

describe('module-variant extensions (.mjs .cjs .mts .cts)', () => {
  const m = new ParserManager('/root');

  it.each([
    ['a.mjs', 'export function hi(a) { return a; }\n', 'hi'],
    ['a.cjs', 'function hi(a) { return a; }\nmodule.exports = { hi };\n', 'hi'],
    ['a.mts', 'export function hi(a: number): number { return a; }\n', 'hi'],
    ['a.cts', 'export function hi(a: number): number { return a; }\n', 'hi'],
  ])('parses %s', async (file, src, name) => {
    const r = await m.parse(file, src);
    expect(r.tags.map(t => t.name)).toContain(name);
  });

  it('custom query resolver covers the variants', () => {
    const map = (QueryResolver as any).EXT_MAP;
    expect(map.javascript).toEqual(expect.arrayContaining(['.mjs', '.cjs']));
    expect(map.typescript).toEqual(expect.arrayContaining(['.mts', '.cts']));
  });
});
