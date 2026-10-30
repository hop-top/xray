/**
 * Runs one MCP tool call as an xray CLI child process.
 *
 * Command handlers write to stdout and call process.exit, and read
 * process.cwd(); running them in the server process would corrupt the
 * protocol stream and serialize every call through one cwd. A child per
 * call reuses the exact CLI code path with its own cwd and exit code.
 *
 * Children run with `--no-telemetry` (no consent prompt or
 * `.xrayrc.json` write), `--offline` (no upgrade check), no colour and
 * `--log-level warn` (stderr keeps warnings and errors only).
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolArgumentError } from './tools';

/** Global flags every child gets, ahead of the command path. */
export const CHILD_FLAGS = [
  '--no-telemetry', '--offline', '--no-color', '--no-hints', '--log-level', 'warn',
] as const;

export interface ChildResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  /** CLI entry script (dist/index.js). */
  entry: string;
  /** Child working directory. */
  cwd: string;
  /** Kill the child after this many ms. */
  timeoutMs: number;
}

/** Whether `child` is `parent` or inside it (both absolute, resolved). */
export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Realpath of `p`, or of its nearest existing ancestor joined with the rest. */
function realpathLoose(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realpathLoose(parent), path.basename(p));
  }
}

/**
 * Resolve `value` against `base` and require it inside `serverRoot`
 * (symlinks resolved). Returns the absolute path.
 */
export function containPath(serverRoot: string, base: string, value: string, label: string): string {
  const abs = path.resolve(base, value);
  if (!isWithin(serverRoot, realpathLoose(abs))) {
    throw new ToolArgumentError(`${label} "${value}" is outside the server root ${serverRoot}`);
  }
  return abs;
}

/** Resolve the per-call `root` argument to an existing directory inside the server root. */
export function resolveCallRoot(serverRoot: string, root: unknown): string {
  if (root === undefined || root === null || root === '') return serverRoot;
  if (typeof root !== 'string') throw new ToolArgumentError('argument "root" must be a string');
  const abs = containPath(serverRoot, serverRoot, root, 'root');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new ToolArgumentError(`root "${root}" does not exist`);
  }
  if (!stat.isDirectory()) throw new ToolArgumentError(`root "${root}" is not a directory`);
  return fs.realpathSync(abs);
}

/** Spawn `node <entry> <CHILD_FLAGS> <argv>`; resolves with captured output. */
export function runChild(argv: string[], o: RunOptions): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const child = spawn(process.execPath, [o.entry, ...CHILD_FLAGS, ...argv], {
      cwd: o.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf-8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf-8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, o.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) stderr += `\nxray mcp: command timed out after ${o.timeoutMs}ms`;
      resolve({ stdout, stderr, exitCode: code ?? (signal ? 1 : 0) });
    });
  });
}

/** Fresh private temp dir for one call's file output. */
export function makeOutputDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xray-mcp-'));
}

/**
 * Read every file under `dir` (sorted, relative names) into one text
 * blob. A single file is returned bare; several get `== name ==` headers.
 */
export function collectOutput(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) files.push(p);
    }
  };
  walk(dir);
  files.sort();
  if (files.length === 1) return fs.readFileSync(files[0], 'utf-8');
  return files
    .map((f) => `== ${path.relative(dir, f)} ==\n${fs.readFileSync(f, 'utf-8')}`)
    .join('\n');
}
