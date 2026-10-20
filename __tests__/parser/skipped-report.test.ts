/**
 * Per-run reporting of files skipped for lack of a grammar: one aggregated
 * INFO hint, shown for human formats, hidden for machine formats unless
 * verbose, always hidden with --quiet (log level error). Broken grammars
 * (installed but failing to load) remain a warning.
 */
import { Logger, LogLevel } from '../../src/lib/logger';
import {
  beginLanguageRun,
  reportSkippedLanguages,
  resetGrammarCache,
} from '../../src/lib/parser/grammars';
import { getLanguageConfig } from '../../src/lib/parser/language-registry';
import { isMachineFormat } from '../../src/lib/output-format';

const HINT = 'found 2 .kt, 1 .swift files without installed grammars — install with: xray lang add kotlin swift';

function stderr() {
  const lines: string[] = [];
  jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { lines.push(a.map(String).join(' ')); });
  jest.spyOn(console, 'warn').mockImplementation((...a: any[]) => { lines.push(a.map(String).join(' ')); });
  return lines;
}

function skipSome() {
  process.env.XRAY_LANG_BLOCK = 'kotlin,swift';
  resetGrammarCache();
  beginLanguageRun(undefined);
  getLanguageConfig('.kt', 'src/b/Widget.kt');
  getLanguageConfig('.kt', 'src/a/Util.kt');
  getLanguageConfig('.swift', 'View.swift');
  getLanguageConfig('.go', 'main.go');
}

describe('reportSkippedLanguages', () => {
  const prev = Logger.getLevel();
  afterEach(() => {
    delete process.env.XRAY_LANG_BLOCK;
    beginLanguageRun(undefined);
    reportSkippedLanguages();
    resetGrammarCache();
    Logger.setLevel(prev);
    jest.restoreAllMocks();
  });

  it.each([undefined, 'txt', 'table', 'text', 'human', 'tree'])('human format %p: one INFO hint at default verbosity', (format) => {
    Logger.setLevel(LogLevel.INFO);
    skipSome();
    const lines = stderr();
    const out = reportSkippedLanguages({ format });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`ℹ ${HINT}`);
    expect(out.map(o => o.language)).toEqual(['kotlin', 'swift']);
  });

  it.each(['json', 'yaml', 'csv', 'tsv', 'xml', 'ndjson'])('machine format %p: silent at default verbosity', (format) => {
    Logger.setLevel(LogLevel.INFO);
    skipSome();
    const lines = stderr();
    const out = reportSkippedLanguages({ format });
    expect(lines).toEqual([]);
    expect(out).toHaveLength(2); // still returned as data
  });

  it('machine format + verbose: hint plus per-language debug detail with sample paths', () => {
    Logger.setLevel(LogLevel.DEBUG);
    skipSome();
    const lines = stderr();
    reportSkippedLanguages({ format: 'json' });
    expect(lines[0]).toContain(HINT);
    expect(lines.slice(1).join('\n')).toContain('kotlin: 2 files (.kt) — e.g. src/a/Util.kt, src/b/Widget.kt');
    expect(lines.slice(1).join('\n')).toContain('swift: 1 file (.swift) — e.g. View.swift');
  });

  it('--quiet (level error): nothing, even for human format', () => {
    Logger.setLevel(LogLevel.ERROR);
    skipSome();
    const lines = stderr();
    reportSkippedLanguages({ format: 'txt' });
    expect(lines).toEqual([]);
  });

  it('single file wording', () => {
    Logger.setLevel(LogLevel.INFO);
    process.env.XRAY_LANG_BLOCK = 'kotlin';
    resetGrammarCache();
    beginLanguageRun(undefined);
    getLanguageConfig('.kt', 'A.kt');
    const lines = stderr();
    reportSkippedLanguages();
    expect(lines).toEqual([expect.stringContaining('found 1 .kt file without an installed grammar — install with: xray lang add kotlin')]);
  });

  it('resets after reporting', () => {
    Logger.setLevel(LogLevel.INFO);
    skipSome();
    reportSkippedLanguages();
    const lines = stderr();
    expect(reportSkippedLanguages()).toEqual([]);
    expect(lines).toEqual([]);
  });
});

describe('isMachineFormat', () => {
  it('classifies formats', () => {
    for (const f of ['json', 'JSON', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'ndjson', 'jsonl']) expect(isMachineFormat(f)).toBe(true);
    for (const f of [undefined, '', 'txt', 'text', 'table', 'tree', 'human', 'mermaid', 'dot']) expect(isMachineFormat(f)).toBe(false);
  });
});
