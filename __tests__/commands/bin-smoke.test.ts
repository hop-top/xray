/**
 * Smoke test — `bin/xray` must actually run the CLI under the current Node.
 *
 * Guards two regressions:
 *  - bin entry requiring dist/index.js without invoking main() (silent
 *    exit 0, no output);
 *  - native deps (better-sqlite3, tree-sitter + grammars) failing to load
 *    on the running Node major.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1' },
    timeout: 90_000,
  });
}

describe('bin/xray smoke', () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(DIST_ENTRY)) {
      const tsc = require.resolve('typescript/bin/tsc');
      const r = spawnSync(process.execPath, [tsc], { cwd: ROOT, encoding: 'utf-8' });
      if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`);
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-smoke-'));
    fs.writeFileSync(
      path.join(tmp, 'a.ts'),
      'export function hello() { return 1 }\nexport class A { m() { return hello() } }\n'
    );
    fs.writeFileSync(path.join(tmp, 'b.py'), 'def f():\n  return 2\n');
  }, 120_000);

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('--version prints the package version', () => {
    const pkg = require('../../package.json');
    const r = run(['--version'], tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(pkg.version);
  }, 90_000);

  it('--help lists commands', () => {
    const r = run(['--help'], tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: xray');
    expect(r.stdout).toContain('map');
  }, 90_000);

  it('map parses a small fixture (tree-sitter + sqlite cache load)', () => {
    const out = path.join(tmp, 'out');
    const r = run(['map', '-p', tmp, '-o', out, '--txt'], tmp);
    expect(r.status).toBe(0);
    const rootChunk = fs.readFileSync(`${out}_root.txt`, 'utf-8');
    expect(rootChunk).toContain('function hello()');
    expect(rootChunk).toContain('function f()');
  }, 90_000);
});
