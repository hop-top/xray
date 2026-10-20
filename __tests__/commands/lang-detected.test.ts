/**
 * `xray lang list` surfaces languages detected in the repo whose grammar is
 * not installed, as a human section and as data in --json.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { registerLangCommand } from '../../src/commands/lang';
import { Logger } from '../../src/lib/logger';
import { LANGUAGE_PACKS, resetGrammarCache } from '../../src/lib/parser/grammars';

const FIXTURE = path.join(__dirname, '../fixtures/lang-hint');

function capture() {
  const lines: string[] = [];
  for (const m of ['output', 'info', 'success', 'warn', 'error'] as const) {
    jest.spyOn(Logger, m).mockImplementation(((s: string) => { lines.push(s); }) as any);
  }
  return lines;
}

describe('xray lang list: detected, not installed', () => {
  let repo: string;
  let managed: string;
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-lang-det-'));
    for (const f of fs.readdirSync(FIXTURE)) fs.copyFileSync(path.join(FIXTURE, f), path.join(repo, f));
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));
  beforeEach(() => {
    managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-lang-'));
    process.env.XRAY_LANG_DIR = managed;
    process.env.XRAY_LANG_BLOCK = LANGUAGE_PACKS.map(p => p.name).filter(n => n !== 'go' && n !== 'typescript').join(',');
    resetGrammarCache();
  });
  afterEach(() => {
    delete process.env.XRAY_LANG_DIR;
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    jest.restoreAllMocks();
  });

  it('--json includes detectedNotInstalled as data', async () => {
    const lines = capture();
    await registerLangCommand().parseAsync(['node', 'lang', 'list', '--json', '--path', repo]);
    const out = JSON.parse(lines.join('\n'));
    expect(out.detectedNotInstalled).toEqual([
      { language: 'kotlin', files: 2, extensions: { '.kt': 2 }, status: 'not-installed' },
      { language: 'swift', files: 1, extensions: { '.swift': 1 }, status: 'not-installed' },
    ]);
    expect(out.install).toBe('xray lang add kotlin swift');
  });

  it('human output has a detected-not-installed section with counts and the fix', async () => {
    const lines = capture();
    await registerLangCommand().parseAsync(['node', 'lang', 'list', '--path', repo]);
    const text = lines.join('\n');
    expect(text).toContain('Detected in this repo, not installed:');
    expect(text).toMatch(/kotlin\s+2 files \(\.kt\)/);
    expect(text).toMatch(/swift\s+1 file \(\.swift\)/);
    expect(text).toContain('xray lang add kotlin swift');
  });

  it('json has an empty list when every detected language is installed', async () => {
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    const lines = capture();
    await registerLangCommand().parseAsync(['node', 'lang', 'list', '--json', '--path', repo]);
    const out = JSON.parse(lines.join('\n'));
    expect(out.detectedNotInstalled).toEqual([]);
    expect(out.install).toBeNull();
  });
});
