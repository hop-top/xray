/**
 * `xray mcp`: stdio MCP server over xray's read-only analysis commands.
 *
 * Kit's `commanderBridge` enumerates the command tree and gates calls;
 * `tools.ts` narrows and reshapes the leaves; built-in read-only analysis
 * tools run in-process over the warm workspace (`workspace.ts`,
 * `inprocess.ts`), while untrusted project strategies run as a CLI child
 * (`runner.ts`); `stdio.ts` binds kit's handler to stdin/stdout.
 *
 * Loaded lazily from the `mcp` command action so ordinary CLI runs
 * never load the MCP protocol stack.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import type * as KitMcp from '@hop-top/kit/dist/mcp';
import type {
  FlagSchema, Invocation, InvocationMeta, InvokeResult, Leaf, McpHandler, McpHttpResponse, McpBridge,
} from '@hop-top/kit/dist/mcp';
import { findCommand, isExposedPath, policyFor, shapeLeaf, buildArgv, type PathScope, type ToolDef } from './tools';
import {
  assertConfigPinned, collectOutput, containPath, makeOutputDir, pinnedConfigArgs, resolveCallRoot, runChild,
  type ChildResult,
} from './runner';
import { canRunInProcess, runInProcess } from './inprocess';
import { serveStdio } from './stdio';
import { WarmWorkspaceManager } from './workspace';
import { listHandbookPages, readHandbookPage } from '../handbook/generator';

// tsconfig's legacy `node` resolution ignores the kit exports map: types
// from the dist path, runtime through the exported `./mcp` subpath.
function kitMcp(): typeof KitMcp {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@hop-top/kit/mcp') as typeof KitMcp;
}

/**
 * A non-CLI tool served directly by the bridge. Registered by the server
 * after the command-tree leaves so it is listed and invocable like any
 * analysis tool, but with no commander command behind it.
 */
export interface DirectToolDef {
  name: string;
  description: string;
  properties: Record<string, FlagSchema>;
  required?: readonly string[];
  invoke(args: Record<string, unknown> | undefined): InvokeResult | Promise<InvokeResult>;
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
  /** Warm in-process graph workspace; built-in tools use it when present. */
  workspace?: WarmWorkspaceManager;
  /** Additional roots authorized beyond the server root (user global contexts). */
  allowedRoots?: ReadonlySet<string>;
  /** Non-CLI tools merged into `leaves()`/`invoke()` after the built-ins. */
  directTools?: ReadonlyMap<string, DirectToolDef>;
}

/** One tool call as the bridge sees it; `meta` is optional for programmatic calls. */
export type BridgeInvocation = Omit<Invocation, 'meta'> & { meta?: InvocationMeta };

/** The xray bridge: kit's `McpBridge` plus programmatic invocation. */
export interface XrayBridge extends McpBridge {
  leaves(): Leaf[];
  invoke(inv: BridgeInvocation): Promise<InvokeResult>;
}

/** CLI entry next to this module once built (dist/lib/mcp → dist/index.js). */
export function defaultEntry(): string {
  return path.resolve(__dirname, '..', '..', 'index.js');
}

/**
 * Tool-selection guidance for agents, returned in the MCP `initialize`
 * response. Concise by design: it says which tool answers which question.
 */
export const MCP_INSTRUCTIONS = [
  'xray serves read-only code analysis over the served project root.',
  'Pick a tool by intent:',
  '- explore: find files (--match), search code (--search), or list/stats before mapping.',
  '- query: one call-graph question in a single call, e.g. "calls(fn)" or "callers(fn)".',
  '- impact: every transitive caller of a symbol before renaming or changing its signature.',
  '- map: the full code map or serialized graph (format json is large; reach for query/impact first).',
  '- graph: control/data-flow graphs for a symbol or directory.',
  '- imports: per-file import records for dependency questions.',
  '- handbook: list or read generated structural handbook pages ({ action: "list" | "read", slug? }).',
  '- strategy_*: framework-aware extras when one applies.',
  'Use read_file (or your editor) to open file contents; these tools return analysis, not file text.',
  'Paths resolve against the project root; pass root to analyze a subdirectory. Relative paths inside the project only.',
].join('\n');

function directLeaves(direct: ReadonlyMap<string, DirectToolDef> | undefined): Leaf[] {
  if (!direct) return [];
  return [...direct.values()].map((d) => ({
    path: [d.name],
    description: d.description,
    properties: d.properties,
    ...(d.required && d.required.length > 0 ? { required: [...d.required] } : {}),
  }));
}

function createDefaultDirectTools(serverRoot: string): Map<string, DirectToolDef> {
  const handbookDir = path.join(serverRoot, '.xray', 'handbook');
  const map = new Map<string, DirectToolDef>();
  map.set('handbook', {
    name: 'handbook',
    description: 'List or read generated structural handbook pages (.xray/handbook/*.md).',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform: "list" available pages or "read" a page by slug.',
        enum: ['list', 'read'],
      },
      slug: {
        type: 'string',
        description: 'Subsystem slug (or "README" for the overview) when action is "read".',
      },
    },
    required: ['action'],
    invoke: (args) => {
      const action = typeof args?.action === 'string' ? args.action : '';
      if (action === 'list') {
        const pages = listHandbookPages(handbookDir);
        return { stdout: JSON.stringify({ pages }, null, 2), stderr: '', exitCode: 0 };
      }
      if (action === 'read') {
        const slug = typeof args?.slug === 'string' ? args.slug : '';
        if (!slug.trim()) {
          return { stdout: '', stderr: 'slug is required when action is "read"', exitCode: 2 };
        }
        try {
          const content = readHandbookPage(handbookDir, slug);
          if (content === null) {
            return { stdout: '', stderr: `Handbook page not found: ${slug}`, exitCode: 1 };
          }
          return { stdout: content, stderr: '', exitCode: 0 };
        } catch (err: any) {
          return { stdout: '', stderr: err?.message ?? 'Invalid handbook slug', exitCode: 2 };
        }
      }
      return { stdout: '', stderr: 'action must be "list" or "read"', exitCode: 2 };
    },
  });
  return map;
}

/**
 * McpBridge over the xray tree: kit's commanderBridge for enumeration,
 * schema and the policy gate, wrapped to expose only read-only tools
 * under client-safe names. Built-in analysis tools run in-process over
 * the warm workspace; every other call runs as a CLI child.
 */
export function createXrayBridge(program: Command, o: XrayBridgeOptions): XrayBridge {
  const kit = kitMcp();
  const pending = new WeakMap<Invocation, ToolDef>();
  const allowedRoots = o.workspace?.getAllowedRoots() ?? o.allowedRoots;
  const directTools = new Map<string, DirectToolDef>(createDefaultDirectTools(o.serverRoot));
  if (o.directTools) {
    for (const [k, v] of o.directTools) directTools.set(k, v);
  }

  const inner = kit.commanderBridge(program, {
    enabled: (leaf) => (isExposedPath(program, leaf.path) ? undefined : { mcp: false }),
    run: (inv, cmd) => {
      const def = pending.get(inv);
      if (!def) throw new kit.UnknownCommandError(`unknown command: ${inv.path.join(' ')}`);
      if (o.workspace && canRunInProcess(def, inv.flags, o.serverRoot)) {
        return runInProcess(def, inv.flags, {
          serverRoot: o.serverRoot,
          serverConfig: o.serverConfig,
          workspace: o.workspace,
          allowedRoots,
        });
      }
      return runTool(def, cmd, inv.flags, o, allowedRoots);
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
    leaves: () => [...tools().map((t) => t.leaf), ...directLeaves(directTools)],
    invoke: async (inv) => {
      const name = inv.path.length === 1 ? inv.path[0] : '';
      const direct = directTools.get(name);
      if (direct) {
        return direct.invoke(inv.flags as Record<string, unknown> | undefined);
      }
      const tool = tools().find((t) => t.def.name === name);
      if (!tool) throw new kit.UnknownCommandError(`unknown tool: ${inv.path.join('.')}`);
      const meta: InvocationMeta = inv.meta ?? { surface: 'mcp', requestedAt: new Date() };
      const real: Invocation = { ...inv, path: tool.def.path, meta };
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
 * Run one tool call as a CLI child; argument errors throw (kit renders
 * them as tool errors). The child's cwd is always the server root:
 * project strategies, `node_modules` strategies and the strategy cache
 * load from the trusted root only; with a server config, it is passed as
 * `--config`, so no config walk-up from `--path` happens. The per-call
 * `root` reaches the command as its project path (`--path`), never as cwd.
 */
async function runTool(
  def: ToolDef,
  cmd: Command,
  args: Record<string, unknown> | undefined,
  o: XrayBridgeOptions,
  allowedRoots?: ReadonlySet<string>
): Promise<InvokeResult> {
  const callRoot = resolveCallRoot(o.serverRoot, args?.root, allowedRoots);
  const scope: PathScope = {
    dir: callRoot,
    explicit: callRoot !== o.serverRoot,
    contain: (value, base, label) => containPath(o.serverRoot, base, value, label, allowedRoots),
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

/**
 * Inject the tool-selection instructions into the `initialize` result.
 * Kit's legacy handler has no instructions slot, so the server adds one.
 */
function withInstructions(res: McpHttpResponse): McpHttpResponse {
  if (!res.body) return res;
  try {
    const msg = JSON.parse(res.body) as {
      result?: { protocolVersion?: unknown; instructions?: unknown };
    };
    const result = msg.result;
    if (
      result !== null &&
      typeof result === 'object' &&
      'protocolVersion' in result &&
      result.instructions === undefined
    ) {
      result.instructions = MCP_INSTRUCTIONS;
      return { ...res, body: JSON.stringify(msg) };
    }
  } catch {
    // Not JSON: leave the response untouched.
  }
  return res;
}

/**
 * Build the MCP request handler for `program`: the bridge above plus the
 * initialize instructions. Shared by stdio serving and tests.
 */
export function createXrayMcpHandler(program: Command, o: StartOptions): McpHandler {
  const kit = kitMcp();
  const inner = kit.createMcpHandler(createXrayBridge(program, o), {
    serverInfo: { name: 'xray', version: o.version },
    // stdio has no HTTP headers; the 2026-07-28 era is header-routed.
    specVersions: [kit.MCP_SPEC_2024_11_05],
  });
  return async (req) => withInstructions(await inner(req));
}

export interface StartOptions extends XrayBridgeOptions {
  version: string;
}

/**
 * Serve over stdin/stdout until stdin closes. stdout carries protocol
 * lines only: every other in-process stdout write is routed to stderr.
 */
export async function startMcpServer(program: Command, o: StartOptions): Promise<void> {
  const protocolWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: any, enc?: any, cb?: any) =>
    process.stderr.write(chunk, enc, cb)) as typeof process.stdout.write;

  const workspace = new WarmWorkspaceManager(o.serverRoot, o.serverConfig);
  try {
    const handler = createXrayMcpHandler(program, { ...o, workspace });
    await serveStdio(handler, {
      input: process.stdin,
      write: (line) => {
        protocolWrite(line);
      },
      log: (msg) => process.stderr.write(`${msg}\n`),
    });
  } finally {
    workspace.close();
    process.stdout.write = protocolWrite;
  }
}
