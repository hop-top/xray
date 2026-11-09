/**
 * Every command accepts `--format`, so a script can always ask for JSON
 * errors; given `--format json` a succeeding command prints valid JSON on
 * stdout, a failing one a kit error envelope on stderr with stdout empty.
 *
 * Part 1 walks the real command tree. Part 2 spawns the built CLI
 * (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';

const ROOT = path.resolve(__dirname, '../..');
const ENTRY = path.join(ROOT, 'dist', 'index.js');

/**
 * Leaves that do not take `--format`, and why. Anything else must.
 * - help: kit's own, prints help text.
 * - completion <shell>: prints a shell script; there is no JSON form of it.
 */
const EXEMPT = new Set(['help', 'completion bash', 'completion zsh', 'completion fish', 'completion powershell']);

const leaves = (cmd: Command, trail: string[] = []): Array<{ path: string; cmd: Command }> =>
  cmd.commands.length === 0
    ? [{ path: trail.join(' '), cmd }]
    : cmd.commands.flatMap(c => leaves(c, [...trail, c.name()]));

describe('--format on every leaf of the real command tree', () => {
  let tmp: string;
  let tree: Command;
  const cwd = process.cwd();
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fmt-tree-')));
    for (const d of ['cache', 'data', 'state', 'config', 'lang', 'proj']) fs.mkdirSync(path.join(tmp, d));
    Object.assign(process.env, {
      XDG_CACHE_HOME: path.join(tmp, 'cache'),
      XDG_DATA_HOME: path.join(tmp, 'data'),
      XDG_STATE_HOME: path.join(tmp, 'state'),
      XDG_CONFIG_HOME: path.join(tmp, 'config'),
      XRAY_LANG_DIR: path.join(tmp, 'lang'),
    });
    fs.writeFileSync(path.join(tmp, 'proj', '.xrayrc.json'), JSON.stringify({
      paths: ['.'],
      aliases: { comps: 'react components' },
    }));
    process.chdir(path.join(tmp, 'proj'));
    const { registerCommands } = require('../../src/commands');
    tree = await registerCommands({}, undefined);
  });

  afterAll(() => {
    process.chdir(cwd);
    process.env = savedEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('every leaf but the exempt ones declares --format', () => {
    const missing = leaves(tree)
      .filter(l => l.path !== '' && !EXEMPT.has(l.path))
      .filter(l => !l.cmd.options.some(o => o.long === '--format'))
      .map(l => l.path);
    expect(missing).toEqual([]);
  });

  it('the tree holds what the walk is meant to cover', () => {
    const paths = leaves(tree).map(l => l.path);
    for (const p of [
      'strategy create', 'strategy remove', 'alias set', 'alias remove', 'lang add', 'lang remove',
      'cache clear', 'clear-cache', 'mcp', 'explore', 'imports', 'comps', 'react components',
    ]) expect(paths).toContain(p);
  });

  it('exemptions name real leaves (a stale entry fails)', () => {
    const paths = new Set(leaves(tree).map(l => l.path));
    for (const e of EXEMPT) expect(paths.has(e)).toBe(true);
  });
});

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

let tmp: string;
let home: string;
let proj: string;
let langDir: string;

function run(args: string[], opts: { cwd?: string; input?: string } = {}): Result {
  const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', '--quiet', ...args], {
    cwd: opts.cwd ?? proj,
    input: opts.input,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      XRAY_LANG_DIR: langDir,
      XRAY_NO_TELEMETRY: '1',
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface Envelope { code: string; message: string; exit_code: number; transience: string; [k: string]: unknown }

/** Exit code, empty stdout, stderr that is exactly one kit envelope. */
function expectEnvelope(r: Result, exit: number, code: string): Envelope {
  expect(r.status).toBe(exit);
  expect(r.stdout).toBe('');
  const env = JSON.parse(r.stderr) as Envelope;
  expect(env.code).toBe(code);
  expect(env.exit_code).toBe(exit);
  expect(typeof env.message).toBe('string');
  expect(Object.keys(env)).toEqual(expect.arrayContaining(['code', 'message', 'exit_code', 'transience']));
  return env;
}

/** Exit 0, stdout one JSON document. */
function expectJson(r: Result): any {
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

beforeAll(() => {
  if (!fs.existsSync(ENTRY)) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}${r.stderr}`);
  }
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-json-all-')));
  home = path.join(tmp, 'home');
  proj = path.join(tmp, 'proj');
  langDir = path.join(tmp, 'lang');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.py'), 'def a():\n    return 1\n');
}, 300_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('refusals and conflicts are kit envelopes with --format after the subcommand', () => {
  it('strategy create over an existing file: CONFLICT (4)', () => {
    expectJson(run(['strategy', 'create', 'dup', '--format', 'json']));
    const env = expectEnvelope(run(['strategy', 'create', 'dup', '--format', 'json']), 4, 'CONFLICT');
    expect(env.message).toContain('Strategy file already exists');
    expect(env.transience).toBe('permanent');
  });

  it('alias set on a reserved name: CONFLICT (4)', () => {
    const env = expectEnvelope(run(['alias', 'set', 'map', 'react components', '--format', 'json']), 4, 'CONFLICT');
    expect(env.message).toContain('conflicts with an existing command');
  });

  it('--confirm=no strategy remove: UNAUTHORIZED (5), nothing removed', () => {
    const file = path.join(proj, '.xray', 'strategies', 'keep.yml');
    expectJson(run(['strategy', 'create', 'keep', '--format', 'json']));
    const env = expectEnvelope(run(['--confirm=no', 'strategy', 'remove', 'keep', '--format', 'json']), 5, 'UNAUTHORIZED');
    expect(env.message).toContain('xray strategy remove refused');
    expect(fs.existsSync(file)).toBe(true);
    // Flag order after the subcommand too.
    expectEnvelope(run(['strategy', 'remove', 'keep', '--confirm=no', '--format', 'json']), 5, 'UNAUTHORIZED');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('--confirm=no cache clear: UNAUTHORIZED (5), also for clear-cache', () => {
    const env = expectEnvelope(run(['--confirm=no', 'cache', 'clear', '--format', 'json']), 5, 'UNAUTHORIZED');
    expect(env.message).toContain('xray cache clear refused');
    expectEnvelope(run(['--confirm=no', 'clear-cache', '--format', 'json']), 5, 'UNAUTHORIZED');
  });

  it('--dry-run mcp: kit refuses with its envelope (the flag is no longer a parse error)', () => {
    const env = expectEnvelope(run(['--dry-run', 'mcp', '--format', 'json']), 2, 'USAGE');
    expect(env.message).toContain('does not accept --dry-run');
  });

  it('text mode keeps the kit text refusal', () => {
    const r = run(['--confirm=no', 'cache', 'clear']);
    expect(r.status).toBe(5);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^UNAUTHORIZED: destructive command xray cache clear refused/);
  });
});

describe('failures of the commands that lacked --format', () => {
  it.each([
    [['alias', 'remove', 'nope'], 3, 'NOT_FOUND'],
    [['strategy', 'info', 'nope'], 3, 'NOT_FOUND'],
    [['strategy', 'validate', 'nope'], 3, 'NOT_FOUND'],
    [['strategy', 'install', './nope'], 3, 'NOT_FOUND'],
    [['strategy', 'detect', '-p', '/nonexistent-xray-dir'], 3, 'NOT_FOUND'],
    [['lang', 'add', 'bogus'], 2, 'USAGE'],
    [['lang', 'remove', 'bogus'], 2, 'USAGE'],
    [['alias', 'set', 'x', 'nonsense'], 2, 'USAGE'],
  ] as Array<[string[], number, string]>)('%j', (args, exit, code) => {
    expectEnvelope(run([...args, '--format', 'json']), exit, code);
  });

  it('explore --path missing is NOT_FOUND (3), like map; text mode agrees', () => {
    const missing = path.join(tmp, 'nope');
    const r = run(['explore', '--path', missing, '--format', 'json']);
    const env = expectEnvelope(r, 3, 'NOT_FOUND');
    expect(env.message).toBe(`Path does not exist: ${missing}`);
    expect(r.stderr).not.toMatch(/\n\s+at /);
    expect(r.stderr).not.toContain(ROOT);
    const text = run(['explore', '--path', missing]);
    expect(text.status).toBe(3);
    expect(text.stderr).toBe(`✖ Path does not exist: ${missing}\n`);
  });

  it('strategy detect -p missing is NOT_FOUND (3), JSON or text', () => {
    expect(run(['strategy', 'detect', '-p', path.join(tmp, 'nope')]).status).toBe(3);
  });
});

describe('success: --format json prints one JSON document on stdout', () => {
  it('alias set / remove', () => {
    const set = expectJson(run(['alias', 'set', 'comps', 'react components', '--format', 'json']));
    expect(set).toEqual({ alias: 'comps', target: 'react components', action: 'created', config: path.join(proj, '.xrayrc.json') });
    expect(expectJson(run(['alias', 'set', 'comps', 'react hooks', '--format', 'json'])).action).toBe('updated');
    const rm = expectJson(run(['alias', 'remove', 'comps', '--format', 'json']));
    expect(rm).toMatchObject({ alias: 'comps', target: 'react hooks', action: 'removed' });
  });

  it('alias set / remove: text mode prints no document on stdout', () => {
    const r = run(['alias', 'set', 'tmpalias', 'react components']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    const rm = run(['alias', 'remove', 'tmpalias']);
    expect(rm.status).toBe(0);
    expect(rm.stdout).toBe('');
  });

  it('strategy create / remove', () => {
    const created = expectJson(run(['strategy', 'create', 'okay', '--format', 'json']));
    const file = path.join(proj, '.xray', 'strategies', 'okay.yml');
    expect(created).toEqual({ strategy: 'okay', path: file, kind: 'yaml', action: 'created' });
    expect(fs.existsSync(file)).toBe(true);
    const removed = expectJson(run(['--confirm=yes', 'strategy', 'remove', 'okay', '--format', 'json']));
    expect(removed).toEqual({ strategy: 'okay', kind: 'file', path: file, action: 'removed', notRemoved: [] });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('strategy create --ts', () => {
    const out = expectJson(run(['strategy', 'create', 'tsone', '--ts', '-d', path.join(tmp, 'tsdir'), '--format', 'json']));
    expect(out).toMatchObject({ strategy: 'tsone', kind: 'ts', action: 'created' });
  });

  it('strategy install of a local file reads it', () => {
    const file = path.join(tmp, 'local.yml');
    fs.writeFileSync(file, 'name: local\nversion: 0.1.0\ndetect:\n  files: []\n  dependencies: []\nfileTypes: []\ntags: []\ncommands: {}\n');
    expect(expectJson(run(['strategy', 'install', file, '--format', 'json']))).toEqual({
      action: 'read', source: file, strategy: 'local', version: '0.1.0', loaded: true,
    });
  });

  it('strategy detect / info / validate / path', () => {
    const detect = expectJson(run(['strategy', 'detect', '--format', 'json']));
    expect(detect.path).toBe(proj);
    expect(Array.isArray(detect.strategies)).toBe(true);
    const info = expectJson(run(['strategy', 'info', 'react', '--format', 'json']));
    expect(info).toMatchObject({ name: 'react', detected: false });
    expect(info.commands.map((c: { name: string }) => c.name)).toContain('components');
    const validate = expectJson(run(['strategy', 'validate', 'react', '--format', 'json']));
    expect(validate).toMatchObject({ name: 'react', hasDetect: true, hasAnalyze: true, detection: 'not-detected' });
    const paths = expectJson(run(['strategy', 'path', '--format', 'json']));
    expect(paths.paths.length).toBeGreaterThan(0);
    expect(typeof paths.paths[0].exists).toBe('boolean');
  });

  it('cache clear and clear-cache', () => {
    for (const cmd of [['cache', 'clear'], ['clear-cache']]) {
      const out = expectJson(run(['--confirm=yes', ...cmd, '--format', 'json']));
      expect(out.action).toBe('none');
    }
  });

  it('lang add / remove report per language', () => {
    expect(expectJson(run(['lang', 'add', 'go', '--format', 'json']))).toMatchObject({
      action: 'add', ok: true, languages: [{ language: 'go', status: 'already-installed' }],
    });
    expect(expectJson(run(['lang', 'remove', 'go', '--format', 'json']))).toMatchObject({
      action: 'remove', ok: true, languages: [{ language: 'go', status: 'not-managed' }],
    });
  });

  it('a bad --format value is a usage error (text: only json asks for JSON errors)', () => {
    const r = run(['strategy', 'path', '--format', 'xml']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("invalid --format 'xml'");
  });

  it('a user alias forwards --format to its target', () => {
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify({ paths: ['.'], aliases: { comps: 'react components' } }));
    fs.writeFileSync(path.join(proj, 'src', 'c.tsx'), 'export const C = () => null;\n');
    const out = expectJson(run(['comps', '--format', 'json']));
    expect(Array.isArray(out)).toBe(true);
    fs.rmSync(path.join(proj, '.xrayrc.json'));
  });

  it('mcp accepts --format json (JSON-RPC on stdout)', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
    const r = run(['mcp', '--format', 'json'], { input: JSON.stringify(msg) + '\n' });
    const reply = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
    expect(reply.id).toBe(1);
    const bad = run(['mcp', '--format', 'text']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("invalid --format 'text'");
  });
});

describe('--dry-run plans are JSON under --format json', () => {
  it.each([
    [['--dry-run', 'alias', 'set', 'dry', 'react components'], 'xray alias set'],
    [['--dry-run', 'strategy', 'create', 'dryone'], 'xray strategy create'],
    [['--dry-run', 'clear-cache'], 'xray clear-cache'],
    [['--dry-run', 'lang', 'add', 'go'], 'xray lang add'],
  ] as Array<[string[], string]>)('%j', (args, command) => {
    const plan = expectJson(run([...args, '--format', 'json']));
    expect(plan.command).toBe(command);
    expect(Array.isArray(plan.effects)).toBe(true);
  });
});

describe('xray imports: JSON by default', () => {
  it('failures: envelope without a flag, exit 3, stdout empty', () => {
    const env = expectEnvelope(run(['imports', '-p', path.join(tmp, 'nope')]), 3, 'NOT_FOUND');
    expect(env.message).toContain('Path does not exist');
    expectEnvelope(run(['imports', 'src', '--lang', 'bogus']), 2, 'USAGE');
  });

  it('an explicit text-ish format keeps the text line', () => {
    for (const fmt of ['text', 'table', 'csv', 'yaml']) {
      const r = run(['imports', '-p', path.join(tmp, 'nope'), '--format', fmt]);
      expect(r.status).toBe(3);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe(`✖ Path does not exist or is not a directory: ${path.join(tmp, 'nope')}\n`);
    }
  });

  it('--format json is still JSON', () => {
    expectEnvelope(run(['imports', '-p', path.join(tmp, 'nope'), '--format', 'json']), 3, 'NOT_FOUND');
  });

  it('success output is the document, as before', () => {
    const r = run(['imports', 'src']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout).schema).toBe('xray.imports/v1');
    expect(r.stdout).toBe(run(['imports', 'src', '--format', 'json']).stdout);
  });

  it('other commands stay text without a flag', () => {
    const r = run(['map', '--path', path.join(tmp, 'nope')]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/^✖ /);
  });
});

describe('childStdio', () => {
  const { setJsonErrors } = require('../../src/lib/error/report');
  const { childStdio } = require('../../src/lib/result-format');
  afterEach(() => setJsonErrors(false));

  it('npm output joins stderr when the run speaks JSON, so stdout holds the document alone', () => {
    setJsonErrors(true);
    expect(childStdio()).toEqual(['ignore', 2, 2]);
    setJsonErrors(false);
    expect(childStdio()).toBe('inherit');
  });
});
