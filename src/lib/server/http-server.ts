/**
 * Local read-only REST API + static Web UI HTTP server for `xray serve`.
 *
 * Security boundaries:
 * - Binds `127.0.0.1` by default; non-loopback `--host` requires `--token`.
 * - `Origin` header guard on every request: if present, must be loopback
 *   (`http(s)://localhost`, `127.0.0.1`, `[::1]`), else 403.
 * - Optional Bearer `--token` enforced via `timingSafeEqualStrings` on `/api/*`
 *   and `/mcp`.
 * - All filesystem paths are confined via `WarmWorkspaceManager.containAcrossAllowedRoots`
 *   and read via `readTextSafe()`, refusing `.git/` and sensitive files
 *   (`.env`, `.env.*`, `*.pem`, `*.key`).
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type { Command } from 'commander';
import ignore, { type Ignore } from 'ignore';
import type { McpHandler } from '@hop-top/kit/dist/mcp';
import { isWithin } from '../confine';
import { UsageError } from '../error/types';
import { getDiff, getFileBlame, isGitRepo, listBranches, listCommits } from '../git';
import { listHandbookPages, readHandbookPage } from '../handbook/generator';
import { isAllowedOrigin, isLoopbackHost } from '../mcp/http-transport';
import { timingSafeEqualStrings } from '../mcp/scoped-token';
import { createXrayMcpHandler, defaultEntry } from '../mcp/server';
import { ToolArgumentError } from '../mcp/tools';
import { WarmWorkspaceManager } from '../mcp/workspace';
import { truncateLine, windowSlice } from '../output-guardrails';
import { evaluateFilter, parseFilterDsl } from '../query/filter-dsl';
import { computeImpact, DEFAULT_IMPACT_DEPTH } from '../query/impact';
import { renderMermaid, type MermaidView } from '../renderer/mermaid-renderer';
import { readTextSafe } from '../safe-read';
import { actorFromRequest, createAuditLogger } from './audit';
import { loadGatewayUpstreams, McpGateway } from './gateway';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_READ_LINES = 2000;
const DEFAULT_READ_LINES = 500;
const MAX_LINE_CHARS = 2000;
const MAX_TREE_DEPTH = 10;
const DEFAULT_TREE_LIMIT = 1000;
const MAX_TREE_LIMIT = 10_000;

export interface ServeHttpOptions {
  serverRoot: string;
  serverConfig?: string | null;
  host?: string;
  port?: number;
  token?: string;
  apiOnly?: boolean;
  mcp?: boolean;
  auditLog?: string;
  offline?: boolean;
  gateway?: McpGateway;
  program?: Command;
  workspace?: WarmWorkspaceManager;
  version?: string;
  uiDir?: string;
}

export interface ServeHttpServerInstance {
  readonly server: http.Server;
  readonly port: number;
  readonly url: string;
  readonly workspace: WarmWorkspaceManager;
  start(): Promise<void>;
  stop(): Promise<void>;
}

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body, 'utf8')),
    'cache-control': 'no-store',
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
        reject(new HttpStatusError(413, 'request body too large'));
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

function isSensitiveFile(relPath: string): boolean {
  const base = path.basename(relPath);
  if (base === '.env' || base.startsWith('.env.')) return true;
  const lower = base.toLowerCase();
  return lower.endsWith('.pem') || lower.endsWith('.key');
}

function hasGitSegment(relPath: string): boolean {
  return relPath.split(/[/\\]/).some((seg) => seg === '.git');
}

function loadGitignore(rootDir: string): Ignore {
  const ig = ignore();
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      ig.add(readTextSafe(rootDir, '.gitignore'));
    } catch {
      // Ignore unreadable .gitignore
    }
  }
  return ig;
}

function parseIntParam(
  raw: string | null,
  def: number,
  min: number,
  max: number,
  name: string
): number {
  if (raw === null || raw === '') return def;
  const num = Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new HttpStatusError(400, `query parameter "${name}" must be an integer`);
  }
  return Math.min(max, Math.max(min, num));
}

function resolveRootDir(workspace: WarmWorkspaceManager, rawRoot: string | null): string {
  if (!rawRoot) return workspace.serverRoot;
  let contained: { root: string; absPath: string };
  try {
    contained = workspace.containAcrossAllowedRoots(rawRoot);
  } catch (err: any) {
    throw new HttpStatusError(403, err?.message ?? 'root outside allowed roots');
  }
  let realDir: string;
  try {
    realDir = fs.realpathSync(contained.absPath);
  } catch {
    throw new HttpStatusError(404, `root "${rawRoot}" does not exist`);
  }
  if (!fs.statSync(realDir).isDirectory()) {
    throw new HttpStatusError(400, `root "${rawRoot}" is not a directory`);
  }
  return realDir;
}

function resolveContainedTarget(
  workspace: WarmWorkspaceManager,
  rawRoot: string | null,
  rawPath: string
): { matchedRoot: string; callDir: string; realTarget: string; relToRoot: string } {
  const callDir = resolveRootDir(workspace, rawRoot);
  const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(callDir, rawPath);

  let contained: { root: string; absPath: string };
  try {
    contained = workspace.containAcrossAllowedRoots(candidate);
  } catch (err: any) {
    throw new HttpStatusError(403, err?.message ?? 'path outside allowed roots');
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(contained.absPath);
  } catch {
    throw new HttpStatusError(404, `path "${rawPath}" does not exist`);
  }

  if (rawRoot && !isWithin(callDir, realTarget)) {
    throw new HttpStatusError(403, `path "${rawPath}" escapes root "${rawRoot}"`);
  }

  const relToRoot = path.relative(contained.root, realTarget).split(path.sep).join('/');
  return { matchedRoot: contained.root, callDir, realTarget, relToRoot };
}

function assertSafeTarget(relToRoot: string, rawPath: string): void {
  if (hasGitSegment(relToRoot) || hasGitSegment(rawPath)) {
    throw new HttpStatusError(403, `refusing to access inside .git: "${rawPath}"`);
  }
  if (isSensitiveFile(relToRoot)) {
    throw new HttpStatusError(403, `refusing to access sensitive file: "${rawPath}"`);
  }
}

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStaticFile(
  res: http.ServerResponse,
  uiDir: string,
  pathname: string
): boolean {
  const reqRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!reqRel || reqRel.includes('..') || reqRel.includes('\0')) {
    sendJson(res, 403, { error: 'forbidden path' });
    return true;
  }
  const resolvedUiDir = path.resolve(uiDir);
  const target = path.resolve(resolvedUiDir, reqRel);
  if (!isWithin(resolvedUiDir, target)) {
    sendJson(res, 403, { error: 'forbidden path' });
    return true;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return false;
  }
  const ext = path.extname(target).toLowerCase();
  const mime = STATIC_MIME[ext] ?? 'application/octet-stream';
  const data = fs.readFileSync(target);
  res.writeHead(200, {
    'content-type': mime,
    'content-length': String(data.length),
    'cache-control': 'no-cache',
  });
  res.end(data);
  return true;
}

interface PortalInitialRoute {
  mode: 'handbook' | 'browse';
  context: string;
  target: string;
}

function parsePortalDeepLink(pathname: string): PortalInitialRoute | null {
  const hbMatch = /^\/handbook\/([^/]+)\/(.+)$/.exec(pathname);
  if (hbMatch) {
    return {
      mode: 'handbook',
      context: decodeURIComponent(hbMatch[1]),
      target: decodeURIComponent(hbMatch[2]),
    };
  }
  const browseMatch = /^\/browse\/([^/]+)\/(.+)$/.exec(pathname);
  if (browseMatch) {
    return {
      mode: 'browse',
      context: decodeURIComponent(browseMatch[1]),
      target: decodeURIComponent(browseMatch[2]),
    };
  }
  return null;
}

function servePortalSpa(
  res: http.ServerResponse,
  uiDir: string,
  route: PortalInitialRoute
): boolean {
  const indexPath = path.resolve(uiDir, 'index.html');
  if (!isWithin(path.resolve(uiDir), indexPath) || !fs.existsSync(indexPath)) {
    return false;
  }
  let html = fs.readFileSync(indexPath, 'utf8');
  const serialized = JSON.stringify(route).replace(/</g, '\\u003c');
  const scriptTag = `<script>window.__XRAY_INITIAL_ROUTE__ = ${serialized};</script>`;
  if (html.includes('</head>')) {
    html = html.replace('</head>', `  ${scriptTag}\n</head>`);
  } else {
    html = `${scriptTag}\n${html}`;
  }
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(buf.length),
    'cache-control': 'no-cache',
  });
  res.end(buf);
  return true;
}

/**
 * Create the local Web UI & read-only REST API HTTP server.
 * Throws `UsageError` when binding a non-loopback `host` without `token`.
 */
export function createServeHttpServer(options: ServeHttpOptions): ServeHttpServerInstance {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 4173;
  const masterToken = options.token && options.token.length > 0 ? options.token : undefined;
  const apiOnly = Boolean(options.apiOnly);
  const uiDir = options.uiDir ?? path.resolve(__dirname, '../../ui');

  if (!isLoopbackHost(host) && !masterToken) {
    throw new UsageError(
      `--token (or XRAY_SERVE_TOKEN) is required when binding --host "${host}" to a non-loopback address`
    );
  }

  const ownsWorkspace = !options.workspace;
  const workspace =
    options.workspace ?? new WarmWorkspaceManager(options.serverRoot, options.serverConfig ?? null);
  const audit = createAuditLogger(options.auditLog);

  let mcpHandler: McpHandler | null = null;
  if (options.mcp) {
    if (!options.program) {
      throw new UsageError('internal error: program is required when --mcp is enabled');
    }
    mcpHandler = createXrayMcpHandler(options.program, {
      serverRoot: workspace.serverRoot,
      serverConfig: workspace.serverConfig,
      entry: defaultEntry(),
      timeoutMs: 300_000,
      version: options.version ?? '0.1.0',
      workspace,
      gateway: options.gateway,
      offline: options.offline,
      transport: 'http',
    });
  }

  let boundPort = requestedPort;

  const server = http.createServer(async (req, res) => {
    const actor = actorFromRequest(req);
    try {
      if (!isAllowedOrigin(req.headers.origin)) {
        audit?.log({ event: 'auth.forbidden_origin', actor, target: req.url ?? '/', status: 'denied' });
        sendJson(res, 403, { error: 'forbidden origin' });
        return;
      }

      const method = (req.method ?? 'GET').toUpperCase();
      const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;
      const params = parsedUrl.searchParams;

      if (method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { ok: true, status: 'ok' });
        return;
      }

      const requiresAuth = pathname.startsWith('/api/') || pathname === '/mcp';
      if (masterToken && requiresAuth) {
        const bearer = extractBearerToken(req);
        if (!bearer || !timingSafeEqualStrings(bearer, masterToken)) {
          audit?.log({ event: 'auth.denied', actor, target: pathname, status: 'denied' });
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
      }

      if (pathname === '/mcp') {
        if (!mcpHandler) {
          sendJson(res, 404, { error: 'mcp endpoint disabled (pass --mcp to enable)' });
          return;
        }
        const body = method === 'POST' ? await readBody(req) : undefined;
        const mcpRes = await mcpHandler({
          method,
          headers: normalizeHeaders(req.headers),
          ...(body !== undefined ? { body } : {}),
        });
        res.writeHead(mcpRes.status, mcpRes.headers);
        res.end(mcpRes.body);
        return;
      }

      if (pathname.startsWith('/api/')) {
        if (method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed (read-only API)' });
          return;
        }

        if (pathname === '/api/contexts') {
          const roots = Array.from(workspace.getAllowedRoots()).map((r) => ({
            path: r,
            name: path.basename(r) || r,
          }));
          sendJson(res, 200, { serverRoot: workspace.serverRoot, roots });
          return;
        }

        if (pathname === '/api/tree') {
          const rawRoot = params.get('root');
          const relInput = params.get('path') || '.';
          const depth = parseIntParam(params.get('depth'), 1, 1, MAX_TREE_DEPTH, 'depth');
          const limit = parseIntParam(
            params.get('limit'),
            DEFAULT_TREE_LIMIT,
            1,
            MAX_TREE_LIMIT,
            'limit'
          );

          const { matchedRoot, realTarget, relToRoot } = resolveContainedTarget(
            workspace,
            rawRoot,
            relInput
          );
          if (hasGitSegment(relToRoot) || hasGitSegment(relInput)) {
            throw new HttpStatusError(403, 'refusing to list .git directory');
          }
          if (!fs.statSync(realTarget).isDirectory()) {
            throw new HttpStatusError(400, `path "${relInput}" must be a directory`);
          }

          const ig = loadGitignore(matchedRoot);
          const entries: Array<{ path: string; name: string; type: 'directory' | 'file' }> = [];
          let hasMore = false;

          const walk = (dir: string, currentDepth: number): void => {
            if (hasMore) return;
            let dirents: fs.Dirent[];
            try {
              dirents = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }

            const items: Array<{ name: string; full: string; rel: string; isDir: boolean }> = [];
            for (const d of dirents) {
              if (d.name === '.git') continue;
              const full = path.join(dir, d.name);
              let isDir = d.isDirectory();
              let isFile = d.isFile();
              if (d.isSymbolicLink()) {
                try {
                  const real = fs.realpathSync(full);
                  if (!isWithin(matchedRoot, real)) continue;
                  const st = fs.statSync(real);
                  isDir = st.isDirectory();
                  isFile = st.isFile();
                } catch {
                  continue;
                }
              }
              if (!isDir && !isFile) continue;

              const rel = path.relative(matchedRoot, full).split(path.sep).join('/');
              if (ig.ignores(isDir ? `${rel}/` : rel) || ig.ignores(rel)) continue;
              items.push({ name: d.name, full, rel, isDir });
            }

            items.sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.name.localeCompare(b.name);
            });

            for (const item of items) {
              if (entries.length >= limit) {
                hasMore = true;
                return;
              }
              entries.push({
                path: item.rel,
                name: item.name,
                type: item.isDir ? 'directory' : 'file',
              });
              if (item.isDir && currentDepth < depth) {
                walk(item.full, currentDepth + 1);
                if (hasMore) return;
              }
            }
          };

          walk(realTarget, 1);
          sendJson(res, 200, {
            root: matchedRoot,
            path: relToRoot || '.',
            entries,
            hasMore,
          });
          return;
        }

        if (pathname === '/api/file') {
          const rawPath = params.get('path');
          if (!rawPath) {
            throw new HttpStatusError(400, 'query parameter "path" is required');
          }
          const offset = parseIntParam(
            params.get('offset'),
            1,
            1,
            Number.MAX_SAFE_INTEGER,
            'offset'
          );
          const limit = parseIntParam(
            params.get('limit'),
            DEFAULT_READ_LINES,
            1,
            MAX_READ_LINES,
            'limit'
          );

          const { matchedRoot, realTarget, relToRoot } = resolveContainedTarget(
            workspace,
            params.get('root'),
            rawPath
          );
          assertSafeTarget(relToRoot, rawPath);

          if (!fs.statSync(realTarget).isFile()) {
            throw new HttpStatusError(400, `path "${rawPath}" is not a file`);
          }

          let content: string;
          try {
            content = readTextSafe(matchedRoot, realTarget);
          } catch (err: any) {
            throw new HttpStatusError(403, err?.message ?? 'cannot read file');
          }

          const rawLines = content.length === 0 ? [] : content.split(/\r?\n/);
          if (content.endsWith('\n') && rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
            rawLines.pop();
          }

          const slice = windowSlice(rawLines, {
            offset: offset - 1,
            limit,
            maxLimit: MAX_READ_LINES,
          });
          const lines = slice.items.map((line, idx) => {
            const trunc = truncateLine(line, MAX_LINE_CHARS);
            return {
              line: offset + idx,
              text: trunc.text,
              ...(trunc.truncated ? { truncated: true } : {}),
            };
          });

          sendJson(res, 200, {
            root: matchedRoot,
            path: relToRoot,
            offset,
            limit: slice.limit,
            totalLines: rawLines.length,
            hasMore: slice.hasMore,
            lines,
          });
          return;
        }

        if (pathname === '/api/search') {
          const query = params.get('q') ?? '';
          if (!query) {
            throw new HttpStatusError(400, 'query parameter "q" is required');
          }
          const regex = params.get('regex') === 'true' || params.get('regex') === '1';
          const caseSensitive = params.get('case') === 'true' || params.get('case') === '1';
          const filterExpr = params.get('filter') ?? '';
          const offset = parseIntParam(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
          const limit = parseIntParam(params.get('limit'), 100, 1, 500, 'limit');

          const rootDir = resolveRootDir(workspace, params.get('root'));
          const warm = await workspace.getGraph(rootDir);
          const trigramIndex = workspace.getTrigramIndex(rootDir);
          const files = Object.keys(warm.manifest.fileManifest);
          trigramIndex.sync(rootDir, files);

          const filterAst = filterExpr.trim() ? parseFilterDsl(filterExpr) : null;
          const searchResult = trigramIndex.search(query, {
            regex,
            caseSensitive,
            offset: filterAst ? 0 : offset,
            limit: filterAst ? 500 : limit,
          });

          if (!filterAst) {
            sendJson(res, 200, { root: rootDir, query, ...searchResult });
            return;
          }

          const filtered = searchResult.matches.filter((m) =>
            evaluateFilter(filterAst, { file: m.relPath, content: m.content })
          );
          const sliced = windowSlice(filtered, { offset, limit, maxLimit: 500 });
          sendJson(res, 200, {
            root: rootDir,
            query,
            matches: sliced.items,
            total: sliced.total,
            offset: sliced.offset,
            limit: sliced.limit,
            hasMore: sliced.hasMore,
            candidateFiles: searchResult.candidateFiles,
            usedFts: searchResult.usedFts,
          });
          return;
        }

        if (pathname === '/api/symbols') {
          const rootDir = resolveRootDir(workspace, params.get('root'));
          const rawPath = params.get('path');
          let relFilter: string | null = null;
          if (rawPath) {
            const target = resolveContainedTarget(workspace, params.get('root'), rawPath);
            assertSafeTarget(target.relToRoot, rawPath);
            relFilter = target.relToRoot;
          }

          const warm = await workspace.getGraph(rootDir);
          const symbols: Array<{
            id: string;
            name: string;
            kind: string;
            file: string;
            line: number;
            endLine?: number;
            signature?: string;
            rank: number;
            community?: number;
          }> = [];

          for (const node of warm.serialized.nodes) {
            if (node.type !== 'tag') continue;
            const nodeFile = node.file
              ? path.isAbsolute(node.file)
                ? path.relative(rootDir, node.file).split(path.sep).join('/')
                : node.file.split(path.sep).join('/')
              : '';
            if (relFilter && nodeFile !== relFilter) continue;
            symbols.push({
              id: node.id,
              name: node.label,
              kind: node.kind ?? 'symbol',
              file: nodeFile,
              line: typeof node.line === 'number' ? node.line + 1 : 1,
              ...(typeof node.endLine === 'number' ? { endLine: node.endLine + 1 } : {}),
              ...(node.signature ? { signature: node.signature } : {}),
              rank: typeof node.rank === 'number' ? node.rank : 0,
              ...(typeof node.community === 'number' ? { community: node.community } : {}),
            });
          }

          symbols.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
          sendJson(res, 200, { root: rootDir, path: relFilter, symbols });
          return;
        }

        if (pathname === '/api/impact') {
          const symbol = params.get('symbol')?.trim();
          if (!symbol) {
            throw new HttpStatusError(400, 'query parameter "symbol" is required');
          }
          const depth = parseIntParam(
            params.get('depth'),
            DEFAULT_IMPACT_DEPTH,
            1,
            20,
            'depth'
          );
          const crossContext = params.get('crossContext') === 'true';
          const rootDir = resolveRootDir(workspace, params.get('root'));
          const warm = await workspace.getGraph(rootDir);
          const impact = computeImpact(warm.graph, symbol, { depth });

          const crossContextResults: Array<{ root: string; nodes: typeof impact.nodes }> = [];
          if (crossContext) {
            for (const otherRoot of workspace.getAllowedRoots()) {
              if (otherRoot === rootDir) continue;
              try {
                const otherWarm = await workspace.getGraph(otherRoot);
                const otherImpact = computeImpact(otherWarm.graph, symbol, { depth });
                if (otherImpact.nodes.length > 0) {
                  crossContextResults.push({
                    root: otherRoot,
                    nodes: otherImpact.nodes,
                  });
                }
              } catch {
                // Skip roots that fail to analyze
              }
            }
          }

          sendJson(res, 200, {
            root: rootDir,
            crossContext,
            ...impact,
            ...(crossContext ? { crossContextResults } : {}),
          });
          return;
        }

        if (pathname === '/api/commits') {
          const rootDir = resolveRootDir(workspace, params.get('root'));
          const repoOk = await isGitRepo(rootDir);
          if (!repoOk) {
            sendJson(res, 200, {
              root: rootDir,
              isGitRepo: false,
              branches: [],
              commits: [],
              page: 1,
              perPage: 50,
              hasMore: false,
            });
            return;
          }
          const page = parseIntParam(params.get('page'), 1, 1, 10_000, 'page');
          const perPage = parseIntParam(params.get('perPage'), 50, 1, 100, 'perPage');
          const [branches, commits] = await Promise.all([
            listBranches(rootDir),
            listCommits(rootDir, {
              query: params.get('query') ?? undefined,
              author: params.get('author') ?? undefined,
              since: params.get('since') ?? undefined,
              until: params.get('until') ?? undefined,
              ref: params.get('ref') ?? undefined,
              page,
              perPage,
              includeRefs: true,
            }),
          ]);
          sendJson(res, 200, { root: rootDir, isGitRepo: true, branches, ...commits });
          return;
        }

        if (pathname === '/api/diff') {
          const rootDir = resolveRootDir(workspace, params.get('root'));
          const base = params.get('base') || 'WORKING';
          const head = params.get('head') || 'HEAD';
          const rawPath = params.get('path');
          const files = await getDiff(
            rootDir,
            base,
            head,
            rawPath ? [rawPath] : undefined
          );
          sendJson(res, 200, { root: rootDir, base, head, files });
          return;
        }

        if (pathname === '/api/blame') {
          const rawPath = params.get('path');
          if (!rawPath) {
            throw new HttpStatusError(400, 'query parameter "path" is required');
          }
          const { matchedRoot, relToRoot } = resolveContainedTarget(
            workspace,
            params.get('root'),
            rawPath
          );
          assertSafeTarget(relToRoot, rawPath);
          const ref = params.get('ref') ?? undefined;
          const blame = await getFileBlame(matchedRoot, relToRoot, ref);
          sendJson(res, 200, { root: matchedRoot, path: relToRoot, blame });
          return;
        }

        if (pathname === '/api/handbook') {
          const rootDir = resolveRootDir(workspace, params.get('root'));
          const slug = params.get('slug') || 'README';
          const handbookDir = path.join(rootDir, '.xray', 'handbook');
          const pages = listHandbookPages(handbookDir);
          const content = readHandbookPage(handbookDir, slug);
          sendJson(res, 200, {
            root: rootDir,
            slug,
            exists: content !== null,
            pages,
            content,
          });
          return;
        }

        if (pathname === '/api/handbook/index') {
          const contexts = Array.from(workspace.getAllowedRoots()).map((r) => {
            const name = path.basename(r) || r;
            const handbookDir = path.join(r, '.xray', 'handbook');
            const pages = listHandbookPages(handbookDir);
            const exists = pages.length > 0;
            const firstSlug = pages[0]?.slug ?? 'README';
            let lastUpdatedAt = '';
            let lastUpdatedCommit = '';
            for (const p of pages) {
              if (p.lastUpdatedAt && p.lastUpdatedAt >= lastUpdatedAt) {
                lastUpdatedAt = p.lastUpdatedAt;
                lastUpdatedCommit = p.lastUpdatedCommit || lastUpdatedCommit;
              }
            }
            return {
              name,
              root: r,
              exists,
              url: `/handbook/${encodeURIComponent(name)}/${encodeURIComponent(firstSlug)}`,
              docCount: pages.length,
              lastUpdatedAt,
              lastUpdatedCommit,
            };
          });
          sendJson(res, 200, { serverRoot: workspace.serverRoot, contexts });
          return;
        }

        if (pathname === '/api/diagram') {
          const rootDir = resolveRootDir(workspace, params.get('root'));
          const rawView = (params.get('view') || 'architecture').toLowerCase();
          const view: MermaidView =
            rawView === 'calls' || rawView === 'cfg' || rawView === 'dfg'
              ? rawView
              : 'architecture';
          const anchor = params.get('anchor') ?? undefined;
          const maxNodes = parseIntParam(params.get('maxNodes'), 60, 1, 300, 'maxNodes');
          const depth = params.get('depth')
            ? parseIntParam(params.get('depth'), 2, 1, 10, 'depth')
            : undefined;

          const warm = await workspace.getGraph(rootDir);
          const mermaid = renderMermaid(warm.graph, {
            view,
            anchor,
            depth,
            maxNodes,
            root: rootDir,
          });

          const allNodes = warm.serialized.nodes;
          const filteredNodes = allNodes
            .filter((n) => (view === 'architecture' ? n.type === 'file' : n.type === 'tag'))
            .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
            .slice(0, maxNodes);

          const nodeIds = new Set(filteredNodes.map((n) => n.id));
          const edges = warm.serialized.edges
            .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
            .map((e) => ({
              source: e.source,
              target: e.target,
              type: e.type,
              ...(e.confidence ? { confidence: e.confidence } : {}),
            }));

          const nodes = filteredNodes.map((n) => ({
            id: n.id,
            label: n.label,
            type: n.type,
            ...(n.kind ? { kind: n.kind } : {}),
            ...(n.file ? { file: n.file } : {}),
            ...(typeof n.line === 'number' ? { line: n.line + 1 } : {}),
            rank: n.rank ?? 0,
            ...(typeof n.community === 'number' ? { community: n.community } : {}),
          }));

          sendJson(res, 200, {
            root: rootDir,
            view,
            anchor: anchor ?? null,
            mermaid,
            nodes,
            edges,
          });
          return;
        }

        sendJson(res, 404, { error: 'unknown API endpoint' });
        return;
      }

      if (!apiOnly && (method === 'GET' || method === 'HEAD')) {
        const portalRoute = parsePortalDeepLink(pathname);
        if (portalRoute && servePortalSpa(res, uiDir, portalRoute)) {
          return;
        }
        if (serveStaticFile(res, uiDir, pathname)) {
          return;
        }
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof HttpStatusError) {
        if (!res.headersSent) sendJson(res, err.status, { error: err.message });
        return;
      }
      if (err instanceof ToolArgumentError || err instanceof UsageError) {
        if (!res.headersSent) sendJson(res, 400, { error: err.message });
        return;
      }
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
    workspace,
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
          const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
          audit?.log({
            event: 'admin.server_start',
            actor: 'system',
            target: `http://${formattedHost}:${boundPort}`,
            status: 'ok',
          });
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
          audit?.log({
            event: 'admin.server_stop',
            actor: 'system',
            target: `http://${formattedHost}:${boundPort}`,
            status: err ? 'error' : 'ok',
          });
          if (ownsWorkspace) workspace.close();
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

/** Start the local Web UI & REST API server and wait for SIGINT/SIGTERM. */
export async function startServeHttpServer(options: ServeHttpOptions): Promise<void> {
  let gateway = options.gateway;
  if (options.mcp && !gateway) {
    const upstreams = loadGatewayUpstreams({
      serverRoot: options.serverRoot,
      serverConfig: options.serverConfig,
    });
    if (Object.keys(upstreams).length > 0) {
      const audit = createAuditLogger(options.auditLog);
      gateway = new McpGateway({ upstreams, offline: options.offline, audit });
      await gateway.discoverTools();
    }
  }
  const instance = createServeHttpServer({ ...options, gateway });
  await instance.start();
  const modeLabel = options.apiOnly ? 'REST API' : 'Web UI + REST API';
  process.stderr.write(`xray serve (${modeLabel}) listening on ${instance.url}\n`);
  if (options.mcp) {
    process.stderr.write(`xray mcp Streamable HTTP mounted at ${instance.url}/mcp\n`);
  }
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      void instance.stop().finally(() => resolve());
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
