import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BUNDLES,
  LANGUAGE_PACKS,
  MissingGrammarError,
  UnknownLanguageError,
  beginLanguageRun,
  expandSelection,
  reportSkippedLanguages,
  getGrammar,
  getPack,
  isGrammarAvailable,
  packForExtension,
  requireGrammarModule,
  resetGrammarCache,
} from '../../src/lib/parser/grammars';
import { getLanguageConfig } from '../../src/lib/parser/language-registry';
import { Logger } from '../../src/lib/logger';

const pkg = require('../../package.json');

describe('language pack catalog', () => {
  it('stays in sync with package.json (optional peers + tested ranges)', () => {
    for (const p of LANGUAGE_PACKS) {
      expect(pkg.peerDependencies[p.module]).toBe(p.range);
      expect(pkg.peerDependenciesMeta[p.module]).toEqual({ optional: true });
      expect(pkg.devDependencies[p.module]).toBe(p.range);
      expect(pkg.dependencies[p.module]).toBeUndefined();
      expect(pkg.optionalDependencies?.[p.module]).toBeUndefined();
    }
  });

  it('pins the C# grammar to exactly 0.23.1 in catalog and package.json', () => {
    // 0.23.5 is ESM-only with top-level await and cannot be require()d, so a
    // range that admits it breaks fresh installs. The lockfile hides this.
    const cs = LANGUAGE_PACKS.find(p => p.module === 'tree-sitter-c-sharp');
    expect(cs?.range).toBe('0.23.1');
    expect(pkg.peerDependencies['tree-sitter-c-sharp']).toBe('0.23.1');
    expect(pkg.devDependencies['tree-sitter-c-sharp']).toBe('0.23.1');
  });

  it('core runtime depends on tree-sitter only (no grammar in dependencies)', () => {
    expect(pkg.dependencies['tree-sitter']).toBeDefined();
    expect(Object.keys(pkg.dependencies).filter(k => k.startsWith('tree-sitter-'))).toEqual([]);
  });

  it('maps extensions and aliases to packs', () => {
    expect(packForExtension('.go')?.name).toBe('go');
    expect(packForExtension('.tsx')?.name).toBe('typescript');
    expect(packForExtension('.xyz')).toBeUndefined();
    expect(getPack('TS')?.name).toBe('typescript');
    expect(getPack('c-sharp')?.name).toBe('csharp');
  });

  it('expands bundles and rejects unknown names', () => {
    expect(expandSelection(['web']).map(p => p.name)).toEqual(['typescript', 'javascript']);
    expect(expandSelection(['go', 'systems']).map(p => p.name).sort()).toEqual(['c', 'cpp', 'go', 'rust']);
    expect(expandSelection(['full']).length).toBe(LANGUAGE_PACKS.length);
    expect(Object.keys(BUNDLES)).toEqual(expect.arrayContaining(['web', 'go', 'systems', 'full']));
    expect(() => expandSelection(['cobol'])).toThrow(UnknownLanguageError);
  });
});

describe('lazy loading and missing grammars', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    resetGrammarCache();
    warn = jest.spyOn(Logger, 'warn').mockImplementation();
  });
  afterEach(() => {
    delete process.env.XRAY_LANG_BLOCK;
    beginLanguageRun(undefined);
    reportSkippedLanguages();
    resetGrammarCache();
    warn.mockRestore();
  });

  it('loads a grammar on demand and caches it', () => {
    const a = getGrammar('go');
    expect(a.ok).toBe(true);
    expect(a.source).toBe('xray');
    expect(getGrammar('golang')).toBe(a);
    expect(requireGrammarModule('typescript').tsx).toBeDefined();
  });

  it('reports a missing grammar instead of throwing', () => {
    process.env.XRAY_LANG_BLOCK = 'kotlin';
    expect(isGrammarAvailable('kotlin')).toBe(false);
    expect(getLanguageConfig('.kt')).toBeUndefined();
    expect(() => requireGrammarModule('kotlin')).toThrow(MissingGrammarError);
    expect(isGrammarAvailable('go')).toBe(true);
  });

  it('reports missing languages once, aggregated, as INFO (no warning)', () => {
    const info = jest.spyOn(Logger, 'info').mockImplementation();
    process.env.XRAY_LANG_BLOCK = 'kotlin,python';
    beginLanguageRun(undefined);
    getLanguageConfig('.kt');
    getLanguageConfig('.kt');
    getLanguageConfig('.kt');
    getLanguageConfig('.py');
    const out = reportSkippedLanguages();
    expect(out.map(o => o.language)).toEqual(['kotlin', 'python']);
    expect(out[0]).toMatchObject({ count: 3, byExtension: { '.kt': 3 } });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('found 3 .kt, 1 .py files without installed grammars — install with: xray lang add kotlin python');
    expect(warn).not.toHaveBeenCalled();
    // reset after reporting
    expect(reportSkippedLanguages()).toEqual([]);
    info.mockRestore();
  });

  it('explicit selection is required: missing grammar throws, unselected languages are silent', () => {
    process.env.XRAY_LANG_BLOCK = 'go';
    expect(() => beginLanguageRun(['go'])).toThrow(MissingGrammarError);
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    beginLanguageRun(['typescript']);
    expect(getLanguageConfig('.ts')).toBeDefined();
    expect(getLanguageConfig('.go')).toBeUndefined();
    expect(reportSkippedLanguages()).toEqual([]);
  });
});

describe('untrusted project search path', () => {
  const origCwd = process.cwd();
  let repo: string;
  let managed: string;
  let marker: string;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-evil-'));
    managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-managed-'));
    marker = path.join(repo, 'PWNED');
    fs.mkdirSync(path.join(repo, 'node_modules/tree-sitter-go'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'node_modules/tree-sitter-go/index.js'),
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = {};`
    );
    process.chdir(repo);
    process.env.XRAY_LANG_DIR = managed;
    resetGrammarCache();
    warn = jest.spyOn(Logger, 'warn').mockImplementation();
  });
  afterEach(() => {
    process.chdir(origCwd);
    delete process.env.XRAY_LANG_DIR;
    delete process.env.XRAY_ALLOW_PROJECT_GRAMMARS;
    resetGrammarCache();
    warn.mockRestore();
  });

  // xray's own copy must not satisfy the lookup, or the repo path is never reached.
  function withoutOwnGrammar(fn: () => void) {
    jest.isolateModules(() => {
      jest.doMock('tree-sitter-go', () => {
        throw Object.assign(new Error("Cannot find module 'tree-sitter-go'"), { code: 'MODULE_NOT_FOUND' });
      });
      fn();
    });
  }

  it('does NOT load a grammar from the scanned repo node_modules by default', () => {
    withoutOwnGrammar(() => {
      const g = require('../../src/lib/parser/grammars');
      const s = g.getGrammar('go');
      expect(s.ok).toBe(false);
      expect(s.reason).toBe('missing');
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('loads from the repo only with explicit env opt-in, and warns with the path', () => {
    process.env.XRAY_ALLOW_PROJECT_GRAMMARS = '1';
    withoutOwnGrammar(() => {
      const g = require('../../src/lib/parser/grammars');
      const L = require('../../src/lib/logger').Logger;
      const w = jest.spyOn(L, 'warn').mockImplementation();
      const s = g.getGrammar('go');
      expect(s.source).toBe('project');
      expect(w).toHaveBeenCalledWith(expect.stringContaining(path.join('node_modules/tree-sitter-go')));
    });
    expect(fs.existsSync(marker)).toBe(true);
  });
});
