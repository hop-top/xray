import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addExploreOutputFlags, handleExploreAction } from '../../src/commands/explore';

/**
 * `--match` end to end. Tree lives under a directory named `*-env/` so a
 * match against the absolute path would see ancestors of the root.
 */
describe('xray explore --match', () => {
  let base: string;
  let root: string;
  let other: string;
  let writeSpy: jest.SpyInstance;
  const captured = () => writeSpy.mock.calls.map((c) => String(c[0])).join('');

  const put = (dir: string, files: string[]) => {
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), 'export const x = 1;\n');
    }
  };

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-match-env-'));
    root = path.join(base, 'proj-env', 'proj');
    other = path.join(base, 'other');
    put(root, ['a.ts', 'a.test.ts', 'src/b.ts', 'src/b.test.ts', 'src/sub/c.js', 'src/envelope.ts', '.env.ts']);
    put(other, ['z.ts', 'z.test.ts', 'src/y.ts']);
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
  let logSpies: jest.SpyInstance[];
  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logSpies = (['log', 'error', 'warn', 'info'] as const).map((m) => jest.spyOn(console, m).mockImplementation());
  });
  afterEach(() => {
    writeSpy.mockRestore();
    logSpies.forEach((s) => s.mockRestore());
  });

  async function explore(paths: string[], ...args: string[]): Promise<string[]> {
    writeSpy.mockClear();
    const program = new Command();
    program.exitOverride();
    const cmd = program
      .command('explore')
      .argument('[query]')
      .option('-p, --path <path>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-m, --match <pattern>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-s, --search <keyword>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-t, --type <ext>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('--stats');
    addExploreOutputFlags(cmd).action((q, opts, c) => handleExploreAction(q, opts, c));
    await program.parseAsync(['node', 'test', 'explore', ...paths.flatMap((p) => ['-p', p]), '--format', 'json', ...args]);
    return JSON.parse(captured()).map((r: { path: string }) => r.path).sort();
  }
  const under = (dir: string, ...rel: string[]) => rel.map((r) => path.join(dir, r)).sort();

  it('a negated pattern excludes from the positive set', async () => {
    expect(await explore([root], '-m', '*.ts', '-m', '!*.test.ts'))
      .toEqual(under(root, '.env.ts', 'a.ts', 'src/b.ts', 'src/envelope.ts'));
  });

  it('only negatives: everything minus those', async () => {
    expect(await explore([root], '-m', '!*.test.ts', '-m', '!*.js'))
      .toEqual(under(root, '.env.ts', 'a.ts', 'src/b.ts', 'src/envelope.ts'));
  });

  it('ancestors of the root do not take part in matching', async () => {
    expect(await explore([root], '-m', '*env*')).toEqual(under(root, '.env.ts', 'src/envelope.ts'));
    expect(await explore([root], '-m', '.env*')).toEqual(under(root, '.env.ts'));
    expect(await explore([root], '-m', '!*env*', '-m', '*.ts')).toEqual(under(root, 'a.test.ts', 'a.ts', 'src/b.test.ts', 'src/b.ts'));
  });

  it('a pattern with `/` is anchored at the root', async () => {
    expect(await explore([root], '-m', 'src/*.ts')).toEqual(under(root, 'src/b.test.ts', 'src/b.ts', 'src/envelope.ts'));
    expect(await explore([root], '-m', 'proj-env/**')).toEqual([]);
  });

  it('each --path is matched under its own root', async () => {
    expect(await explore([root, other], '-m', 'src/*.ts', '-m', '!*.test.ts'))
      .toEqual([...under(root, 'src/b.ts', 'src/envelope.ts'), ...under(other, 'src/y.ts')].sort());
  });

  it('combines with --type', async () => {
    expect(await explore([root], '-t', 'js', '-m', '!*.test.ts')).toEqual(under(root, 'src/sub/c.js'));
    expect(await explore([root], '-t', 'ts', '-m', 'src/**', '-m', '!*.test.ts')).toEqual(under(root, 'src/b.ts', 'src/envelope.ts'));
  });
});
