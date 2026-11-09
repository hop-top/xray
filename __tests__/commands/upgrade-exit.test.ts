/**
 * The built CLI with the upgrade check on and fetch stubbed (preloaded, so
 * nothing reaches the network). A finished command gives the check a short
 * grace (UPGRADE_CHECK_GRACE_MS) and then leaves: a quick answer still
 * prints its notice, a slow or hung one never delays the exit.
 * Spawns the built CLI (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');
const STUB = path.resolve(__dirname, '../support/stub-github-releases.js');
const GRACE_MS = 500;

let tmp: string;

function run(stub: Record<string, string>) {
  const started = Date.now();
  // No --offline: the check runs. --no-telemetry keeps consent out of it.
  const r = spawnSync(process.execPath, ['--require', STUB, ENTRY, '--no-telemetry', 'paths'], {
    cwd: tmp,
    env: {
      PATH: process.env.PATH,
      TMPDIR: tmp,
      HOME: tmp,
      XDG_CONFIG_HOME: path.join(tmp, 'cfg'),
      XDG_CACHE_HOME: path.join(tmp, 'cache'),
      XDG_DATA_HOME: path.join(tmp, 'data'),
      XDG_STATE_HOME: path.join(tmp, 'state'),
      XRAY_NO_TELEMETRY: '1',
      NO_COLOR: '1',
      ...stub,
    },
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
}

beforeAll(() => {
  if (!fs.existsSync(ENTRY)) throw new Error('dist missing: run `npm run build` first');
});

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-upgrade-exit-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('upgrade notice and exit timing', () => {
  // Baseline: the same command with no check, for a fair comparison.
  const baseline = () => {
    const started = Date.now();
    const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', 'paths'], {
      cwd: tmp,
      env: { PATH: process.env.PATH, TMPDIR: tmp, HOME: tmp, XRAY_NO_TELEMETRY: '1', NO_COLOR: '1' },
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return { status: r.status, ms: Date.now() - started };
  };

  it('a quick lookup prints the notice for the release tag, command output intact', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(r.stderr).toContain('→ v99.0.0-rc.1');
    expect(r.stderr).toContain('https://github.com/hop-top/xray/releases/tag/xray/v99.0.0-rc.1');
  });

  it('a tag of another component prints nothing', () => {
    const r = run({ STUB_TAG: 'kit/v99.0.0' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('new release');
  });

  it('a hung lookup is cut at the grace: no notice, exit code kept, no long wait', () => {
    const base = baseline();
    const r = run({ STUB_HANG: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('new release');
    expect(r.ms).toBeLessThan(base.ms + GRACE_MS + 1500);
  });

  it('a listing over several pages is bounded by the grace, not by the page count', () => {
    // 3 pages x 400 ms in sequence = 1200 ms: past the grace, so no notice,
    // and the exit comes at the grace rather than after the last page.
    const base = baseline();
    const r = run({ STUB_PAGES: '3', STUB_DELAY_MS: '400' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('new release');
    expect(r.ms).toBeLessThan(base.ms + GRACE_MS + 1500);
  });

  it('a multi-page listing that settles inside the grace still notifies', () => {
    const r = run({ STUB_PAGES: '3', STUB_DELAY_MS: '40' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('releases/tag/xray/v99.0.0-rc.1');
  });
});
