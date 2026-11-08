/**
 * Relative `paths` (top level, `lenses.<name>.paths`, `scopes.<name>.paths`)
 * resolve against the directory of the config file that defines them, not
 * the cwd; absolute paths are kept; `--path` stays cwd-relative. Every
 * run starts from a cwd other than the config directory.
 * Spawns the built CLI (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

let tmp: string;
let home: string;
let proj: string;
let sub: string;
let out: string;

function run(args: string[], cwd: string): Result {
  const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      XRAY_NO_TELEMETRY: '1',
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function map(args: string[], cwd: string): string {
  const r = run(['map', '--no-chunk', '-o', out, ...args], cwd);
  expect(r.stderr).not.toMatch(/does not exist/);
  expect(r.status).toBe(0);
  return fs.readFileSync(out, 'utf-8');
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cfg-rel-')));
  home = path.join(tmp, 'home');
  proj = path.join(tmp, 'proj');
  sub = path.join(proj, 'sub');
  out = path.join(tmp, 'out.txt');
  fs.mkdirSync(home, { recursive: true });
  write(path.join(proj, 'src', 'core', 'alpha.py'), 'def alpha():\n    return 1\n');
  write(path.join(proj, 'src', 'extra', 'beta.py'), 'def beta():\n    return 2\n');
  // Same relative layout under the cwd: a cwd-relative resolve would scan these.
  write(path.join(sub, 'src', 'core', 'decoy.py'), 'def decoy():\n    return 3\n');
  write(path.join(sub, 'src', 'extra', 'decoy2.py'), 'def decoy2():\n    return 4\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function projectConfig(cfg: object): void {
  write(path.join(proj, '.xrayrc.json'), JSON.stringify({ skipDetect: true, ...cfg }));
}

describe('relative config paths resolve against the config file directory', () => {
  it('project config found by walking up from a subdirectory', () => {
    projectConfig({ paths: ['./src/core'] });
    const text = map([], sub);
    expect(text).toContain('alpha.py');
    expect(text).not.toContain('decoy');
  });

  it('lens paths', () => {
    projectConfig({ paths: ['./src/core'], lenses: { more: { paths: ['src/extra'] } } });
    const text = map(['--lens', 'more'], sub);
    expect(text).toContain('beta.py');
    expect(text).not.toContain('alpha.py');
    expect(text).not.toContain('decoy');
  });

  it('scope paths', () => {
    projectConfig({ paths: ['./src/core'], scopes: { more: { paths: ['./src/extra'] } } });
    const text = map(['--scope', 'more'], sub);
    expect(text).toContain('beta.py');
    expect(text).not.toContain('decoy');
  });

  it('explicit --config elsewhere', () => {
    // The config file's directory is its project: it may name only paths under it.
    const cfgDir = tmp;
    write(path.join(cfgDir, 'xray.json'), JSON.stringify({ skipDetect: true, paths: ['proj/src/core'] }));
    const r = run(['--config', path.join(cfgDir, 'xray.json'), 'map', '--no-chunk', '-o', out], sub);
    expect(r.stderr).not.toMatch(/does not exist/);
    expect(r.status).toBe(0);
    const t = fs.readFileSync(out, 'utf-8');
    expect(t).toContain('alpha.py');
    expect(t).not.toContain('decoy');
  });

  it('global config: against the global config directory', () => {
    const globalDir = path.join(home, '.config', 'xray');
    write(path.join(globalDir, 'config.json'), JSON.stringify({
      skipDetect: true,
      paths: ['../../../proj/src/core'],
      lenses: { more: { paths: ['../../../proj/src/extra'] } },
    }));
    // cwd with no project config on the way up
    const elsewhere = path.join(tmp, 'elsewhere');
    write(path.join(elsewhere, 'src', 'core', 'decoy.py'), 'def decoy():\n    return 3\n');
    let text = map([], elsewhere);
    expect(text).toContain('alpha.py');
    expect(text).not.toContain('decoy');
    text = map(['--lens', 'more'], elsewhere);
    expect(text).toContain('beta.py');
    expect(text).not.toContain('decoy');
  });

  it('absolute config paths unchanged', () => {
    projectConfig({ paths: [path.join(proj, 'src', 'extra')] });
    const text = map([], sub);
    expect(text).toContain('beta.py');
    expect(text).not.toContain('decoy');
  });

  it('--path on the CLI stays cwd-relative', () => {
    projectConfig({ paths: ['./src/extra'] });
    const text = map(['--path', 'src/core'], sub);
    expect(text).toContain('decoy.py');
    expect(text).not.toContain('alpha.py');
  });

  it('missing relative config root: warning names the resolved path', () => {
    projectConfig({ paths: ['./src/core', './gone'] });
    const r = run(['map', '--no-chunk', '-o', out], sub);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(path.join(proj, 'gone'));
    expect(fs.readFileSync(out, 'utf-8')).toContain('alpha.py');
  });
});
