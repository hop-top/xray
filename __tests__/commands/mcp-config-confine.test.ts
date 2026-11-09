/**
 * Over MCP, a server-root config's `output` and `paths` cannot take a
 * call outside the root: `output` is replaced by a private temp dir, and
 * `paths` that resolve outside the root are refused (the config's own
 * project is the server root). A `root` or `path` argument is contained
 * as before. Drives the built bin as a stdio MCP server.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');

type Msg = { id?: number; result?: any; error?: unknown };

function startServer(cwd: string, env: NodeJS.ProcessEnv) {
  const proc = spawn(process.execPath, [BIN, 'mcp'], { cwd, env, stdio: 'pipe' });
  let buf = '';
  let id = 1;
  const waiters = new Map<number, (m: Msg) => void>();
  proc.stdout.setEncoding('utf-8').on('data', (d: string) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const m = JSON.parse(line) as Msg;
      if (typeof m.id === 'number') waiters.get(m.id)?.(m);
    }
  });
  const request = (method: string, params?: unknown) =>
    new Promise<Msg>((resolve) => {
      const i = id++;
      waiters.set(i, resolve);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`);
    });
  return {
    async init() {
      await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    },
    call: (name: string, args: Record<string, unknown> = {}) => request('tools/call', { name, arguments: args }),
    close: () =>
      new Promise<void>((resolve) => {
        proc.on('close', () => resolve());
        proc.stdin.end();
      }),
  };
}

const text = (m: Msg): string => (m.result.content as Array<{ text: string }>).map((c) => c.text).join('\n');

describe('xray mcp: server-root config cannot reach outside the root', () => {
  let sandbox: string;
  let env: NodeJS.ProcessEnv;
  let server: ReturnType<typeof startServer>;
  let proj: string;
  let outside: string;
  let cfgout: string;

  beforeAll(async () => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-confine-')));
    const home = path.join(sandbox, 'home');
    fs.mkdirSync(home);
    env = {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      XRAY_LANG_DIR: path.join(home, 'lang'),
      LANG: 'C',
    };
    proj = path.join(sandbox, 'proj');
    outside = path.join(sandbox, 'outside');
    cfgout = path.join(sandbox, 'cfgout');
    for (const d of [path.join(proj, 'src'), path.join(outside, 'src'), cfgout]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(proj, 'src/a.ts'), 'export function insideMarker(): number {\n  return 1;\n}\n');
    fs.writeFileSync(path.join(outside, 'src/s.ts'), 'export function outsideSecret(): number {\n  return 2;\n}\n');
  });

  afterEach(async () => {
    if (server) await server.close();
  });
  afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const serve = async (config: unknown) => {
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify(config));
    server = startServer(proj, env);
    await server.init();
  };

  it('config output outside the root writes nothing there', async () => {
    await serve({ output: '../cfgout/evil.sh' });
    const r = await server.call('map', { 'skip-detect': true, 'no-chunk': true });
    expect(r.result.isError).toBe(false);
    expect(text(r)).toContain('insideMarker');
    expect(fs.readdirSync(cfgout)).toEqual([]);
  }, 120_000);

  it.each(['map', 'graph'])('%s: config paths outside the root are refused, not analyzed', async (tool) => {
    await serve({ paths: [outside] });
    const r = await server.call(tool, { 'skip-detect': true, 'no-chunk': true });
    expect(r.result.isError).toBe(true);
    expect(text(r)).toContain('outside the project');
    expect(text(r)).not.toContain('outsideSecret');
  }, 120_000);

  it('query: building its graph from config paths outside the root is refused', async () => {
    await serve({ paths: [outside] });
    const r = await server.call('query', { query: 'calls(outsideSecret)' });
    expect(r.result.isError).toBe(true);
    expect(text(r)).not.toContain('outsideSecret():');
  }, 120_000);

  it('a call argument still cannot name a path outside the root', async () => {
    await serve({ paths: [outside] });
    const r = await server.call('map', { path: [outside], 'skip-detect': true });
    expect(r.result.isError).toBe(true);
    expect(text(r)).toContain('outside the server root');
    expect(text(r)).not.toContain('outsideSecret');
  }, 120_000);

  it('config inside the root works as before', async () => {
    await serve({ paths: ['src'], output: 'out.txt' });
    const r = await server.call('map', { 'skip-detect': true, 'no-chunk': true });
    expect(r.result.isError).toBe(false);
    expect(text(r)).toContain('insideMarker');
    expect(fs.existsSync(path.join(proj, 'out.txt'))).toBe(false);
  }, 120_000);
});
