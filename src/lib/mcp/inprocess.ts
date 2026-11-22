/**
 * In-process execution for the built-in read-only analysis tools.
 *
 * The MCP surface runs `impact`, `query`, `imports`, `explore` and the
 * graph formats of `map`/`graph` inside the server process over the warm
 * workspace (`workspace.ts`), so a repeat call reuses the parsed graph
 * instead of spawning a CLI child. Every function here delegates to the
 * command implementations (`handleImportsAction`, `impactFromSerialized`,
 * `queryFromSerialized`, `handleExploreAction`); only argument coercion,
 * containment and rendering live here.
 *
 * Untrusted project strategies (and the chunked text map writer) stay on
 * the child-process path in `runner.ts`.
 */
import * as fs from 'fs';
import { Writable } from 'stream';
import type { InvokeResult } from '@hop-top/kit/dist/mcp';
import { graphToEdgesCsv, graphToNodesCsv, graphToXml } from '../graph/export';
import { formatterOf, outputRegistry, type ColumnSpec, type Registry } from '../output';
import type { SerializedGraph } from '../query/types';
import { DEFAULT_IMPACT_COLUMNS, impactFromSerialized, impactRegistry } from '../../commands/impact';
import { DEFAULT_QUERY_COLUMNS, listAdapters, queryFromSerialized, queryRegistry } from '../../commands/query';
import { DEFAULT_IMPORTS_COLUMNS, handleImportsAction, importsRegistry } from '../../commands/imports';
import { handleExploreAction, type ExploreCapture } from '../../commands/explore';
import { assertConfigPinned, containPath, resolveCallRoot } from './runner';
import { hasProjectStrategyCode } from '../strategy/loader';
import {
  ROOT_PARAM, ToolArgumentError, isUrlLike, type ParamKind, type ToolDef,
} from './tools';
import type { WarmWorkspaceManager } from './workspace';
import type { ExploreCommandOptions } from '../../types/command-options';

/** What in-process execution needs from the bridge. */
export interface InProcessScope {
  serverRoot: string;
  serverConfig: string | null;
  workspace: WarmWorkspaceManager;
  /** Roots authorized by the server root plus user global config contexts. */
  allowedRoots?: ReadonlySet<string>;
}

const GRAPH_FORMATS = new Set(['json', 'xml', 'csv']);

/** Options this module can honor per tool; anything else falls back to a child. */
const SUPPORTED: Readonly<Record<string, ReadonlySet<string>>> = {
  impact: new Set(['symbol', 'depth', 'strict', 'format', 'lens', 'scope']),
  query: new Set(['query', 'format', 'list-adapters']),
  imports: new Set(['path', 'lang', 'format', 'no-cache', 'no-ignore', 'paths']),
  explore: new Set(['path', 'match', 'search', 'type', 'stats', 'format']),
  map: new Set(['path', 'anchor', 'query', 'limit', 'with', 'depth', 'match', 'catch', 'lang', 'lens', 'scope', 'format', 'json', 'csv', 'xml', 'txt']),
  graph: new Set(['path', 'anchor', 'query', 'limit', 'with', 'depth', 'match', 'catch', 'lang', 'lens', 'scope', 'format', 'json', 'csv', 'xml', 'txt']),
};

/**
 * Whether this tool call can be served in-process from `args`.
 *
 * Explore is the one built-in that can evaluate project strategies (they
 * register commands at CLI startup). When the server root's own strategies
 * would load, it stays on the child path: the child runs them exactly as a
 * CLI run there would, while in-process would skip them. Either way, code
 * from an untrusted sub-root never loads.
 */
export function canRunInProcess(
  def: ToolDef,
  args: Record<string, unknown> | undefined,
  serverRoot?: string
): boolean {
  const supported = SUPPORTED[def.name];
  if (!supported) return false;
  for (const key of Object.keys(args ?? {})) {
    if (key === ROOT_PARAM) {
      if (def.policy.root === 'none') return false;
      continue;
    }
    if (!supported.has(key)) return false;
  }
  if (def.name === 'explore' && serverRoot && hasProjectStrategyCode(serverRoot)) return false;
  if (def.name === 'map' || def.name === 'graph') {
    // Only single-root graph documents: multi-root merging and the chunked
    // text map (strategy auto-detection, chunk files) stay on the CLI path.
    const paths = args?.path;
    if (Array.isArray(paths) && paths.length > 1) return false;
    if (!GRAPH_FORMATS.has(graphFormat(args))) return false;
  }
  return true;
}

function graphFormat(args: Record<string, unknown> | undefined): string {
  const a = args ?? {};
  if (typeof a.format === 'string' && a.format !== '') return a.format;
  if (a.json === true) return 'json';
  if (a.csv === true) return 'csv';
  if (a.xml === true) return 'xml';
  if (a.txt === true) return 'txt';
  return 'txt';
}

/** Typed, validated access to one call's tool arguments. */
class Args {
  constructor(
    private readonly def: ToolDef,
    private readonly values: Record<string, unknown>,
    private readonly scope: InProcessScope,
    /** The call root: relative path arguments resolve against it. */
    readonly callRoot: string
  ) {}

  private kind(key: string): ParamKind | undefined {
    if (Object.prototype.hasOwnProperty.call(this.def.policy.options, key)) {
      return this.def.policy.options[key];
    }
    const positional = this.def.policy.positionals?.[key];
    return positional === 'path' || positional === 'value' ? positional : undefined;
  }

  has(key: string): boolean {
    return this.values[key] !== undefined && this.values[key] !== null;
  }

  /** The raw argument bag (for format detection). */
  all(): Record<string, unknown> {
    return this.values;
  }

  scalar(key: string): string | undefined {
    if (!this.has(key)) return undefined;
    const v = this.values[key];
    if (typeof v === 'string') return this.contained(key, v);
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    throw new ToolArgumentError(`argument "${key}" must be a string`);
  }

  integer(key: string): number | undefined {
    const raw = this.scalar(key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new ToolArgumentError(`argument "${key}" must be an integer`);
    return n;
  }

  bool(key: string): boolean | undefined {
    if (!this.has(key)) return undefined;
    const v = this.values[key];
    if (typeof v === 'boolean') return v;
    throw new ToolArgumentError(`argument "${key}" must be a boolean`);
  }

  list(key: string): string[] {
    if (!this.has(key)) return [];
    const v = this.values[key];
    const items = Array.isArray(v) ? v : [v];
    return items.map((item) => {
      if (typeof item === 'string') return this.contained(key, item);
      if (typeof item === 'number' && Number.isFinite(item)) return String(item);
      throw new ToolArgumentError(`argument "${key}" must be a string`);
    });
  }

  /** Apply the tool's containment rule for a path-valued argument. */
  private contained(key: string, value: string): string {
    switch (this.kind(key)) {
      case 'path':
      case 'project-file':
        return this.path(key, value);
      case 'dir': {
        const abs = this.path(key, value);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          throw new ToolArgumentError(`argument "${key}" "${value}" does not exist`);
        }
        if (!stat.isDirectory()) {
          throw new ToolArgumentError(`argument "${key}" "${value}" must be an existing directory, not a file`);
        }
        return abs;
      }
      case 'query-source':
        return value
          .split(',')
          .map((raw) => {
            const part = raw.trim();
            if (part === '') return part;
            const colon = part.indexOf(':');
            if (colon > 0 && part.startsWith('.')) {
              return `${part.slice(0, colon)}:${this.path(key, part.slice(colon + 1))}`;
            }
            return this.path(key, part);
          })
          .join(',');
      default:
        return value;
    }
  }

  private path(key: string, value: string): string {
    if (isUrlLike(value)) {
      throw new ToolArgumentError(`argument "${key}" must be a path inside the server root, not a URL: "${value}"`);
    }
    return containPath(this.scope.serverRoot, this.callRoot, value, key, this.scope.allowedRoots);
  }
}

/** Reject arguments the tool does not declare (kit would otherwise ignore them). */
function assertKnownArgs(def: ToolDef, args: Record<string, unknown> | undefined): void {
  const known = new Set([...Object.keys(def.policy.options), ...def.positionals]);
  for (const key of Object.keys(args ?? {})) {
    if (key === ROOT_PARAM) {
      if (def.policy.root === 'none') throw new ToolArgumentError(`unknown argument "${ROOT_PARAM}" for tool ${def.name}`);
      continue;
    }
    if (!known.has(key)) throw new ToolArgumentError(`unknown argument "${key}" for tool ${def.name}`);
  }
}

function callRootOf(scope: InProcessScope, args: Record<string, unknown> | undefined, def: ToolDef): string {
  if (def.policy.root === 'none') return scope.serverRoot;
  return resolveCallRoot(scope.serverRoot, args?.[ROOT_PARAM], scope.allowedRoots);
}

/** Render `data` through a registry, capturing the output stream. */
async function render(
  registry: Registry,
  format: string,
  data: unknown,
  cols: readonly ColumnSpec[]
): Promise<string> {
  if (!registry.lookup(format)) {
    throw new ToolArgumentError(`unknown output format "${format}" (valid: ${registry.keys().join(', ')})`);
  }
  const parts: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      parts.push(chunk.toString());
      done();
    },
  });
  await formatterOf(registry, format).render(stream, data, {}, cols.map((c) => c.header));
  return parts.join('');
}

/** Run one built-in tool in-process; throws ToolArgumentError / CodedError on bad input. */
export async function runInProcess(
  def: ToolDef,
  args: Record<string, unknown> | undefined,
  scope: InProcessScope
): Promise<InvokeResult> {
  assertKnownArgs(def, args);
  const callRoot = callRootOf(scope, args, def);
  // Same rule as the child path: without a server config to pin, a sub-root
  // with its own config is refused, so its config never loads in-process.
  if (callRoot !== scope.serverRoot && (def.policy.configFromPath || def.name === 'query')) {
    assertConfigPinned(scope.serverConfig, callRoot);
  }
  const a = new Args(def, args ?? {}, scope, callRoot);

  switch (def.name) {
    case 'impact':
      return impact(a, scope, callRoot);
    case 'query':
      return query(a, scope, callRoot);
    case 'imports':
      return imports(a, scope, callRoot);
    case 'explore':
      return explore(a, scope, callRoot);
    case 'map':
    case 'graph':
      return mapGraph(a, def, scope, callRoot);
    default:
      throw new ToolArgumentError(`tool ${def.name} is not available in-process`);
  }
}

async function impact(a: Args, scope: InProcessScope, callRoot: string): Promise<InvokeResult> {
  if (!a.has('symbol')) throw new ToolArgumentError('argument "symbol" is required');
  const format = a.scalar('format') ?? 'text';
  const warm = await scope.workspace.getGraph(callRoot, {
    configPath: scope.serverConfig ?? undefined,
    lens: a.scalar('lens'),
    scope: a.scalar('scope'),
  });
  const result = await impactFromSerialized(warm.serialized, a.scalar('symbol'), {
    depth: a.scalar('depth'),
    strict: a.bool('strict'),
  });
  const stdout = await render(impactRegistry, format, result, DEFAULT_IMPACT_COLUMNS);
  return { stdout, stderr: '', exitCode: 0 };
}

async function query(a: Args, scope: InProcessScope, callRoot: string): Promise<InvokeResult> {
  if (a.bool('list-adapters')) {
    return { stdout: listAdapters().replace(/\n$/, '') + '\n', stderr: '', exitCode: 0 };
  }
  const q = a.scalar('query');
  if (!q || !q.trim()) throw new ToolArgumentError('argument "query" is required');
  const format = a.scalar('format') ?? 'table';
  const warm = await scope.workspace.getGraph(callRoot, {
    configPath: scope.serverConfig ?? undefined,
  });
  const result = queryFromSerialized(warm.serialized, q, {});
  const stdout = await render(queryRegistry, format, result, DEFAULT_QUERY_COLUMNS);
  return { stdout, stderr: '', exitCode: 0 };
}

async function imports(a: Args, scope: InProcessScope, callRoot: string): Promise<InvokeResult> {
  const format = a.scalar('format') ?? 'json';
  const root = a.has('path') ? a.scalar('path')! : callRoot;
  const doc = handleImportsAction(a.list('paths'), {
    path: root,
    lang: a.list('lang'),
    ignore: a.bool('no-ignore') === true ? false : true,
    cache: a.bool('no-cache') === true ? false : true,
  });
  // The CLI reports `root` as given ('.' when it defaults to the working
  // directory); match that for a call rooted at the server root.
  const normalized = callRoot === scope.serverRoot ? { ...doc, root: '.' } : doc;
  const stdout = await render(importsRegistry, format, normalized, DEFAULT_IMPORTS_COLUMNS);
  return { stdout, stderr: '', exitCode: 0 };
}

async function explore(a: Args, scope: InProcessScope, callRoot: string): Promise<InvokeResult> {
  const format = a.scalar('format') ?? 'text';
  const paths = a.list('path');
  const options: ExploreCommandOptions = {
    path: paths.length > 0 ? paths : [callRoot],
    match: a.list('match'),
    search: a.has('search') ? a.list('search') : [],
    type: a.list('type'),
    stats: a.bool('stats'),
  } as ExploreCommandOptions;
  const capture: ExploreCapture = {
    mute: true,
    indexFor: (root) => scope.workspace.getTrigramIndex(root),
  };
  await handleExploreAction(options, undefined, capture);
  const outcome = capture.outcome;
  if (!outcome) throw new ToolArgumentError('explore produced no result');
  const registry = outputRegistry(outcome.text);
  const stdout = await render(registry, format, outcome.rows, outcome.cols);
  return { stdout, stderr: '', exitCode: 0 };
}

async function mapGraph(a: Args, def: ToolDef, scope: InProcessScope, callRoot: string): Promise<InvokeResult> {
  const format = graphFormat(a.all());
  const paths = a.list('path');
  const root = paths.length > 0 ? paths[0] : callRoot;
  let withFeatures = a.list('with');
  if (def.name === 'graph' && !withFeatures.includes('cf') && !withFeatures.includes('df')) {
    withFeatures = [...withFeatures, 'cf', 'df'];
  }
  const features: Record<string, boolean> = {};
  for (const f of withFeatures) features[f] = true;

  const warm = await scope.workspace.getGraph(root, {
    configPath: scope.serverConfig ?? undefined,
    lens: a.scalar('lens'),
    scope: a.scalar('scope'),
    lang: a.list('lang'),
    match: a.list('match'),
    catch: a.list('catch'),
    queries: a.list('query'),
    limit: a.integer('limit'),
    depth: a.integer('depth'),
    anchor: a.scalar('anchor'),
    features: Object.keys(features).length > 0 ? features : undefined,
  });
  return { stdout: renderGraph(warm.serialized, format as 'json' | 'xml' | 'csv'), stderr: '', exitCode: 0 };
}

function renderGraph(graph: SerializedGraph, format: 'json' | 'xml' | 'csv'): string {
  if (format === 'xml') return graphToXml(graph);
  if (format === 'csv') {
    return `== nodes.csv ==\n${graphToNodesCsv(graph)}\n== edges.csv ==\n${graphToEdgesCsv(graph)}`;
  }
  return JSON.stringify(graph, null, 2) + '\n';
}
