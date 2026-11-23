/**
 * `xray serve [paths...]` — unified local Web UI, read-only REST API, and MCP
 * server (Streamable HTTP via `--mcp` or stdio via `--stdio`).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import { parseDurationMs } from '../lib/duration';
import { UsageError } from '../lib/error/types';
import { resolveServerConfig } from '../lib/mcp/runner';
import { WarmWorkspaceManager } from '../lib/mcp/workspace';
import { addResultFormat } from '../lib/result-format';
import { startServeHttpServer } from '../lib/server/http-server';
import { declareEffect } from './side-effect';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json');

export interface ServeCommandOptions {
  port: string;
  host: string;
  token?: string;
  apiOnly?: boolean;
  mcp?: boolean;
  stdio?: boolean;
  timeout: string;
  auditLog?: string;
  config?: string;
  format?: string;
}

const HELP_AFTER = `Modes:
  xray serve                 Local Web UI + read-only REST API (127.0.0.1:4173)
  xray serve --api-only      JSON REST API without Web UI
  xray serve --mcp           Mount Streamable HTTP MCP endpoint at /mcp
  xray serve --stdio         Serve MCP tools over stdin/stdout (no HTTP server)

Example (Claude Code stdio MCP):
  claude mcp add xray -- xray -C /path/to/project serve --stdio
`;

/** Register `xray serve`. */
export function registerServeCommand(program: Command): Command {
  const cmd = addResultFormat(
    program
      .command('serve')
      .description('Start local Web UI, REST API, or MCP server (--mcp / --stdio)')
      .argument('[paths...]', 'Root directories to serve (defaults to current directory)')
      .option('--port <port>', 'HTTP bind port (default: 4173)', '4173')
      .option('--host <host>', 'HTTP bind host (default: 127.0.0.1)', '127.0.0.1')
      .option('--token <secret>', 'Bearer token (required for non-loopback --host, or XRAY_SERVE_TOKEN env)')
      .option('--api-only', 'Serve JSON REST API only without static Web UI')
      .option('--mcp', 'Mount Streamable HTTP MCP endpoint at /mcp')
      .option('--stdio', 'Serve MCP tools over stdio (no HTTP listener)')
      .option('--timeout <duration>', 'Per-call MCP tool timeout (e.g. 30s, 5m)', '5m')
      .option('--audit-log <path>', 'Append JSONL audit log for auth, gateway, and admin events'),
    'Output format: json (with --stdio, errors are JSON on stderr)',
    ['json']
  )
    .addHelpText('after', HELP_AFTER)
    .action(async (paths: string[], opts: ServeCommandOptions, command: Command) => {
      if (opts.format !== undefined && opts.format.toLowerCase() !== 'json') {
        throw new UsageError(`invalid --format '${opts.format}' (expected: json)`);
      }

      const timeoutMs = parseDurationMs(opts.timeout, '--timeout', { defaultUnit: 's' });

      const primaryPath = paths && paths.length > 0 ? paths[0] : '.';
      const resolvedPrimary = path.resolve(primaryPath);
      if (!fs.existsSync(resolvedPrimary) || !fs.statSync(resolvedPrimary).isDirectory()) {
        throw new UsageError(`path "${primaryPath}" must be an existing directory`);
      }

      const serverRoot = fs.realpathSync(resolvedPrimary);
      const globals = command.optsWithGlobals?.() ?? {};
      const configPath = opts.config ?? (globals.config as string | undefined);
      const serverConfig = resolveServerConfig(serverRoot, configPath);
      const offline = Boolean(globals.offline);

      if (opts.stdio) {
        if (opts.mcp || opts.apiOnly) {
          throw new UsageError('--stdio cannot be combined with --mcp or --api-only');
        }
        // Lazy-load the MCP server stack so ordinary CLI runs never pay for it.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const server = require('../lib/mcp/server') as typeof import('../lib/mcp/server');
        await server.startMcpServer(command.parent ?? command, {
          serverRoot,
          serverConfig,
          entry: server.defaultEntry(),
          timeoutMs,
          version,
          offline,
        });
        return;
      }

      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new UsageError(`invalid --port '${opts.port}' (expected an integer 0..65535)`);
      }

      const workspace = new WarmWorkspaceManager(serverRoot, serverConfig);
      const token = opts.token ?? process.env.XRAY_SERVE_TOKEN ?? process.env.XRAY_MCP_TOKEN;

      await startServeHttpServer({
        serverRoot,
        serverConfig,
        host: opts.host,
        port,
        ...(token ? { token } : {}),
        apiOnly: Boolean(opts.apiOnly),
        mcp: Boolean(opts.mcp),
        ...(opts.auditLog ? { auditLog: opts.auditLog } : {}),
        offline,
        program: command.parent ?? command,
        workspace,
        version,
      });
    });

  return declareEffect(cmd, 'interactive', 'no');
}
