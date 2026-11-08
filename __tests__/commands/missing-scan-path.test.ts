/**
 * Scan roots are validated before analysis: a configured root that no
 * longer exists warns (naming the root and the config file it came from)
 * and is skipped; no surviving root, or a missing `--path`, fails non-zero
 * without writing a map. Spawns the built CLI (`npm run build` first).
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
let root: string;
let good: string;
let gone: string;
let cfgFile: string;

function run(args: string[]): Result {
  const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', ...args], {
    cwd: root,
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

function writeConfig(paths: string[]): void {
  fs.writeFileSync(cfgFile, JSON.stringify({ paths, skipDetect: true }));
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-missing-root-')));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'proj');
  // Config roots must stay inside the project (the config file's directory).
  good = path.join(root, 'good');
  gone = path.join(root, 'renamed-away');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(good, { recursive: true });
  fs.writeFileSync(path.join(good, 'a.py'), 'def a():\n    return 1\n');
  cfgFile = path.join(root, '.xrayrc.json');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('missing scan roots', () => {
  it('config root missing: warns with root + config file, maps the remaining root', () => {
    writeConfig([gone, good]);
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--no-chunk', '-o', out]);
    expect(r.status).toBe(0);
    const warning = r.stderr.split('\n').find((l) => l.includes(gone));
    expect(warning).toBeDefined();
    expect(warning).toContain(cfgFile);
    expect(r.stderr).not.toMatch(new RegExp(`Analyzing repo at:.*${gone}`));
    expect(fs.readFileSync(out, 'utf-8')).toContain('a.py');
  });

  it('config root that is a file, not a directory: warned and skipped', () => {
    const file = path.join(good, 'a.py');
    writeConfig([file, good]);
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--no-chunk', '-o', out]);
    expect(r.status).toBe(0);
    expect(r.stderr.split('\n').find((l) => l.includes(file) && l.includes(cfgFile))).toBeDefined();
  });

  it.each(['map', 'graph'])('%s: all config roots missing -> config error, non-zero, no map', (cmd) => {
    writeConfig([gone]);
    const out = path.join(tmp, 'out.txt');
    const r = run([cmd, '--no-chunk', '-o', out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(gone);
    expect(r.stderr).toContain(cfgFile);
    expect(r.stderr).not.toContain('Found 0 files');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('all config roots missing (default chunked output): no .xray map written', () => {
    writeConfig([gone]);
    const r = run(['map']);
    expect(r.status).not.toBe(0);
    expect(fs.readdirSync(root).filter((f) => f.startsWith('.xray') && f.endsWith('.md'))).toEqual([]);
  });

  it('config roots from the global config: warning names the global file', () => {
    const globalCfg = path.join(home, '.config', 'xray', 'config.json');
    fs.mkdirSync(path.dirname(globalCfg), { recursive: true });
    fs.writeFileSync(globalCfg, JSON.stringify({ paths: [gone, good] }));
    fs.writeFileSync(cfgFile, JSON.stringify({ skipDetect: true }));
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--no-chunk', '-o', out]);
    expect(r.status).toBe(0);
    const warning = r.stderr.split('\n').find((l) => l.includes(gone));
    expect(warning).toContain(globalCfg);
    expect(warning).not.toContain(cfgFile);
  });

  it('scope paths missing: --scope fails with root + config file, no map', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ skipDetect: true, scopes: { api: { paths: [gone] } } }));
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--scope', 'api', '--no-chunk', '-o', out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(gone);
    expect(r.stderr).toContain(cfgFile);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('scope paths partly missing: --all-scopes warns and maps the good root', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({
      skipDetect: true,
      scopes: { api: { paths: [gone, good], output: path.join(root, 'api.txt'), chunked: false } },
    }));
    const r = run(['map', '--all-scopes']);
    expect(r.status).toBe(0);
    expect(r.stderr.split('\n').find((l) => l.includes(gone) && l.includes(cfgFile))).toBeDefined();
    expect(fs.readFileSync(path.join(root, 'api.txt'), 'utf-8')).toContain('a.py');
  });

  it('missing --path -> error, non-zero, no map', () => {
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--path', gone, '--no-chunk', '-o', out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(gone);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('missing --path alongside a good one still fails (typo is never skipped)', () => {
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--path', good, '--path', gone, '--no-chunk', '-o', out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(gone);
    expect(fs.existsSync(out)).toBe(false);
  });
});
