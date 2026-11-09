/**
 * `xray mcp` end to end: the built bin as a stdio MCP server, driven by
 * a minimal newline-delimited JSON-RPC client.
 *
 * Covers initialize, tools/list (read-only set, derived schemas),
 * explore + query + map on a fixture repo, error mapping (JSON-RPC
 * errors vs isError tool results), root and path containment, the trust
 * boundary (project code only from the server root), and stdout
 * cleanliness (every byte on stdout is a protocol message).
 */
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'child_process';
import * as http from 'http';
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

function startServer(cwd: string, extra: string[] = [], serverEnv: NodeJS.ProcessEnv = {}): StdioClient {
  const proc = spawn(process.execPath, [BIN, ...extra, 'mcp'], { cwd, env: { ...env, ...serverEnv }, stdio: 'pipe' });
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
    const tools = r.result.tools as Array<{ name: string; description?: string; inputSchema: any }>;
    const names = tools.map((t) => t.name);
    for (const n of ['map', 'graph', 'explore', 'query', 'impact', 'strategy_list', 'strategy_detect', 'react_hooks', 'markdown_toc']) {
      expect(names).toContain(n);
    }
    for (const n of ['scan', 'cache_clear', 'alias_set', 'alias_remove', 'strategy_create', 'strategy_install', 'strategy_remove', 'build_exec', 'lang_add', 'mcp', 'describe', 'completion']) {
      expect(names).not.toContain(n);
    }
    expect(names.every((n) => /^[A-Za-z0-9_-]+$/.test(n))).toBe(true);

    const explore = tools.find((t) => t.name === 'explore')!.inputSchema;
    expect(explore.properties.query).toBeUndefined();
    expect(explore.properties.search).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(explore.properties.root.type).toBe('string');
    const map = tools.find((t) => t.name === 'map')!.inputSchema;
    expect(map.properties.output).toBeUndefined();
    expect(map.properties.share).toBeUndefined();
    expect(map.properties.preset).toBeUndefined();
    expect(map.properties['no-chunk'].type).toBe('boolean');
    expect(map.properties.query).toMatchObject({ type: 'array', items: { type: 'string' } });
    const goCli = tools.find((t) => t.name === 'go-cli_commands')!.inputSchema;
    for (const f of ['exec-binary', 'binary', 'unsafe-no-sandbox', 'allow-cgo']) expect(goCli.properties[f]).toBeUndefined();
    expect(tools.find((t) => t.name === 'config-files_values')!.inputSchema.properties['show-secrets']).toBeUndefined();
    expect(tools.find((t) => t.name === 'config-files_keys')!.inputSchema.properties.file.type).toBe('string');
    expect(tools.find((t) => t.name === 'strategy_list')!.inputSchema.properties.root).toBeUndefined();
    const impact = tools.find((t) => t.name === 'impact')!;
    expect(Object.keys(impact.inputSchema.properties).sort()).toEqual(['depth', 'format', 'lens', 'root', 'scope', 'strict', 'symbol']);
    expect(impact.inputSchema.required).toEqual(['symbol']);
    expect(impact.inputSchema.properties.strict.type).toBe('boolean');
    expect(impact.description).toMatch(/what breaks/i);
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

  it('calls impact in the server root, text and json', async () => {
    const j = await client.call('impact', { symbol: 'alpha', format: 'json' });
    expect(j.result.isError).toBe(false);
    const res = JSON.parse(j.result.content[0].text);
    expect(res.symbol.query).toBe('alpha');
    expect(res.nodes.map((n: any) => n.name).sort()).toEqual(['beta', 'gamma']);
    const t = await client.call('impact', { symbol: 'alpha', depth: '1' });
    expect(t.result.isError).toBe(false);
    expect(text(t)).toContain('beta');
    expect(text(t)).not.toContain('gamma');
  }, 120_000);

  it('rejects impact graph (server root only)', async () => {
    const r = await client.call('impact', { symbol: 'alpha', graph: 'g.json' });
    expect(r.error).toBeUndefined();
    expect(r.result.isError).toBe(true);
    expect(text(r)).toMatch(/unknown argument "graph"/);
  });

  it.each(['map', 'graph'])('%s offers no positional paths: only the contained path option', async name => {
    const r = await client.request('tools/list');
    const tool = (r.result.tools as Array<{ name: string; inputSchema: any }>).find(t => t.name === name)!;
    expect(tool.inputSchema.properties.paths).toBeUndefined();
    expect(tool.inputSchema.properties.path).toBeDefined();
  });

  it('lists imports: paths positional, path/lang/format, root', async () => {
    const r = await client.request('tools/list');
    const imports = (r.result.tools as Array<{ name: string; description?: string; inputSchema: any }>).find((t) => t.name === 'imports')!;
    expect(Object.keys(imports.inputSchema.properties).sort()).toEqual(['format', 'lang', 'no-ignore', 'path', 'paths', 'root']);
    expect(imports.inputSchema.properties.paths).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(imports.description).toMatch(/xray\.imports\/v1/);
  });

  it('calls imports: the CLI document, narrowed by contained paths', async () => {
    const r = await client.call('imports', { format: 'json' });
    expect(r.result.isError).toBe(false);
    const cli = spawnSync(process.execPath, [BIN, 'imports', '--format', 'json'], { cwd: repo, env, encoding: 'utf-8' });
    expect(cli.status).toBe(0);
    expect(JSON.parse(text(r))).toEqual(JSON.parse(cli.stdout));
    const doc = JSON.parse(text(r));
    expect(doc.schema).toBe('xray.imports/v1');
    expect(doc.files.map((f: any) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts', 'imports/a.ts', 'imports/b.ts', 'imports/c.ts', 'sub/d.ts']);
    const sub = await client.call('imports', { paths: ['sub'], lang: ['ts'] });
    expect(sub.result.isError).toBe(false);
    expect(JSON.parse(text(sub)).files.map((f: any) => f.path)).toEqual(['sub/d.ts']);
  }, 60_000);

  it.each([[['..']], [['/']], [['sub', '../..']]])('rejects imports paths %j outside the server root', async (paths) => {
    const r = await client.call('imports', { paths });
    expect(r.error).toBeUndefined();
    expect(r.result.isError).toBe(true);
    expect(text(r)).toMatch(/paths "[^"]*" is outside the server root/);
  });

  it('returns map output as content without writing it into the project', async () => {
    const r = await client.call('map', { 'skip-detect': true, 'no-chunk': true, txt: true });
    expect(r.result.isError).toBe(false);
    expect(text(r)).toContain('alpha');
    expect(fs.existsSync(path.join(repo, '.xray.txt'))).toBe(false);
    expect(fs.readdirSync(repo).filter((f) => f.startsWith('.xray') && f !== '.xray')).toEqual([]);
  }, 120_000);

  it('map honors match: only matching files are mapped', async () => {
    const r = await client.call('map', { 'skip-detect': true, 'no-chunk': true, txt: true, match: ['sub/**'] });
    expect(r.result.isError).toBe(false);
    expect(text(r)).toContain('delta');
    expect(text(r)).not.toContain('alpha');
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

describe('xray mcp trust boundary', () => {
  let proj: string;
  let markers: string;
  let outside: string;
  let client: StdioClient;
  let httpServer: http.Server;
  let port: number;
  const hits: string[] = [];

  const marks = () => fs.readdirSync(markers).sort();
  // With the opt-in set, every child warns which project code it loaded; the
  // tool text carries stderr after stdout. Drop those lines to read the JSON.
  const jsonText = (m: Msg) =>
    text(m).split('\n').filter((l) => !l.includes('loading strategy code from project path')).join('\n');
  const clearMarks = () => {
    for (const f of fs.readdirSync(markers)) fs.rmSync(path.join(markers, f));
  };
  const strategy = (name: string) =>
    `require('fs').writeFileSync(${JSON.stringify(markers)} + '/${name}', '1');\n` +
    `module.exports = { name: '${name}', version: '1.0.0', detect: async () => false };\n`;

  beforeAll(async () => {
    proj = path.join(sandbox, 'trust');
    markers = path.join(sandbox, 'markers');
    outside = path.join(sandbox, 'outside');
    fs.cpSync(FIXTURE, proj, { recursive: true });
    fs.mkdirSync(markers);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'typescript.scm'), '(identifier) @name');

    // Trusted: the server root's own project strategy.
    fs.mkdirSync(path.join(proj, '.xray', 'strategies'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.xray', 'strategies', 'trusted.js'), strategy('trusted'));

    // Untrusted subtree: strategies, a node_modules strategy package, a
    // data config, and a JS config (ignored: never discovered, never run).
    const vendor = path.join(proj, 'vendor');
    fs.mkdirSync(path.join(vendor, '.xray', 'strategies'), { recursive: true });
    fs.writeFileSync(path.join(vendor, '.xray', 'strategies', 'evil.js'), strategy('evil'));
    const pkg = path.join(vendor, 'node_modules', 'xray-strategy-evilpkg');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
      name: 'xray-strategy-evilpkg', 'xray-strategy': { name: 'evilpkg', entry: 'index.js' },
    }));
    fs.writeFileSync(path.join(pkg, 'index.js'), strategy('evilpkg'));
    fs.writeFileSync(path.join(vendor, '.xrayrc.json'), '{}');
    fs.writeFileSync(path.join(vendor, '.xrayrc.js'),
      `require('fs').writeFileSync(${JSON.stringify(markers)} + '/rcjs', '1');\nmodule.exports = {};\n`);
    fs.writeFileSync(path.join(vendor, 'v.ts'), 'export function vendored(): number {\n  return 1;\n}\n');

    // Subtree whose only config is JS: no config to refuse, and it never runs.
    const jsOnly = path.join(proj, 'jsonly');
    fs.mkdirSync(jsOnly);
    fs.writeFileSync(path.join(jsOnly, '.xrayrc.js'),
      `require('fs').writeFileSync(${JSON.stringify(markers)} + '/rcjs', '1');\nmodule.exports = {};\n`);
    fs.writeFileSync(path.join(jsOnly, 'j.ts'), 'export function jsonly(): number {\n  return 2;\n}\n');

    // Plain subdirectory: no config, no strategies.
    fs.mkdirSync(path.join(proj, 'clean'));
    fs.writeFileSync(path.join(proj, 'clean', 'c.ts'), 'export function gamma(): number {\n  return 3;\n}\n');
    fs.symlinkSync(outside, path.join(proj, 'escape'));
    spawnSync('git', ['init', '-q'], { cwd: proj, env });

    httpServer = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('(identifier) @name');
    });
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', () => r()));
    port = (httpServer.address() as { port: number }).port;

    // The user's own opt-in, set on the server; children inherit it. The
    // boundary under test is which directory's code it reaches.
    client = startServer(proj, [], { XRAY_ALLOW_PROJECT_STRATEGIES: '1' });
    await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    client.notify('notifications/initialized');
  }, 60_000);

  afterAll(async () => {
    if (client) await client.close();
    if (httpServer) await new Promise((r) => httpServer.close(r));
  });

  beforeEach(clearMarks);

  it('without the opt-in on the server, no project code runs and strategy_list says so', async () => {
    const bare = startServer(proj);
    try {
      await bare.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
      bare.notify('notifications/initialized');
      const r = await bare.call('strategy_list', { format: 'json' });
      expect(r.result.isError).toBe(false);
      expect(text(r)).toContain('XRAY_ALLOW_PROJECT_STRATEGIES=1');
      expect(text(r)).toContain('.xray/strategies/trusted.js');
      expect(marks()).toEqual([]);
    } finally {
      await bare.close();
    }
  }, 60_000);

  it('loads the server root\'s own project strategies', async () => {
    const r = await client.call('strategy_list', { format: 'json' });
    expect(r.result.isError).toBe(false);
    const names = JSON.parse(jsonText(r)).map((s: any) => s.name);
    expect(names).toContain('trusted');
    expect(names).not.toContain('evil');
    expect(names).not.toContain('evilpkg');
    expect(marks()).toEqual(['trusted']);
  }, 60_000);

  it.each([
    ['explore', { root: 'vendor', search: ['vendored'], format: 'json' }],
    ['strategy_detect', { root: 'vendor' }],
    ['react_hooks', { root: 'vendor' }],
    ['config-files_list', { root: 'vendor' }],
  ])('%s with root inside an untrusted subtree runs none of its code', async (name, args) => {
    const r = await client.call(name, args);
    expect(r.result.isError).toBe(false);
    expect(marks()).toEqual(['trusted']);
  }, 60_000);

  it('scopes explore to the call root via --path', async () => {
    const r = await client.call('explore', { root: 'vendor', search: ['vendored'], format: 'json' });
    expect(JSON.parse(jsonText(r)).map((x: any) => x.file)).toEqual([path.join(proj, 'vendor', 'v.ts')]);
  }, 60_000);

  it.each([[{ root: 'vendor' }], [{ path: ['vendor'] }]])(
    'map refuses %j: the subtree has its own config',
    async (args) => {
      const r = await client.call('map', { 'skip-detect': true, 'no-chunk': true, ...args });
      expect(r.result.isError).toBe(true);
      expect(text(r)).toMatch(/has its own xray config/);
      expect(marks()).toEqual([]);
    },
    60_000
  );

  it.each([[{ root: 'jsonly' }], [{ path: ['jsonly'] }]])(
    'map %j: a sub-root whose only config is .xrayrc.js is not refused and never runs it',
    async (args) => {
      const r = await client.call('map', { 'skip-detect': true, 'no-chunk': true, ...args });
      expect(r.result.isError).toBe(false);
      expect(text(r)).toContain('jsonly');
      expect(marks()).toEqual(['trusted']);
    },
    120_000
  );

  it('maps a plain sub-root', async () => {
    const r = await client.call('map', { root: 'clean', 'no-chunk': true });
    expect(r.result.isError).toBe(false);
    expect(text(r)).toContain('gamma');
    expect(text(r)).not.toContain('alpha');
    expect(marks()).toEqual(['trusted']);
  }, 120_000);

  it('queries a graph built over a plain sub-root', async () => {
    const r = await client.call('query', { root: 'clean', query: 'callers(gamma)', format: 'json' });
    expect(r.result.isError).toBe(false);
    expect(client.stderr).not.toMatch(/evil/);
  }, 120_000);

  it.each([
    ['query outside root', 'map', () => ({ query: [path.join(outside, 'typescript.scm')] }), /outside the server root/],
    ['query .ext:../ escape', 'map', () => ({ query: ['.ts:../outside/typescript.scm'] }), /outside the server root/],
    ['query through symlink', 'map', () => ({ query: ['escape/typescript.scm'] }), /outside the server root/],
    ['query .ext:http URL', 'map', () => ({ query: [`.ts:http://127.0.0.1:${port}/typescript.scm`] }), /not a URL/],
    ['query URL in comma list', 'map', () => ({ query: [`clean,https://127.0.0.1:${port}/typescript.scm`] }), /not a URL/],
    ['anchor through symlink', 'map', () => ({ anchor: 'escape/typescript.scm' }), /outside the server root/],
    ['config-files --file outside root', 'config-files_keys', () => ({ file: '../outside/typescript.scm' }), /outside the server root/],
    ['unlisted code-running flag', 'go-cli_commands', () => ({ 'exec-binary': true }), /unknown argument "exec-binary"/],
    ['unlisted secrets flag', 'config-files_values', () => ({ 'show-secrets': true }), /unknown argument "show-secrets"/],
    ['unlisted writer flag', 'map', () => ({ share: 'x.md' }), /unknown argument "share"/],
    ['root on an unscoped tool', 'strategy_list', () => ({ root: 'vendor' }), /unknown argument "root"/],
  ])('rejects %s', async (_label, name, args, msg) => {
    const r = await client.call(name, { 'skip-detect': name === 'map' ? true : undefined, ...args() });
    expect(r.error).toBeUndefined();
    expect(r.result.isError).toBe(true);
    expect(text(r)).toMatch(msg);
    expect(hits).toEqual([]);
    expect(marks()).toEqual([]);
  }, 60_000);
});

// Server root with a config file: children run with `--config <it>`, so
// sub-roots with their own config are scopable and that config never
// loads. `cobol` is an unknown language: a sub config that loads fails
// the call.
describe('xray mcp with a server root config', () => {
  let markers: string;
  let pinned: string;
  let unpinned: string;
  let client: StdioClient;
  let explicitClient: StdioClient;

  const marks = () => fs.readdirSync(markers).sort();
  const clearMarks = () => {
    for (const f of fs.readdirSync(markers)) fs.rmSync(path.join(markers, f));
  };
  const markerJs = (name: string, extra = '') =>
    `require('fs').writeFileSync(${JSON.stringify(markers)} + '/${name}', '1');\nmodule.exports = {${extra}};\n`;
  const subProjects = (dir: string) => {
    fs.mkdirSync(path.join(dir, 'pkg'));
    fs.writeFileSync(path.join(dir, 'pkg', '.xrayrc.json'), JSON.stringify({ languages: ['cobol'] }));
    fs.writeFileSync(path.join(dir, 'pkg', 'p.ts'), 'export function epsilon(): number {\n  return 5;\n}\n');
    fs.mkdirSync(path.join(dir, 'pkgjs'));
    fs.writeFileSync(path.join(dir, 'pkgjs', '.xrayrc.js'), markerJs('subrcjs', " languages: ['cobol'] "));
    fs.writeFileSync(path.join(dir, 'pkgjs', 'q.ts'), 'export function zeta(): number {\n  return 6;\n}\n');
    spawnSync('git', ['init', '-q'], { cwd: dir, env });
  };
  const init = async (c: StdioClient) => {
    await c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    c.notify('notifications/initialized');
  };

  beforeAll(async () => {
    markers = path.join(sandbox, 'pinned-markers');
    fs.mkdirSync(markers);

    // Discovered: the server root's own .xrayrc.json. `json: true` makes
    // map output JSON, which shows this config (not a sub-root's) applied.
    pinned = path.join(sandbox, 'pinned');
    fs.cpSync(FIXTURE, pinned, { recursive: true });
    fs.writeFileSync(path.join(pinned, '.xrayrc.json'), JSON.stringify({ json: true }));
    subProjects(pinned);

    // Explicit: no discoverable root config; `xray mcp --config <file>`.
    unpinned = path.join(sandbox, 'unpinned');
    fs.cpSync(FIXTURE, unpinned, { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'served.json'), JSON.stringify({ limit: 4096 }));
    subProjects(unpinned);

    client = startServer(pinned);
    explicitClient = startServer(unpinned, ['--config', path.join(sandbox, 'served.json')]);
    await init(client);
    await init(explicitClient);
  }, 60_000);

  afterAll(async () => {
    if (client) await client.close();
    if (explicitClient) await explicitClient.close();
  });

  beforeEach(clearMarks);

  it.each(['map', 'graph'])(
    '%s scopes a sub-root with its own .xrayrc.json; the root config applies, not the sub one',
    async (tool) => {
      const r = await client.call(tool, { root: 'pkg', 'skip-detect': true, 'no-chunk': true });
      expect(text(r)).not.toMatch(/cobol/);
      expect(r.result.isError).toBe(false);
      if (tool === 'map') {
        expect(() => JSON.parse(text(r))).not.toThrow();
        expect(text(r)).toContain('epsilon');
        expect(text(r)).not.toContain('alpha');
      }
    },
    120_000
  );

  it.each([[{ root: 'pkgjs' }], [{ path: ['pkgjs'] }]])(
    'map %j: a sub .xrayrc.js never runs and its languages are not applied',
    async (args) => {
      const r = await client.call('map', { 'skip-detect': true, 'no-chunk': true, ...args });
      expect(r.result.isError).toBe(false);
      expect(text(r)).toContain('zeta');
      expect(marks()).toEqual([]);
    },
    120_000
  );

  it('query builds its graph over a configured sub-root', async () => {
    const r = await client.call('query', { root: 'pkg', query: 'callers(epsilon)', format: 'json' });
    expect(r.result.isError).toBe(false);
    expect(marks()).not.toContain('subrcjs');
  }, 120_000);

  it('xray mcp --config pins that file: configured sub-roots are scopable', async () => {
    for (const root of ['pkg', 'pkgjs']) {
      const r = await explicitClient.call('map', { root, 'skip-detect': true, 'no-chunk': true });
      expect(text(r)).not.toMatch(/cobol/);
      expect(r.result.isError).toBe(false);
    }
    expect(marks()).toEqual([]);
  }, 120_000);

  it('xray mcp --config with a missing file is a usage error', () => {
    const r = spawnSync(process.execPath, [BIN, '--config', 'nope.json', 'mcp'], { cwd: unpinned, env, encoding: 'utf-8', input: '' });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/not found/);
  });
});
