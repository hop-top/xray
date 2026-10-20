import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { Logger } from '../../src/lib/logger';
import { resetGrammarCache, MissingGrammarError } from '../../src/lib/parser/grammars';

const fixture = path.join(__dirname, '../fixtures/lang-packs');

describe('map on a Go+TS(+py,java) repo with only go and typescript grammars', () => {
  let warn: jest.SpyInstance;
  let cacheDir: string;
  beforeEach(() => {
    process.env.XRAY_LANG_BLOCK = 'python,java,kotlin,rust,c,cpp,php';
    resetGrammarCache();
    warn = jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'info').mockImplementation();
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cache-'));
  });
  afterEach(() => {
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    jest.restoreAllMocks();
  });

  const run = (extra: object = {}) =>
    new Xray({ path: fixture, cachePath: path.join(cacheDir, 'c.db'), chunked: false, ...extra }).run() as Promise<string>;

  it('maps go and ts symbols, warns once per missing language, and continues', async () => {
    const out = await run();
    expect(out).toContain('Greet');
    expect(out).toContain('Calculator');
    const msgs = warn.mock.calls.map(c => c[0]).filter((m: string) => m.startsWith('skipping'));
    expect(msgs).toEqual(expect.arrayContaining([
      'skipping 1 .py file: grammar not installed — run `xray lang add python`',
      'skipping 1 .java file: grammar not installed — run `xray lang add java`',
    ]));
    expect(msgs).toHaveLength(2);
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
    expect(warn.mock.calls.filter(c => String(c[0]).startsWith('skipping'))).toHaveLength(0);
  });

  it('explicitly requiring a missing grammar fails the run', async () => {
    await expect(run({ languages: ['go', 'python'] })).rejects.toThrow(MissingGrammarError);
  });
});
