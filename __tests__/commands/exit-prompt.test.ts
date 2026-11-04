/**
 * Every command exits promptly and prints everything it has to print,
 * whatever the network does.
 *
 * The startup upgrade check is the only network call a run can make. A
 * stub that accepts connections and never answers stands in for a dead
 * network: the check must not hold the process open past its grace, and
 * stdout must still arrive complete (no truncating exit).
 *
 * Built CLI in a subprocess; every `fetch` is redirected (by a preload)
 * to the local stub, so nothing leaves the machine.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');

/** Slack over the grace for a loaded machine; the defect holds for 10s+. */
const EXIT_BOUND_MS = 6_000;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

describe('prompt exit with an unresponsive network', () => {
  let tmp: string;
  let proj: string;
  let home: string;
  let server: net.Server;
  let env: NodeJS.ProcessEnv;
  const sockets = new Set<net.Socket>();

  beforeAll(async () => {
    if (!fs.existsSync(DIST_ENTRY)) throw new Error('dist missing: run `npm run build` first');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-exit-'));
    proj = path.join(tmp, 'proj');
    home = path.join(tmp, 'home');
    fs.mkdirSync(proj);
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(proj, 'a.ts'), 'export function a() { return 1 }\n');

    server = net.createServer((s) => {
      sockets.add(s);
      s.on('data', () => {});
      s.on('error', () => {});
      s.on('close', () => sockets.delete(s));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    const preload = path.join(tmp, 'stub-fetch.js');
    fs.writeFileSync(
      preload,
      `const real = globalThis.fetch;\n` +
      `globalThis.fetch = (u, o) => real('http://127.0.0.1:${port}/', o);\n`
    );
    env = {
      ...process.env,
      HOME: home,
      XDG_CACHE_HOME: path.join(home, 'cache'),
      XDG_CONFIG_HOME: path.join(home, 'config'),
      XDG_DATA_HOME: path.join(home, 'data'),
      XDG_STATE_HOME: path.join(home, 'state'),
      // The upgrade check keeps its cache in the temp dir: isolate it so no
      // fresh cache entry hides the network path.
      TMPDIR: path.join(tmp, 'tmpdir'),
      NODE_OPTIONS: `--require ${preload}`,
    };
    fs.mkdirSync(env.TMPDIR as string);
    delete env.XRAY_NO_TELEMETRY;
    delete env.DO_NOT_TRACK;
  }, 30_000);

  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  function run(args: string[], cwd = proj, extraEnv: NodeJS.ProcessEnv = {}): Promise<Run> {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...env, ...extraEnv } });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf-8').on('data', (d) => { stdout += d; });
      child.stderr.setEncoding('utf-8').on('data', (d) => { stderr += d; });
      const killer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.on('close', (code) => {
        clearTimeout(killer);
        resolve({ code, stdout, stderr, ms: Date.now() - t0 });
      });
    });
  }

  it('human command exits within the bound and prints the same as --offline', async () => {
    const offline = await run(['paths', '--offline']);
    const online = await run(['paths']);
    expect(online.code).toBe(0);
    expect(online.ms).toBeLessThan(EXIT_BOUND_MS);
    expect(online.stdout).toBe(offline.stdout);
  }, 90_000);

  it('large piped output arrives complete', async () => {
    const r = await run(['describe']);
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(EXIT_BOUND_MS);
    // > 64 KiB (pipe buffer): a truncating exit would cut the JSON.
    expect(r.stdout.length).toBeGreaterThan(65_536);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  }, 90_000);

  it('--no-telemetry does not change the bound', async () => {
    const r = await run(['describe', '--no-telemetry']);
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(EXIT_BOUND_MS);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  }, 90_000);

  it('a failing command keeps its exit code', async () => {
    const r = await run(['strategy', 'info', 'no-such-strategy']);
    expect(r.code).not.toBe(0);
    expect(r.ms).toBeLessThan(EXIT_BOUND_MS);
  }, 90_000);
});

describe('map writing a graph format into a fresh directory', () => {
  it('default output succeeds and leaves no strategy detection dir behind', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-map-'));
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-map-xdg-'));
    try {
      fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"x"}\n');
      fs.writeFileSync(path.join(cwd, 'a.ts'), 'export function a() { return 1 }\n');
      const r = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const c = spawn(process.execPath, [BIN, 'map', '--format', 'json', '--offline'], {
          cwd,
          env: { ...process.env, XRAY_NO_TELEMETRY: '1', HOME: xdg, XDG_CACHE_HOME: xdg, XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg },
        });
        let stderr = '';
        c.stderr.setEncoding('utf-8').on('data', (d) => { stderr += d; });
        c.on('close', (code) => resolve({ code, stderr }));
      });
      expect(r.stderr).not.toContain('FileWriteError');
      expect(r.code).toBe(0);
      // The graph goes to its own default file, and detection leaves nothing.
      expect(fs.statSync(path.join(cwd, '.xray.json')).isFile()).toBe(true);
      expect(fs.existsSync(path.join(cwd, '.xray'))).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(xdg, { recursive: true, force: true });
    }
  }, 90_000);
});
