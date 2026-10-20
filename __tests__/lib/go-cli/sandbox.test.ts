// Real OS-sandbox behavior. Skipped where no sandbox tool exists.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import GoCliStrategy from '../../../strategies/go-cli';
import { StrategyContextImpl } from '../../../src/lib/strategy/context';
import { detectSandbox, obtainToolspec } from '../../../src/lib/strategy/go-cli/binary';

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
    expect(r.write).not.toBe('0');
    expect(r.home).not.toBe('0');
    expect(hits).toBe(0);
    expect(fs.existsSync(escape)).toBe(false);
  });

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
