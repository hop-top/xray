/**
 * MCP tool surface derived from the commander tree.
 *
 * Kit's `commanderBridge` enumerates leaves and maps their options to
 * JSON Schema; this module narrows that set to xray's read-only
 * analysis commands and fills what the kit projection leaves out:
 * positional arguments, repeatable options as arrays, negated flags
 * (`--no-x`) as booleans and the per-call `root`.
 *
 * Options are allowlisted per tool (`ToolPolicy`): an option is exposed
 * only when listed, and every listed option (and positional, via
 * `ToolPolicy.positionals`) that names a file or directory is contained
 * in the server root.
 *
 * Pure (no I/O beyond the injected path resolver): tool selection,
 * schema shaping and argv building are unit-tested against small
 * commander trees.
 */
import * as path from 'path';
import type { Argument, Command, Option } from 'commander';
import type { FlagSchema, Leaf } from '@hop-top/kit/dist/mcp';
import { getCommandGroup } from '../../commands/kit-cli';
import { declaredEffect } from '../../commands/side-effect';
import { DEFAULT_IMPACT_DEPTH } from '../query/impact';

/** Per-call project scope parameter (a directory inside the server root). */
export const ROOT_PARAM = 'root';

/**
 * How a tool argument value is handled.
 *
 * - `value`: passed through (flag, name, pattern, number).
 * - `path`: filesystem path; resolved against the call root and held
 *   inside the server root (symlinks resolved). URLs are refused.
 * - `dir`: like `path`, and it must be an existing directory: a file here
 *   would be read directly, past the scanner's ignore and extension rules.
 * - `query-source`: map's `--query` (`path`, `.ext:path`, comma lists);
 *   every path part is contained like `path`. URLs are refused (the CLI
 *   would fetch them).
 * - `project-file`: a file the command joins onto its project path
 *   (`config-files keys --file`); contained, then passed project-relative.
 */
export type ParamKind = 'value' | 'path' | 'dir' | 'query-source' | 'project-file';

/**
 * How the per-call `root` reaches a command. Children always run in the
 * server root, so `root` is never a working directory:
 * - `path`: passed as the command's `--path` (when no `path` is given).
 * - `graph`: query; the graph it builds is mapped with `--path=<root>`.
 * - `none`: the command has no project scope; `root` is not offered.
 */
export type RootScope = 'path' | 'graph' | 'none';

/** Per-tool allowlist: only these options are exposed and accepted. */
export interface ToolPolicy {
  options: Readonly<Record<string, ParamKind>>;
  /**
   * Kind per positional argument (commander name). Like options, only
   * listed positionals are exposed; a `path` positional is contained like
   * a `path` option.
   */
  positionals?: Readonly<Record<string, 'value' | 'path'>>;
  root: RootScope;
  /**
   * The command loads xray config by walking up from its `--path`
   * (map/graph): every such directory must resolve to the server
   * root's config, never one of its own.
   */
  configFromPath: boolean;
  /** Keep auto-detection when `root` becomes `--path` (map/graph). */
  detectOnRoot: boolean;
  /** Tool description for agents; default: the command's own description. */
  description?: string;
}

const EXTENSION_OVERRIDES: Record<string, ParamKind> = {
  'enable-extension': 'value',
  'disable-extension': 'value',
  'enable-surface': 'value',
  'disable-surface': 'value',
  'extension-hint': 'value',
  'extension-threshold': 'value',
};

/** map / graph. Not offered: --output (runner-owned), --share, --config. */
const ANALYSIS: ToolPolicy = {
  options: {
    path: 'path',
    anchor: 'path',
    query: 'query-source',
    limit: 'value',
    with: 'value',
    depth: 'value',
    match: 'value',
    catch: 'value',
    format: 'value',
    xml: 'value',
    json: 'value',
    csv: 'value',
    txt: 'value',
    'no-chunk': 'value',
    group: 'value',
    lens: 'value',
    scope: 'value',
    'all-scopes': 'value',
    detect: 'value',
    'skip-detect': 'value',
    lang: 'value',
    ...EXTENSION_OVERRIDES,
  },
  root: 'path',
  configFromPath: true,
  detectOnRoot: true,
};

const scoped = (options: Record<string, ParamKind>, root: RootScope = 'path'): ToolPolicy => ({
  options, root, configFromPath: false, detectOnRoot: false,
});

/** Core commands exposed as tools, keyed by tool name. */
const CORE_TOOLS: Readonly<Record<string, ToolPolicy>> = {
  map: ANALYSIS,
  graph: ANALYSIS,
  explore: {
    ...scoped({
      path: 'dir', match: 'value', search: 'value', type: 'value',
      stats: 'value', 'list-strategies': 'value', format: 'value',
    }),
  },
  query: {
    ...scoped({ graph: 'path', 'list-adapters': 'value', format: 'value' }, 'graph'),
    positionals: { query: 'value' },
  },
  // Parses only (no config); positional paths held inside the server root.
  imports: {
    ...scoped({ path: 'path', lang: 'value', format: 'value', 'no-ignore': 'value' }),
    positionals: { paths: 'path' },
    description:
      'Per-file imports as the xray.imports/v1 JSON document (schemas/xray.imports.v1.json): 1-based line/column, ' +
      'normalized module, package, locality, parse errors and unsupported constructs (complete: false). ' +
      'paths: files/dirs inside root to narrow to; lang: python, go, rust, typescript|ts, javascript|js, php. no-ignore: list git-ignored files, nested repos and node_modules too (.git skipped).',
  },
  // Builds its graph in process like map (config walks up from --path);
  // --graph not offered: the graph always comes from the call root.
  impact: {
    options: { depth: 'value', strict: 'value', format: 'value', lens: 'value', scope: 'value' },
    positionals: { symbol: 'value' },
    root: 'path',
    configFromPath: true,
    detectOnRoot: false,
    description:
      'What breaks if I change <symbol>: every transitive caller of a function/method (exact name or glob), ' +
      'grouped by area, with EXTRACTED/INFERRED confidence. Use before renaming, changing a signature or ' +
      `removing a symbol. strict: EXTRACTED edges only; depth: caller levels (default ${DEFAULT_IMPACT_DEPTH}).`,
  },
  strategy_list: scoped({ format: 'value' }, 'none'),
  strategy_detect: scoped({ path: 'path' }),
};

/** Options every `<strategy> <noun>` command gets from registration. */
const STRATEGY_NOUN: Record<string, ParamKind> = { path: 'path', format: 'value', ...EXTENSION_OVERRIDES };

/**
 * Options built-in strategies declare per noun, vetted as safe. Options a
 * strategy declares that are not listed here (go-cli's `--binary`,
 * `--exec-binary`, config's `--show-secrets`, any project strategy's own
 * options) are not exposed.
 */
const STRATEGY_NOUN_EXTRA: Readonly<Record<string, Record<string, ParamKind>>> = {
  'config-files_list': { pattern: 'value' },
  'config-files_keys': { file: 'project-file' },
  'config-files_values': { file: 'project-file' },
  'build_run': { target: 'value' },
  'markdown_toc': { depth: 'value' },
};

/** Commands whose CLI result is files (`-o`), collected by the runner. */
const FILE_OUTPUT_TOOLS = new Set(['map', 'graph']);

/** One exposed tool: MCP name, command path, policy and parameter kinds. */
export interface ToolDef {
  name: string;
  path: string[];
  policy: ToolPolicy;
  /** Parameters bound to positional arguments, in declaration order. */
  positionals: string[];
  /** Map/scan/graph: output goes to files the runner collects. */
  fileOutput: boolean;
}

/**
 * MCP tool name for a command path. Segments join with `_`, not kit's
 * `.`: several clients restrict tool names to `[A-Za-z0-9_-]`.
 */
export function toolNameFor(path: string[]): string {
  return path.join('_');
}

/** Allowlist policy for a command path, or undefined when it is not a tool. */
export function policyFor(root: Command, path: string[]): ToolPolicy | undefined {
  const name = toolNameFor(path);
  if (Object.prototype.hasOwnProperty.call(CORE_TOOLS, name)) return CORE_TOOLS[name];
  // `<strategy> <noun>`: every subcommand of a dynamic strategy group.
  if (path.length !== 2 || path[0] === 'strategy') return undefined;
  const top = (root.commands as Command[]).find((c) => c.name() === path[0]);
  if (top === undefined || getCommandGroup(top) !== 'strategy') return undefined;
  // Only reads are tools: a strategy command that runs code or writes
  // (`build exec`) declares a higher tier. No declared tier: not exposed.
  const leaf = findCommand(root, path);
  if (leaf === undefined || declaredEffect(leaf).tier !== 'read') return undefined;
  const extra = Object.prototype.hasOwnProperty.call(STRATEGY_NOUN_EXTRA, name) ? STRATEGY_NOUN_EXTRA[name] : {};
  return scoped({ ...STRATEGY_NOUN, ...extra });
}

/** Whether a command path is one of the read-only tools. */
export function isExposedPath(root: Command, path: string[]): boolean {
  return policyFor(root, path) !== undefined;
}

/** Resolve a command path back to its commander Command. */
export function findCommand(root: Command, path: string[]): Command | undefined {
  let cur: Command | undefined = root;
  for (const seg of path) {
    cur = (cur.commands as Command[]).find((c) => c.name() === seg);
    if (!cur) return undefined;
  }
  return cur;
}

/** Schema property name for an option (long flag, undashed), as kit derives it. */
export function optionKey(opt: Option): string {
  if (opt.long) return opt.long.replace(/^--/, '');
  return (opt.short ?? '').replace(/^-/, '');
}

function findOption(cmd: Command, key: string): Option | undefined {
  return (cmd.options as Option[]).find((o) => !o.hidden && optionKey(o) === key);
}

/** Takes no value: plain and negated (`--no-x`) flags alike. */
function isFlag(opt: Option): boolean {
  return !opt.required && !opt.optional;
}

/** Repeatable options collect into an array default (`[]`). */
function isRepeatable(opt: Option): boolean {
  return opt.variadic || Array.isArray(opt.defaultValue);
}

function allowed(policy: ToolPolicy, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(policy.options, key);
}

/**
 * Shape one kit leaf into the exposed tool leaf + its ToolDef: keep only
 * allowlisted options, widen repeatable options to arrays, add
 * positional arguments and (when the tool has a project scope) `root`.
 */
function exposedArguments(cmd: Command, policy: ToolPolicy): readonly Argument[] {
  const listed = policy.positionals ?? {};
  return (cmd.registeredArguments as readonly Argument[])
    .filter(arg => Object.prototype.hasOwnProperty.call(listed, arg.name()));
}

export function shapeLeaf(leaf: Leaf, cmd: Command, policy: ToolPolicy): { leaf: Leaf; def: ToolDef } {
  const properties: Record<string, FlagSchema> = {};
  const required: string[] = [];

  for (const [key, schema] of Object.entries(leaf.properties)) {
    if (!allowed(policy, key) || key === ROOT_PARAM) continue;
    const opt = findOption(cmd, key);
    if (!opt) continue;
    if (isFlag(opt)) {
      properties[key] = { type: 'boolean', description: schema.description };
    } else if (isRepeatable(opt)) {
      properties[key] = { type: 'array', items: { type: 'string' }, description: schema.description };
    } else {
      properties[key] = schema;
    }
  }
  for (const key of leaf.required ?? []) {
    if (key in properties) required.push(key);
  }

  const positionals: string[] = [];
  for (const arg of exposedArguments(cmd, policy)) {
    let key = arg.name();
    if (key in properties || key === ROOT_PARAM) key = `${key}-arg`;
    properties[key] = arg.variadic
      ? { type: 'array', items: { type: 'string' }, description: arg.description }
      : { type: 'string', description: arg.description };
    if (arg.required) required.push(key);
    positionals.push(key);
  }

  const fileOutput = leaf.path.length === 1 && FILE_OUTPUT_TOOLS.has(leaf.path[0]);
  if (policy.root !== 'none') {
    properties[ROOT_PARAM] = {
      type: 'string',
      description:
        'Project directory to analyze (absolute, or relative to the server root); must be inside the server root. ' +
        'Relative path arguments resolve against it. Default: server root.',
    };
  }

  const name = toolNameFor(leaf.path);
  const shaped: Leaf = {
    path: [name],
    description: policy.description ?? leaf.description,
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(leaf.class ? { class: leaf.class } : {}),
  };
  return { leaf: shaped, def: { name, path: leaf.path, policy, positionals, fileOutput } };
}

/** Error for a bad tool argument; surfaces as an MCP tool error. */
export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolArgumentError';
  }
}

function scalar(key: string, v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  throw new ToolArgumentError(`argument "${key}" must be a string`);
}

function values(key: string, v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => scalar(key, x)) : [scalar(key, v)];
}

/** `scheme://...`: a URL, never accepted where a path is expected. */
export function isUrlLike(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value.trim());
}

/**
 * Containment for path-valued arguments, injected so this module stays
 * pure. `contain` resolves `value` against `base`, requires the result
 * inside the server root (symlinks resolved) and returns it absolute.
 */
export interface PathScope {
  /** Per-call project directory (absolute); the server root by default. */
  dir: string;
  /** Whether the call selected `dir` with `root` (vs the default). */
  explicit: boolean;
  contain(value: string, base: string, label: string): string;
  /** True when `abs` is an existing directory; unset in unit tests that fake paths. */
  isDirectory?(abs: string): boolean;
}

/** Argv for one call plus the project directories passed as `--path`. */
export interface BuiltArgv {
  argv: string[];
  /** Absolute `--path` values (given, or the call root); empty = server root. */
  projectDirs: string[];
}

function containedPath(key: string, value: string, base: string, scope: PathScope): string {
  if (isUrlLike(value)) throw new ToolArgumentError(`argument "${key}" must be a path inside the server root, not a URL: "${value}"`);
  return scope.contain(value, base, key);
}

/** map `--query`: comma list of `path` or `.ext:path`; every path contained. */
function containQuerySource(key: string, value: string, scope: PathScope): string {
  return value
    .split(',')
    .map((raw) => {
      const part = raw.trim();
      if (part === '') return part;
      const colon = part.indexOf(':');
      if (colon > 0 && part.startsWith('.')) {
        return `${part.slice(0, colon)}:${containedPath(key, part.slice(colon + 1), scope.dir, scope)}`;
      }
      return containedPath(key, part, scope.dir, scope);
    })
    .join(',');
}

/**
 * Translate tool arguments into the command's argv (path first,
 * options as `--key=value`, positionals after `--`). Only options in the
 * tool's policy are accepted; path-like values are contained through
 * `scope`. With an explicit `root` and no `path`, `root` becomes the
 * command's `--path`. Unknown or unlisted keys and type mismatches
 * throw ToolArgumentError.
 */
export function buildArgv(
  def: ToolDef,
  cmd: Command,
  args: Record<string, unknown> | undefined,
  scope: PathScope
): BuiltArgv {
  const { policy } = def;
  const opts: string[] = [];
  const positionals: string[] = [];
  const projectDirs: string[] = [];
  const given = args ?? {};

  if (policy.root === 'none' && given[ROOT_PARAM] !== undefined && given[ROOT_PARAM] !== null) {
    throw new ToolArgumentError(`unknown argument "${ROOT_PARAM}" for tool ${def.name}`);
  }

  // `path` first: a project-file resolves against the (first) project path.
  const keys = Object.keys(given).sort((a, b) => Number(b === 'path') - Number(a === 'path'));
  for (const key of keys) {
    const v = given[key];
    if (key === ROOT_PARAM || v === undefined || v === null) continue;
    if (def.positionals.includes(key)) continue;
    const opt = allowed(policy, key) ? findOption(cmd, key) : undefined;
    if (!opt) throw new ToolArgumentError(`unknown argument "${key}" for tool ${def.name}`);

    if (isFlag(opt)) {
      if (typeof v !== 'boolean') throw new ToolArgumentError(`argument "${key}" must be a boolean`);
      if (v) opts.push(`--${key}`);
      continue;
    }
    const vals = values(key, v);
    if (vals.length > 1 && !isRepeatable(opt)) {
      throw new ToolArgumentError(`argument "${key}" takes a single value`);
    }
    for (const val of vals) {
      let out = val;
      switch (policy.options[key]) {
        case 'path':
          out = containedPath(key, val, scope.dir, scope);
          if (key === 'path') projectDirs.push(out);
          break;
        case 'dir':
          out = containedPath(key, val, scope.dir, scope);
          if (scope.isDirectory && !scope.isDirectory(out)) {
            throw new ToolArgumentError(`argument "${key}" "${val}" must be an existing directory, not a file`);
          }
          if (key === 'path') projectDirs.push(out);
          break;
        case 'query-source':
          out = containQuerySource(key, val, scope);
          break;
        case 'project-file': {
          const project = projectDirs[0] ?? scope.dir;
          out = path.relative(project, containedPath(key, val, project, scope));
          break;
        }
        default:
          break;
      }
      opts.push(`--${key}=${out}`);
    }
  }

  // The call root reaches the command as its project path, never as cwd.
  if (scope.explicit && policy.root === 'path' && projectDirs.length === 0) {
    opts.unshift(`--path=${scope.dir}`);
    projectDirs.push(scope.dir);
    // map/graph auto-detect only without --path; keep the default.
    if (policy.detectOnRoot && given.detect === undefined && given['skip-detect'] !== true) opts.push('--detect');
  }

  const declared = exposedArguments(cmd, policy);
  def.positionals.forEach((key, i) => {
    const v = given[key];
    if (v === undefined || v === null) return;
    const name = declared[i]?.name() ?? key;
    const kind = policy.positionals?.[name];
    for (const val of values(key, v)) {
      positionals.push(kind === 'path' ? containedPath(key, val, scope.dir, scope) : val);
    }
  });

  return {
    argv: [...def.path, ...opts, ...(positionals.length > 0 ? ['--', ...positionals] : [])],
    projectDirs,
  };
}
