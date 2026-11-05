/**
 * `strategy detect` writes nothing into the project: the detection cache
 * (timestamps, differs each run) lives in the user cache dir. A read-only
 * project works with no warning. Spawns the built CLI (`npm run build`
 * first) in a temp dir.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

let tmp: string;
let repo: string;

function run() {
  const home = path.join(tmp, 'home');
  return spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', 'strategy', 'detect'], {
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
}

/** Every entry under `dir` with its mode, size and mtime, or file content. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      const rel = path.relative(dir, p);
      if (st.isDirectory()) {
        out[rel] = `dir ${st.mode}`;
        walk(p);
      } else {
        out[rel] = `file ${st.mode} ${st.size} ${st.mtimeMs}`;
      }
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-detect-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.xray', 'strategies'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.xray', 'strategies', 'mine.yaml'), 'name: mine\n');
  fs.writeFileSync(path.join(repo, 'a.py'), 'def a():\n    return 1\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"p"}\n');
});

afterEach(() => {
  fs.chmodSync(repo, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
});

it('leaves the project tree unchanged', () => {
  const before = snapshot(repo);
  const r = run();
  expect(r.status).toBe(0);
  expect(snapshot(repo)).toEqual(before);
  expect(fs.existsSync(path.join(repo, '.xray', 'detected-strategies.json'))).toBe(false);
  // user strategies stay put
  expect(fs.readFileSync(path.join(repo, '.xray', 'strategies', 'mine.yaml'), 'utf-8')).toBe('name: mine\n');
});

it('works on a read-only project without a warning', () => {
  fs.rmSync(path.join(repo, '.xray'), { recursive: true });
  fs.chmodSync(repo, 0o555);
  const before = snapshot(repo);
  const r = run();
  expect(r.status).toBe(0);
  expect(r.stderr).not.toMatch(/Could not write|EACCES|EROFS|\.xray/);
  expect(snapshot(repo)).toEqual(before);
});
