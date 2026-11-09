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

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      ...process.env,
      XRAY_NO_TELEMETRY: '1',
      XRAY_LANG_BLOCK: BLOCK,
      XRAY_LANG_DIR: managed,
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
    for (const f of fs.readdirSync(FIXTURE)) fs.copyFileSync(path.join(FIXTURE, f), path.join(repo, f));
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  });
  beforeEach(() => { out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fmt-out-')), 'o.out'); });
  afterEach(() => fs.rmSync(path.dirname(out), { recursive: true, force: true }));
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(managed, { recursive: true, force: true });
  });

  const args = (cmd: string, ...extra: string[]) => [cmd, '-p', repo, '--skip-detect', '--no-chunk', '-o', out, ...extra];

  test.each(['map', 'graph'])('%s --format json writes a JSON graph', cmd => {
    const r = run(args(cmd, '--format', 'json'));
    expect(r.status).toBe(0);
    expect(isJson(out)).toBe(true);
  });

  test('--format json and --json produce equivalent output', () => {
    expect(run(args('map', '--format', 'json')).status).toBe(0);
    const a = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(run(args('map', '--json')).status).toBe(0);
    const b = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });

  test('--format txt / csv / xml are accepted (non-JSON text)', () => {
    for (const f of ['txt', 'csv', 'xml']) {
      const r = run(args('map', '--format', f));
      expect(r.status).toBe(0);
      expect(isJson(out)).toBe(false);
    }
  });

  test('--format wins over a conflicting legacy flag', () => {
    expect(run(args('map', '--format', 'txt', '--json')).status).toBe(0);
    expect(isJson(out)).toBe(false);
    expect(run(args('map', '--format', 'json', '--csv')).status).toBe(0);
    expect(isJson(out)).toBe(true);
  });

  test('conflicting legacy flags -> usage error (exit 2), nothing written', () => {
    for (const flags of [['--json', '--csv'], ['--xml', '--txt']]) {
      const r = run(args('map', ...flags));
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/conflicting/);
      expect(fs.existsSync(out)).toBe(false);
    }
  });

  test('--format mermaid / dot -> usage error (exit 2) listing valid formats', () => {
    for (const f of ['mermaid', 'dot']) {
      const r = run(args('map', '--format', f));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`invalid --format '${f}' (expected one of: txt, csv, xml, json)`);
    }
  });

  test('--mermaid / --dot flags are unknown options (exit 2)', () => {
    for (const f of ['--mermaid', '--dot']) {
      const r = run(args('map', f));
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/unknown option/);
    }
  });

  test('unknown --format value -> usage error (exit 2)', () => {
    const r = run(args('map', '--format', 'yaml'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("invalid --format 'yaml'");
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

  describe('lang list', () => {
    test('--format json == --json', () => {
      const a = run(['lang', 'list', '--format', 'json', '--path', repo]);
      const b = run(['lang', 'list', '--json', '--path', repo]);
      expect(a.status).toBe(0);
      expect(JSON.parse(a.stdout).bundles).toEqual(JSON.parse(b.stdout).bundles);
    });
    test('--format text is human output; --format wins over --json', () => {
      const r = run(['lang', 'list', '--format', 'text', '--json', '--path', repo]);
      expect(r.status).toBe(0);
      expect(() => JSON.parse(r.stdout)).toThrow();
    });
    test('unknown value -> exit 2', () => {
      expect(run(['lang', 'list', '--format', 'yaml', '--path', repo]).status).toBe(2);
    });
  });

  test('help advertises --format and marks legacy flags as aliases', () => {
    const r = run(['map', '--help']);
    expect(r.stdout).toMatch(/--format <fmt>/);
    expect(r.stdout).toMatch(/--json\s+Alias of --format json/);
  });
});
