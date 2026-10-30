/**
 * `xray mcp` end to end: the built bin as a stdio MCP server, driven by
 * a minimal newline-delimited JSON-RPC client.
 *
 * Covers initialize, tools/list (read-only set, derived schemas),
 * explore + query + map on a fixture repo, error mapping (JSON-RPC
 * errors vs isError tool results), root containment, and stdout
 * cleanliness (every byte on stdout is a protocol message).
 */
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const FIXTURE = path.join(ROOT, '__tests__', 'fixtures', 'plumbing');

type Msg = { jsonrpc: string; id?: number; result?: any; error?: { code: number; message: string } };

/** Minimal stdio MCP client: one JSON-RPC message per line. */
class StdioClient {
  private nextId = 1;
  private buf = '';
  private waiters = new Map<number, (m: Msg) => void>();
  readonly lines: string[] = [];
  stderr = '';
  readonly closed: Promise<number | null>;

  constructor(readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding('utf-8').on('data', (d: string) => {
      this.buf += d;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        this.lines.push(line);
        const msg = JSON.parse(line) as Msg; // non-JSON stdout fails the suite
        if (typeof msg.id === 'number') this.waiters.get(msg.id)?.(msg);
      }
    });
    proc.stderr.setEncoding('utf-8').on('data', (d: string) => (this.stderr += d));
    this.closed = new Promise((resolve) => proc.on('close', resolve));
  }

  get trailing(): string {
    return this.buf;
  }

  request(method: string, params?: unknown): Promise<Msg> {
    const id = this.nextId++;
    const p = new Promise<Msg>((resolve) => this.waiters.set(id, resolve));
    this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    return p;
  }

  notify(method: string): void {
    this.send({ jsonrpc: '2.0', method });
  }

  call(name: string, args: Record<string, unknown> = {}): Promise<Msg> {
    return this.request('tools/call', { name, arguments: args });
  }

  send(obj: unknown): void {
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  async close(): Promise<number | null> {
    this.proc.stdin.end();
    return this.closed;
  }
}

let sandbox: string;
let repo: string;
let env: NodeJS.ProcessEnv;

function startServer(cwd: string, extra: string[] = []): StdioClient {
  const proc = spawn(process.execPath, [BIN, ...extra, 'mcp'], { cwd, env, stdio: 'pipe' });
  return new StdioClient(proc);
}

const text = (m: Msg) => (m.result.content as Array<{ text: string }>).map((c) => c.text).join('\n');

beforeAll(() => {
  if (!fs.existsSync(DIST_ENTRY)) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}${r.stderr}`);
  }
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-mcp-')));
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(home, { recursive: true });
  env = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    LANG: 'C',
  };
  repo = path.join(sandbox, 'repo');
  fs.cpSync(FIXTURE, repo, { recursive: true });
  fs.mkdirSync(path.join(repo, 'sub'));
  fs.writeFileSync(path.join(repo, 'sub', 'd.ts'), 'export function delta(): number {\n  return 4;\n}\n');
  spawnSync('git', ['init', '-q'], { cwd: repo, env });
}, 300_000);

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('xray mcp over stdio', () => {
  let client: StdioClient;

  beforeAll(() => {
    client = startServer(repo);
  });

  afterAll(async () => {
    if (client) await client.close();
  });

  it('initializes as xray on 2024-11-05', async () => {
    const r = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(r.result).toEqual({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'xray', version: require('../../package.json').version },
    });
    client.notify('notifications/initialized');
  });

  it('answers ping', async () => {
    expect((await client.request('ping')).result).toEqual({});
  });

  it('lists only read-only tools with schemas derived from the command tree', async () => {
    const r = await client.request('tools/list');
    const tools = r.result.tools as Array<{ name: string; inputSchema: any }>;
    const names = tools.map((t) => t.name);
    for (const n of ['map', 'scan', 'graph', 'explore', 'query', 'strategy_list', 'strategy_detect', 'react_hooks', 'markdown_toc']) {
      expect(names).toContain(n);
    }
    for (const n of ['cache_clear', 'alias_set', 'alias_remove', 'strategy_create', 'strategy_install', 'strategy_remove', 'lang_add', 'mcp', 'describe', 'completion']) {
      expect(names).not.toContain(n);
    }
    expect(names.every((n) => /^[A-Za-z0-9_-]+$/.test(n))).toBe(true);

    const explore = tools.find((t) => t.name === 'explore')!.inputSchema;
    expect(explore.properties.query.type).toBe('string');
    expect(explore.properties.search).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(explore.properties.root.type).toBe('string');
    const map = tools.find((t) => t.name === 'map')!.inputSchema;
    expect(map.properties.output).toBeUndefined();
    expect(map.properties.share).toBeUndefined();
    expect(map.properties.preset).toBeUndefined();
    expect(map.properties['no-chunk'].type).toBe('boolean');
    const goCli = tools.find((t) => t.name === 'go-cli_commands')!.inputSchema;
    expect(goCli.properties['exec-binary']).toBeUndefined();
  });

  it('calls explore', async () => {
    const r = await client.call('explore', { search: ['alpha'], format: 'json' });
    expect(r.result.isError).toBe(false);
    const rows = JSON.parse(r.result.content[0].text);
    expect(rows.map((x: any) => path.relative(repo, x.file)).sort()).toEqual(['a.ts', 'b.ts', 'b.ts', 'imports/a.ts']);
  }, 60_000);

  it('calls explore in a sub-root', async () => {
    const r = await client.call('explore', { search: ['delta'], format: 'json', root: 'sub' });
    expect(r.result.isError).toBe(false);
    const rows = JSON.parse(r.result.content[0].text);
    expect(rows.map((x: any) => x.file)).toEqual([path.join(repo, 'sub', 'd.ts')]);
  }, 60_000);

  it('calls query, building the graph when none is given', async () => {
    const r = await client.call('query', { query: 'callers(alpha)', format: 'json' });
    expect(r.result.isError).toBe(false);
    const res = JSON.parse(r.result.content[0].text);
    expect(res.nodes.map((n: any) => n.name)).toContain('beta');
  }, 120_000);

  it('returns map output as content without writing it into the project', async () => {
    const r = await client.call('map', { 'skip-detect': true, 'no-chunk': true, txt: true });
    expect(r.result.isError).toBe(false);
    expect(text(r)).toContain('alpha');
    expect(fs.existsSync(path.join(repo, '.xray.txt'))).toBe(false);
    expect(fs.readdirSync(repo).filter((f) => f.startsWith('.xray') && f !== '.xray' && f !== '.xray_cache.db')).toEqual([]);
  }, 120_000);

  it('maps command failures to isError results with stderr', async () => {
    const r = await client.call('query', { query: 'calls(x)', graph: 'missing.json' });
    expect(r.result.isError).toBe(true);
    expect(text(r)).toMatch(/Graph file not found/);
  }, 60_000);

  it.each([
    [{ root: '..' }, /outside the server root/],
    [{ path: ['/'] }, /outside the server root/],
    [{ bogus: true }, /unknown argument "bogus"/],
    [{ stats: 'yes' }, /must be a boolean/],
  ])('rejects bad arguments %j as tool errors', async (args, msg) => {
    const r = await client.call('explore', args);
    expect(r.error).toBeUndefined();
    expect(r.result.isError).toBe(true);
    expect(text(r)).toMatch(msg);
  });

  it('rejects unknown and hidden tools as JSON-RPC errors', async () => {
    for (const name of ['nope', 'cache_clear', 'cache.clear']) {
      const r = await client.call(name);
      expect(r.error?.code).toBe(-32602);
    }
    expect((await client.request('resources/list')).error?.code).toBe(-32601);
  });

  it('keeps stdout protocol-only and writes no consent config', async () => {
    const code = await client.close();
    expect(code).toBe(0);
    expect(client.trailing).toBe('');
    expect(client.lines.length).toBeGreaterThan(0);
    for (const line of client.lines) {
      const m = JSON.parse(line);
      expect(m.jsonrpc).toBe('2.0');
      expect(typeof m.id).toBe('number'); // no reply to the notification
    }
    expect(fs.existsSync(path.join(repo, '.xrayrc.json'))).toBe(false);
  });
});

describe('xray mcp startup', () => {
  it('-C serves the given directory', async () => {
    const client = startServer(sandbox, ['-C', 'repo']);
    const r = await client.call('explore', { search: ['delta'], format: 'json' });
    expect(JSON.parse(r.result.content[0].text).map((x: any) => x.file)).toEqual([path.join(repo, 'sub', 'd.ts')]);
    expect(await client.close()).toBe(0);
  }, 60_000);

  it('answers malformed JSON with a parse error', async () => {
    const client = startServer(repo);
    client.proc.stdin.write('{not json\n');
    client.proc.stdin.end();
    expect(await client.closed).toBe(0);
    expect(JSON.parse(client.lines[0]).error.code).toBe(-32700);
  });

  it('rejects a bad --timeout as a usage error', () => {
    const r = spawnSync(process.execPath, [BIN, 'mcp', '--timeout', '0'], { cwd: repo, env, encoding: 'utf-8', input: '' });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/invalid --timeout/);
  });
});
