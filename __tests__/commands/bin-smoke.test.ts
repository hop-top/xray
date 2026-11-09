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

// Every spawn runs `--offline` (the startup upgrade check would otherwise
// reach the GitHub API) and with its dirs redirected, so nothing lands in the
// developer's real cache, state, config or temp dirs.
let sandbox: string;
let netLog: string;
let netGuardFile: string;

// Preload for every spawn: logs any attempt to resolve or connect to a host.
const NET_GUARD = `
const fs = require('fs'), net = require('net'), dns = require('dns');
const log = (what) => fs.appendFileSync(process.env.XRAY_TEST_NET_LOG, what + '\\n');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const o = a[0];
  if (!(o && typeof o === 'object' && o.path) && typeof o !== 'string') log('connect ' + JSON.stringify(o));
  return connect.apply(this, a);
};
const lookup = dns.lookup;
dns.lookup = function (host, ...a) { log('lookup ' + host); return lookup.call(this, host, ...a); };
`;

function isolatedEnv(base: string): NodeJS.ProcessEnv {
  fs.mkdirSync(path.join(base, 'tmp'), { recursive: true });
  return {
    ...process.env,
    XRAY_NO_TELEMETRY: '1',
    HOME: base,
    TMPDIR: path.join(base, 'tmp'),
    XRAY_TEST_NET_LOG: netLog,
    XDG_CACHE_HOME: path.join(base, 'cache'),
    XDG_STATE_HOME: path.join(base, 'state'),
    XDG_CONFIG_HOME: path.join(base, 'config'),
    XDG_DATA_HOME: path.join(base, 'data'),
  };
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, ['-r', netGuardFile, BIN, '--offline', ...args], {
    cwd,
    encoding: 'utf-8',
    env: isolatedEnv(sandbox),
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
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-smoke-env-'));
    netLog = path.join(sandbox, 'net.log');
    netGuardFile = path.join(sandbox, 'net-guard.js');
    fs.writeFileSync(netGuardFile, NET_GUARD);
    fs.writeFileSync(
      path.join(tmp, 'a.ts'),
      'export function hello() { return 1 }\nexport class A { m() { return hello() } }\n'
    );
    fs.writeFileSync(path.join(tmp, 'b.py'), 'def f():\n  return 2\n');
  }, 120_000);

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
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

  it('read-only commands leave the cwd untouched', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-ro-'));
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-ro-xdg-'));
    try {
      fs.writeFileSync(path.join(cwd, 'a.ts'), 'export const a = 1;\n');
      for (const args of [['describe'], ['--help'], ['describe', '--help']]) {
        const r = spawnSync(process.execPath, ['-r', netGuardFile, BIN, '--offline', ...args], {
          cwd,
          encoding: 'utf-8',
          env: isolatedEnv(xdg),
          timeout: 90_000,
        });
        expect(r.status).toBe(0);
        expect(fs.readdirSync(cwd)).toEqual(['a.ts']);
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(xdg, { recursive: true, force: true });
    }
  }, 120_000);

  it('no run in this file reached the network (the startup upgrade check is off)', () => {
    expect(fs.existsSync(netLog) ? fs.readFileSync(netLog, 'utf-8') : '').toBe('');
  });
});
