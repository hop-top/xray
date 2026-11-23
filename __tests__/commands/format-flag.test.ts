/**
 * `--format <fmt>` on map/scan/graph (and lang list) with the legacy
 * --json/--csv/--xml/--txt flags kept as aliases.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LANGUAGE_PACKS } from '../../src/lib/parser/grammars';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const FIXTURE = path.join(__dirname, '../fixtures/lang-hint');
const BLOCK = LANGUAGE_PACKS.map(p => p.name).filter(n => n !== 'go' && n !== 'typescript').join(',');
const HINT = 'without installed grammars';

let repo: string;
let managed: string;
let out: string;
let cacheHome: string;

/** The graph cache serves a warm project without re-parsing: notices are parse-time. */
const cold = () => fs.rmSync(path.join(cacheHome, 'xray'), { recursive: true, force: true });

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      ...process.env,
      XRAY_NO_TELEMETRY: '1',
      XRAY_LANG_BLOCK: BLOCK,
      XRAY_LANG_DIR: managed,
      XDG_CACHE_HOME: cacheHome,
      FORCE_COLOR: '0',
    },
    timeout: 90_000,
  });
}

const isJson = (f: string) => { try { JSON.parse(fs.readFileSync(f, 'utf-8')); return true; } catch { return false; } };

describe('--format', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fmt-'));
    managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fmt-lang-'));
    cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fmt-cache-'));
    for (const f of fs.readdirSync(FIXTURE)) fs.copyFileSync(path.join(FIXTURE, f), path.join(repo, f));
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  });
  beforeEach(() => { out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fmt-out-')), 'o.out'); });
  afterEach(() => fs.rmSync(path.dirname(out), { recursive: true, force: true }));
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(managed, { recursive: true, force: true });
    fs.rmSync(cacheHome, { recursive: true, force: true });
  });

  const args = (cmd: string, ...extra: string[]) => [cmd, '-p', repo, '--no-detect', '--no-chunk', '-o', out, ...extra];

  test('map --format json writes a JSON graph', () => {
    const r = run(args('map', '--format', 'json'));
    expect(r.status).toBe(0);
    expect(isJson(out)).toBe(true);
  });

  test('--format txt / csv / xml are accepted (non-JSON text)', () => {
    for (const f of ['txt', 'csv', 'xml']) {
      const r = run(args('map', '--format', f));
      expect(r.status).toBe(0);
      expect(isJson(out)).toBe(false);
    }
  });

  test('legacy boolean format aliases (--json, --txt, --csv, --xml, --mermaid) are unknown options', () => {
    for (const flag of ['--json', '--txt', '--csv', '--xml', '--mermaid', '--dot']) {
      const r = run(args('map', flag));
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/unknown option/);
      expect(fs.existsSync(out)).toBe(false);
    }
  });

  test('--format dot and --format mermaid -> usage error (exit 2) listing valid formats', () => {
    for (const bad of ['dot', 'mermaid', 'yaml']) {
      const r = run(args('map', '--format', bad));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`invalid --format '${bad}' (expected one of: txt, csv, xml, json)`);
    }
  });

  test('CLI --format beats config-file json', () => {
    fs.writeFileSync(path.join(repo, '.xrayrc.json'), JSON.stringify({ json: true }));
    try {
      expect(run(args('map')).status).toBe(0);
      expect(isJson(out)).toBe(true); // config still honoured without a CLI choice
      expect(run(args('map', '--format', 'txt')).status).toBe(0);
      expect(isJson(out)).toBe(false);
    } finally {
      fs.rmSync(path.join(repo, '.xrayrc.json'));
    }
  });

  describe('INFO hint classification keys off the resolved format', () => {
    // The hint is emitted while parsing: a warm graph cache would hide it.
    beforeEach(cold);
    test('--format json: hint hidden (machine)', () => {
      const r = run(args('map', '--format', 'json'));
      expect(r.stderr).not.toContain(HINT);
    });
    test('--format csv / xml: hint hidden (machine)', () => {
      for (const f of ['csv', 'xml']) expect(run(args('map', '--format', f)).stderr).not.toContain(HINT);
    });
    test('--format txt and default: hint shown (human)', () => {
      expect(run(args('map', '--format', 'txt')).stderr).toContain(HINT);
      expect(run(args('map')).stderr).toContain(HINT);
    });
    test('--format json -V: hint shown', () => {
      expect(run(['-V', ...args('map', '--format', 'json')]).stderr).toContain(HINT);
    });
  });

  describe('language list', () => {
    test('--format json outputs structured languages and bundles', () => {
      const a = run(['language', 'list', '--format', 'json', '--path', repo]);
      expect(a.status).toBe(0);
      const parsed = JSON.parse(a.stdout);
      expect(Array.isArray(parsed.languages)).toBe(true);
      expect(parsed.bundles).toBeDefined();
    });
    test('--format text is human output', () => {
      const r = run(['language', 'list', '--format', 'text', '--path', repo]);
      expect(r.status).toBe(0);
      expect(() => JSON.parse(r.stdout)).toThrow();
    });
    test('--json is unknown option (exit 2)', () => {
      expect(run(['language', 'list', '--json', '--path', repo]).status).toBe(2);
    });
    test('unknown value -> exit 2', () => {
      expect(run(['language', 'list', '--format', 'yaml', '--path', repo]).status).toBe(2);
    });
  });

  test('help advertises --format and omits removed boolean format aliases', () => {
    const r = run(['map', '--help']);
    expect(r.stdout).toMatch(/--format <fmt>/);
    expect(r.stdout).not.toMatch(/--json\b/);
  });
});
