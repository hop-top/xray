/**
 * A regular file named `.xray` in the project (left by an old version):
 * detection keeps its cache outside the project, so the command works with
 * no warning and leaves the file alone. Spawns the built CLI (`npm run
 * build` first) in a temp dir.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

let tmp: string;
let repo: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-stale-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'a.py'), 'def a():\n    return 1\n');
  fs.writeFileSync(path.join(repo, '.xray'), 'left by an old version\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

it('strategy detect with a .xray file works without a warning and leaves it alone', () => {
  const home = path.join(tmp, 'home');
  const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', 'strategy', 'detect'], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      NO_COLOR: '1',
    },
    input: '',
    encoding: 'utf-8',
    timeout: 60_000,
  });
  expect(r.status).toBe(0);
  expect(r.stderr).toContain('Detecting strategies for');
  expect(r.stderr).not.toContain('.xray');
  expect(r.stderr).not.toContain('ENOTDIR');
  expect(r.stderr).not.toMatch(/Could not write/);
  // nothing deleted
  expect(fs.readFileSync(path.join(repo, '.xray'), 'utf-8')).toBe('left by an old version\n');
});
