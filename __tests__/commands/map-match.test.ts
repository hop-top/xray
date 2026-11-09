/**
 * `map|graph --match` end to end. Same semantics as `explore --match`
 * (positives OR, `!` excludes and wins, root-relative, basename rule), so
 * both commands agree on the file set. Config `match` (top level, lens,
 * scope) is the same list; the CLI flag replaces it.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let base: string;
let repo: string;
let outDir: string;
let n = 0;

const FILES: Record<string, string> = {
  'a.ts': 'export function alpha() { return 1; }\n',
  'a.test.ts': "import { alpha } from './a';\nexport function alphaTest() { return alpha(); }\n",
  'lib/x.js': 'function jsOnly() { return 2; }\nmodule.exports = { jsOnly };\n',
  'src/api/h.ts': 'export function apiHandler() { return 3; }\n',
};
const ALL = Object.keys(FILES).sort();

const run = (args: string[], cwd = repo) =>
  spawnSync(process.execPath, [BIN, '--no-telemetry', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0', XDG_CONFIG_HOME: path.join(base, '.xdg') },
    timeout: 90_000,
  });

const out = () => path.join(outDir, `g${n++}.json`);

/** File nodes of the graph a `--format json` run wrote. */
function graphFiles(args: string[], cmd = 'map'): string[] {
  const o = out();
  const r = run([cmd, '--skip-detect', '--format', 'json', '-o', o, ...args]);
  expect(r.status).toBe(0);
  return JSON.parse(fs.readFileSync(o, 'utf-8')).nodes
    .filter((x: { type: string }) => x.type === 'file')
    .map((x: { id: string }) => x.id)
    .sort();
}

const writeConfig = (cfg: object) =>
  fs.writeFileSync(path.join(repo, '.xrayrc.json'), JSON.stringify(cfg));

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-map-match-env-'));
  repo = path.join(base, 'proj');
  for (const [rel, body] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  spawnSync('git', ['init', '-q'], { cwd: repo });
});
beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(base, 'out-'));
  fs.rmSync(path.join(repo, '.xrayrc.json'), { force: true });
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('map --match (graph formats)', () => {
  it('without --match every file is in the graph', () => {
    expect(graphFiles([])).toEqual(ALL);
  });

  it('a positive pattern keeps only matching files', () => {
    expect(graphFiles(['-m', '*.js'])).toEqual(['lib/x.js']);
  });

  it('positives OR, negation excludes and wins', () => {
    expect(graphFiles(['-m', '*.ts', '-m', '!*.test.ts'])).toEqual(['a.ts', 'src/api/h.ts']);
    expect(graphFiles(['-m', '*.ts', '-m', '*.js', '-m', '!a.*'])).toEqual(['lib/x.js', 'src/api/h.ts']);
  });

  it('only negatives: everything but those', () => {
    expect(graphFiles(['-m', '!*.test.ts'])).toEqual(['a.ts', 'lib/x.js', 'src/api/h.ts']);
  });

  it('a pattern with `/` is anchored at the root; ancestors of the root never match', () => {
    expect(graphFiles(['-m', 'src/**'])).toEqual(['src/api/h.ts']);
    expect(graphFiles(['-m', 'api/*'])).toEqual([]);
  });

  it('graph agrees with map', () => {
    expect(graphFiles(['-m', '*.js'], 'graph')).toEqual(['lib/x.js']);
  });

  it('agrees with explore on the same patterns', () => {
    const pats = ['-m', '*.ts', '-m', '!*.test.ts', '-m', 'lib/**'];
    const ex = run(['explore', '--format', 'json', '-p', repo, ...pats]);
    const explored = JSON.parse(ex.stdout)
      .map((r: { path: string }) => path.relative(repo, r.path).split(path.sep).join('/'))
      .sort();
    expect(graphFiles(pats)).toEqual(explored);
  });

  it('the file set is the same when matching a graph with --path', () => {
    expect(graphFiles(['-p', repo, '-m', '*.js'])).toEqual(['lib/x.js']);
  });
});

describe('map --match (text output)', () => {
  it('chunked (default) lists only matching files', () => {
    const o = path.join(outDir, 'map.md');
    const r = run(['map', '--skip-detect', '-m', '*.js', '-o', o]);
    expect(r.status).toBe(0);
    const text = fs.readdirSync(outDir).map(f => fs.readFileSync(path.join(outDir, f), 'utf-8')).join('\n');
    expect(text).toContain('jsOnly');
    expect(text).not.toContain('alpha');
    expect(text).not.toContain('apiHandler');
  });

  it('--no-chunk lists only matching files', () => {
    const o = path.join(outDir, 'map.md');
    const r = run(['map', '--skip-detect', '--no-chunk', '-m', '*.ts', '-m', '!*.test.ts', '-o', o]);
    expect(r.status).toBe(0);
    const text = fs.readFileSync(o, 'utf-8');
    expect(text).toContain('alpha');
    expect(text).toContain('apiHandler');
    expect(text).not.toContain('jsOnly');
    expect(text).not.toContain('alphaTest');
  });
});

describe('map --match (no file matches)', () => {
  it('says so on stderr and exits 0, like explore', () => {
    const o = out();
    const r = run(['map', '--skip-detect', '--format', 'json', '-o', o, '-m', '*.nothing']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no files? match/i);
    expect(r.stderr).toContain('*.nothing');
    expect(JSON.parse(fs.readFileSync(o, 'utf-8')).nodes).toEqual([]);
  });

  it('is silent about it when --match was not given', () => {
    const r = run(['map', '--skip-detect', '--format', 'json', '-o', out()]);
    expect(r.stderr).not.toMatch(/no files? match/i);
  });
});

describe('config `match`', () => {
  it('top-level match applies; the CLI flag replaces it', () => {
    writeConfig({ match: ['*.js'] });
    expect(graphFiles([])).toEqual(['lib/x.js']);
    expect(graphFiles(['-m', 'src/**'])).toEqual(['src/api/h.ts']);
  });

  it('lens match applies', () => {
    writeConfig({ lenses: { js: { match: ['*.js'] } } });
    expect(graphFiles(['--lens', 'js'])).toEqual(['lib/x.js']);
    expect(graphFiles([])).toEqual(ALL);
  });

  it('scope match applies, with --scope and --all-scopes', () => {
    // A config output must stay inside the project.
    const jsOut = path.join(repo, 'js.json');
    const apiOut = path.join(repo, 'api.json');
    writeConfig({
      format: 'json',
      scopes: { js: { match: ['*.js'], output: jsOut }, api: { match: ['src/**'], output: apiOut } },
    });
    const filesOf = (f: string): string[] => JSON.parse(fs.readFileSync(f, 'utf-8')).nodes
      .filter((x: { type: string }) => x.type === 'file').map((x: { id: string }) => x.id);

    expect(run(['map', '--skip-detect', '--scope', 'js']).status).toBe(0);
    expect(filesOf(jsOut)).toEqual(['lib/x.js']);
    fs.rmSync(jsOut);

    expect(run(['map', '--skip-detect', '--all-scopes']).status).toBe(0);
    expect(filesOf(jsOut)).toEqual(['lib/x.js']);
    expect(filesOf(apiOut)).toEqual(['src/api/h.ts']);
    fs.rmSync(jsOut, { force: true });
    fs.rmSync(apiOut, { force: true });
  });
});

describe('graph cache and --match (impact, multi-root)', () => {
  const impactOnce = (extra: object) => {
    writeConfig({ ...extra });
    const r = run(['impact', 'alpha', '--format', 'json', '-p', '.', '-p', 'lib']);
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout).nodes.map((x: { name: string }) => x.name).sort();
  };

  it('changing config match between runs never serves the other result', () => {
    const full = impactOnce({});
    const narrow = impactOnce({ match: ['!*.test.ts'] });
    expect(full).toContain('alphaTest');
    expect(narrow).not.toContain('alphaTest');
    expect(impactOnce({})).toEqual(full);
    expect(impactOnce({ match: ['!*.test.ts'] })).toEqual(narrow);
  });
});
