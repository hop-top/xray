// Real OS-sandbox behavior. Skipped where no sandbox tool exists.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import GoCliStrategy from '../../../strategies/go-cli';
import { StrategyContextImpl } from '../../../src/lib/strategy/context';
import { detectSandbox, obtainToolspec, runProcess, sandboxProfile, wrapSandbox } from '../../../src/lib/strategy/go-cli/binary';

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'go-cli');
const sandbox = detectSandbox();
const d = sandbox ? describe : describe.skip;
const haveGo = spawnSync('go', ['version']).status === 0;

d('OS sandbox confines an executed CLI', () => {
  let server: http.Server;
  let hits = 0;
  let port = 0;
  let tmp: string;
  let escape: string;
  let script: string;
  const home = fs.realpathSync(os.homedir());

  beforeAll(async () => {
    server = http.createServer((_q, res) => {
      hits++;
      res.end('ok');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    port = (server.address() as any).port;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-sbx-'));
    escape = path.join(os.tmpdir(), `gocli-escape-${process.pid}`);
    script = path.join(tmp, 'fakecli');
    // Reports what the process managed to do inside the manifest `short`.
    fs.writeFileSync(
      script,
      `#!/bin/sh
curl -s -m 3 http://127.0.0.1:${port}/ >/dev/null 2>&1; net=$?
touch "${escape}" 2>/dev/null; wr=$?
ls "${home}" >/dev/null 2>&1; hm=$?
printf '{"tool":"fake","version":"1","schema_version":"1.0","commands":[{"path":["fake","probe"],"short":"net=%s write=%s home=%s"}]}' "$net" "$wr" "$hm"
`,
      { mode: 0o755 }
    );
  });
  afterAll(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(escape, { force: true });
  });
  beforeEach(() => {
    hits = 0;
    fs.rmSync(escape, { force: true });
  });

  const probe = async (sb: any) => {
    const out = await obtainToolspec('/nonexistent', { binary: script, sandbox: sb, unsafeNoSandbox: true });
    expect(out.reason).toBeUndefined();
    const short = out.report!.commands.find(c => c.path.join(' ') === 'fake probe')!.short!;
    return Object.fromEntries(short.split(' ').map(kv => kv.split('=')));
  };

  it('control: unsandboxed, the same binary reaches the network, writes and reads home', async () => {
    const r = await probe(null);
    expect(r).toEqual({ net: '0', write: '0', home: '0' });
    expect(hits).toBe(1);
    expect(fs.existsSync(escape)).toBe(true);
  });

  it('sandboxed: no network, no writes outside the private dir, no home reads', async () => {
    const r = await probe(sandbox);
    expect(r.net).not.toBe('0');
    // bwrap gives the sandbox a private, writable tmpfs /tmp: the touch succeeds
    // inside it by design and never reaches the host (asserted below via
    // `escape`). sandbox-exec has no mount namespace, so there it must fail.
    if (sandbox !== 'bwrap') expect(r.write).not.toBe('0');
    expect(r.home).not.toBe('0');
    expect(hits).toBe(0);
    expect(fs.existsSync(escape)).toBe(false);
  });

  (haveGo ? it : it.skip)('sandboxed build matches a plain go build (cgo-tagged files, C toolchain)', async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-plain-'));
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GOROOT;
    delete env.GOBIN;
    const plain = spawnSync('go', ['build', '-o', path.join(plainDir, 'bin'), '.'], {
      cwd: path.join(FIX, 'cgopair'),
      env,
    });
    expect(plain.status).toBe(0);
    const plainOut = spawnSync(path.join(plainDir, 'bin'), ['spec']).stdout.toString();
    fs.rmSync(plainDir, { recursive: true, force: true });

    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-cache-'));
    const out = await obtainToolspec(path.join(FIX, 'cgopair'), { execBinary: true, allowCgo: true, cacheDir, buildTimeoutMs: 240_000 });
    fs.rmSync(cacheDir, { recursive: true, force: true });
    expect(out.reason).toBeUndefined();
    const short = out.report!.commands.find(c => c.path.join(' ') === 'cgopair probe')!.short;
    expect(short).toBe('cgo:3');
    expect(JSON.parse(plainOut).commands[0].short).toBe(short);
  }, 300_000);

  (haveGo ? it : it.skip)('cgo off by default: cgo-only fixture fails with the --allow-cgo hint', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-cache-'));
    const out = await obtainToolspec(path.join(FIX, 'cgopair'), { execBinary: true, cacheDir });
    fs.rmSync(cacheDir, { recursive: true, force: true });
    expect(out.report).toBeUndefined();
    expect(out.reason).toContain('build needs cgo; rerun with --allow-cgo');
  }, 300_000);

  it('build step cannot read the home directory (sentinel in a fake HOME)', async () => {
    const fakeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-fakehome-')));
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-work-')));
    const sentinel = path.join(fakeHome, 'secret.txt');
    fs.writeFileSync(sentinel, 'TOP-SECRET');
    const readIt = async (readAllow: string[]) => {
      const w = wrapSandbox(sandbox!, 'build', { work, home: fakeHome, cmd: '/bin/cat', args: [sentinel], readAllow });
      return runProcess(w.cmd, w.args, { cwd: work, env: { PATH: '/usr/bin:/bin' }, timeoutMs: 10_000 });
    };
    const denied = await readIt([]);
    expect(denied.stdout).not.toContain('TOP-SECRET');
    expect(denied.code).not.toBe(0);
    // explicit allow works (proves the denial above is the profile, not a broken probe)
    const allowed = await readIt([fakeHome]);
    expect(allowed.stdout).toContain('TOP-SECRET');
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  (haveGo ? it : it.skip)('second run reuses the persistent build cache', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-cache-'));
    const t0 = Date.now();
    const a = await obtainToolspec(path.join(FIX, 'stdspec'), { execBinary: true, cacheDir });
    const first = Date.now() - t0;
    const t1 = Date.now();
    const b = await obtainToolspec(path.join(FIX, 'stdspec'), { execBinary: true, cacheDir });
    const second = Date.now() - t1;
    expect(a.report && b.report).toBeTruthy();
    expect(fs.readdirSync(cacheDir).length).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }, 300_000);

  (haveGo ? it : it.skip)('builds and runs a real Go CLI under --exec-binary', async () => {
    const s = new GoCliStrategy();
    const out = JSON.parse(
      await s.commands.commands.handler(new StrategyContextImpl(path.join(FIX, 'stdspec')), {
        format: 'json',
        execBinary: true,
      })
    );
    expect(out.source).toBe('toolspec');
    expect(out.commands.map((c: any) => c.path.join(' '))).toContain('demo item purge');
  }, 300_000);
});

// wrapSandbox('bwrap') is pure argument construction: checked on every OS.
describe('bwrap argument order', () => {
  it('private /tmp and /home are mounted before binds that live under them', () => {
    const dir = fs.mkdtempSync('/tmp/xray-bwrap-order-');
    try {
      const { args } = wrapSandbox('bwrap', 'build', {
        work: dir,
        home: '/home/nobody',
        cmd: 'go',
        args: ['build'],
        readAllow: [dir],
      });
      const tmpfsAt = (mp: string) => args.findIndex((a, i) => a === '--tmpfs' && args[i + 1] === mp);
      const bindAt = args.findIndex((a, i) => a === '--ro-bind' && args[i + 1] === dir);
      expect(tmpfsAt('/tmp')).toBeGreaterThanOrEqual(0);
      expect(tmpfsAt('/home')).toBeGreaterThanOrEqual(0);
      expect(bindAt).toBeGreaterThan(tmpfsAt('/tmp'));
      expect(bindAt).toBeGreaterThan(tmpfsAt('/home'));
      expect(args.findIndex((a, i) => a === '--bind' && args[i + 1] === dir)).toBeGreaterThan(tmpfsAt('/tmp'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('macOS profile: no write to the shared xcrun cache', () => {
  it('never allows writes under /var/folders (the cgo build keeps its xcrun cache in private tmp)', () => {
    const profile = sandboxProfile({ work: '/w', home: '/h', readDenyHome: true });
    expect(profile).not.toContain('xcrun_db');
    expect(profile).not.toMatch(/file-write[^\n]*var\/folders/);
  });
});
