/**
 * Files in catalog languages whose grammar is not installed are discovered
 * but not parsed, nothing is installed, and the run reports them with ONE
 * aggregated INFO hint on stderr:
 *   - human output (default): shown
 *   - machine output (--json): hidden unless verbose
 *   - --quiet: hidden
 * Exit code is unaffected. Explicitly required languages still fail.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LANGUAGE_PACKS } from '../../src/lib/parser/grammars';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const FIXTURE = path.join(__dirname, '../fixtures/lang-hint');

// Only go + typescript grammars "installed".
const BLOCK = LANGUAGE_PACKS.map(p => p.name).filter(n => n !== 'go' && n !== 'typescript').join(',');
const HINT = 'found 2 .kt, 1 .swift files without installed grammars — install with: xray lang add kotlin swift';

let repo: string;
let managed: string;

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

const occurrences = (s: string, needle: string) => s.split(needle).length - 1;

describe('missing-grammar hint (CLI)', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hint-'));
    managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hint-lang-'));
    for (const f of fs.readdirSync(FIXTURE)) fs.copyFileSync(path.join(FIXTURE, f), path.join(repo, f));
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(managed, { recursive: true, force: true });
  });

  const mapArgs = (out: string, ...extra: string[]) => ['map', '-p', repo, '--skip-detect', '--no-chunk', '-o', path.join(repo, out), ...extra];

  it('default (human) output: one aggregated INFO hint on stderr, exit 0, kt/swift not parsed', () => {
    const r = run(mapArgs('out.txt'));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`ℹ ${HINT}`);
    expect(occurrences(r.stderr, 'without installed grammar')).toBe(1);
    expect(r.stderr).not.toMatch(/skipping \d+/);
    expect(r.stderr).not.toContain('⚠');
    expect(r.stdout).not.toContain('without installed grammar');
    const out = fs.readFileSync(path.join(repo, 'out.txt'), 'utf-8');
    expect(out).toContain('Greet');
    expect(out).toContain('Calculator');
    expect(out).not.toContain('kotlinHelper');
    expect(out).not.toContain('swiftHelper');
    // No implicit install into the managed dir.
    expect(fs.readdirSync(managed)).toEqual([]);
  }, 90_000);

  it('--json: no hint on either stream, stdout untouched, exit 0', () => {
    const r = run(mapArgs('out.json', '--json'));
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('without installed grammar');
    expect(r.stdout).toBe('');
  }, 90_000);

  it('lang list --json: stdout is pure JSON carrying the same info as data', () => {
    const r = run(['lang', 'list', '--json', '--path', repo]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.detectedNotInstalled.map((d: any) => d.language)).toEqual(['kotlin', 'swift']);
    expect(r.stderr).not.toContain('without installed grammar');
  }, 90_000);

  it('--json --verbose: hint plus per-language detail on stderr', () => {
    const r = run(['--log-level', 'debug', ...mapArgs('out-v.json', '--json')]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(HINT);
    expect(r.stderr).toMatch(/kotlin: 2 files \(\.kt\).*Util\.kt/);
    expect(r.stderr).toMatch(/swift: 1 file \(\.swift\).*View\.swift/);
    expect(r.stdout).toBe('');
  }, 90_000);

  it('--quiet: no hint, exit 0', () => {
    const r = run(['--quiet', ...mapArgs('out-q.txt')]);
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).not.toContain('without installed grammar');
  }, 90_000);

  // Exit 3 (not found) is today's documented code for a required, missing grammar.
  it('--lang requiring a missing language still fails the run (exit 3)', () => {
    const r = run(mapArgs('out-r.txt', '--lang', 'go,kotlin'));
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("Grammar for 'kotlin' is not installed");
  }, 90_000);

  it('config `languages` requiring a missing language still fails the run (exit 3)', () => {
    fs.writeFileSync(path.join(repo, '.xrayrc.json'), JSON.stringify({ languages: ['go', 'swift'] }));
    try {
      const r = run(mapArgs('out-c.txt'));
      expect(r.status).toBe(3);
      expect(r.stderr).toContain("Grammar for 'swift' is not installed");
    } finally {
      fs.rmSync(path.join(repo, '.xrayrc.json'));
    }
  }, 90_000);
});
