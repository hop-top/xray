/**
 * End-to-end: files whose names git would quote (`core.quotepath`: non-ASCII
 * bytes, tab, newline, ESC) are scanned like any other. Requires
 * `npm run build`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileScanner, gitListFiles } from '../../src/lib/scanner';

const CLI = path.resolve(__dirname, '../../bin/cli.js');
const posix = process.platform !== 'win32';

// name -> exported function, so each file contributes a distinct symbol.
const NAMES: Array<[string, string]> = [
  ['café.ts', 'cafe'],
  ['日本.ts', 'nihon'],
  ['with space.ts', 'spaced'],
  ['tab\there.ts', 'tabbed'],
  ['new\nline.ts', 'newlined'],
  ['esc\u001b[31mred.ts', 'escaped'],
  ['sub dir/ünï.ts', 'nested'],
];
const WIN_UNSAFE = /[\t\n\u001b]/;

let sandbox: string;
let proj: string;
let env: NodeJS.ProcessEnv;
const names = NAMES.filter(([n]) => posix || !WIN_UNSAFE.test(n));

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-nonascii-')));
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(home);
  env = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_STATE_HOME: path.join(home, 'state'),
    NO_COLOR: '1',
  };
  proj = path.join(sandbox, 'proj');
  fs.mkdirSync(path.join(proj, 'sub dir'), { recursive: true });
  for (const [name, fn] of names) {
    const importer = name === '日本.ts' ? 'import { cafe } from "./café";\n' : '';
    const body = name === '日本.ts' ? `return cafe();` : 'return 1;';
    fs.writeFileSync(path.join(proj, name), `${importer}export function ${fn}(): number {\n  ${body}\n}\n`);
  }
  spawnSync('git', ['init', '-q'], { cwd: proj, env });
  // All but the last are tracked; the last stays untracked (`--others`).
  const tracked = names.slice(0, -1).map(([n]) => n);
  const add = spawnSync('git', ['add', '--', ...tracked], { cwd: proj, env });
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);
}, 60_000);

afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const run = (args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: proj, env, encoding: 'utf-8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });

const posixPath = (n: string) => n.split(path.sep).join('/');

describe('scanner with names git would quote', () => {
  it('gitListFiles returns the raw names', () => {
    expect(gitListFiles(proj).sort()).toEqual(names.map(([n]) => n).sort());
  });

  it('scan() lists every file', () => {
    expect(new FileScanner(proj).scan().sort()).toEqual(names.map(([n]) => n).sort());
  });

  it('scan() lists the same files in a repo whose quotepath is on or off', () => {
    for (const q of ['true', 'false']) {
      spawnSync('git', ['config', 'core.quotepath', q], { cwd: proj });
      expect(new FileScanner(proj).scan()).toHaveLength(names.length);
    }
  });
});

describe('commands see every file', () => {
  it('explore --format json lists each file', () => {
    const r = run(['explore', '--format', 'json']);
    expect(r.status).toBe(0);
    const paths = (JSON.parse(r.stdout) as Array<{ path: string }>).map((e) => e.path);
    for (const [n] of names) expect(paths).toContain(path.join(proj, n));
  });

  it('imports --format json lists each file and resolves the import across non-ASCII names', () => {
    const r = run(['imports', '--format', 'json']);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    const files = (doc.files as Array<{ path: string; imports: Array<{ resolved?: { path?: string } | null }> }>);
    expect(files.map((f) => f.path).sort()).toEqual(names.map(([n]) => posixPath(n)).sort());
    const nihon = files.find((f) => f.path === '日本.ts')!;
    expect(nihon.imports).toHaveLength(1);
    expect(JSON.stringify(nihon.imports[0])).toContain('café.ts');
  });

  it('map --format json has a node per file', () => {
    const r = run(['map', '--format', 'json']);
    expect(r.status).toBe(0);
    const graph = fs.readFileSync(path.join(proj, '.xray.json'), 'utf-8');
    for (const [n, fn] of names) expect(graph).toContain(`${JSON.stringify(posixPath(n)).slice(1, -1)}::${fn}`);
  });

  it('lang list counts every file', () => {
    const r = run(['lang', 'list', '--format', 'json']);
    expect(r.status).toBe(0);
    const ts = (JSON.parse(r.stdout).languages as Array<{ language: string; files: number }>).find((l) => l.language === 'typescript')!;
    expect(ts.files).toBe(names.length);
  });

  it('impact follows a call across non-ASCII file names', () => {
    const r = run(['impact', 'cafe', '--format', 'json']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('nihon');
  });
});

describe('ESC in a file name stays escaped in text output', () => {
  (posix ? it : it.skip)('explore, text', () => {
    const r = run(['explore']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('\u001b');
    expect(r.stdout).toContain('esc\\x1b[31mred.ts');
  });
});
