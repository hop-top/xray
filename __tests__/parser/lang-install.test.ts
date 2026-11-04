import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as grammars from '../../src/lib/parser/grammars';
import { checkGrammar, installPacks } from '../../src/lib/parser/lang-install';

// tree-sitter's native state breaks when different grammar packages parse in
// one jest process (see scripts/test-sequential.sh), so every real parse here
// uses the typescript package (default grammar + tsx variant). Other
// languages only appear as mocked, invalid or blocked statuses.
describe('post-install grammar check', () => {
  let managed: string;
  beforeEach(() => {
    managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-lang-install-'));
    process.env.XRAY_LANG_DIR = managed;
    grammars.resetGrammarCache();
  });
  afterEach(() => {
    delete process.env.XRAY_LANG_DIR;
    delete process.env.XRAY_LANG_BLOCK;
    grammars.resetGrammarCache();
    jest.restoreAllMocks();
  });

  const ok = () => ({ status: 0 });
  const ts = () => grammars.getPack('typescript')!;

  it('passes for an installed grammar that tree-sitter accepts', () => {
    const out = installPacks([ts()], ok);
    expect(out.ok).toBe(true);
    expect(out.statuses[0].ok).toBe(true);
    expect(out.statuses[0].check?.ok).toBe(true);
    expect(out.statuses[0].check?.treeSitter).toMatch(/^\d+\./);
  });

  it('checks the per-extension variants too (typescript -> tsx)', () => {
    const base = grammars.getGrammar('typescript');
    const r = checkGrammar({ ...base, moduleExports: { ...base.moduleExports, tsx: {} } });
    expect(r.ok).toBe(false);
    expect(r.check?.ok).toBe(false);
  });

  it('fails per grammar when tree-sitter rejects a grammar that loads fine', () => {
    const real = grammars.getGrammar.bind(grammars);
    jest.spyOn(grammars, 'getGrammar').mockImplementation((l: string) =>
      l === 'typescript' ? { ...real('typescript'), grammar: {} } : real(l));
    const out = installPacks([ts()], ok);
    const [s] = out.statuses;
    expect(out.ok).toBe(false);
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('broken');
    expect(s.check?.ok).toBe(false);
    expect(s.error).toBeTruthy();
    expect(s.module).toBe('tree-sitter-typescript');
  });

  it('does not run on grammars that failed to load', () => {
    process.env.XRAY_LANG_BLOCK = 'typescript';
    const out = installPacks([ts()], ok);
    expect(out.statuses[0].reason).toBe('blocked');
    expect(out.statuses[0].check).toBeUndefined();
  });
});
