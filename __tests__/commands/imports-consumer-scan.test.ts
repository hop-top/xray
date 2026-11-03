/**
 * `xray imports` as a consumer runs it: the built bin over small projects,
 * one per contract language (__tests__/fixtures/imports/consumer-scan/):
 *
 *   web   TS/JS package: static, call-based (require / import()),
 *         type-position import(), unsupported, a parse error
 *   py    Python package + namespace dir: static, relative, importlib /
 *         __import__ calls, unsupported (exec, sys.path), a parse error
 *   go    go.work with two modules: static (stdlib, workspace, own,
 *         required), unsupported (cgo, plugin, linkname), a parse error
 *   rust  crate + build.rs: use trees, extern crate, mod, path-root
 *         references, include macros, the build script, a parse error
 *   php   namespace + group use: use forms, require / include literals,
 *         qualified-name references, unsupported, a parse error
 *
 * Per project (cwd = project, root "."): stdout is the golden
 * (expected.json, also checked in process by imports/golden.test.ts),
 * schema-valid; two runs byte-equal; uncached == cold cache == warm cache
 * (warm = all hits); the MCP `imports` tool returns the CLI document; the
 * project tree (names, sizes, mtimes) is unchanged by all of it. `describe`
 * lists `imports` with its schema id.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validate } from '../support/json-schema';
import { IMPORTS_SCHEMA_ID, type ImportsDoc } from '../../src/lib/imports/types';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const SCAN = path.join(ROOT, '__tests__', 'fixtures', 'imports', 'consumer-scan');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'xray.imports.v1.json'), 'utf8'));
const PROJECTS = ['go', 'php', 'py', 'rust', 'web'];

interface Result { status: number | null; stdout: string; stderr: string }

let sandbox: string;
let env: NodeJS.ProcessEnv;

function run(args: string[], cwd: string, cacheDir: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...env, XDG_CACHE_HOME: cacheDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.setEncoding('utf-8').on('data', (d: string) => (stdout += d));
    p.stderr.setEncoding('utf-8').on('data', (d: string) => (stderr += d));
    p.on('error', reject);
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Header values that change without output changes, as in the goldens. */
function pinVersions(doc: ImportsDoc): ImportsDoc {
  const grammars = Object.fromEntries(Object.entries(doc.grammars).map(([k, g]) => [k, { ...g, version: '0.0.0-golden' }]));
  return { ...doc, xray: { version: '0.0.0-golden', extractor: '0.0.0-golden' }, grammars };
}

/** Every entry under `dir` with size and mtime: a write anywhere shows up. */
function snapshotTree(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    const st = fs.lstatSync(path.join(dir, p));
    out.push(`${p} ${st.isDirectory() ? 'd' : st.size} ${st.mtimeMs}`);
    if (e.isDirectory()) out.push(...snapshotTree(dir, p));
  }
  return out;
}

/** One `tools/call imports` over a fresh stdio MCP server rooted at `cwd`. */
async function mcpImports(cwd: string, cacheDir: string): Promise<{ isError: boolean; text: string }> {
  const proc = spawn(process.execPath, [BIN, 'mcp'], { cwd, env: { ...env, XDG_CACHE_HOME: cacheDir }, stdio: 'pipe' }) as ChildProcessWithoutNullStreams;
  let buf = '';
  const waiters = new Map<number, (m: any) => void>();
  proc.stdout.setEncoding('utf-8').on('data', (d: string) => {
    buf += d;
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (typeof msg.id === 'number') waiters.get(msg.id)?.(msg);
    }
  });
  const closed = new Promise((resolve) => proc.on('close', resolve));
  const request = (id: number, method: string, params: unknown) => {
    const p = new Promise<any>((resolve) => waiters.set(id, resolve));
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return p;
  };
  try {
    await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const r = await request(2, 'tools/call', { name: 'imports', arguments: { format: 'json' } });
    return { isError: r.result.isError, text: (r.result.content as Array<{ text: string }>).map(c => c.text).join('\n') };
  } finally {
    proc.stdin.end();
    await closed;
  }
}

beforeAll(() => {
  if (!fs.existsSync(DIST_ENTRY)) {
    const tsc = require.resolve('typescript/bin/tsc');
    const r = spawnSync(process.execPath, [tsc], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`);
  }
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-consumer-scan-')));
  env = { ...process.env, HOME: sandbox, XDG_CONFIG_HOME: path.join(sandbox, 'xdg'), NO_COLOR: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('XRAY_')) delete env[k];
  env.XRAY_NO_TELEMETRY = '1';
}, 120_000);

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

it('every project has a golden', () => {
  expect(fs.readdirSync(SCAN).filter(d => fs.statSync(path.join(SCAN, d)).isDirectory()).sort()).toEqual(PROJECTS);
  for (const p of PROJECTS) expect(fs.existsSync(path.join(SCAN, p, 'expected.json'))).toBe(true);
});

describe.each(PROJECTS)('consumer scan: %s', (project) => {
  const dir = path.join(SCAN, project);
  const expected = () => fs.readFileSync(path.join(dir, 'expected.json'), 'utf8');
  let before: string[];
  let runs: Record<'uncached' | 'uncachedAgain' | 'cold' | 'warm', Result>;
  let mcp: { isError: boolean; text: string };
  let after: string[];

  beforeAll(async () => {
    before = snapshotTree(dir);
    const none = path.join(sandbox, `${project}-none`);
    const cache = path.join(sandbox, `${project}-cache`);
    const json = ['imports', '--format', 'json'];
    const uncached = await run([...json, '--no-cache'], dir, none);
    const uncachedAgain = await run([...json, '--no-cache'], dir, none);
    const cold = await run([...json, '--verbose'], dir, cache);
    const warm = await run([...json, '--verbose'], dir, cache);
    runs = { uncached, uncachedAgain, cold, warm };
    mcp = await mcpImports(dir, path.join(sandbox, `${project}-mcp`));
    after = snapshotTree(dir);
  }, 120_000);

  it('stdout is the golden document, schema-valid, exit 0', () => {
    const r = runs.uncached;
    expect([r.status, r.stderr]).toEqual([0, '']);
    const doc = JSON.parse(r.stdout) as ImportsDoc;
    expect(doc.schema).toBe(IMPORTS_SCHEMA_ID);
    expect(doc.root).toBe('.');
    expect(validate(SCHEMA, doc, { noUndeclared: true })).toEqual([]);
    expect(JSON.stringify(pinVersions(doc), null, 2) + '\n').toBe(expected());
  });

  it('covers every outcome: complete files, incomplete files, a parse error', () => {
    const doc = JSON.parse(runs.uncached.stdout) as ImportsDoc;
    expect(doc.files.some(f => f.complete)).toBe(true);
    expect(doc.files.some(f => f.status === 'ok' && f.unsupported.length > 0)).toBe(true);
    expect(doc.files.some(f => f.status === 'parse-error' && f.parseErrors.length > 0)).toBe(true);
    expect(doc.summary.imports).toBeGreaterThan(0);
  });

  it('two runs are byte-identical', () => {
    expect(runs.uncachedAgain.stdout).toBe(runs.uncached.stdout);
  });

  it('cached runs (cold, then warm with every file a hit) equal the uncached run', () => {
    const n = (JSON.parse(runs.uncached.stdout) as ImportsDoc).files.length;
    expect([runs.cold.status, runs.warm.status]).toEqual([0, 0]);
    expect(runs.cold.stdout).toBe(runs.uncached.stdout);
    expect(runs.warm.stdout).toBe(runs.uncached.stdout);
    expect(runs.cold.stderr).toMatch(new RegExp(`imports cache: 0 hits, ${n} misses \\(0 invalid\\), ${n} written`));
    expect(runs.warm.stderr).toMatch(new RegExp(`imports cache: ${n} hits, 0 misses \\(0 invalid\\), 0 written`));
  });

  it('the MCP imports tool returns the CLI document', () => {
    expect(mcp.isError).toBe(false);
    expect(mcp.text.trimEnd()).toBe(runs.uncached.stdout.trimEnd());
  });

  it('leaves the project tree unchanged (names, sizes, mtimes)', () => {
    expect(after).toEqual(before);
  });
});

it('describe lists imports with its output schema id', () => {
  const r = spawnSync(process.execPath, [BIN, 'describe', '--format', 'json'], { cwd: sandbox, env, encoding: 'utf-8' });
  expect(r.status).toBe(0);
  const imports = (JSON.parse(r.stdout) as { commands: Array<{ name: string; output?: { schema: string; path: string } }> })
    .commands.find(c => c.name === 'imports');
  expect(imports?.output).toMatchObject({ schema: IMPORTS_SCHEMA_ID, path: 'schemas/xray.imports.v1.json' });
});
