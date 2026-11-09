/**
 * `xray mcp` command + argv detection.
 *
 * Kept free of the MCP stack: the server module loads only when the
 * action runs.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import { UsageError } from '../lib/error/types';
import { declareEffect } from './side-effect';
import { addResultFormat } from '../lib/result-format';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json');

/** Root flags that take a separate value token. */
export const ROOT_VALUE_FLAGS: ReadonlySet<string> = new Set(['--log-level', '--config', '-C', '--chdir']);

export interface McpRequest {
  /** argv index of the `-C/--chdir` value token, when given. */
  chdirIndex?: number;
  /** `-C/--chdir` value as given. */
  chdir?: string;
}

/**
 * Whether argv (process.argv shape) runs `xray mcp`: the first
 * positional, after root flags, is `mcp`. Reports `-C/--chdir` so the
 * caller can apply it before commands (and project strategies) load.
 */
export function parseMcpRequest(argv: readonly string[]): McpRequest | null {
  const req: McpRequest = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return null;
    if (a.startsWith('--chdir=')) {
      req.chdir = a.slice('--chdir='.length);
      req.chdirIndex = i;
      continue;
    }
    if (ROOT_VALUE_FLAGS.has(a)) {
      if (a === '-C' || a === '--chdir') {
        req.chdir = argv[i + 1];
        req.chdirIndex = i + 1;
      }
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    return a === 'mcp' ? req : null;
  }
  return null;
}

/**
 * Apply `-C/--chdir` for an mcp request now, so strategy discovery sees
 * the served project rather than the launch directory. Returns argv with
 * the value made absolute (the root preAction chdir becomes a no-op).
 */
export function applyMcpChdir(argv: string[], req: McpRequest): string[] {
  if (req.chdir === undefined || req.chdirIndex === undefined) return argv;
  const abs = path.resolve(req.chdir);
  try {
    process.chdir(abs);
  } catch (err: any) {
    throw new UsageError(`--chdir: ${err.message}`);
  }
  const out = [...argv];
  out[req.chdirIndex] = argv[req.chdirIndex].startsWith('--chdir=') ? `--chdir=${abs}` : abs;
  return out;
}

const HELP_AFTER = `Serves map, graph, explore, query, strategy list/detect and every
<strategy> <noun> command as MCP tools over stdin/stdout. Each call runs
the CLI command in a child process inside the server root (the working
directory, or -C <dir>); the optional "root" tool argument selects a
directory inside it. Project strategies and config load from the server
root only, as for any xray run there. See docs/user/mcp.md.

Example (Claude Code):
  claude mcp add xray -- xray -C /path/to/project mcp
`;

/** Register `xray mcp`. */
export function registerMcpCommand(program: Command): Command {
  return declareEffect(addResultFormat(program
    .command('mcp')
    .description('Serve analysis commands as MCP tools over stdio')
    .option('--timeout <seconds>', 'Per-call timeout in seconds', '300'),
    'Output format: json (the protocol is JSON-RPC on stdout; with json, errors are JSON on stderr)',
    ['json'])
    .addHelpText('after', HELP_AFTER)
    .action(async (opts: { timeout: string; config?: string; format?: string }, cmd: Command) => {
      if (opts.format !== undefined && opts.format.toLowerCase() !== 'json') {
        throw new UsageError(`invalid --format '${opts.format}' (expected: json)`);
      }
      const seconds = Number(opts.timeout);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new UsageError(`invalid --timeout '${opts.timeout}' (expected a positive number of seconds)`);
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const server = require('../lib/mcp/server') as typeof import('../lib/mcp/server');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { resolveServerConfig } = require('../lib/mcp/runner') as typeof import('../lib/mcp/runner');
      const serverRoot = fs.realpathSync(process.cwd());
      await server.startMcpServer(cmd.parent ?? cmd, {
        serverRoot,
        serverConfig: resolveServerConfig(serverRoot, opts.config),
        entry: server.defaultEntry(),
        timeoutMs: Math.round(seconds * 1000),
        version,
      });
    }), 'interactive', 'no');
}
