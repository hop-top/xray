import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { Logger } from '../../src/lib/logger';
import { resetGrammarCache, MissingGrammarError } from '../../src/lib/parser/grammars';

const fixtureSrc = path.join(__dirname, '../fixtures/lang-packs');
let fixture = '';

describe('map on a Go+TS(+py,java) repo with only go and typescript grammars', () => {
  let warn: jest.SpyInstance;
  let info: jest.SpyInstance;
  let cacheDir: string;
  beforeEach(() => {
    process.env.XRAY_LANG_BLOCK = 'python,java,kotlin,rust,c,cpp,php';
    resetGrammarCache();
    warn = jest.spyOn(Logger, 'warn').mockImplementation();
    info = jest.spyOn(Logger, 'info').mockImplementation();
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cache-'));
    // Private copy: isolates the run from repo/git state and concurrent suites.
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fx-'));
    for (const f of fs.readdirSync(fixtureSrc)) fs.copyFileSync(path.join(fixtureSrc, f), path.join(fixture, f));
  });
  afterEach(() => {
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    jest.restoreAllMocks();
  });

  const run = (extra: object = {}) =>
    new Xray({ path: fixture, cachePath: path.join(cacheDir, 'c.db'), chunked: false, ...extra }).run() as Promise<string>;

  it('maps go and ts symbols, reports missing languages in one INFO hint, and continues', async () => {
    const out = await run();
    expect(out).toContain('Greet');
    expect(out).toContain('Calculator');
    const hints = info.mock.calls.map(c => String(c[0])).filter(m => m.includes('without installed grammar'));
    expect(hints).toEqual(['found 1 .java, 1 .py files without installed grammars — install with: xray lang add java python']);
    expect(warn.mock.calls.filter(c => /grammar|skipping/.test(String(c[0])))).toEqual([]);
  });

  it('does not cache skipped files, so installing the grammar later takes effect', async () => {
    await run();
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    const out = await run();
    expect(out).toContain('helper');
  });

  it('explicit languages restrict parsing silently', async () => {
    const out = await run({ languages: ['go', 'typescript'] });
    expect(out).toContain('Greet');
    expect(info.mock.calls.filter(c => String(c[0]).includes('without installed grammar'))).toHaveLength(0);
    expect(warn.mock.calls.filter(c => /grammar|skipping/.test(String(c[0])))).toEqual([]);
  });

  it('explicitly requiring a missing grammar fails the run', async () => {
    await expect(run({ languages: ['go', 'python'] })).rejects.toThrow(MissingGrammarError);
  });
});
