/**
 * `map|graph --all-scopes` applies every CLI option to each scope run, with
 * the same precedence as `--scope <name>` (CLI over scope config).
 *
 * Parity method: a config with ONE scope makes `--all-scopes` the same run
 * as `--scope s`, so every option variant must write byte-identical files in
 * both modes. A meta-test walks the options `describe` lists for `map` and
 * `graph`, so a newly added option without a variant fails here.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../bin/cli.js');

/** One variant per option: args that make the option visible in the output. */
const VARIANTS: Record<string, string[]> = {
  '--limit': ['--limit', '40'],
  '--with': ['--with', 'vars'],
  '--anchor': ['--anchor', 'src/b.ts'],
  '--depth': ['--depth', '1'],
  '--query': ['--query', '.ts:lib'],
  '--match': ['--match', '*.py'],
  '--catch': ['--catch', 'beta'],
  '--format': ['--format', 'json'],
  '--txt': ['--txt'],
  '--csv': ['--csv'],
  '--xml': ['--xml'],
  '--json': ['--json'],
  '--no-chunk': ['--no-chunk'],
  '--group': ['--group', 'community'],
  '--detect': ['--detect'],
  '--lang': ['--lang', 'python'],
  '--skip-detect': ['--skip-detect'],
  '--share': ['--share'],
  '--preset': ['--preset', 'insights'],
  '--enable-extension': ['--enable-extension', 'nope-ext'],
  '--disable-extension': ['--disable-extension', 'nope-ext'],
  '--extension-threshold': ['--extension-threshold', 'nope-ext=3'],
  '--extension-hint': ['--extension-hint', 'nope-ext=hint'],
  '--enable-surface': ['--enable-surface', 'nope-ext:map'],
  '--disable-surface': ['--disable-surface', 'nope-ext:map'],
};

/** Options that select the run itself or the diagram family, not the run's content. */
const NOT_RUN_OPTIONS: Record<string, string> = {
  '--lens': 'overlay; exclusive with --scope/--all-scopes (UsageError)',
  '--scope': 'selects the scope; --all-scopes is its plural',
  '--all-scopes': 'the flag under test',
  '--path': 'each scope has its own paths; with --all-scopes a UsageError',
  '--output': 'each scope writes its own output; with --all-scopes a UsageError',
};

interface Described { name: string; options: Array<{ name: string }>; subcommands?: Described[] }

describe('map|graph --all-scopes forwards every CLI option', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let described: Described[];

  const dir = (...p: string[]) => {
    const d = path.join(root, ...p);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, '--no-telemetry', ...args], { cwd, env, encoding: 'utf8', timeout: 120_000 });

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'all-scopes-'));
    env = {
      ...process.env,
      HOME: dir('env', 'home'),
      XDG_CONFIG_HOME: dir('env', 'config'),
      XDG_CACHE_HOME: dir('env', 'cache'),
      XDG_STATE_HOME: dir('env', 'state'),
      XDG_DATA_HOME: dir('env', 'data'),
      NO_COLOR: '1',
      XRAY_NO_TELEMETRY: '1',
    };
    described = (JSON.parse(run(root, 'describe').stdout) as { commands: Described[] }).commands;
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  /** A project with files across languages; `scopes` as given. */
  const project = (name: string, scopes: object): string => {
    const p = dir('proj', name);
    const put = (rel: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(p, rel)), { recursive: true });
      fs.writeFileSync(path.join(p, rel), body);
    };
    put('src/a.ts', "import { beta } from './b';\nexport function alpha() { return beta(); }\n");
    put('src/b.ts', 'export function beta() { return 1; }\nexport function gamma() { return 2; }\n');
    put('src/c.py', 'def delta():\n    return 3\n');
    put('lib/l.ts', 'export function libFn() { return 4; }\n');
    put('pkg/p.go', 'package pkg\n\nfunc Pkg() int { return 5 }\n');
    put('.xrayrc.json', JSON.stringify({ scopes }));
    spawnSync('git', ['init', '-q'], { cwd: p });
    return p;
  };

  /** Drop what legitimately differs run to run: timestamps, the echoed command line. */
  const stable = (text: string): string =>
    text
      .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>')
      .replace(/^Command: .*$/gm, 'Command: <cmd>');

  /** Run once, return every file the run wrote (path -> content), then clean up. */
  const written = (cwd: string, args: string[]): { status: number | null; files: Record<string, string> } => {
    const keep = new Set(['.xrayrc.json', '.git', 'src', 'lib', 'pkg']);
    const r = run(cwd, ...args);
    const files: Record<string, string> = {};
    const walk = (rel: string) => {
      for (const e of fs.readdirSync(path.join(cwd, rel), { withFileTypes: true })) {
        const r2 = path.join(rel, e.name);
        if (!rel && keep.has(e.name)) continue;
        if (e.isDirectory()) walk(r2);
        else files[r2] = stable(fs.readFileSync(path.join(cwd, r2), 'utf8'));
      }
    };
    walk('');
    for (const e of fs.readdirSync(cwd)) if (!keep.has(e)) fs.rmSync(path.join(cwd, e), { recursive: true, force: true });
    return { status: r.status, files };
  };

  it.each(['map', 'graph'])('%s: every described option has a variant or a stated reason', (cmd) => {
    const names = described.find((c) => c.name === cmd)!.options.map((o) => o.name);
    const unknown = names.filter((n) => !(n in VARIANTS) && !(n in NOT_RUN_OPTIONS));
    expect(unknown).toEqual([]);
  });

  describe.each(['map', 'graph'])('%s: --all-scopes (one scope) == --scope', (cmd) => {
    let p: string;
    beforeAll(() => {
      p = project(cmd, { only: { paths: ['./src'] } });
    });

    // graph runs the same code; sampling every option once per command keeps
    // the cost bounded while still covering both entry points.
    it.each(Object.entries(VARIANTS))('%s', (_opt, args) => {
      const base = [cmd, ...args];
      const viaScope = written(p, [...base, '--scope', 'only']);
      const viaAll = written(p, [...base, '--all-scopes']);
      expect(viaAll.status).toBe(viaScope.status);
      expect(Object.keys(viaAll.files).sort()).toEqual(Object.keys(viaScope.files).sort());
      expect(viaAll.files).toEqual(viaScope.files);
    });
  });

  it('--match applies to every scope', () => {
    const p = project('match', {
      ts: { paths: ['./src'], output: 'ts.json', format: 'json' },
      go: { paths: ['./pkg'], output: 'go.json', format: 'json' },
    });
    const r = run(p, 'map', '--skip-detect', '--all-scopes', '--match', '*.py');
    const filesOf = (f: string): string[] =>
      JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')).nodes
        .filter((n: { type: string }) => n.type === 'file')
        .map((n: { id: string }) => n.id);
    expect(r.status).toBe(0);
    expect(filesOf('ts.json')).toEqual(['c.py']);
    expect(filesOf('go.json')).toEqual([]);
  });

  it('CLI option beats the scope config in each scope', () => {
    const p = project('prec', {
      one: { paths: ['./src'], output: 'one.json', format: 'json', match: ['*.ts'] },
      two: { paths: ['./src'], output: 'two.json', format: 'json', match: ['*.ts'] },
    });
    expect(run(p, 'map', '--skip-detect', '--all-scopes', '--match', '*.py').status).toBe(0);
    for (const f of ['one.json', 'two.json']) {
      const ids = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')).nodes
        .filter((n: { type: string }) => n.type === 'file').map((n: { id: string }) => n.id);
      expect(ids).toEqual(['c.py']);
    }
  });

  it('no scopes defined: usage error (2) saying so', () => {
    const p = project('none', {});
    const r = run(p, 'map', '--all-scopes');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no scopes are defined/);
  });
});
