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
  }) => { notifyIfAvailable: (stream?: NodeJS.WritableStream) => Promise<void> };
};

// Single source of truth: package.json. Hard-coding drifts the moment a
// release bumps the published version.
const { version: XRAY_VERSION } = require('../package.json');

/**
 * Build the upgrade-checker the CLI wires into its startup stream.
 */
export function createXrayUpgradeChecker() {
  return createChecker({
    name: 'xray',
    currentVersion: XRAY_VERSION,
    owner: 'xray-codes',
    repo: 'xray',
  });
}
