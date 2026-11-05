/**
 * `xray imports` end to end: the built bin over the imports golden
 * fixtures. The json format is the extractor's document byte for byte,
 * valid against schemas/xray.imports.v1.json; exit codes; determinism;
 * narrowing (positional paths, --lang); other formats; and a run leaves
 * the scanned root untouched (no cache, no telemetry sink, nothing).
 */
import { projectKey } from '../../src/lib/storage';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validate } from '../support/json-schema';
import { extractImports } from '../../src/lib/imports';
import { collectImportFiles, IMPORT_MANIFESTS, resolveImportLanguages } from '../../src/lib/imports/collect';
import type { ImportsDoc } from '../../src/lib/imports/types';
import { CI_ENV_VARS, telemetryOffReason } from '../../src/lib/telemetry-policy';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const FIXTURES = path.join(ROOT, '__tests__', 'fixtures', 'imports');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'xray.imports.v1.json'), 'utf8'));
const PKG_VERSION: string = require('../../package.json').version;

interface Result { status: number | null; stdout: string; stderr: string }

let sandbox: string;
let env: NodeJS.ProcessEnv;

function run(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.setEncoding('utf-8').on('data', (d: string) => (stdout += d));
    p.stderr.setEncoding('utf-8').on('data', (d: string) => (stderr += d));
    p.on('error', reject);
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function cases(): Array<{ id: string; dir: string }> {
  const out: Array<{ id: string; dir: string }> = [];
  for (const lang of fs.readdirSync(FIXTURES).sort()) {
    const langDir = path.join(FIXTURES, lang);
    if (!fs.statSync(langDir).isDirectory()) continue;
    for (const name of fs.readdirSync(langDir).sort()) {
      const dir = path.join(langDir, name);
      if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'expected.json'))) out.push({ id: `${lang}/${name}`, dir });
    }
  }
  return out;
}

/** Golden placeholders for header values that change without output changes. */
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

function copyDir(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true });
}

beforeAll(() => {
  if (!fs.existsSync(DIST_ENTRY)) {
    const tsc = require.resolve('typescript/bin/tsc');
    const r = spawnSync(process.execPath, [tsc], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`);
  }
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-imports-cli-')));
  env = { ...process.env, HOME: sandbox, XDG_CONFIG_HOME: path.join(sandbox, 'xdg'), XDG_CACHE_HOME: path.join(sandbox, 'cache'), NO_COLOR: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('XRAY_')) delete env[k];
  env.XRAY_NO_TELEMETRY = '1';
}, 120_000);

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('xray imports on the golden fixtures', () => {
  const all = cases();
  let results: Map<string, Result>;

  beforeAll(async () => {
    // cwd = case dir and no -p: root is ".", as in expected.json.
    const rs = await Promise.all(all.map(c => run(['imports', '--format', 'json'], c.dir)));
    results = new Map(all.map((c, i) => [c.id, rs[i]]));
  }, 180_000);

  it('finds the fixtures', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all.map(c => [c.id, c] as const))('%s: stdout is the golden document, schema-valid', (id, c) => {
    const r = results.get(id)!;
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as ImportsDoc;
    expect(r.stdout).toBe(JSON.stringify(doc, null, 2) + '\n');
    expect(validate(SCHEMA, doc, { noUndeclared: true })).toEqual([]);
    expect(doc.xray.version).toBe(PKG_VERSION);
    const expected = JSON.parse(fs.readFileSync(path.join(c.dir, 'expected.json'), 'utf8'));
    expect(JSON.stringify(pinVersions(doc), null, 2)).toBe(JSON.stringify(expected, null, 2));
  });
});

describe('xray imports: document, determinism, narrowing', () => {
  it('two runs over every fixture are byte-identical and match the in-process extractor', async () => {
    const a = await run(['imports', '-p', FIXTURES], sandbox);
    const b = await run(['imports', '-p', FIXTURES, '--format', 'json'], sandbox);
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    const doc = JSON.parse(a.stdout) as ImportsDoc;
    expect(doc.root).toBe(FIXTURES);
    expect(doc.files.length).toBeGreaterThan(10);
    expect(validate(SCHEMA, doc, { noUndeclared: true })).toEqual([]);
    const direct = extractImports(collectImportFiles(FIXTURES), { root: FIXTURES, xrayVersion: PKG_VERSION });
    expect(a.stdout).toBe(JSON.stringify(direct, null, 2) + '\n');
  }, 60_000);

  it('positional paths narrow to files and dirs inside the root', async () => {
    const r = await run(['imports', 'python/relative/app/pkg', 'go/raw-string', '--format', 'json'], FIXTURES);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as ImportsDoc;
    expect(doc.root).toBe('.');
    expect(doc.files.map(f => f.path)).toEqual([
      'go/raw-string/main.go', 'python/relative/app/pkg/__init__.py', 'python/relative/app/pkg/mod.py',
    ]);
  });

  it('--lang narrows by contract language (aliases accepted)', async () => {
    const r = await run(['imports', '-p', FIXTURES, '--lang', 'ts,go'], sandbox);
    expect(r.status).toBe(0);
    const langs = new Set((JSON.parse(r.stdout) as ImportsDoc).files.map(f => f.language));
    expect([...langs].sort()).toEqual(['go', 'typescript']);
  });

  it('text, table and csv render the same records', async () => {
    const dir = path.join(FIXTURES, 'python', 'relative');
    const json = JSON.parse((await run(['imports'], dir)).stdout) as ImportsDoc;
    const n = json.summary.imports;
    const text = await run(['imports', '--format', 'text'], dir);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('app/pkg/mod.py (python, ok)');
    expect(text.stdout.trim().split('\n').pop()).toBe(`${json.summary.files} files, ${json.summary.complete} complete · ${n} imports · 0 unsupported · 0 parse errors`);
    const csv = await run(['imports', '--format', 'csv'], dir);
    expect(csv.stdout.trim().split('\n')).toHaveLength(n + 1);
    expect(csv.stdout.split('\n')[0]).toBe('file,line,column,kind,form,module,normalized,locality');
    const table = await run(['imports', '--format', 'table', '--cols', 'file,line,module'], dir);
    expect(table.stdout.split('\n')[0].trim().split(/\s+/)).toEqual(['file', 'line', 'module']);
  });
});

describe('xray imports: exit codes', () => {
  it.each([
    [['imports', '-p', 'missing-root'], 3, /does not exist/],
    [['imports', 'missing-path'], 3, /does not exist: missing-path/],
    [['imports', '..'], 2, /outside the root/],
    [['imports', '--lang', 'cobol'], 2, /unknown --lang 'cobol'/],
    [['imports', '--format', 'xml'], 2, /unknown output format "xml"/],
  ])('xray %j exits %i', async (args, code, msg) => {
    const r = await run(args as string[], path.join(FIXTURES, 'python'));
    expect(r.status).toBe(code);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(msg as RegExp);
  });

  it('a file with parse errors or unsupported constructs is data (exit 0)', async () => {
    const dir = path.join(sandbox, 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'b.py'), 'import os\ndef (:\n');
    const r = await run(['imports', '-p', dir], sandbox);
    expect(r.status).toBe(0);
    expect(validate(SCHEMA, JSON.parse(r.stdout), { noUndeclared: true })).toEqual([]);
  });
});

describe('xray imports writes nothing under the scanned root', () => {
  it('with saved telemetry consent, cwd = root, --format json and the default format', async () => {
    const base = fs.mkdtempSync(path.join(sandbox, 'ro-'));
    const root = path.join(base, 'repo');
    copyDir(path.join(FIXTURES, 'python', 'relative'), root);
    copyDir(path.join(FIXTURES, 'rust', 'use-forms'), path.join(root, 'crate'));
    const xdg = path.join(base, 'xdg');
    fs.mkdirSync(path.join(xdg, 'xray'), { recursive: true });
    fs.writeFileSync(path.join(xdg, 'xray', 'config.json'), JSON.stringify({ telemetry: { enabled: true } }));
    // Consent saved, telemetry not forced off by env: only the run kind decides.
    const consent = { XDG_CONFIG_HOME: xdg, XRAY_NO_TELEMETRY: '', DO_NOT_TRACK: '' };
    const before = snapshotTree(root);
    const json = await run(['imports', '--format', 'json'], root, consent);
    const dflt = await run(['imports', '-p', root, 'crate'], root, consent);
    expect(json.status).toBe(0);
    expect(dflt.status).toBe(0);
    expect(JSON.parse(json.stdout).summary.files).toBeGreaterThan(0);
    expect(snapshotTree(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, '.xray'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.xray_cache.db'))).toBe(false);
  }, 60_000);

  it('at a terminal with saved consent, the default (json) format records nothing under the root', async () => {
    const base = fs.mkdtempSync(path.join(sandbox, 'tty-'));
    const root = path.join(base, 'repo');
    copyDir(path.join(FIXTURES, 'python', 'relative'), root);
    const xdg = path.join(base, 'xdg');
    fs.mkdirSync(path.join(xdg, 'xray'), { recursive: true });
    fs.writeFileSync(path.join(xdg, 'xray', 'config.json'), JSON.stringify({ telemetry: { enabled: true } }));
    // Interactive run: stdin/stdout report a TTY (preloaded), no CI, no opt-out env.
    const preload = path.join(base, 'fake-tty.js');
    fs.writeFileSync(preload, 'process.stdout.isTTY = true; process.stdin.isTTY = true;\n');
    const stateHome = path.join(base, 'state');
    const interactive: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: stateHome, XRAY_NO_TELEMETRY: '', DO_NOT_TRACK: '' };
    for (const k of CI_ENV_VARS) interactive[k] = '';
    const runTTY = (args: string[]) => new Promise<Result>((resolve, reject) => {
      const p = spawn(process.execPath, ['-r', preload, BIN, ...args], { cwd: root, env: { ...env, ...interactive }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      p.stdout.setEncoding('utf-8').on('data', (d: string) => (stdout += d));
      p.stderr.setEncoding('utf-8').on('data', (d: string) => (stderr += d));
      p.on('error', reject);
      p.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    const before = snapshotTree(root);
    const r = await runTTY(['imports', '-p', root]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).summary.files).toBeGreaterThan(0);
    expect(snapshotTree(root)).toEqual(before);
    // Control: an explicit human format at the same terminal does record (consent decides).
    const text = await runTTY(['imports', '-p', root, '--format', 'text']);
    expect(text.status).toBe(0);
    // The sink is the state dir's, keyed by the root; the root gets nothing.
    expect(fs.existsSync(path.join(stateHome, 'xray', 'telemetry', projectKey(root), 'telemetry.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.xray'))).toBe(false);
  }, 60_000);

  it('telemetry treats `imports --format json` as a machine run even at a terminal', () => {
    const argv = ['node', 'xray', 'imports', '--format', 'json'];
    expect(telemetryOffReason({ argv, env: {}, stdoutIsTTY: true })).toBe('machine-format');
  });
});

describe('collectImportFiles', () => {
  it('lists posix paths in byte order and resolves --lang aliases', () => {
    const files = collectImportFiles(FIXTURES, { languages: ['js'] });
    const paths = files.map(f => f.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual([...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(paths.every(p => !p.includes('\\'))).toBe(true);
    // Manifests are always listed for resolution; everything else is the selected language.
    const sources = paths.filter(p => !IMPORT_MANIFESTS.includes(path.posix.basename(p)));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every(p => /\.(js|jsx|mjs|cjs)$/.test(p))).toBe(true);
    expect(resolveImportLanguages(['ts', 'typescript', 'PY'])).toEqual(['python', 'typescript']);
  });

  it('always includes manifests (go.mod, go.work, package.json, Cargo.toml) whatever --lang / paths narrow to', () => {
    const dir = fs.mkdtempSync(path.join(sandbox, 'man-'));
    const put = (p: string, c: string) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), c); };
    put('go.work', 'go 1.22\nuse ./svc\n');
    put('svc/go.mod', 'module example.com/svc\n');
    put('svc/main.go', 'package main\nimport "example.com/svc/lib"\n');
    put('web/package.json', '{"name":"web"}\n');
    put('web/a.ts', "import x from 'y'\n");
    put('crate/Cargo.toml', '[package]\nname = "c"\n');
    put('crate/src/lib.rs', 'use std::fmt;\n');
    put('other.json', '{}\n');
    put('.gitignore', 'ignored/\n');
    put('ignored/go.mod', 'module x\n');
    const paths = collectImportFiles(dir, { languages: ['go'], paths: [path.join(dir, 'svc', 'main.go')] }).map(f => f.path);
    expect(paths).toEqual(['crate/Cargo.toml', 'go.work', 'svc/go.mod', 'svc/main.go', 'web/package.json']);
    expect([...IMPORT_MANIFESTS].sort()).toEqual(['Cargo.toml', 'go.mod', 'go.work', 'package.json']);
  });

  it('xray imports --lang go over a go.mod + go.work tree: exit 0, manifests are inputs, not files', async () => {
    const dir = fs.mkdtempSync(path.join(sandbox, 'gowork-'));
    fs.writeFileSync(path.join(dir, 'go.work'), 'go 1.22\nuse ./svc\n');
    fs.mkdirSync(path.join(dir, 'svc'));
    fs.writeFileSync(path.join(dir, 'svc', 'go.mod'), 'module example.com/svc\n');
    fs.writeFileSync(path.join(dir, 'svc', 'main.go'), 'package main\n\nimport "example.com/svc/lib"\n');
    fs.writeFileSync(path.join(dir, 'a.py'), 'import os\n');
    const r = await run(['imports', '-p', dir, '--lang', 'go'], sandbox);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as ImportsDoc;
    expect(validate(SCHEMA, doc, { noUndeclared: true })).toEqual([]);
    expect(doc.files.map(f => f.path)).toEqual(['svc/main.go']);
    expect(doc.files[0].imports.map(i => i.module)).toEqual(['example.com/svc/lib']);
  });

  it('includes contract extensions the scan catalog does not claim (.mjs, .cjs, .mts, .cts)', () => {
    const dir = fs.mkdtempSync(path.join(sandbox, 'ext-'));
    for (const f of ['a.mjs', 'b.cjs', 'c.mts', 'd.cts', 'e.txt']) fs.writeFileSync(path.join(dir, f), "import x from 'y'\n");
    expect(collectImportFiles(dir).map(f => f.path)).toEqual(['a.mjs', 'b.cjs', 'c.mts', 'd.cts']);
  });
});
