/**
 * Integration tests for MCP primitive tools (read_file, list_tree,
 * list_branches, list_commits, get_diff), Streamable HTTP transport,
 * Origin guard, and xrst_ scoped tokens.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerCoreCommands } from '../src/commands/registration/core';
import { createMcpHttpServer, isLoopbackHost } from '../src/lib/mcp/http-transport';
import { ScopedTokenManager } from '../src/lib/mcp/scoped-token';
import { WarmWorkspaceManager } from '../src/lib/mcp/workspace';

function buildTestProgram(): Command {
  const prog = new Command('xray');
  registerCoreCommands(prog);
  return prog;
}

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

describe('MCP HTTP transport and primitive tools', () => {
  let sandbox: string;
  let repo: string;
  let outside: string;
  let subRoot: string;

  beforeAll(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-mcp-http-')));
    repo = path.join(sandbox, 'repo');
    outside = path.join(sandbox, 'outside');
    subRoot = path.join(repo, 'packages', 'app');

    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(subRoot, { recursive: true });
    fs.mkdirSync(path.join(repo, 'ignored-dir'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n.env.*\n*.pem\n*.key\nignored-dir/\n');
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET_KEY=supersecret\n');
    fs.writeFileSync(path.join(repo, '.env.local'), 'LOCAL_SECRET=abc\n');
    fs.writeFileSync(path.join(repo, 'cert.pem'), '-----BEGIN CERTIFICATE-----\n');
    fs.writeFileSync(path.join(repo, 'ignored-dir', 'skip.txt'), 'should not appear\n');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret\n');

    // 600 lines for testing 500-line cap + offset/hasMore, plus a >500 char line
    const lines: string[] = [];
    for (let i = 1; i <= 600; i++) {
      lines.push(i === 2 ? `line-2-${'x'.repeat(600)}` : `line-${i}`);
    }
    fs.writeFileSync(path.join(repo, 'src', 'big.txt'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(repo, 'src', 'hello.ts'), 'export const hello = () => "world";\n');
    fs.writeFileSync(path.join(subRoot, 'index.ts'), 'export const app = 1;\n');

    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test User');
    git(repo, 'add', '.gitignore', 'src/hello.ts', 'src/big.txt', 'packages/app/index.ts');
    git(repo, 'commit', '-q', '-m', 'initial commit');

    git(repo, 'checkout', '-q', '-b', 'feature/demo');
    fs.writeFileSync(path.join(repo, 'src', 'hello.ts'), 'export const hello = () => "updated";\n');
    git(repo, 'add', 'src/hello.ts');
    git(repo, 'commit', '-q', '-m', 'update hello');

    // Uncommitted working-tree edit
    fs.writeFileSync(path.join(repo, 'src', 'hello.ts'), 'export const hello = () => "working";\n');
  });

  afterAll(() => {
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  describe('unauthenticated loopback server', () => {
    let workspace: WarmWorkspaceManager;
    let instance: ReturnType<typeof createMcpHttpServer>;
    let baseUrl: string;

    beforeAll(async () => {
      workspace = new WarmWorkspaceManager(repo, null);
      instance = createMcpHttpServer(buildTestProgram(), {
        serverRoot: repo,
        serverConfig: null,
        entry: path.resolve(__dirname, '../dist/index.js'),
        timeoutMs: 30_000,
        version: '0.1.0-test',
        workspace,
        host: '127.0.0.1',
        port: 0,
      });
      await instance.start();
      baseUrl = instance.url;
    });

    afterAll(async () => {
      await instance.stop();
      workspace.close();
    });

    it('serves GET /healthz and rejects non-localhost Origin with 403', async () => {
      const ok = await httpRequest(baseUrl, 'GET', '/healthz');
      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.body)).toMatchObject({ ok: true });

      const localOrigin = await httpRequest(baseUrl, 'GET', '/healthz', {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(localOrigin.status).toBe(200);

      const ipv4Origin = await httpRequest(baseUrl, 'GET', '/healthz', {
        headers: { Origin: 'http://127.0.0.1:8080' },
      });
      expect(ipv4Origin.status).toBe(200);

      const ipv6Origin = await httpRequest(baseUrl, 'GET', '/healthz', {
        headers: { Origin: 'http://[::1]:3000' },
      });
      expect(ipv6Origin.status).toBe(200);

      const evil = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      expect(evil.status).toBe(403);

      const spoofed = await httpRequest(baseUrl, 'GET', '/healthz', {
        headers: { Origin: 'http://localhost.evil.com' },
      });
      expect(spoofed.status).toBe(403);
    });

    it('returns 403 on /auth/scoped-token when master --token is unset', async () => {
      const mint = await httpRequest(baseUrl, 'POST', '/auth/scoped-token', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roots: [repo] }),
      });
      expect(mint.status).toBe(403);

      const del = await httpRequest(baseUrl, 'DELETE', '/auth/scoped-token/some-jti');
      expect(del.status).toBe(403);
    });

    it('handles Streamable HTTP initialize + tools/list + tools/call for all 5 primitive tools', async () => {
      const initRes = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'http-test', version: '1.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      const initRpc = JSON.parse(initRes.body);
      expect(initRpc.result.serverInfo.name).toBe('xray');
      expect(initRpc.result.instructions).toMatch(/read_file/);

      const listRes = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      });
      expect(listRes.status).toBe(200);
      const toolNames = (JSON.parse(listRes.body).result.tools as Array<{ name: string }>).map(
        (t) => t.name
      );
      for (const name of ['read_file', 'list_tree', 'list_branches', 'list_commits', 'get_diff']) {
        expect(toolNames).toContain(name);
      }

      // 1. read_file: 500-line cap, 1-based line numbers, line truncation, hasMore
      const readRes = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'read_file', arguments: { path: 'src/big.txt', offset: 1, limit: 999 } },
        }),
      });
      const readPayload = JSON.parse(JSON.parse(readRes.body).result.content[0].text);
      expect(readPayload.lines).toHaveLength(500);
      expect(readPayload.lines[0]).toMatchObject({ line: 1, text: 'line-1' });
      expect(readPayload.lines[1].line).toBe(2);
      expect(readPayload.lines[1].text.length).toBeLessThan(550);
      expect(readPayload.lines[1].text).toContain('[truncated');
      expect(readPayload.hasMore).toBe(true);

      // 1b. read_file: refuses .git/ and .env / *.pem
      for (const forbidden of ['.git/HEAD', '.env', '.env.local', 'cert.pem', '../outside/secret.txt']) {
        const badRes = await httpRequest(baseUrl, 'POST', '/mcp', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'read_file', arguments: { path: forbidden } },
          }),
        });
        expect(JSON.parse(badRes.body).result.isError).toBe(true);
      }

      // 2. list_tree: dirs sorted before files, honors .gitignore
      const treeRes = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'list_tree', arguments: { depth: 1 } },
        }),
      });
      const treePayload = JSON.parse(JSON.parse(treeRes.body).result.content[0].text);
      const entryNames = (treePayload.entries as Array<{ name: string; type: string }>).map(
        (e) => e.name
      );
      expect(entryNames).not.toContain('.git');
      expect(entryNames).not.toContain('ignored-dir');
      expect(entryNames).not.toContain('.env');
      const firstFileIdx = treePayload.entries.findIndex((e: any) => e.type === 'file');
      const lastDirIdx = treePayload.entries
        .map((e: any, i: number) => (e.type === 'directory' ? i : -1))
        .reduce((a: number, b: number) => Math.max(a, b), -1);
      if (firstFileIdx !== -1 && lastDirIdx !== -1) {
        expect(lastDirIdx).toBeLessThan(firstFileIdx);
      }

      // 3. list_branches
      const branchRes = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'list_branches', arguments: {} },
        }),
      });
      const branchesPayload = JSON.parse(JSON.parse(branchRes.body).result.content[0].text);
      expect(branchesPayload.branches.map((b: any) => b.name)).toContain('feature/demo');

      // 4. list_commits
      const commitsRes = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'list_commits', arguments: { perPage: 5 } },
        }),
      });
      const commitsPayload = JSON.parse(JSON.parse(commitsRes.body).result.content[0].text);
      expect(commitsPayload.commits.length).toBeGreaterThanOrEqual(2);
      expect(commitsPayload.commits[0].subject).toBe('update hello');

      // 5. get_diff (working tree against HEAD)
      const diffRes = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: { name: 'get_diff', arguments: { base: 'WORKING' } },
        }),
      });
      const diffPayload = JSON.parse(JSON.parse(diffRes.body).result.content[0].text);
      expect(diffPayload.files.map((f: any) => f.path)).toContain('src/hello.ts');
    });
  });

  describe('authenticated HTTP server and xrst_ scoped tokens', () => {
    const MASTER_TOKEN = 'master-secret-token-123';
    let workspace: WarmWorkspaceManager;
    let instance: ReturnType<typeof createMcpHttpServer>;
    let baseUrl: string;

    beforeAll(async () => {
      workspace = new WarmWorkspaceManager(repo, null);
      instance = createMcpHttpServer(buildTestProgram(), {
        serverRoot: repo,
        serverConfig: null,
        entry: path.resolve(__dirname, '../dist/index.js'),
        timeoutMs: 30_000,
        version: '0.1.0-test',
        workspace,
        host: '127.0.0.1',
        port: 0,
        token: MASTER_TOKEN,
      });
      await instance.start();
      baseUrl = instance.url;
    });

    afterAll(async () => {
      await instance.stop();
      workspace.close();
    });

    it('requires token for /mcp and /auth/scoped-token', async () => {
      const noAuth = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(noAuth.status).toBe(401);

      const mintNoAuth = await httpRequest(baseUrl, 'POST', '/auth/scoped-token', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roots: [subRoot] }),
      });
      expect(mintNoAuth.status).toBe(401);
    });

    it('mints, validates, scopes, and revokes xrst_ tokens', async () => {
      // Mint scoped token restricted to packages/app
      const mintRes = await httpRequest(baseUrl, 'POST', '/auth/scoped-token', {
        headers: {
          Authorization: `Bearer ${MASTER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roots: [subRoot] }),
      });
      expect(mintRes.status).toBe(200);
      const minted = JSON.parse(mintRes.body);
      expect(minted.token).toMatch(/^xrst_/);
      expect(typeof minted.jti).toBe('string');

      // Valid scoped token can read inside packages/app
      const okCall = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: {
          Authorization: `Bearer ${minted.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: { name: 'read_file', arguments: { path: 'packages/app/index.ts' } },
        }),
      });
      expect(okCall.status).toBe(200);
      expect(JSON.parse(okCall.body).result.isError).toBe(false);

      // Scoped token CANNOT read outside its narrowed root (e.g. src/hello.ts in repo)
      const wrongRootCall = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: {
          Authorization: `Bearer ${minted.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: { name: 'read_file', arguments: { path: 'src/hello.ts' } },
        }),
      });
      expect(wrongRootCall.status).toBe(200);
      expect(JSON.parse(wrongRootCall.body).result.isError).toBe(true);

      // Disjoint wrong-root token has empty intersected roots and cannot read anything
      const disjointMint = await httpRequest(baseUrl, 'POST', '/auth/scoped-token', {
        headers: {
          Authorization: `Bearer ${MASTER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roots: [outside] }),
      });
      expect(disjointMint.status).toBe(200);
      const disjointToken = JSON.parse(disjointMint.body).token as string;
      const disjointCall = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: {
          Authorization: `Bearer ${disjointToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 111,
          method: 'tools/call',
          params: { name: 'read_file', arguments: { path: 'packages/app/index.ts' } },
        }),
      });
      expect(disjointCall.status).toBe(200);
      expect(JSON.parse(disjointCall.body).result.isError).toBe(true);

      // Revoke the token
      const delRes = await httpRequest(baseUrl, 'DELETE', `/auth/scoped-token/${minted.jti}`, {
        headers: { Authorization: `Bearer ${MASTER_TOKEN}` },
      });
      expect(delRes.status).toBe(200);
      expect(JSON.parse(delRes.body)).toMatchObject({ revoked: true, jti: minted.jti });

      // Revoked token is rejected with 401
      const revokedCall = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: {
          Authorization: `Bearer ${minted.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/list' }),
      });
      expect(revokedCall.status).toBe(401);
    });

    it('rejects expired and tampered xrst_ tokens', async () => {
      const mgr = new ScopedTokenManager(MASTER_TOKEN);
      const expired = mgr.mint([repo], { ttlSeconds: -10 });
      expect(mgr.verify(expired)).toBeNull();

      const expiredCall = await httpRequest(baseUrl, 'POST', '/mcp', {
        headers: {
          Authorization: `Bearer ${expired}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/list' }),
      });
      expect(expiredCall.status).toBe(401);

      const tampered = mgr.mint([repo]).slice(0, -4) + 'AAAA';
      expect(mgr.verify(tampered)).toBeNull();
    });

    it('requires --token for non-loopback --host', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('0.0.0.0')).toBe(false);

      expect(() =>
        createMcpHttpServer(buildTestProgram(), {
          serverRoot: repo,
          serverConfig: null,
          entry: path.resolve(__dirname, '../dist/index.js'),
          timeoutMs: 30_000,
          version: '0.1.0-test',
          workspace,
          host: '0.0.0.0',
          port: 0,
        })
      ).toThrow(/token/i);
    });
  });
});
