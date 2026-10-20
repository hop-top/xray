import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StrategyLoader } from '../../src/lib/strategy/loader';
import { Logger } from '../../src/lib/logger';
import { resetGrammarCache } from '../../src/lib/parser/grammars';

describe('strategies declaring requiresLanguages', () => {
  let file: string;
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-strat-'));
    file = path.join(dir, 'needs-kotlin.js');
    fs.writeFileSync(file, `module.exports = { name: 'needs-kotlin', version: '1', requiresLanguages: ['kotlin'], detect: () => true, analyze: async () => ({ tags: [] }) };`);
    resetGrammarCache();
  });
  afterEach(() => {
    delete process.env.XRAY_LANG_BLOCK;
    resetGrammarCache();
    jest.restoreAllMocks();
  });

  it('is not detected, with one warning, when the grammar is missing', async () => {
    process.env.XRAY_LANG_BLOCK = 'kotlin';
    const warn = jest.spyOn(Logger, 'warn').mockImplementation();
    const s = await new StrategyLoader().loadStrategy(file);
    expect(await s.detect({} as any)).toBe(false);
    expect(await s.detect({} as any)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('xray lang add kotlin');
  });

  it('is detected normally when the grammar is present', async () => {
    const s = await new StrategyLoader().loadStrategy(file);
    expect(await s.detect({} as any)).toBe(true);
  });
});
