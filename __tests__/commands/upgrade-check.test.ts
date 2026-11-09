/**
 * `xray upgrade --check`: is a newer release out? Read-only; there is no
 * install action. Spawns the built CLI with fetch stubbed (nothing reaches
 * the network); `npm run build` first.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');
const STUB = path.resolve(__dirname, '../support/stub-github-releases.js');
const CURRENT: string = require('../../package.json').version;

let tmp: string;

function run(args: string[], stub: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ['--require', STUB, ENTRY, '--no-telemetry', ...args], {
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
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeAll(() => {
  if (!fs.existsSync(ENTRY)) throw new Error('dist missing: run `npm run build` first');
});
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-upgrade-check-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('upgrade without --check', () => {
  it('is a usage error naming --check and the npm install command', () => {
    const r = run(['upgrade']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--check');
    expect(r.stderr).toContain('npm i -g @hop-top/xray');
  });

  it('json: usage envelope on stderr, stdout empty', () => {
    const r = run(['upgrade', '--format', 'json']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(JSON.parse(r.stderr).code).toBe('USAGE');
  });
});

describe('upgrade --check', () => {
  it('newer release: exit 0, says an update is available, once', () => {
    const r = run(['upgrade', '--check'], { STUB_TAG: 'xray/v99.0.0-rc.1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('update available');
    expect(r.stdout).toContain(`v${CURRENT}`);
    expect(r.stdout).toContain('v99.0.0-rc.1');
    // The startup notice would repeat it on stderr.
    expect(r.stderr).not.toContain('A new release');
  });

  it('up to date: exit 0, says so', () => {
    const r = run(['upgrade', '--check'], { STUB_TAG: 'xray/v0.0.1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('up to date');
    expect(r.stdout).not.toContain('update available');
  });

  it('json, newer release', () => {
    const r = run(['upgrade', '--check', '--format', 'json'], { STUB_TAG: 'xray/v99.0.0-rc.1' });
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc).toMatchObject({
      current: CURRENT,
      latest: '99.0.0-rc.1',
      updateAvailable: true,
    });
    expect(doc.url).toContain('xray/v99.0.0-rc.1');
  });

  it('json, up to date', () => {
    const r = run(['upgrade', '--check', '--format', 'json'], { STUB_TAG: 'xray/v0.0.1' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ current: CURRENT, latest: null, updateAvailable: false });
  });

  it.each([['reject'], ['http']])('network failure (%s): exit 6', (mode) => {
    const r = run(['upgrade', '--check'], { STUB_FAIL: mode });
    expect(r.status).toBe(6);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('could not check');
  });

  it('network failure, json: transient envelope on stderr, stdout empty', () => {
    const r = run(['upgrade', '--check', '--format', 'json'], { STUB_FAIL: 'reject' });
    expect(r.status).toBe(6);
    expect(r.stdout).toBe('');
    const env = JSON.parse(r.stderr);
    expect(env).toMatchObject({ code: 'TRANSIENT', exit_code: 6 });
  });

  it('--offline: exit 6 without touching the network', () => {
    const r = run(['--offline', 'upgrade', '--check'], { STUB_FAIL: 'reject' });
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('offline');
  });

  it('a fresh answer every time: a cached older result is not reused', () => {
    expect(run(['upgrade', '--check'], { STUB_TAG: 'xray/v0.0.1' }).stdout).toContain('up to date');
    expect(run(['upgrade', '--check'], { STUB_TAG: 'xray/v99.0.0' }).stdout).toContain('update available');
  });
});
