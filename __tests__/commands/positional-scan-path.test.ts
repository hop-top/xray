/**
 * `map`/`graph [paths...]`: a positional path is exactly `--path`.
 * Spawns the built CLI (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

let tmp: string;
let home: string;
let root: string;

function run(args: string[], cwd: string = root) {
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
      XRAY_LANG_DIR: path.join(home, 'lang'),
      XRAY_NO_TELEMETRY: '1',
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function files(out: string): string[] {
  const g = JSON.parse(fs.readFileSync(out, 'utf-8'));
  const ids = (g.nodes ?? []).map((n: any) => String(n.file ?? n.path ?? n.id));
  return [...new Set(ids.map((i: string) => i.split('::')[0]))].sort() as string[];
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-positional-')));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(root, 'a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'c'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'x.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'b', 'y.ts'), 'export const y = 1;\n');
  fs.writeFileSync(path.join(root, 'c', 'z.ts'), 'export const z = 1;\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe.each(['map', 'graph'])('%s [paths...]', (cmd) => {
  const json = (extra: string[], name: string) => {
    const out = path.join(tmp, name);
    const r = run([cmd, ...extra, '--format', 'json', '-o', out]);
    return { r, out };
  };

  it('maps only the positional path, same graph as --path', () => {
    const pos = json(['a'], 'pos.json');
    const flag = json(['--path', 'a'], 'flag.json');
    expect(pos.r.status).toBe(0);
    const f = files(pos.out);
    expect(f.some((p) => p.endsWith('x.ts'))).toBe(true);
    expect(f.some((p) => p.endsWith('y.ts'))).toBe(false);
    expect(f.some((p) => p.endsWith('z.ts'))).toBe(false);
    expect(f).toEqual(files(flag.out));
  });

  it('several positionals merge like repeated --path', () => {
    const pos = json(['a', 'b'], 'pos.json');
    const flag = json(['--path', 'a', '--path', 'b'], 'flag.json');
    expect(pos.r.status).toBe(0);
    const f = files(pos.out);
    expect(f.some((p) => p.endsWith('x.ts'))).toBe(true);
    expect(f.some((p) => p.endsWith('y.ts'))).toBe(true);
    expect(f.some((p) => p.endsWith('z.ts'))).toBe(false);
    expect(f).toEqual(files(flag.out));
  });

  it('nonexistent positional fails exactly like a nonexistent --path', () => {
    const pos = json(['nope'], 'pos.json');
    const flag = json(['--path', 'nope'], 'flag.json');
    expect(flag.r.status).not.toBe(0);
    expect(pos.r.status).toBe(flag.r.status);
    expect(pos.r.stderr).toContain(path.join(root, 'nope'));
    expect(pos.r.stderr).toContain('Path does not exist or is not a directory');
    expect(fs.existsSync(pos.out)).toBe(false);
  });

  it('positional together with --path is a usage error (exit 2)', () => {
    const r = json(['a', '--path', 'b'], 'x.json');
    expect(r.r.status).toBe(2);
    expect(r.r.stderr).toMatch(/positional/i);
    expect(r.r.stderr).toContain('--path');
    expect(fs.existsSync(r.out)).toBe(false);
  });

  it('no positional: scans the current directory as before', () => {
    const { r, out } = json([], 'plain.json');
    expect(r.status).toBe(0);
    expect(files(out).filter((p) => /[xyz]\.ts$/.test(p))).toHaveLength(3);
  });
});

describe('positional path feeds config discovery like --path', () => {
  it('finds the config next to the positional root', () => {
    // sub/.xrayrc.json excludes skip.ts; found via walk-up from the root
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'keep.ts'), 'export const k = 1;\n');
    fs.writeFileSync(path.join(sub, 'skip.ts'), 'export const s = 1;\n');
    fs.writeFileSync(path.join(sub, '.xrayrc.json'), JSON.stringify({ skipDetect: true, ignore: ['skip.ts'] }));
    const pos = path.join(tmp, 'pos.json');
    const flag = path.join(tmp, 'flag.json');
    const rp = run(['map', 'sub', '--format', 'json', '-o', pos]);
    const rf = run(['map', '--path', 'sub', '--format', 'json', '-o', flag]);
    expect(rp.status).toBe(0);
    expect(rf.status).toBe(0);
    expect(files(pos)).toEqual(files(flag));
  });

  it('config `paths` is overridden by a positional exactly as by --path', () => {
    fs.writeFileSync(path.join(root, '.xrayrc.json'), JSON.stringify({ skipDetect: true, paths: ['b'] }));
    const pos = path.join(tmp, 'pos.json');
    const flag = path.join(tmp, 'flag.json');
    expect(run(['map', 'a', '--format', 'json', '-o', pos]).status).toBe(0);
    expect(run(['map', '--path', 'a', '--format', 'json', '-o', flag]).status).toBe(0);
    const f = files(pos);
    expect(f).toEqual(files(flag));
    expect(f.some((p) => p.endsWith('x.ts'))).toBe(true);
    expect(f.some((p) => p.endsWith('y.ts'))).toBe(false);
  });

  it('resolves against -C like --path', () => {
    const pos = path.join(tmp, 'pos.json');
    const flag = path.join(tmp, 'flag.json');
    expect(run(['-C', root, 'map', 'a', '--format', 'json', '-o', pos], tmp).status).toBe(0);
    expect(run(['-C', root, 'map', '--path', 'a', '--format', 'json', '-o', flag], tmp).status).toBe(0);
    expect(files(pos)).toEqual(files(flag));
    expect(files(pos).some((p) => p.endsWith('y.ts'))).toBe(false);
  });
});
