import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerCoreCommands } from '../src/commands/registration/core';
import { createServeHttpServer } from '../src/lib/server/http-server';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function httpRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(urlPath, baseUrl);
    const req = http.request(
      target,
      {
        method,
        headers: options.headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

describe('xray serve HTTP API and Web UI', () => {
  let sandbox: string;
  let repo: string;
  let outside: string;

  beforeAll(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-serve-api-')));
    repo = path.join(sandbox, 'repo');
    outside = path.join(sandbox, 'outside');

    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'ignored-dir'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.xray', 'handbook'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n.env.*\n*.pem\n*.key\nignored-dir/\n');
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET_KEY=supersecret\n');
    fs.writeFileSync(path.join(repo, 'private.pem'), '-----BEGIN PRIVATE KEY-----\n');
    fs.writeFileSync(path.join(repo, 'ignored-dir', 'skip.txt'), 'ignored\n');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret\n');

    fs.writeFileSync(
      path.join(repo, 'src', 'math.ts'),
      [
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        '',
        'export function doubleSum(x: number, y: number): number {',
        '  return add(x, y) * 2;',
        '}',
      ].join('\n') + '\n'
    );

    const bigLines: string[] = [];
    for (let i = 1; i <= 550; i++) {
      bigLines.push(`export const line_${i} = ${i};`);
    }
    fs.writeFileSync(path.join(repo, 'src', 'big.ts'), bigLines.join('\n') + '\n');

    fs.writeFileSync(
      path.join(repo, '.xray', 'handbook', 'README.md'),
      '---\ngenerator: deterministic\nsubsystem: overview\n---\n\n# Overview\n\nRepo handbook.\n'
    );

    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test User');
    git(repo, 'add', '.gitignore', 'src/math.ts', 'src/big.ts');
    git(repo, 'commit', '-q', '-m', 'initial commit');

    fs.writeFileSync(
      path.join(repo, 'src', 'math.ts'),
      [
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        '',
        'export function doubleSum(x: number, y: number): number {',
        '  return add(x, y) * 2;',
        '}',
        '',
        'export function tripleSum(x: number, y: number): number {',
        '  return add(x, y) * 3;',
        '}',
      ].join('\n') + '\n'
    );
  });

  afterAll(() => {
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('refuses non-loopback host without --token', () => {
    expect(() =>
      createServeHttpServer({
        serverRoot: repo,
        host: '0.0.0.0',
        port: 0,
      })
    ).toThrow(/--token/i);
  });

  describe('loopback server endpoints and security guards', () => {
    let instance: ReturnType<typeof createServeHttpServer>;

    beforeAll(async () => {
      const prog = new Command('xray');
      registerCoreCommands(prog);
      instance = createServeHttpServer({
        serverRoot: repo,
        host: '127.0.0.1',
        port: 0,
        mcp: true,
        program: prog,
        uiDir: path.resolve(__dirname, '../src/ui'),
      });
      await instance.start();
    });

    afterAll(async () => {
      await instance.stop();
    });

    it('serves index.html on GET /', async () => {
      const res = await httpRequest(instance.url, 'GET', '/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('rejects non-localhost Origin with 403', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/contexts', {
        headers: { Origin: 'https://evil.example.com' },
      });
      expect(res.status).toBe(403);
    });

    it('GET /api/contexts returns allowed roots', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/contexts');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.serverRoot).toBe(repo);
      expect(Array.isArray(data.roots)).toBe(true);
      expect(data.roots.some((r: { path: string }) => r.path === repo)).toBe(true);
    });

    it('GET /api/tree returns lazy directory children and respects .gitignore', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/tree?path=.&depth=1&limit=1000');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      const names = data.entries.map((e: { name: string }) => e.name);
      expect(names).toContain('src');
      expect(names).not.toContain('.git');
      expect(names).not.toContain('ignored-dir');
      expect(names).not.toContain('math.ts');
    });

    it('GET /api/file reads file lines with pagination and refuses traversal/.env/.git', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/file?path=src/big.ts&offset=1&limit=500');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.totalLines).toBe(550);
      expect(data.hasMore).toBe(true);
      expect(data.lines).toHaveLength(500);
      expect(data.lines[0].line).toBe(1);

      const trav = await httpRequest(instance.url, 'GET', '/api/file?path=../outside/secret.txt');
      expect(trav.status).toBe(403);

      const envRes = await httpRequest(instance.url, 'GET', '/api/file?path=.env');
      expect(envRes.status).toBe(403);

      const pemRes = await httpRequest(instance.url, 'GET', '/api/file?path=private.pem');
      expect(pemRes.status).toBe(403);

      const gitRes = await httpRequest(instance.url, 'GET', '/api/file?path=.git/HEAD');
      expect(gitRes.status).toBe(403);
    });

    it('GET /api/search searches indexed code with filter DSL support', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/search?q=doubleSum&filter=file:math.ts');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.matches.length).toBeGreaterThanOrEqual(1);
      expect(data.matches[0].relPath).toBe('src/math.ts');
    });

    it('GET /api/symbols returns symbols for a file', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/symbols?path=src/math.ts');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      const names = data.symbols.map((s: { name: string }) => s.name);
      expect(names).toContain('add');
      expect(names).toContain('doubleSum');
    });

    it('GET /api/impact returns callers for a symbol', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/impact?symbol=add&depth=3&crossContext=false');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.symbol.query).toBe('add');
      expect(Array.isArray(data.nodes)).toBe(true);
      const callerNames = data.nodes.map((c: { name?: string }) => c.name);
      expect(callerNames).toContain('doubleSum');
    });

    it('GET /api/commits, /api/diff, and /api/blame return git metadata', async () => {
      const commitsRes = await httpRequest(instance.url, 'GET', '/api/commits');
      expect(commitsRes.status).toBe(200);
      const commitsData = JSON.parse(commitsRes.body);
      expect(commitsData.commits.length).toBeGreaterThanOrEqual(1);
      expect(commitsData.commits[0].subject).toBe('initial commit');

      const diffRes = await httpRequest(instance.url, 'GET', '/api/diff');
      expect(diffRes.status).toBe(200);
      const diffData = JSON.parse(diffRes.body);
      expect(diffData.files.some((f: { path: string }) => f.path === 'src/math.ts')).toBe(true);

      const blameRes = await httpRequest(instance.url, 'GET', '/api/blame?path=src/math.ts');
      expect(blameRes.status).toBe(200);
      const blameData = JSON.parse(blameRes.body);
      expect(blameData.blame.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/handbook returns handbook page content', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/handbook?slug=README');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.slug).toBe('README');
      expect(data.content).toContain('# Overview');
    });

    it('GET /api/diagram returns mermaid, nodes, and edges', async () => {
      const res = await httpRequest(instance.url, 'GET', '/api/diagram?view=architecture');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(typeof data.mermaid).toBe('string');
      expect(data.mermaid).toContain('flowchart');
      expect(Array.isArray(data.nodes)).toBe(true);
      expect(Array.isArray(data.edges)).toBe(true);
    });

    it('mounts Streamable HTTP MCP handler at /mcp when --mcp is enabled', async () => {
      const res = await httpRequest(instance.url, 'POST', '/mcp', {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      });
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.result?.serverInfo?.name).toBeDefined();
    });
  });

  describe('--api-only and --token enforcement', () => {
    let instance: ReturnType<typeof createServeHttpServer>;

    beforeAll(async () => {
      instance = createServeHttpServer({
        serverRoot: repo,
        host: '127.0.0.1',
        port: 0,
        token: 'secret-token-123',
        apiOnly: true,
        uiDir: path.resolve(__dirname, '../src/ui'),
      });
      await instance.start();
    });

    afterAll(async () => {
      await instance.stop();
    });

    it('returns 404 on / when --api-only is set', async () => {
      const res = await httpRequest(instance.url, 'GET', '/');
      expect(res.status).toBe(404);
    });

    it('enforces Bearer token on /api/* endpoints', async () => {
      const unauth = await httpRequest(instance.url, 'GET', '/api/contexts');
      expect(unauth.status).toBe(401);

      const auth = await httpRequest(instance.url, 'GET', '/api/contexts', {
        headers: { Authorization: 'Bearer secret-token-123' },
      });
      expect(auth.status).toBe(200);
    });
  });
});
