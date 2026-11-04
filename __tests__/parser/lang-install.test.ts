import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as grammars from '../../src/lib/parser/grammars';
import { checkGrammar, installCommand, removeCommand, installPacks } from '../../src/lib/parser/lang-install';

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

describe('npm commands', () => {
  const pack = (module: string, range: string) => ({ name: 'x', module, range, extensions: ['.x'], query: 'x.scm' } as any);

  it('install saves exact versions and keeps --legacy-peer-deps', () => {
    const argv = installCommand([pack('tree-sitter-c-sharp', '0.23.1')]);
    expect(argv).toContain('--save-exact');
    expect(argv).toContain('--legacy-peer-deps');
    expect(argv.slice(-1)).toEqual(['tree-sitter-c-sharp@0.23.1']);
  });

  it('install keeps the catalog range as the npm spec for range packs', () => {
    expect(installCommand([pack('tree-sitter-go', '^0.25.0')]).slice(-1)).toEqual(['tree-sitter-go@^0.25.0']);
  });

  it('remove does not carry install-only flags', () => {
    const argv = removeCommand([pack('tree-sitter-go', '^0.25.0')]);
    expect(argv).not.toContain('--save-exact');
    expect(argv).toContain('--legacy-peer-deps');
    expect(argv.slice(-1)).toEqual(['tree-sitter-go']);
  });
});
