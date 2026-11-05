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
