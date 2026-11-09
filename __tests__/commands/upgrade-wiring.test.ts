/**
 * Wiring test for the kit upgrade-checker.
 *
 * `src/upgrade-checker.ts` exports `createXrayUpgradeChecker()`, which
 * must construct a checker with the expected `name`/`owner`/`repo`/
 * `currentVersion` so end-of-flow upgrade notices target the correct
 * GitHub release. The factory lives in its own module so this test
 * does not transitively load commander / tree-sitter / telemetry.
 */

const notifyIfAvailable = jest.fn().mockResolvedValue(undefined);
const createChecker = jest.fn().mockReturnValue({ notifyIfAvailable });

jest.mock('@hop-top/kit/upgrade', () => ({
  createChecker: (...args: unknown[]) => createChecker(...args),
}));

describe('upgrade wiring', () => {
  beforeEach(() => {
    createChecker.mockClear();
    notifyIfAvailable.mockClear();
    jest.resetModules();
  });

  it('createXrayUpgradeChecker constructs a checker with xray-specific options', () => {
    const { createXrayUpgradeChecker } = require('../../src/upgrade-checker');

    createChecker.mockClear();
    createXrayUpgradeChecker();

    expect(createChecker).toHaveBeenCalledTimes(1);
    const opts = createChecker.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).toMatchObject({
      name: 'xray',
      owner: 'hop-top',
      repo: 'xray',
      tagPrefix: 'xray/v',
      includePrereleases: true,
    });
    expect(typeof opts.currentVersion).toBe('string');
    expect((opts.currentVersion as string).length).toBeGreaterThan(0);
  });

  it('currentVersion matches package.json version', () => {
    const { createXrayUpgradeChecker } = require('../../src/upgrade-checker');
    const pkg = require('../../package.json');

    createChecker.mockClear();
    createXrayUpgradeChecker();

    const opts = createChecker.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.currentVersion).toBe(pkg.version);
  });
});
