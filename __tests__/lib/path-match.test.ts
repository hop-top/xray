import { compileMatchers } from '../../src/lib/path-match';

const TREE = [
  'a.ts', 'a.test.ts', 'Foo.TS', 'README.md',
  'src/b.ts', 'src/b.test.ts', 'src/sub/c.js', 'src/sub/deep/d.ts',
  'lib/x.ts', 'a-ts', 'src/.env.prod',
];
const run = (...p: string[]) => TREE.filter(compileMatchers(p));

describe('compileMatchers', () => {
  it('basename pattern matches at any depth', () => {
    expect(run('*.ts')).toEqual(['a.ts', 'a.test.ts', 'Foo.TS', 'src/b.ts', 'src/b.test.ts', 'src/sub/deep/d.ts', 'lib/x.ts']);
  });

  it('a `.` is literal', () => {
    expect(run('*.ts')).not.toContain('a-ts');
  });

  it('positives OR; a negative excludes', () => {
    expect(run('*.ts', '!*.test.ts')).toEqual(['a.ts', 'Foo.TS', 'src/b.ts', 'src/sub/deep/d.ts', 'lib/x.ts']);
    expect(run('*.js', 'README.md')).toEqual(['README.md', 'src/sub/c.js']);
  });

  it('negatives win whatever the order', () => {
    expect(run('!*.test.ts', '*.ts')).toEqual(run('*.ts', '!*.test.ts'));
  });

  it('only negatives: everything minus those', () => {
    expect(run('!*.test.ts', '!*.js')).toEqual(TREE.filter((f) => !/\.test\.ts$|\.js$/.test(f)));
  });

  it('a pattern with `/` anchors at the root; `*` stays in a segment', () => {
    expect(run('src/*.ts')).toEqual(['src/b.ts', 'src/b.test.ts']);
    expect(run('b.ts')).toEqual(['src/b.ts']);
    expect(run('sub/*.js')).toEqual([]);
  });

  it('`**` crosses `/`, and `**/` also matches zero directories', () => {
    expect(run('src/**/*.ts')).toEqual(['src/b.ts', 'src/b.test.ts', 'src/sub/deep/d.ts']);
    expect(run('**/*test*')).toEqual(['a.test.ts', 'src/b.test.ts']);
    expect(run('src/**')).toEqual(TREE.filter((f) => f.startsWith('src/')));
  });

  it('leading `/` and `./` mean the root; trailing `/` means the directory', () => {
    expect(run('/a.ts')).toEqual(['a.ts']);
    expect(run('./src/b.ts')).toEqual(['src/b.ts']);
    expect(run('src/sub/')).toEqual(['src/sub/c.js', 'src/sub/deep/d.ts']);
  });

  it('`.env*` reaches dotfiles by name', () => {
    expect(run('.env*')).toEqual(['src/.env.prod']);
  });

  it('a bare word is the whole basename, not a substring', () => {
    expect(run('b')).toEqual([]);
    expect(run('README.md')).toEqual(['README.md']);
  });

  it('`?` and character classes', () => {
    expect(run('?.ts')).toEqual(['a.ts', 'src/b.ts', 'src/sub/deep/d.ts', 'lib/x.ts']);
    expect(run('/?.ts')).toEqual(['a.ts']);
    expect(run('[ab].ts')).toEqual(['a.ts', 'src/b.ts']);
    expect(run('[!a].ts')).toEqual(['src/b.ts', 'src/sub/deep/d.ts', 'lib/x.ts']);
  });

  it('case-insensitive', () => {
    expect(run('*.ts')).toContain('Foo.TS');
    expect(run('FOO.ts')).toEqual(['Foo.TS']);
  });

  it('regex metacharacters in a pattern are literal', () => {
    expect(run('(a).ts', 'a+.ts', 'a|b', '^a')).toEqual([]);
  });

  it('empty and bare-`!` patterns select everything', () => {
    expect(run()).toEqual(TREE);
    expect(run('!')).toEqual(TREE);
  });
});

describe('compileMatchers: hostile patterns', () => {
  const BOUND_MS = 500;
  const timed = (patterns: string[], path: string): { hit: boolean; ms: number } => {
    const start = process.hrtime.bigint();
    const hit = compileMatchers(patterns)(path);
    return { hit, ms: Number(process.hrtime.bigint() - start) / 1e6 };
  };

  it.each([
    ['`*a` x12, short path', ['*a'.repeat(12) + '*b'], 'a'.repeat(60)],
    ['`*a` x200, long path', ['*a'.repeat(200) + '*b'], 'a'.repeat(4096)],
    ['`**/a` x200, deep path', ['**/a'.repeat(200) + 'b'], 'a/'.repeat(2048)],
    ['`**/*a` x50, deep path', ['**/*a'.repeat(50) + 'b'], 'a/'.repeat(2048)],
    ['long `?` run', ['?'.repeat(1000) + 'b'], 'a'.repeat(1000)],
    ['`*?` run', ['*?'.repeat(500) + 'b'], 'a'.repeat(2000)],
    ['huge class', [`[${'a-b'.repeat(150)}]*[${'xyz'.repeat(150)}]b`], 'a'.repeat(3000)],
    ['as a negative', ['!' + '*a'.repeat(200) + '*b'], 'a'.repeat(4096)],
  ] as const)('%s finishes fast and does not match', (_name, patterns, path) => {
    const { hit, ms } = timed([...patterns], path);
    expect(hit).toBe(patterns[0].startsWith('!'));
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it('the same patterns still match when they should', () => {
    const m = compileMatchers(['*a'.repeat(200) + '*b']);
    expect(m('a'.repeat(4096) + 'b')).toBe(true);
    expect(compileMatchers(['**/a'.repeat(50)])('a/'.repeat(49) + 'a')).toBe(true);
  });
});

describe('compileMatchers: classes', () => {
  const m = (p: string, path: string) => compileMatchers([p])(path);

  it('a reversed range is empty, never an error', () => {
    expect(() => compileMatchers(['[z-a]'])).not.toThrow();
    expect(m('[z-a]', 'a')).toBe(false);
    expect(m('[z-a]', 'm')).toBe(false);
    expect(m('[!z-a]', 'm')).toBe(true);
    expect(m('[z-ab]', 'b')).toBe(true);
    expect(m('x[z-a]y', 'xay')).toBe(false);
  });

  it('ranges and `^` negation, case-insensitive', () => {
    expect(m('[a-c]', 'b')).toBe(true);
    expect(m('[a-c]', 'B')).toBe(true);
    expect(m('[a-c]', 'd')).toBe(false);
    expect(m('[^a-c]', 'd')).toBe(true);
    expect(m('[^a-c]', 'b')).toBe(false);
    expect(m('[!a-c]', 'B')).toBe(false);
  });

  it('`]` first, leading or trailing `-`, and `\\` are class members', () => {
    expect(m('[]a]', ']')).toBe(true);
    expect(m('[a-]', '-')).toBe(true);
    expect(m('[-a]', '-')).toBe(true);
    expect(m('[a-]', 'b')).toBe(false);
    expect(m('[\\]', '\\')).toBe(true);
    expect(m('[*]', '*')).toBe(true);
    expect(m('[*]', 'a')).toBe(false);
  });

  it('an unclosed `[` is literal', () => {
    expect(m('[', '[')).toBe(true);
    expect(m('a[b', 'a[b')).toBe(true);
    expect(m('[!]', 'x')).toBe(true); // `[!]` closes as an empty negated class
  });
});

describe('compileMatchers: `**` over odd paths', () => {
  it('crosses a newline in a file name', () => {
    expect(compileMatchers(['src/**'])('src/a\nb/c.ts')).toBe(true);
    expect(compileMatchers(['**/c.ts'])('a\nb/c.ts')).toBe(true);
    expect(compileMatchers(['c.ts'])('a\nb/c.ts')).toBe(true);
  });

  it('`**/` takes whole directories only', () => {
    const m = compileMatchers(['**/b.ts']);
    expect(m('b.ts')).toBe(true);
    expect(m('x/y/b.ts')).toBe(true);
    expect(m('xb.ts')).toBe(false);
    expect(compileMatchers(['a/**/b'])('a/b')).toBe(true);
    expect(compileMatchers(['a/**/b'])('a/x/y/b')).toBe(true);
    expect(compileMatchers(['a/**/b'])('a/xb')).toBe(false);
  });
});
