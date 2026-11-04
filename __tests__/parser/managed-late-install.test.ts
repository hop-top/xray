import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as grammars from '../../src/lib/parser/grammars';
import { installPacks } from '../../src/lib/parser/lang-install';

/**
 * Node (>= 24) remembers a failed bare-specifier lookup under an existing
 * node_modules: a package installed afterwards, in the same process, stays
 * unresolvable. `xray lang add` probes before installing, so a second add into
 * a managed dir that already has node_modules reported "not installed".
 * Needs no grammar parse, so safe to run alongside other jest files.
 */
describe('grammar installed after a failed lookup in the same process', () => {
  // A module name xray's own node_modules cannot provide, so only the managed dir can.
  const FAKE = 'tree-sitter-late-fake';
  const pack = grammars.getPack('c')!;
  const realModule = pack.module;
  let managed: string;
  beforeEach(() => {
    pack.module = FAKE;
    managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-late-install-'));
    process.env.XRAY_LANG_DIR = managed;
    grammars.resetGrammarCache();
  });
  afterEach(() => {
    pack.module = realModule;
    delete process.env.XRAY_LANG_DIR;
    grammars.resetGrammarCache();
    fs.rmSync(managed, { recursive: true, force: true });
  });

  const fakeInstall = (name: string) => {
    const dir = path.join(managed, 'node_modules', name);
    fs.mkdirSync(path.join(dir, 'bindings/node'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.2.3', main: 'bindings/node' }));
    fs.writeFileSync(path.join(dir, 'bindings/node/index.js'), 'module.exports = { fake: true };\n');
  };

  it('reports the grammar installed once it is on disk (node_modules already present)', () => {
    fakeInstall('tree-sitter-go'); // an earlier add left node_modules behind
    expect(grammars.getGrammar('c').ok).toBe(false); // the pre-install probe
    const out = installPacks([pack], () => { fakeInstall(FAKE); return { status: 0 }; }, managed);
    const [s] = out.statuses;
    expect(s.source).toBe('managed');
    expect(s.version).toBe('1.2.3');
    expect(s.reason).not.toBe('missing');
  });

  it('still reports a grammar that was never installed as missing', () => {
    fakeInstall('tree-sitter-go');
    const s = grammars.getGrammar('c');
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('missing');
  });
});
