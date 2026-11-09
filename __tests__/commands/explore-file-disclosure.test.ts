/**
 * An explicitly named file must not get around the scanner: explore only
 * reads files the scanner lists (supported extension, not ignored, never
 * under .git, symlinks judged by their target). Over MCP the explore path
 * is directory-only. Built bin, spawned; MCP over stdio.
 */
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const MARK = 'SECRETMARK123';

let sandbox: string;
let repo: string;
let env: NodeJS.ProcessEnv;

const cli = (...args: string[]) =>
  spawnSync(process.execPath, [BIN, '--no-telemetry', ...args], { cwd: repo, env, encoding: 'utf-8', timeout: 60_000 });

class Client {
  private id = 1;
  private buf = '';
  private waiters = new Map<number, (m: any) => void>();
  constructor(readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding('utf-8').on('data', (d: string) => {
      this.buf += d;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        const m = JSON.parse(line);
        if (typeof m.id === 'number') this.waiters.get(m.id)?.(m);
      }
    });
  }
  request(method: string, params?: unknown): Promise<any> {
    const id = this.id++;
    const p = new Promise((r) => this.waiters.set(id, r));
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }
  async call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const m = await this.request('tools/call', { name, arguments: args });
    if (m.error) return { isError: true, text: m.error.message };
    return { isError: Boolean(m.result.isError), text: m.result.content.map((c: any) => c.text).join('\n') };
  }
}

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-file-disc-')));
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(home, { recursive: true });
  env = {
    PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: home, LANG: 'C', NO_COLOR: '1',
    XDG_CONFIG_HOME: path.join(home, 'c'), XDG_CACHE_HOME: path.join(home, 'k'),
    XDG_DATA_HOME: path.join(home, 'd'), XDG_STATE_HOME: path.join(home, 's'),
  };
  repo = path.join(sandbox, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'outside'));
  fs.writeFileSync(path.join(repo, 'src/a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, '.env'), `TOKEN=${MARK}\n`);
  fs.writeFileSync(path.join(repo, 'ignored.ts'), `export const s = "${MARK}";\n`);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.ts\n');
  fs.writeFileSync(path.join(sandbox, 'outside/secret.ts'), `export const o = "${MARK}";\n`);
  fs.symlinkSync('../.env', path.join(repo, 'src/envlink.ts'));
  fs.symlinkSync('../../outside/secret.ts', path.join(repo, 'src/outlink.ts'));
  spawnSync('git', ['init', '-q'], { cwd: repo, env });
  fs.appendFileSync(path.join(repo, '.git/config'), `[remote "o"]\n\turl = ${MARK}\n`);
}, 120_000);

afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));

describe('explore on a named file (CLI)', () => {
  it('lists a file the scanner would list', () => {
    const r = cli('explore', '--path', 'src/a.ts');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('a.ts');
  });

  it.each([
    ['.env', 'unsupported extension'],
    ['.git/config', 'under .git'],
    ['ignored.ts', 'ignored'],
    ['src/envlink.ts', 'unsupported extension'],
  ])('%s is skipped with a reason, never read', (file, why) => {
    const r = cli('explore', '--path', file, '--search', 'TOKEN', '--search', 'url', '--search', 'SECRET');
    expect(r.stdout + r.stderr).not.toContain(MARK);
    expect(r.stderr).toContain(`skipped`);
    expect(r.stderr).toContain(why);
  });

  it('bare `xray <file>` follows the same rules', () => {
    const r = cli('.env');
    expect(r.stderr).toContain('skipped');
    expect(r.stdout).not.toContain(MARK);
  });
});

describe('scans do not follow links out of the tree', () => {
  it('explore --search finds neither the .env link nor the outside link', () => {
    const r = cli('explore', '--search', 'RETMARK12');
    expect(r.stdout + r.stderr).not.toContain(MARK);
    const l = cli('explore', '--match', '*');
    expect(l.stdout).toContain('a.ts');
    expect(l.stdout).not.toContain('envlink');
    expect(l.stdout).not.toContain('outlink');
  });
});

describe('empty --search', () => {
  it('is a usage error on the CLI', () => {
    expect(cli('explore', '--search', '').status).toBe(2);
    const j = cli('explore', '--search', '', '--format', 'json');
    expect(j.status).toBe(2);
    expect(JSON.parse(j.stderr.slice(j.stderr.indexOf('{'))).code).toBe('USAGE');
  });
});

describe('xray mcp: no tool discloses ignored or out-of-tree files', () => {
  let c: Client;
  beforeAll(async () => {
    c = new Client(spawn(process.execPath, [BIN, 'mcp'], { cwd: repo, env, stdio: 'pipe' }));
    await c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  }, 60_000);
  afterAll(() => c.proc.stdin.end());

  it.each([['src/a.ts'], ['.env'], ['.git/config'], ['ignored.ts'], ['src/envlink.ts'], ['src/outlink.ts']])(
    'explore refuses %s as a path',
    async (file) => {
      const r = await c.call('explore', { path: [file], search: ['TOKEN', 'url', 'export'] });
      expect(r.isError).toBe(true);
      expect(r.text).not.toContain(MARK);
      expect(r.text).toMatch(/directory|outside the server root/);
    }
  );

  it('empty search is rejected', async () => {
    const r = await c.call('explore', { search: [''] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('non-empty keyword');
  });

  it('no tool call ever prints the marker', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['explore', { search: ['RETMARK12'] }],
      ['explore', { search: ['TOKEN', 'url', 'export'] }],
      ['explore', { match: ['*'] }],
      ['explore', { stats: true }],
      ['map', {}],
      ['map', { path: ['.env'] }],
      ['map', { path: ['.git/config'] }],
      ['graph', {}],
      ['imports', {}],
      ['imports', { paths: ['.env', '.git/config', 'ignored.ts', 'src/envlink.ts'] }],
      ['strategy_detect', { path: ['.env'] }],
      ['strategy_detect', { path: ['.git/config'] }],
    ];
    for (const [name, args] of calls) {
      const r = await c.call(name, args);
      expect(`${name} ${JSON.stringify(args)}: ${r.text}`).not.toContain(MARK);
    }
  }, 120_000);
});
