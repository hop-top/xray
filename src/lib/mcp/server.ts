/**
 * `xray mcp`: stdio MCP server over xray's read-only analysis commands.
 *
 * Kit's `commanderBridge` enumerates the command tree and gates calls;
 * `tools.ts` narrows and reshapes the leaves; each call runs as a CLI
 * child (`runner.ts`); `stdio.ts` binds kit's handler to stdin/stdout.
 *
 * Loaded lazily from the `mcp` command action so ordinary CLI runs
 * never load the MCP protocol stack.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import type * as KitMcp from '@hop-top/kit/dist/mcp';
import type { Invocation, InvokeResult, Leaf, McpBridge } from '@hop-top/kit/dist/mcp';
import { findCommand, isExposedPath, policyFor, shapeLeaf, buildArgv, type PathScope, type ToolDef } from './tools';
import {
  assertConfigPinned, collectOutput, containPath, makeOutputDir, pinnedConfigArgs, resolveCallRoot, runChild,
  type ChildResult,
} from './runner';
import { serveStdio } from './stdio';

// tsconfig's legacy `node` resolution ignores the kit exports map: types
// from the dist path, runtime through the exported `./mcp` subpath.
function kitMcp(): typeof KitMcp {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@hop-top/kit/mcp') as typeof KitMcp;
}

export interface XrayBridgeOptions {
  /**
   * Trusted project directory (realpath). Every child runs with it as
   * cwd, so project strategies and config load from here only.
   */
  serverRoot: string;
  /**
   * The server root's config file (realpath), or null. Every child runs
   * with `-C <serverRoot> --config <it>`; see `resolveServerConfig`.
   */
  serverConfig: string | null;
  /** CLI entry script run per call. */
  entry: string;
  /** Per-call child timeout. */
  timeoutMs: number;
}

/** CLI entry next to this module once built (dist/lib/mcp → dist/index.js). */
export function defaultEntry(): string {
  return path.resolve(__dirname, '..', '..', 'index.js');
}

/**
 * McpBridge over the xray tree: kit's commanderBridge for enumeration,
 * schema and the policy gate, wrapped to expose only read-only tools
 * under client-safe names and to run each call as a CLI child.
 */
export function createXrayBridge(program: Command, o: XrayBridgeOptions): McpBridge {
  const kit = kitMcp();
  const pending = new WeakMap<Invocation, ToolDef>();

  const inner = kit.commanderBridge(program, {
    enabled: (leaf) => (isExposedPath(program, leaf.path) ? undefined : { mcp: false }),
    run: (inv, cmd) => {
      const def = pending.get(inv);
      if (!def) throw new kit.UnknownCommandError(`unknown command: ${inv.path.join(' ')}`);
      return runTool(def, cmd, inv.flags, o);
    },
  });

  const tools = (): Array<{ leaf: Leaf; def: ToolDef }> => {
    const out: Array<{ leaf: Leaf; def: ToolDef }> = [];
    for (const leaf of inner.leaves()) {
      if (leaf.enabled?.mcp === false) continue;
      const cmd = findCommand(program, leaf.path);
      const policy = policyFor(program, leaf.path);
      if (cmd && policy) out.push(shapeLeaf(leaf, cmd, policy));
    }
    return out;
  };

  return {
    leaves: () => tools().map((t) => t.leaf),
    invoke: async (inv) => {
      const name = inv.path.length === 1 ? inv.path[0] : '';
      const tool = tools().find((t) => t.def.name === name);
      if (!tool) throw new kit.UnknownCommandError(`unknown tool: ${inv.path.join('.')}`);
      const real: Invocation = { ...inv, path: tool.def.path };
      pending.set(real, tool.def);
      return inner.invoke(real);
    },
  };
}

function toResult(r: ChildResult, stdout = r.stdout): InvokeResult {
  return { stdout, stderr: r.stderr.trim(), exitCode: r.exitCode };
}

async function withOutputDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = makeOutputDir();
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run one tool call; argument errors throw (kit renders them as tool
 * errors). The child's cwd is always the server root: project
 * strategies, `node_modules` strategies and the strategy cache load from
 * the trusted root only; with a server config, it is passed as
 * `--config`, so no config walk-up from `--path` happens. The per-call `root` reaches the
 * command as its project path (`--path`), never as cwd.
 */
async function runTool(
  def: ToolDef,
  cmd: Command,
  args: Record<string, unknown> | undefined,
  o: XrayBridgeOptions
): Promise<InvokeResult> {
  const callRoot = resolveCallRoot(o.serverRoot, args?.root);
  const scope: PathScope = {
    dir: callRoot,
    explicit: callRoot !== o.serverRoot,
    contain: (value, base, label) => containPath(o.serverRoot, base, value, label),
    isDirectory: (abs) => {
      try {
        return fs.statSync(abs).isDirectory();
      } catch {
        return false;
      }
    },
  };
  const { argv, projectDirs } = buildArgv(def, cmd, args, scope);
  if (def.policy.configFromPath) {
    for (const dir of projectDirs) assertConfigPinned(o.serverConfig, dir);
  }
  const run = {
    entry: o.entry,
    cwd: o.serverRoot,
    timeoutMs: o.timeoutMs,
    globalArgs: pinnedConfigArgs(o.serverRoot, o.serverConfig),
  };
  const withFlag = (flag: string) => [...def.path, flag, ...argv.slice(def.path.length)];

  // map/graph write files: point them at a private dir and return its content.
  if (def.fileOutput) {
    return withOutputDir(async (dir) => {
      const r = await runChild(withFlag(`--output=${path.join(dir, 'xray')}`), run);
      return toResult(r, r.exitCode === 0 ? collectOutput(dir) : r.stdout);
    });
  }

  // query needs a graph file; without --graph, build one the way the CLI
  // documents (`xray map --format json -o graph.json`) in a private dir,
  // over the call root.
  if (def.name === 'query' && args?.graph === undefined && args?.['list-adapters'] !== true) {
    const mapScope = scope.explicit ? [`--path=${callRoot}`, '--detect'] : [];
    if (scope.explicit) assertConfigPinned(o.serverConfig, callRoot);
    return withOutputDir(async (dir) => {
      const graph = path.join(dir, 'graph.json');
      const built = await runChild(['map', ...mapScope, '--format=json', `--output=${graph}`], run);
      if (built.exitCode !== 0) {
        return toResult(built, `building graph (xray map --format json) failed\n${built.stdout}`);
      }
      return toResult(await runChild(withFlag(`--graph=${graph}`), run));
    });
  }

  return toResult(await runChild(argv, run));
}

export interface StartOptions extends XrayBridgeOptions {
  version: string;
}

/**
 * Serve over stdin/stdout until stdin closes. stdout carries protocol
 * lines only: every other in-process stdout write is routed to stderr.
 */
export async function startMcpServer(program: Command, o: StartOptions): Promise<void> {
  const kit = kitMcp();
  const protocolWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: any, enc?: any, cb?: any) =>
    process.stderr.write(chunk, enc, cb)) as typeof process.stdout.write;

  try {
    const handler = kit.createMcpHandler(createXrayBridge(program, o), {
      serverInfo: { name: 'xray', version: o.version },
      // stdio has no HTTP headers; the 2026-07-28 era is header-routed.
      specVersions: [kit.MCP_SPEC_2024_11_05],
    });
    await serveStdio(handler, {
      input: process.stdin,
      write: (line) => {
        protocolWrite(line);
      },
      log: (msg) => process.stderr.write(`${msg}\n`),
    });
  } finally {
    process.stdout.write = protocolWrite;
  }
}
