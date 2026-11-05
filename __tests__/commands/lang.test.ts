import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerLangCommand } from '../../src/commands/lang';
import { Logger } from '../../src/lib/logger';
import * as grammars from '../../src/lib/parser/grammars';
import { resetGrammarCache } from '../../src/lib/parser/grammars';
import { installCommand } from '../../src/lib/parser/lang-install';
import { getPack } from '../../src/lib/parser/grammars';

function capture() {
  const lines: string[] = [];
  jest.spyOn(Logger, 'output').mockImplementation((m: string) => { lines.push(m); });
  jest.spyOn(Logger, 'info').mockImplementation((m: string) => { lines.push(m); });
  jest.spyOn(Logger, 'success').mockImplementation((m: string) => { lines.push(m); });
  jest.spyOn(Logger, 'warn').mockImplementation((m: string) => { lines.push(m); });
  jest.spyOn(Logger, 'error').mockImplementation((m: string) => { lines.push(m); });
  return lines;
}

describe('xray lang', () => {
  let managed: string;
  beforeEach(() => {
    managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-lang-'));
    process.env.XRAY_LANG_DIR = managed;
    process.env.XRAY_LANG_BLOCK = 'kotlin';
    resetGrammarCache();
    process.exitCode = 0;
  });
  afterEach(() => {
    delete process.env.XRAY_LANG_DIR;
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    jest.restoreAllMocks();
    process.exitCode = 0;
  });

  it('list --json reports status, file counts and bundles', async () => {
    const lines = capture();
    const fixture = path.join(__dirname, '../fixtures/lang-packs');
    await registerLangCommand().parseAsync(['node', 'lang', 'list', '--json', '--path', fixture]);
    const out = JSON.parse(lines.join('\n'));
    const byLang = Object.fromEntries(out.languages.map((l: any) => [l.language, l]));
    expect(byLang.go.status).toBe('installed');
    expect(byLang.go.files).toBe(1);
    expect(byLang.kotlin.status).toBe('not-installed');
    expect(out.bundles.web).toEqual(['typescript', 'javascript']);
    expect(out.managedDir).toBe(managed);
  });

  it('add --dry-run prints the plan (the npm command) and installs nothing', async () => {
    const lines = capture();
    const out: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((c: any) => { out.push(String(c)); return true; });
    const run = jest.fn();
    await registerLangCommand(run).parseAsync(['node', 'lang', 'add', 'kotlin', '--dry-run']);
    expect(run).not.toHaveBeenCalled();
    const plan = out.join('') + lines.join('\n');
    expect(plan).toContain('install');
    expect(plan).toContain('tree-sitter-kotlin@');
    expect(fs.existsSync(path.join(managed, 'package.json'))).toBe(false);
  });

  it('add runs npm in the managed dir only for missing languages and fails if still not loadable', async () => {
    const lines = capture();
    const run = jest.fn().mockReturnValue({ status: 0 });
    await registerLangCommand(run).parseAsync(['node', 'lang', 'add', 'go', 'kotlin']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual(installCommand([getPack('kotlin')!]));
    expect(run.mock.calls[0][1]).toBe(managed);
    expect(fs.existsSync(path.join(managed, 'package.json'))).toBe(true);
    expect(lines.join('\n')).toContain('go: already installed');
    expect(process.exitCode).toBe(1); // kotlin blocked => still not loadable
  });

  it('add reports a grammar that loads but tree-sitter rejects, per language, and exits non-zero', async () => {
    const lines = capture();
    const real = grammars.getGrammar.bind(grammars);
    let installed = false;
    jest.spyOn(grammars, 'getGrammar').mockImplementation((l: string) => {
      if (l !== 'kotlin') return real(l);
      // not installed before `npm install`, loadable-but-invalid afterwards
      return installed
        ? { ...real('go'), language: 'kotlin', module: 'tree-sitter-kotlin', version: '0.3.8', grammar: {} }
        : { language: 'kotlin', module: 'tree-sitter-kotlin', ok: false, reason: 'missing' };
    });
    const run = jest.fn().mockImplementation(() => { installed = true; return { status: 0 }; });
    await registerLangCommand(run).parseAsync(['node', 'lang', 'add', 'kotlin', 'go']);
    const out = lines.join('\n');
    expect(out).toContain("kotlin: installed but not usable with xray's tree-sitter");
    expect(out).toContain('tree-sitter-kotlin@0.3.8');
    expect(out).toContain('xray lang remove kotlin');
    expect(out).not.toMatch(/kotlin: installed$/m);
    expect(process.exitCode).toBe(1);
  });

  it('rejects unknown languages with a non-zero exit', async () => {
    const lines = capture();
    await registerLangCommand(jest.fn()).parseAsync(['node', 'lang', 'add', 'cobol']);
    expect(lines.join('\n')).toContain("Unknown language or bundle 'cobol'");
    expect(process.exitCode).toBe(2);
  });

  it('remove only touches packs in the managed dir', async () => {
    const lines = capture();
    fs.writeFileSync(path.join(managed, 'package.json'), JSON.stringify({ dependencies: { 'tree-sitter-kotlin': '^0.3.8' } }));
    const run = jest.fn().mockReturnValue({ status: 0 });
    await registerLangCommand(run).parseAsync(['node', 'lang', 'remove', 'go', 'kotlin']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('tree-sitter-kotlin');
    expect(run.mock.calls[0][0]).not.toContain('tree-sitter-go');
    expect(lines.join('\n')).toContain('go: not managed by xray');
  });
});
