/**
 * `xray <path>`: a file scans only that file, a directory only that
 * directory, with or without leading root flags, in a git repo, for a
 * symlink and for hostile file names. Requires `npm run build`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.join(__dirname, '../../bin/xray');
let repo: string;
let env: NodeJS.ProcessEnv;

const run = (...args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd: repo, env, encoding: 'utf-8', timeout: 60_000 });
const listed = (r: { stdout: string }) =>
  r.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ts$/.test(l));

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-scope-')));
  const home = path.join(repo, '..', path.basename(repo) + '-home');
  fs.mkdirSync(home, { recursive: true });
  env = {
    PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR, NO_COLOR: '1',
    XDG_CONFIG_HOME: path.join(home, 'c'), XDG_CACHE_HOME: path.join(home, 'k'),
    XDG_DATA_HOME: path.join(home, 'd'), XDG_STATE_HOME: path.join(home, 's'),
  };
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'src/$(touch PWNED).ts'), 'export const b = 1;\n');
  fs.symlinkSync('src/$(touch PWNED).ts', path.join(repo, 'link.ts'));
  fs.writeFileSync(path.join(repo, 'top.ts'), 'export const t = 1;\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('xray <path> scopes to the path', () => {
  it.each([
    ['a file', ['src/a.ts'], ['src/a.ts']],
    ['a file after root flags', ['--no-telemetry', '--offline', 'src/a.ts'], ['src/a.ts']],
    ['a symlink to a hostile name', ['link.ts'], ['link.ts']],
    ['a symlink after root flags', ['--no-telemetry', '--offline', 'link.ts'], ['link.ts']],
    ['a hostile name', ['src/$(touch PWNED).ts'], ['src/$(touch PWNED).ts']],
  ])('%s', (_n, args, want) => {
    const got = listed(run(...args)).map((l) => path.relative(repo, l));
    expect(got).toEqual(want);
    expect(fs.existsSync(path.join(repo, 'src/PWNED'))).toBe(false);
  });

  it.each([
    ['a directory', ['src']],
    ['a directory after root flags', ['--no-telemetry', '--offline', 'src']],
  ])('%s lists only that directory', (_n, args) => {
    const got = listed(run(...args)).map((l) => path.relative(repo, l)).sort();
    expect(got).toEqual(['src/$(touch PWNED).ts', 'src/a.ts']);
  });
});
