/**
 * Optional MCP gateway proxy for upstream HTTP and stdio MCP servers.
 *
 * Security boundaries:
 * - `gateway.upstreams` loads ONLY from user global config (`loadGlobalConfig()`)
 *   unless `XRAY_ALLOW_PROJECT_GATEWAY=1` is set; repo-local `gateway` blocks
 *   are ignored with a warning to prevent untrusted-repo RCE (`stdio` command)
 *   and env-secret exfiltration (`http` `headerEnv`).
 * - `headerEnv` values resolve from `process.env` at request time only and are
 *   stripped from all error messages and tool responses.
 * - Remote HTTP upstreams are blocked under `--offline`.
 * - `allowTools` / `blockTools` are enforced both during discovery and invocation.
 */
import { spawn } from 'child_process';
import * as path from 'path';
import type { FlagSchema, InvokeResult } from '@hop-top/kit/dist/mcp';
import type { XrayGatewayUpstreamConfig } from '../../types/xray-config';
import {
  findConfigPath,
  findGlobalConfigPath,
  isUserGlobalConfig,
  loadConfigFile,
  loadGlobalConfig,
} from '../config';
import { Logger } from '../logger';
import type { DirectToolDef } from '../mcp/tools';
import type { AuditLogger } from './audit';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface LoadGatewayOptions {
  serverRoot: string;
  serverConfig?: string | null;
  allowProjectGateway?: boolean;
  warn?: (msg: string) => void;
}

/**
 * Load `gateway.upstreams` from user global config, rejecting repo-local
 * `gateway` blocks unless `XRAY_ALLOW_PROJECT_GATEWAY=1`.
 */
export function loadGatewayUpstreams(
  options: LoadGatewayOptions
): Record<string, XrayGatewayUpstreamConfig> {
  const warn = options.warn ?? ((msg: string) => Logger.warn(msg));
  const upstreams: Record<string, XrayGatewayUpstreamConfig> = {};

  const globalCfg = loadGlobalConfig();
  if (globalCfg?.gateway?.upstreams) {
    Object.assign(upstreams, globalCfg.gateway.upstreams);
  }

  const globalPath = findGlobalConfigPath();
  const candidateLocalPath =
    options.serverConfig ?? findConfigPath(options.serverRoot);

  if (candidateLocalPath) {
    const isGlobal =
      (globalPath && path.resolve(candidateLocalPath) === path.resolve(globalPath)) ||
      isUserGlobalConfig(candidateLocalPath);
    if (!isGlobal) {
      try {
        const localCfg = loadConfigFile(candidateLocalPath);
        if (localCfg?.gateway !== undefined) {
          const allowProject =
            options.allowProjectGateway ??
            process.env.XRAY_ALLOW_PROJECT_GATEWAY === '1';
          if (!allowProject) {
            warn(
              `Ignoring repo-local gateway config in "${candidateLocalPath}" (set XRAY_ALLOW_PROJECT_GATEWAY=1 to enable)`
            );
          } else if (localCfg.gateway.upstreams) {
            Object.assign(upstreams, localCfg.gateway.upstreams);
          }
        }
      } catch {
        // Ignore unreadable local config; standard config loader reports it.
      }
    }
  }

  return upstreams;
}

/**
 * Enforce `allowTools` / `blockTools` policy for an upstream tool.
 * When `allowTools` is present, deny everything not listed; always deny `blockTools`.
 */
export function isToolAllowed(
  toolName: string,
  upstream: Pick<XrayGatewayUpstreamConfig, 'allowTools' | 'blockTools'>
): boolean {
  if (Array.isArray(upstream.blockTools) && upstream.blockTools.includes(toolName)) {
    return false;
  }
  if (Array.isArray(upstream.allowTools)) {
    return upstream.allowTools.includes(toolName);
  }
  return true;
}

/**
 * Resolve `headerEnv` from `process.env` at request time only, returning both
 * the HTTP headers and the list of secret values to scrub from outputs/errors.
 */
function resolveRequestHeaders(headerEnv?: Record<string, string>): {
  headers: Record<string, string>;
  secrets: string[];
} {
  const headers: Record<string, string> = {};
  const secrets: string[] = [];
  if (!headerEnv) return { headers, secrets };

  for (const [headerName, envName] of Object.entries(headerEnv)) {
    if (!headerName || !envName) continue;
    const val = process.env[envName];
    if (typeof val === 'string' && val.length > 0) {
      headers[headerName] = val;
      secrets.push(val);
      const bearerMatch = /^Bearer\s+(.+)$/i.exec(val);
      if (bearerMatch && bearerMatch[1].length > 0) {
        secrets.push(bearerMatch[1]);
      }
    }
  }
  return { headers, secrets };
}

/** Strip any resolved secret values from strings before returning or logging. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  return out;
}

interface UpstreamToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, FlagSchema>;
    required?: string[];
  };
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

function parseRpcPayload(raw: string, contentType: string | null): JsonRpcResponse {
  if (contentType && contentType.includes('text/event-stream')) {
    const dataLines = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== '[DONE]');
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(dataLines[i]) as JsonRpcResponse;
      } catch {
        // Try previous event frame.
      }
    }
    throw new Error('empty SSE response from upstream MCP server');
  }
  return JSON.parse(raw) as JsonRpcResponse;
}

async function httpJsonRpc(
  url: string,
  method: string,
  params: unknown,
  headerEnv: Record<string, string> | undefined,
  timeoutMs: number
): Promise<any> {
  const { headers, secrets } = resolveRequestHeaders(headerEnv);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        redactSecrets(`upstream HTTP ${res.status}: ${text.slice(0, 500)}`, secrets)
      );
    }

    const parsed = parseRpcPayload(text, res.headers.get('content-type'));
    if (parsed.error) {
      throw new Error(
        redactSecrets(parsed.error.message ?? 'upstream MCP JSON-RPC error', secrets)
      );
    }
    return parsed.result;
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(redactSecrets(msg, secrets));
  } finally {
    clearTimeout(timer);
  }
}

async function stdioJsonRpc(
  command: string,
  args: readonly string[] | undefined,
  method: string,
  params: unknown,
  timeoutMs: number
): Promise<any> {
  return new Promise((resolve, reject) => {
    const parts = args && args.length > 0 ? [command, ...args] : command.trim().split(/\s+/);
    const bin = parts[0];
    const cmdArgs = parts.slice(1);
    if (!bin) {
      reject(new Error('stdio upstream command is empty'));
      return;
    }

    const child = spawn(bin, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore already exited child.
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`stdio upstream timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcResponse;
          if (msg.id === 2) {
            if (msg.error) {
              finish(() => reject(new Error(msg.error?.message ?? 'stdio upstream RPC error')));
            } else {
              finish(() => resolve(msg.result));
            }
            return;
          }
        } catch {
          // Ignore non-JSON lines on stdout.
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });

    child.on('error', (err) => {
      finish(() => reject(err));
    });

    child.on('close', (code) => {
      finish(() =>
        reject(new Error(`stdio upstream exited (${code ?? 'null'}): ${stderrBuf.trim()}`))
      );
    });

    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'xray-gateway', version: '0.1.0' },
      },
    });
    const callReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method,
      params,
    });
    child.stdin.write(`${initReq}\n${callReq}\n`);
    child.stdin.end();
  });
}

function formatToolResult(result: any, secrets: readonly string[]): InvokeResult {
  const isError = Boolean(result?.isError);
  let text = '';
  if (Array.isArray(result?.content)) {
    text = result.content
      .map((item: any) => (typeof item?.text === 'string' ? item.text : JSON.stringify(item)))
      .join('\n');
  } else if (result !== undefined) {
    text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }
  const clean = redactSecrets(text, secrets);
  return isError
    ? { stdout: '', stderr: clean, exitCode: 1 }
    : { stdout: clean, stderr: '', exitCode: 0 };
}

export interface McpGatewayOptions {
  upstreams: Record<string, XrayGatewayUpstreamConfig>;
  offline?: boolean;
  audit?: AuditLogger | null;
  timeoutMs?: number;
}

export class McpGateway {
  private readonly upstreams: Record<string, XrayGatewayUpstreamConfig>;
  private readonly offline: boolean;
  private readonly audit: AuditLogger | null;
  private readonly timeoutMs: number;
  private directTools = new Map<string, DirectToolDef>();

  constructor(options: McpGatewayOptions) {
    this.upstreams = options.upstreams ?? {};
    this.offline = Boolean(options.offline);
    this.audit = options.audit ?? null;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getDirectTools(): ReadonlyMap<string, DirectToolDef> {
    return this.directTools;
  }

  private async rpc(
    upstreamName: string,
    upstream: XrayGatewayUpstreamConfig,
    method: string,
    params: unknown
  ): Promise<any> {
    if (upstream.transport === 'http') {
      if (this.offline) {
        this.audit?.log({
          event: 'gateway.upstream_blocked',
          actor: 'system',
          target: upstreamName,
          status: 'denied',
        });
        throw new Error(`Remote HTTP upstream "${upstreamName}" is blocked in --offline mode`);
      }
      if (!upstream.url) {
        throw new Error(`HTTP upstream "${upstreamName}" is missing url`);
      }
      return httpJsonRpc(upstream.url, method, params, upstream.headerEnv, this.timeoutMs);
    }

    if (upstream.transport === 'stdio') {
      if (!upstream.command) {
        throw new Error(`stdio upstream "${upstreamName}" is missing command`);
      }
      return stdioJsonRpc(upstream.command, upstream.args, method, params, this.timeoutMs);
    }

    throw new Error(`Unsupported upstream transport for "${upstreamName}"`);
  }

  async discoverTools(): Promise<Map<string, DirectToolDef>> {
    const discovered = new Map<string, DirectToolDef>();

    for (const [upstreamName, upstream] of Object.entries(this.upstreams)) {
      if (upstream.transport === 'http' && this.offline) {
        this.audit?.log({
          event: 'gateway.upstream_blocked',
          actor: 'system',
          target: upstreamName,
          status: 'denied',
        });
        Logger.warn(`gateway: skipping HTTP upstream "${upstreamName}" in --offline mode`);
        continue;
      }

      try {
        const res = await this.rpc(upstreamName, upstream, 'tools/list', {});
        const tools: UpstreamToolSchema[] = Array.isArray(res?.tools) ? res.tools : [];
        for (const tool of tools) {
          if (!tool?.name || !isToolAllowed(tool.name, upstream)) continue;
          const namespaced = `${upstreamName}__${tool.name}`;
          const properties = (tool.inputSchema?.properties ?? {}) as Record<string, FlagSchema>;
          const required = Array.isArray(tool.inputSchema?.required)
            ? tool.inputSchema.required
            : undefined;
          discovered.set(namespaced, {
            name: namespaced,
            description: tool.description ?? `Gateway tool ${tool.name} on ${upstreamName}`,
            properties,
            ...(required && required.length > 0 ? { required } : {}),
            invoke: (args) => this.callTool(upstreamName, tool.name, args ?? {}),
          });
        }
      } catch (err: any) {
        const { secrets } = resolveRequestHeaders(upstream.headerEnv);
        const msg = redactSecrets(err?.message ?? String(err), secrets);
        Logger.warn(`gateway: failed to discover tools from "${upstreamName}": ${msg}`);
      }
    }

    this.directTools = discovered;
    return discovered;
  }

  async callTool(
    upstreamName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<InvokeResult> {
    const target = `${upstreamName}__${toolName}`;
    const upstream = this.upstreams[upstreamName];
    if (!upstream) {
      this.audit?.log({ event: 'gateway.tool_call', actor: 'mcp', target, status: 'error' });
      return { stdout: '', stderr: `Unknown gateway upstream "${upstreamName}"`, exitCode: 1 };
    }

    if (!isToolAllowed(toolName, upstream)) {
      this.audit?.log({ event: 'gateway.tool_call', actor: 'mcp', target, status: 'denied' });
      return {
        stdout: '',
        stderr: `Gateway tool "${target}" is denied by upstream policy`,
        exitCode: 1,
      };
    }

    const { secrets } = resolveRequestHeaders(upstream.headerEnv);
    try {
      const result = await this.rpc(upstreamName, upstream, 'tools/call', {
        name: toolName,
        arguments: args,
      });
      this.audit?.log({ event: 'gateway.tool_call', actor: 'mcp', target, status: 'ok' });
      return formatToolResult(result, secrets);
    } catch (err: any) {
      const msg = redactSecrets(err?.message ?? String(err), secrets);
      this.audit?.log({ event: 'gateway.tool_call', actor: 'mcp', target, status: 'error' });
      return { stdout: '', stderr: msg, exitCode: 1 };
    }
  }
}
