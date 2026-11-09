import { findNodes } from '../../src/lib/query/match';

function graphOf(labels: Array<[string, string]>): any {
  return {
    forEachNode(fn: (id: string, attrs: any) => void) {
      for (const [id, label] of labels) fn(id, { type: 'tag', label });
    },
  };
}

describe('findNodes glob semantics', () => {
  const g = graphOf([
    ['src/a.ts::Foo', 'Foo'],
    ['src/b/c.ts::Bar', 'Bar'],
    ['src/b/c.ts::foo', 'foo'],
    ['x.y', 'x.y'],
    ['xzy', 'xzy'],
  ]);
  const ids = (p: string) => findNodes(p, g);

  it('star stops at slash, double star crosses it', () => {
    expect(ids('src/*::Foo')).toEqual(['src/a.ts::Foo']);
    expect(ids('src/**::Bar')).toEqual(['src/b/c.ts::Bar']);
    expect(ids('src/*::Bar')).toEqual([]);
  });

  it('question mark is any one character, slash included', () => {
    expect(ids('src?a.ts::Foo')).toEqual(['src/a.ts::Foo']);
    expect(ids('F?o')).toEqual(['src/a.ts::Foo']);
  });

  it('is case-sensitive and treats other characters literally', () => {
    expect(ids('F*')).toEqual(['src/a.ts::Foo']);
    expect(ids('x.*')).toEqual(['x.y']);
    expect(ids('[xz]*y')).toEqual([]);
    expect(ids('**/c.ts::Bar')).toEqual(['src/b/c.ts::Bar']);
    expect(ids('src/**/a.ts::Foo')).toEqual([]); // zero-directory rule is path-only
    expect(ids('f*')).toEqual(['src/b/c.ts::foo']);
  });
});

describe('findNodes hostile glob', () => {
  it('eight stars over a long non-match finishes fast', () => {
    const subject = 'a'.repeat(60);
    const g = graphOf([[subject, subject + 'b']]);
    const t = Date.now();
    expect(findNodes('*a'.repeat(8) + 'c', g)).toEqual([]);
    expect(Date.now() - t).toBeLessThan(500);
  });
});
