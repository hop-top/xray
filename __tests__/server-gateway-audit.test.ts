import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { createMcpHttpServer } from '../src/lib/mcp/http-transport';
import { createServeHttpServer } from '../src/lib/server/http-server';
import { AuditLogger } from '../src/lib/server/audit';
import { loadGatewayUpstreams, McpGateway } from '../src/lib/server/gateway';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function httpRequest(
  baseUrl: string,
  reqPath: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const req = http.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

describe('MCP gateway, portal deep links, handbook index, and JSONL audit log', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    delete process.env.XRAY_ALLOW_PROJECT_GATEWAY;
    delete process.env.TEST_GATEWAY_SECRET;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('gateway config security gate', () => {
    it('rejects repo-local gateway.upstreams by default and warns, enabling only with XRAY_ALLOW_PROJECT_GATEWAY=1', () => {
      const repoDir = makeTempDir('xray-gw-repo-');
      tempDirs.push(repoDir);
      const localConfigPath = path.join(repoDir, '.xrayrc.json');
      fs.writeFileSync(
        localConfigPath,
        JSON.stringify({
          gateway: {
            upstreams: {
              evil: {
                transport: 'stdio',
                command: 'echo pwned',
              },
            },
          },
        }),
        'utf8'
      );

      const warnings: string[] = [];
      const blocked = loadGatewayUpstreams({
        serverRoot: repoDir,
        serverConfig: localConfigPath,
        warn: (msg) => warnings.push(msg),
      });
      expect(blocked.evil).toBeUndefined();
      expect(warnings.some((w) => w.toLowerCase().includes('gateway'))).toBe(true);

      process.env.XRAY_ALLOW_PROJECT_GATEWAY = '1';
      const allowed = loadGatewayUpstreams({
        serverRoot: repoDir,
        serverConfig: localConfigPath,
        warn: (msg) => warnings.push(msg),
      });
      expect(allowed.evil).toBeDefined();
      expect(allowed.evil.transport).toBe('stdio');
      expect(allowed.evil.command).toBe('echo pwned');
    });
  });

  describe('McpGateway upstream proxy', () => {
    let mockServer: http.Server;
    let mockUrl: string;
    let lastAuthHeader: string | undefined;
    let failNextCallWithSecret = false;

    beforeEach(async () => {
      lastAuthHeader = undefined;
      failNextCallWithSecret = false;
      mockServer = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          lastAuthHeader = req.headers.authorization;
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (body.method === 'tools/list') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: {
                  tools: [
                    { name: 'allowed_tool', description: 'Allowed', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
                    { name: 'blocked_tool', description: 'Blocked', inputSchema: { type: 'object', properties: {} } },
                    { name: 'unlisted_tool', description: 'Unlisted', inputSchema: { type: 'object', properties: {} } },
                  ],
                },
              })
            );
            return;
          }
          if (body.method === 'tools/call') {
            if (failNextCallWithSecret) {
              res.writeHead(500, { 'content-type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: `upstream failed with token ${process.env.TEST_GATEWAY_SECRET ?? ''}`,
                })
              );
              return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: {
                  content: [{ type: 'text', text: `ok:${body.params?.name}` }],
                },
              })
            );
            return;
          }
          res.writeHead(404);
          res.end();
        });
      });
      await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
      const addr = mockServer.address() as { port: number };
      mockUrl = `http://127.0.0.1:${addr.port}/mcp`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    });

    it('namespaces tools, enforces allowTools/blockTools, and injects headerEnv without leaking credentials', async () => {
      process.env.TEST_GATEWAY_SECRET = 'super-secret-token-value-123';
      const gw = new McpGateway({
        upstreams: {
          gh: {
            transport: 'http',
            url: mockUrl,
            headerEnv: {
              Authorization: 'TEST_GATEWAY_SECRET',
            },
            allowTools: ['allowed_tool', 'blocked_tool'],
            blockTools: ['blocked_tool'],
          },
        },
      });

      const direct = await gw.discoverTools();
      expect(Array.from(direct.keys())).toEqual(['gh__allowed_tool']);

      const okRes = await direct.get('gh__allowed_tool')!.invoke({ q: 'hello' });
      expect(okRes.exitCode).toBe(0);
      expect(okRes.stdout).toContain('ok:allowed_tool');
      expect(lastAuthHeader).toBe('super-secret-token-value-123');

      const deniedRes = await gw.callTool('gh', 'blocked_tool', {});
      expect(deniedRes.exitCode).not.toBe(0);
      expect((deniedRes.stderr ?? '').toLowerCase()).toContain('denied');

      failNextCallWithSecret = true;
      const errRes = await direct.get('gh__allowed_tool')!.invoke({ q: 'boom' });
      expect(errRes.exitCode).not.toBe(0);
      expect(errRes.stderr).not.toContain('super-secret-token-value-123');
      expect(errRes.stdout).not.toContain('super-secret-token-value-123');
    });

    it('blocks remote HTTP upstreams under --offline', async () => {
      const gw = new McpGateway({
        offline: true,
        upstreams: {
          remote: {
            transport: 'http',
            url: mockUrl,
          },
        },
      });

      const direct = await gw.discoverTools();
      expect(direct.size).toBe(0);

      const res = await gw.callTool('remote', 'allowed_tool', {});
      expect(res.exitCode).not.toBe(0);
      expect((res.stderr ?? '').toLowerCase()).toContain('offline');
    });
  });

  describe('portal deep links and /api/handbook/index', () => {
    it('serves pre-routed SPA for /handbook/<context>/<doc> and /browse/<context>/<path>, and returns /api/handbook/index', async () => {
      const repoDir = makeTempDir('xray-portal-');
      const uiDir = makeTempDir('xray-ui-');
      tempDirs.push(repoDir, uiDir);

      fs.writeFileSync(
        path.join(uiDir, 'index.html'),
        '<!DOCTYPE html><html><head><title>xray</title></head><body><div id="app"></div></body></html>',
        'utf8'
      );
      const handbookDir = path.join(repoDir, '.xray', 'handbook');
      fs.mkdirSync(handbookDir, { recursive: true });
      fs.writeFileSync(
        path.join(handbookDir, 'README.md'),
        '---\nsubsystem: overview\ngenerator: deterministic\nlastUpdatedAt: 2026-11-22T10:00:00Z\nlastUpdatedCommit: abc1234\n---\n# Overview\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(handbookDir, 'auth.md'),
        '---\nsubsystem: auth\ngenerator: deterministic\nlastUpdatedAt: 2026-11-22T11:00:00Z\nlastUpdatedCommit: def5678\n---\n# Auth\n',
        'utf8'
      );

      const srv = createServeHttpServer({
        serverRoot: repoDir,
        port: 0,
        uiDir,
      });
      await srv.start();
      try {
        const ctxName = path.basename(fs.realpathSync(repoDir));
        const hbPage = await httpRequest(srv.url, `/handbook/${encodeURIComponent(ctxName)}/auth`);
        expect(hbPage.status).toBe(200);
        expect(hbPage.headers['content-type']).toContain('text/html');
        expect(hbPage.body).toContain('__XRAY_INITIAL_ROUTE__');
        expect(hbPage.body).toContain('"auth"');

        const browsePage = await httpRequest(srv.url, `/browse/${encodeURIComponent(ctxName)}/src/index.ts`);
        expect(browsePage.status).toBe(200);
        expect(browsePage.headers['content-type']).toContain('text/html');
        expect(browsePage.body).toContain('__XRAY_INITIAL_ROUTE__');
        expect(browsePage.body).toContain('src/index.ts');

        const idxRes = await httpRequest(srv.url, '/api/handbook/index');
        expect(idxRes.status).toBe(200);
        const idx = JSON.parse(idxRes.body);
        expect(Array.isArray(idx.contexts)).toBe(true);
        expect(idx.contexts).toHaveLength(1);
        expect(idx.contexts[0]).toMatchObject({
          exists: true,
          docCount: 2,
          lastUpdatedAt: '2026-11-22T11:00:00Z',
          lastUpdatedCommit: 'def5678',
        });
        expect(idx.contexts[0].url).toBe(`/handbook/${encodeURIComponent(ctxName)}/README`);
      } finally {
        await srv.stop();
      }
    });
  });

  describe('JSONL audit log', () => {
    it('emits JSONL for auth, scoped-token, and admin events while excluding routine search/file reads', async () => {
      const repoDir = makeTempDir('xray-audit-');
      const logDir = makeTempDir('xray-audit-log-');
      tempDirs.push(repoDir, logDir);
      fs.writeFileSync(path.join(repoDir, 'hello.ts'), 'export const x = 1;\n', 'utf8');
      const auditPath = path.join(logDir, 'audit.jsonl');

      const program = new Command('xray');
      const mcpSrv = createMcpHttpServer(program, {
        serverRoot: repoDir,
        serverConfig: null,
        entry: 'dist/index.js',
        timeoutMs: 5000,
        version: '0.1.0',
        port: 0,
        token: 'master-secret',
        auditLog: auditPath,
      });
      await mcpSrv.start();
      try {
        const unauth = await httpRequest(mcpSrv.url, '/mcp', { method: 'POST', body: '{}' });
        expect(unauth.status).toBe(401);

        const mint = await httpRequest(mcpSrv.url, '/auth/scoped-token', {
          method: 'POST',
          headers: { authorization: 'Bearer master-secret' },
          body: JSON.stringify({ roots: [repoDir] }),
        });
        expect(mint.status).toBe(200);
        const { jti } = JSON.parse(mint.body);

        const rev = await httpRequest(mcpSrv.url, `/auth/scoped-token/${jti}`, {
          method: 'DELETE',
          headers: { authorization: 'Bearer master-secret' },
        });
        expect(rev.status).toBe(200);
      } finally {
        await mcpSrv.stop();
      }

      const serveSrv = createServeHttpServer({
        serverRoot: repoDir,
        port: 0,
        apiOnly: true,
        auditLog: auditPath,
      });
      await serveSrv.start();
      try {
        const fileRes = await httpRequest(serveSrv.url, '/api/file?path=hello.ts');
        expect(fileRes.status).toBe(200);
      } finally {
        await serveSrv.stop();
      }

      const lines = fs
        .readFileSync(auditPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(lines.length).toBeGreaterThanOrEqual(4);
      for (const entry of lines) {
        expect(typeof entry.ts).toBe('string');
        expect(typeof entry.event).toBe('string');
        expect(typeof entry.actor).toBe('string');
        expect(typeof entry.target).toBe('string');
        expect(typeof entry.status).toBe('string');
      }
      expect(lines.some((e) => e.event === 'auth.denied' && e.status === 'denied')).toBe(true);
      expect(lines.some((e) => e.event === 'scoped_token.mint' && e.status === 'ok')).toBe(true);
      expect(lines.some((e) => e.event === 'scoped_token.revoke' && e.status === 'ok')).toBe(true);
      expect(lines.some((e) => e.event === 'admin.server_start')).toBe(true);
      expect(lines.some((e) => e.target.includes('/api/file'))).toBe(false);
    });
  });
});
