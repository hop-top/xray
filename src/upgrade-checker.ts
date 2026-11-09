/**
 * Upgrade-checker factory wired into the CLI's startup notification.
 *
 * Extracted from src/index.ts so wiring tests can exercise the factory
 * without dragging in commander, telemetry, or tree-sitter via the
 * full command registration chain.
 */
// Use require() because tsconfig moduleResolution is 'node' (legacy), which
// does not honor @hop-top/kit's `exports` map. Runtime resolution does. The
// jest.mock('@hop-top/kit/upgrade', ...) hook still intercepts because Jest
// hooks the module registry by request string, not by static-import path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createChecker } = require('@hop-top/kit/upgrade') as {
  createChecker: (opts: {
    name: string;
    currentVersion: string;
    owner: string;
    repo: string;
    tagPrefix?: string;
    includePrereleases?: boolean;
    cacheTTL?: number;
  }) => { notifyIfAvailable: (stream?: NodeJS.WritableStream) => Promise<void> };
};

// Single source of truth: package.json. Hard-coding drifts the moment a
// release bumps the published version.
const { version: XRAY_VERSION } = require('../package.json');

/**
 * Build the upgrade-checker the CLI wires into its startup stream.
 */
export function createXrayUpgradeChecker(overrides: { cacheTTL?: number } = {}) {
  return createChecker({
    ...overrides,
    name: 'xray',
    currentVersion: XRAY_VERSION,
    owner: 'hop-top',
    repo: 'xray',
    // Tags are `xray/v<semver>`: the repo hosts other components, so
    // releases/latest may name one of theirs. Prereleases stay on while
    // only rc releases exist; drop includePrereleases once a stable ships.
    tagPrefix: 'xray/v',
    includePrereleases: true,
  });
}

/** Outcome of an explicit upgrade check. */
export interface UpgradeCheckResult {
  current: string;
  /** Newest release when it is newer than `current`; null when up to date. */
  latest: string | null;
  /** Release page of `latest`; null when up to date. */
  url: string | null;
  /** True when the release lookup itself failed (network, HTTP error). */
  failed: boolean;
}

/**
 * One uncached release lookup through the same checker the startup notice
 * uses. The kit checker only reports "newer" by writing its notice and
 * swallows every failure, so the notice is read back and the lookup's
 * requests are watched to tell "up to date" from "could not check".
 */
export async function checkForUpgrade(): Promise<UpgradeCheckResult> {
  const realFetch = globalThis.fetch;
  let failed = false;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try {
      const res = await realFetch(...args);
      if (!res.ok) failed = true;
      return res;
    } catch (err) {
      failed = true;
      throw err;
    }
  }) as typeof fetch;
  let notice = '';
  try {
    await createXrayUpgradeChecker({ cacheTTL: 0 }).notifyIfAvailable({
      write: (chunk: string) => ((notice += chunk), true),
    } as unknown as NodeJS.WritableStream);
  } finally {
    globalThis.fetch = realFetch;
  }
  const m = notice.match(/→ v(\S+)\n(\S+)/);
  return { current: XRAY_VERSION, latest: m ? m[1] : null, url: m ? m[2] : null, failed: m ? false : failed };
}
