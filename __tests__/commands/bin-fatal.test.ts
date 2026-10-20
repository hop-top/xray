/**
 * bin/xray must not leak an unhandled rejection when main() rejects before
 * commander parsing. CodedError -> its exitCode; anything else -> EXIT_GENERIC.
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const PRELOAD = path.join(ROOT, '__tests__', 'fixtures', 'preload-reject-early.js');

function run(mode: string) {
  return spawnSync(process.execPath, ['-r', PRELOAD, BIN, '--version'], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', XRAY_TEST_REJECT: mode },
    timeout: 60_000,
  });
}

describe('bin/xray fatal handling', () => {
  test('plain Error before parse -> exit 1, concise message, no unhandled rejection', () => {
    const r = run('plain');
    expect(r.stderr).not.toMatch(/UnhandledPromiseRejection|unhandled|Node\.js v\d+/i);
    expect(r.stderr).toContain('boom-plain');
    expect(r.status).toBe(1);
  });

  test('CodedError before parse -> its exitCode (usage = 2)', () => {
    const r = run('coded');
    expect(r.stderr).not.toMatch(/UnhandledPromiseRejection|unhandled|Node\.js v\d+/i);
    expect(r.stderr).toContain('boom-coded');
    expect(r.status).toBe(2);
  });
});
