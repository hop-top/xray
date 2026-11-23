/**
 * Stdio MCP request detection (`xray serve --stdio`) + early `-C/--chdir`.
 *
 * Kept free of the MCP stack: the server module loads only when `serve --stdio`
 * runs.
 */
import * as path from 'path';
import { UsageError } from '../lib/error/types';

/** Root flags that take a separate value token. */
export const ROOT_VALUE_FLAGS: ReadonlySet<string> = new Set(['-c', '--config', '-C', '--chdir']);

export interface McpRequest {
  /** argv index of the `-C/--chdir` value token, when given. */
  chdirIndex?: number;
  /** `-C/--chdir` value as given. */
  chdir?: string;
}

/**
 * Whether argv (process.argv shape) runs stdio MCP (`xray ... serve ... --stdio`):
 * the first positional after root flags is `serve`, and `--stdio` appears before `--`.
 * Reports `-C/--chdir` so the caller can apply it before commands (and project
 * strategies) load.
 */
export function parseMcpRequest(argv: readonly string[]): McpRequest | null {
  const req: McpRequest = {};
  let cmdIndex = -1;
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
    if (a !== 'serve') return null;
    cmdIndex = i;
    break;
  }
  if (cmdIndex < 0) return null;
  for (let i = cmdIndex + 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a === '--stdio') return req;
  }
  return null;
}

/**
 * Apply `-C/--chdir` for a stdio MCP request now, so strategy discovery sees
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
