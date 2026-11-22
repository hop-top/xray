/**
 * `xray serve [paths...]` — local Web UI and read-only REST API server.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import { UsageError } from '../lib/error/types';
import { resolveServerConfig } from '../lib/mcp/runner';
import { WarmWorkspaceManager } from '../lib/mcp/workspace';
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
  config?: string;
}

/** Register `xray serve`. */
export function registerServeCommand(program: Command): Command {
  const cmd = program
    .command('serve')
    .description('Launch local Web UI and read-only REST API server')
    .argument('[paths...]', 'Root directories to serve (defaults to current directory)')
    .option('--port <port>', 'HTTP bind port (default: 4173)', '4173')
    .option('--host <host>', 'HTTP bind host (default: 127.0.0.1)', '127.0.0.1')
    .option('--token <secret>', 'Bearer token (required for non-loopback --host, or XRAY_SERVE_TOKEN env)')
    .option('--api-only', 'Serve JSON REST API only without static Web UI')
    .option('--mcp', 'Mount Streamable HTTP MCP endpoint at /mcp')
    .action(async (paths: string[], opts: ServeCommandOptions, command: Command) => {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new UsageError(`invalid --port '${opts.port}' (expected an integer 0..65535)`);
      }

      const primaryPath = paths && paths.length > 0 ? paths[0] : '.';
      const resolvedPrimary = path.resolve(primaryPath);
      if (!fs.existsSync(resolvedPrimary) || !fs.statSync(resolvedPrimary).isDirectory()) {
        throw new UsageError(`path "${primaryPath}" must be an existing directory`);
      }

      const serverRoot = fs.realpathSync(resolvedPrimary);
      const serverConfig = resolveServerConfig(serverRoot, opts.config);
      const workspace = new WarmWorkspaceManager(serverRoot, serverConfig);

      const token = opts.token ?? process.env.XRAY_SERVE_TOKEN;

      await startServeHttpServer({
        serverRoot,
        serverConfig,
        host: opts.host,
        port,
        ...(token ? { token } : {}),
        apiOnly: Boolean(opts.apiOnly),
        mcp: Boolean(opts.mcp),
        program: command.parent ?? command,
        workspace,
        version,
      });
    });

  return declareEffect(cmd, 'interactive', 'no');
}
