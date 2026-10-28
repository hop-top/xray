/**
 * Startup diagnostics (e.g. "Using config file") are verbose-only and go to
 * stderr; default runs print only the command's own output.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1' },
    timeout: 60_000,
  });
}

describe('startup diagnostics', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-diag-'));
    fs.writeFileSync(path.join(tmp, '.xrayrc.json'), '{}');
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('default: stdout is pure JSON, no config-file line on either stream', () => {
    const r = run(['describe', '--format', 'json'], tmp);
    expect(r.status).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout).not.toContain('Using config file');
    expect(r.stderr).not.toContain('Using config file');
  });

  test('default (human output): no config-file line', () => {
    const r = run(['paths'], tmp);
    expect(r.stdout + r.stderr).not.toContain('Using config file');
  });

  test('--verbose: line appears on stderr, stdout stays JSON', () => {
    const r = run(['--log-level', 'debug', 'describe', '--format', 'json'], tmp);
    expect(r.stderr).toContain('Using config file');
    expect(r.stdout).not.toContain('Using config file');
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  test('bare -V also enables it', () => {
    const r = run(['-V', 'describe', '--format', 'json'], tmp);
    expect(r.stderr).toContain('Using config file');
  });
});
