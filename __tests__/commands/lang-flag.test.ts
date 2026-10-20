import { Command } from 'commander';
import { addCommonOptions } from '../../src/commands/common';
import { mergeConfig } from '../../src/lib/config';
import { UnknownLanguageError, MissingGrammarError, beginLanguageRun, resetGrammarCache } from '../../src/lib/parser/grammars';

function parse(args: string[]) {
  const cmd = addCommonOptions(new Command('map')).exitOverride();
  cmd.parse(['node', 'map', ...args]);
  return cmd.opts();
}

describe('--lang flag', () => {
  it('parses comma lists and repeats', () => {
    expect(parse(['--lang', 'go,ts', '--lang', 'python']).lang).toEqual(['go', 'ts', 'python']);
    expect(parse([]).lang).toEqual([]);
  });

  it('overrides config languages; falls back to config when absent', () => {
    const cfg = { languages: ['python'] } as any;
    expect(mergeConfig(cfg, { lang: ['go', 'ts'] }).languages).toEqual(['go', 'ts']);
    expect(mergeConfig(cfg, { lang: [] }).languages).toEqual(['python']);
    expect(mergeConfig(cfg, {}).languages).toEqual(['python']);
    expect(mergeConfig({} as any, { lang: ['go'] }).languages).toEqual(['go']);
  });

  it('accepts aliases and bundles; rejects unknown names with usage exit code', () => {
    expect(() => beginLanguageRun(['ts', 'go'])).not.toThrow();
    expect(() => beginLanguageRun(['web'])).not.toThrow();
    let err: any;
    try { beginLanguageRun(['cobol']); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(UnknownLanguageError);
    expect(err.exitCode).toBe(2);
    beginLanguageRun(undefined);
  });

  it('a required-but-missing grammar exits not-found', () => {
    process.env.XRAY_LANG_BLOCK = 'go';
    resetGrammarCache();
    let err: any;
    try { beginLanguageRun(['go']); } catch (e) { err = e; }
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    beginLanguageRun(undefined);
    expect(err).toBeInstanceOf(MissingGrammarError);
    expect(err.exitCode).toBe(3);
  });
});
