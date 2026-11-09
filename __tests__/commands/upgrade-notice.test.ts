/**
 * The upgrade check as xray wires it, against the real kit checker with
 * fetch stubbed (nothing here touches the network).
 *
 * The repo hosts several components, so xray's tags are `xray/v<semver>`
 * and its releases are prereleases while only rc builds exist: a running
 * 0.1.0-rc.0 must hear about xray/v0.1.0-rc.1, and nobody else's tag.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('xray upgrade checker: component tags and prereleases', () => {
  const realFetch = globalThis.fetch;
  let tmpSpy: jest.SpyInstance;
  let stateDir: string;
  let requested: string[];

  function stubReleases(releases: Array<Record<string, unknown>>) {
    requested = [];
    globalThis.fetch = (async (url: unknown) => {
      requested.push(String(url));
      // releases/latest answers with the newest release; the list with all.
      const body = String(url).endsWith('/releases/latest') ? releases[0] : releases;
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch;
  }

  async function notice(runningVersion: string): Promise<string> {
    jest.resetModules();
    jest.doMock('../../package.json', () => ({ version: runningVersion }));
    const { createXrayUpgradeChecker } = require('../../src/upgrade-checker');
    let out = '';
    await createXrayUpgradeChecker().notifyIfAvailable({
      write: (s: string) => ((out += s), true),
    });
    return out;
  }

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-upgrade-notice-'));
    // The kit caches under os.tmpdir(). Jest's process.env is a copy, so
    // setting TMPDIR here would not reach it.
    tmpSpy = jest.spyOn(require('os'), 'tmpdir').mockReturnValue(stateDir);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    tmpSpy.mockRestore();
    jest.dontMock('../../package.json');
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('0.1.0-rc.0 is told about xray/v0.1.0-rc.1 and linked to that release', async () => {
    stubReleases([
      { tag_name: 'xray/v0.1.0-rc.1', prerelease: true, draft: false },
      { tag_name: 'xray/v0.1.0-rc.0', prerelease: true, draft: false },
    ]);
    const out = await notice('0.1.0-rc.0');
    expect(out).toContain('v0.1.0-rc.0 → v0.1.0-rc.1');
    expect(out).toContain('https://github.com/hop-top/xray/releases/tag/xray/v0.1.0-rc.1');
    expect(requested[0]).toBe(
      'https://api.github.com/repos/hop-top/xray/releases?per_page=100&page=1',
    );
  });

  it("other components' tags never notify", async () => {
    stubReleases([
      { tag_name: 'v9.0.0', prerelease: false },
      { tag_name: 'kit/v9.0.0', prerelease: false },
      { tag_name: 'xray-extra/v9.0.0', prerelease: false },
      { tag_name: 'xray/v0.1.0-rc.0', prerelease: true },
    ]);
    expect(await notice('0.1.0-rc.0')).toBe('');
  });

  it('a draft release does not notify', async () => {
    stubReleases([{ tag_name: 'xray/v0.1.0-rc.1', prerelease: true, draft: true }]);
    expect(await notice('0.1.0-rc.0')).toBe('');
  });

  it('the highest xray tag wins over a newer-listed lower one', async () => {
    stubReleases([
      { tag_name: 'kit/v9.0.0' },
      { tag_name: 'xray/v0.1.0-rc.1', prerelease: true },
      { tag_name: 'xray/v0.1.0-rc.2', prerelease: true },
    ]);
    const out = await notice('0.1.0-rc.0');
    expect(out).toContain('v0.1.0-rc.2');
    expect(out).toContain('releases/tag/xray/v0.1.0-rc.2');
  });
});
