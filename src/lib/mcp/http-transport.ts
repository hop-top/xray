/**
 * Streamable HTTP transport for `xray mcp --transport http`.
 *
 * Wraps `createXrayMcpHandler` (with both MCP_SPEC_2024_11_05 and
 * MCP_SPEC_2026_07_28 enabled) over Node's `node:http` server.
 *
 * Security boundaries:
 * - Default bind `127.0.0.1`; non-loopback `--host` requires `--token`
 *   (or `XRAY_MCP_TOKEN`).
 * - `Origin` header guard on every request: if present, must be
 *   `http(s)://localhost(:port)?`, `127.0.0.1`, or `[::1]`, else 403.
 * - `POST /auth/scoped-token` and `DELETE /auth/scoped-token/:jti`
 *   strictly return 403 when master `--token` is not configured.
 * - Master token and `xrst_` scoped token verification use `timingSafeEqual`.
 * - Does NOT hijack `process.stdout.write`.
 */
import * as http from 'http';
import type { Command } from 'commander';
import type { McpHandler } from '@hop-top/kit/dist/mcp';
import { UsageError } from '../error/types';
import { createXrayMcpHandler, type StartOptions } from './server';
import {
  intersectAllowedRoots,
  runWithScopedRoots,
  ScopedTokenManager,
  SCOPED_TOKEN_PREFIX,
  timingSafeEqualStrings,
} from './scoped-token';
import { WarmWorkspaceManager } from './workspace';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface HttpTransportOptions extends StartOptions {
  host?: string;
  port?: number;
  token?: string;
}

export interface McpHttpServerInstance {
  readonly server: http.Server;
  readonly port: number;
  readonly url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Whether `host` is a loopback address (`127.0.0.1`, `localhost`, `::1`, `127.x.x.x`). */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;
  return false;
}

/**
 * Validate `Origin` header against loopback origins (`http(s)://localhost`,
 * `127.0.0.1`, `[::1]`). Absent `Origin` is allowed (non-browser clients).
 */
export function isAllowedOrigin(originHeader: string | string[] | undefined): boolean {
  if (originHeader === undefined) return true;
  if (Array.isArray(originHeader)) return false;
  try {
    const parsed = new URL(originHeader);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body, 'utf8')),
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks, total).toString('utf8')));
    req.on('error', reject);
  });
}

function extractBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1].trim() : null;
}

function normalizeHeaders(
  headers: http.IncomingHttpHeaders
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/**
 * Create an HTTP server for `xray mcp --transport http`.
 * Throws `UsageError` if a non-loopback `host` is used without `token`.
 */
export function createMcpHttpServer(
  program: Command,
  options: HttpTransportOptions
): McpHttpServerInstance {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 3000;
  const masterToken = options.token && options.token.length > 0 ? options.token : undefined;

  if (!isLoopbackHost(host) && !masterToken) {
    throw new UsageError(
      `--token (or XRAY_MCP_TOKEN) is required when binding --host "${host}" to a non-loopback address`
    );
  }

  const workspace = options.workspace;
  const tokenManager = masterToken ? new ScopedTokenManager(masterToken) : null;
  const mcpHandler: McpHandler = createXrayMcpHandler(program, {
    ...options,
    transport: 'http',
  });

  let boundPort = requestedPort;

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAllowedOrigin(req.headers.origin)) {
        sendJson(res, 403, { error: 'forbidden origin' });
        return;
      }

      const method = (req.method ?? 'GET').toUpperCase();
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

      if (method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { ok: true, status: 'ok' });
        return;
      }

      if (pathname === '/auth/scoped-token' || pathname.startsWith('/auth/scoped-token/')) {
        if (!masterToken || !tokenManager) {
          sendJson(res, 403, { error: 'scoped tokens require master --token' });
          return;
        }
        const bearer = extractBearerToken(req);
        if (!bearer || !timingSafeEqualStrings(bearer, masterToken)) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }

        if (method === 'POST' && pathname === '/auth/scoped-token') {
          let parsedBody: Record<string, unknown> = {};
          try {
            const raw = await readBody(req);
            if (raw.trim() !== '') {
              const v = JSON.parse(raw);
              if (v === null || typeof v !== 'object' || Array.isArray(v)) {
                sendJson(res, 400, { error: 'invalid JSON body' });
                return;
              }
              parsedBody = v as Record<string, unknown>;
            }
          } catch {
            sendJson(res, 400, { error: 'invalid JSON body' });
            return;
          }

          let roots: string[];
          if (parsedBody.roots === undefined) {
            roots = workspace ? [...workspace.getAllowedRoots()] : [options.serverRoot];
          } else if (
            Array.isArray(parsedBody.roots) &&
            parsedBody.roots.every((r) => typeof r === 'string')
          ) {
            roots = parsedBody.roots;
          } else {
            sendJson(res, 400, { error: 'roots must be an array of strings' });
            return;
          }

          const minted = tokenManager.mintDetailed(roots);
          sendJson(res, 200, {
            token: minted.token,
            jti: minted.claims.jti,
            exp: minted.claims.exp,
            roots: minted.claims.roots,
          });
          return;
        }

        if (method === 'DELETE' && pathname.startsWith('/auth/scoped-token/')) {
          const jti = decodeURIComponent(pathname.slice('/auth/scoped-token/'.length));
          if (!jti || jti.includes('/')) {
            sendJson(res, 400, { error: 'invalid token jti' });
            return;
          }
          tokenManager.revoke(jti);
          sendJson(res, 200, { revoked: true, jti });
          return;
        }

        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }

      if (pathname === '/mcp') {
        let scopedRoots: Set<string> | undefined;

        if (masterToken && tokenManager) {
          const bearer = extractBearerToken(req);
          if (!bearer) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
          }
          if (timingSafeEqualStrings(bearer, masterToken)) {
            scopedRoots = undefined;
          } else if (bearer.startsWith(SCOPED_TOKEN_PREFIX)) {
            const claims = tokenManager.verify(bearer);
            if (!claims) {
              sendJson(res, 401, { error: 'invalid or expired scoped token' });
              return;
            }
            const serverAllowed = workspace?.getAllowedRoots() ?? options.allowedRoots ?? new Set([options.serverRoot]);
            scopedRoots = intersectAllowedRoots(claims.roots, serverAllowed, options.serverRoot);
          } else {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
          }
        }

        const body = method === 'POST' ? await readBody(req) : undefined;
        const invokeMcp = () =>
          mcpHandler({
            method,
            headers: normalizeHeaders(req.headers),
            ...(body !== undefined ? { body } : {}),
          });

        const mcpRes = scopedRoots ? await runWithScopedRoots(scopedRoots, invokeMcp) : await invokeMcp();
        res.writeHead(mcpRes.status, mcpRes.headers);
        res.end(mcpRes.body);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: message });
      } else {
        res.end();
      }
    }
  });

  return {
    server,
    get port() {
      return boundPort;
    },
    get url() {
      const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      return `http://${formattedHost}:${boundPort}`;
    },
    start: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, host, () => {
          server.removeListener('error', reject);
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            boundPort = addr.port;
          }
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Start the HTTP MCP server and wait until SIGINT/SIGTERM closes it. */
export async function startMcpHttpServer(
  program: Command,
  options: HttpTransportOptions
): Promise<void> {
  const workspace = options.workspace ?? new WarmWorkspaceManager(options.serverRoot, options.serverConfig);
  const instance = createMcpHttpServer(program, { ...options, workspace });
  try {
    await instance.start();
    process.stderr.write(`xray mcp http listening on ${instance.url}/mcp\n`);
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
        void instance.stop().finally(() => resolve());
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  } finally {
    if (!options.workspace) {
      workspace.close();
    }
  }
}
