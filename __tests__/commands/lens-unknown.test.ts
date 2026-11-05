/**
 * `--lens <name>` must name a lens defined under `lenses` in the config.
 * An unknown name (or `--lens` with no config / no lenses at all) is a
 * usage error (exit 2) naming the lens, the config file consulted and the
 * known lens names — never a silent scan of the default paths.
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
let root: string;
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

function writeConfig(cfg: object): void {
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
}

const LENSES = { quick: { limit: 1024 }, deep: { limit: 9000 } };

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-lens-unknown-')));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.py'), 'def a():\n    return 1\n');
  cfgFile = path.join(root, '.xrayrc.json');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('unknown --lens name', () => {
  const commands: Array<[string, (out: string) => string[]]> = [
    ['map', (out) => ['map', '--no-chunk', '-o', out]],
    ['graph', (out) => ['graph', '-o', out]],
    ['impact', () => ['impact', 'a']],
  ];

  it.each(commands)('%s: exit 2, names lens + config file + known lenses, writes nothing', (_name, args) => {
    writeConfig({ paths: ['./src'], skipDetect: true, lenses: LENSES });
    const out = path.join(tmp, 'out.txt');
    const r = run([...args(out), '--lens', 'nope']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"nope"');
    expect(r.stderr).toContain(cfgFile);
    expect(r.stderr).toMatch(/quick, deep/);
    expect(r.stderr).not.toMatch(/Found \d+ file/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('known lens still applies (exit 0, map written)', () => {
    writeConfig({ paths: ['./src'], skipDetect: true, lenses: LENSES });
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--no-chunk', '-o', out, '--lens', 'quick']);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(out, 'utf-8')).toContain('a.py');
  });

  it('config without lenses: exit 2, says none defined', () => {
    writeConfig({ paths: ['./src'], skipDetect: true });
    const r = run(['map', '--no-chunk', '-o', path.join(tmp, 'out.txt'), '--lens', 'quick']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"quick"');
    expect(r.stderr).toContain(cfgFile);
    expect(r.stderr).toMatch(/no lenses defined/i);
  });

  it('no config file at all: exit 2, says no config file found', () => {
    const r = run(['map', '--no-chunk', '-o', path.join(tmp, 'out.txt'), '--lens', 'quick']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('"quick"');
    expect(r.stderr).toMatch(/no config file found/i);
  });

  it('explicit --config is the file named', () => {
    const alt = path.join(tmp, 'alt.json');
    fs.writeFileSync(alt, JSON.stringify({ paths: ['./src'], skipDetect: true, lenses: LENSES }));
    const r = run(['--config', alt, 'map', '--no-chunk', '-o', path.join(tmp, 'out.txt'), '--lens', 'nope']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(alt);
    expect(r.stderr).toMatch(/quick, deep/);
  });
});

describe('--lens with --scope / --all-scopes', () => {
  const SCOPES = { core: { paths: ['./src'] } };
  const cases: Array<[string, string[]]> = [
    ['--scope then --lens', ['--scope', 'core', '--lens', 'quick']],
    ['--lens then --scope', ['--lens', 'quick', '--scope', 'core']],
    ['--all-scopes then --lens', ['--all-scopes', '--lens', 'quick']],
    ['--lens then --all-scopes', ['--lens', 'quick', '--all-scopes']],
  ];

  it.each(cases)('map %s: exit 2, names both flags, writes nothing', (_name, flags) => {
    writeConfig({ paths: ['./src'], skipDetect: true, lenses: LENSES, scopes: SCOPES });
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--no-chunk', '-o', out, ...flags]);
    expect(r.status).toBe(2);
    const flag = flags.includes('--all-scopes') ? '--all-scopes' : '--scope';
    expect(r.stderr).toContain(`${flag} and --lens are exclusive`);
    expect(r.stderr).not.toMatch(/Found \d+ file/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('impact --scope --lens: exit 2', () => {
    writeConfig({ paths: ['./src'], skipDetect: true, lenses: LENSES, scopes: SCOPES });
    const r = run(['impact', 'a', '--scope', 'core', '--lens', 'quick']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--scope and --lens are exclusive');
  });

  it('--scope alone still applies (exit 0, map written)', () => {
    writeConfig({ paths: ['./src'], skipDetect: true, lenses: LENSES, scopes: SCOPES });
    const out = path.join(tmp, 'out.txt');
    const r = run(['map', '--no-chunk', '-o', out, '--scope', 'core']);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(out, 'utf-8')).toContain('a.py');
  });
});
