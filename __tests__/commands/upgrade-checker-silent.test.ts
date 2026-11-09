/**
 * Behavior test for the real kit upgrade-checker as xray wires it.
 *
 * The repository may be private or have no stable release yet. Any failed or
 * unauthenticated lookup must leave the CLI silent: no notice, no throw.
 * fetch is stubbed; nothing here touches the network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('xray upgrade checker: failed lookups stay silent', () => {
  const realFetch = globalThis.fetch;
  let stateDir: string;
  let requested: string[];
  let tmpSpy: jest.SpyInstance;

  function stubFetch(impl: () => Promise<unknown>) {
    requested = [];
    globalThis.fetch = (async (url: unknown) => {
      requested.push(String(url));
      return impl();
    }) as unknown as typeof fetch;
  }

  async function run(): Promise<string> {
    const { createXrayUpgradeChecker } = require('../../src/upgrade-checker');
    const checker = createXrayUpgradeChecker();
    let out = '';
    await expect(
      checker.notifyIfAvailable({ write: (s: string) => ((out += s), true) }),
    ).resolves.toBeUndefined();
    return out;
  }

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-upgrade-'));
    // The kit caches under os.tmpdir(); isolate it per test. (Jest's
    // process.env is a copy: assigning TMPDIR there never reaches os.)
    tmpSpy = jest.spyOn(require('os'), 'tmpdir').mockReturnValue(stateDir);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    tmpSpy.mockRestore();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('lists hop-top/xray releases (tagged xray/v, prereleases included)', async () => {
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await run();
    expect(requested).toEqual([
      'https://api.github.com/repos/hop-top/xray/releases?per_page=100&page=1',
    ]);
  });

  it.each([
    ['404 (private or unauthenticated)', { ok: false, status: 404 }],
    ['401', { ok: false, status: 401 }],
    ['403 rate limit', { ok: false, status: 403 }],
  ])('%s: no output, no throw', async (_label, res) => {
    stubFetch(async () => ({ ...res, json: async () => ({ message: 'Not Found' }) }));
    expect(await run()).toBe('');
  });

  it('network failure: no output, no throw', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await run()).toBe('');
  });

  it('malformed body: no output, no throw', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }));
    expect(await run()).toBe('');
  });
});
