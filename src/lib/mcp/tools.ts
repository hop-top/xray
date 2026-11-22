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
import * as fs from 'fs';
import * as path from 'path';
import type { Argument, Command, Option } from 'commander';
import ignore, { type Ignore } from 'ignore';
import type { FlagSchema, InvokeResult, Leaf } from '@hop-top/kit/dist/mcp';
import { getCommandGroup } from '../../commands/kit-cli';
import { declaredEffect } from '../../commands/side-effect';
import { isWithin } from '../confine';
import { getDiff, isGitRepo, listBranches, listCommits } from '../git';
import { capOutputBytes, truncateLine, windowSlice } from '../output-guardrails';
import { DEFAULT_IMPACT_DEPTH } from '../query/impact';
import { readTextSafe } from '../safe-read';
import type { WarmWorkspaceManager } from './workspace';

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

const MAX_READ_LINES = 500;
const MAX_LINE_CHARS = 500;
const MAX_TREE_DEPTH = 10;
const MAX_TREE_LIMIT = 10_000;
const DEFAULT_TREE_LIMIT = 1000;
const MAX_OUTPUT_BYTES = 128_000;

function isSensitiveFile(relPath: string): boolean {
  const base = path.basename(relPath);
  if (base === '.env' || base.startsWith('.env.')) return true;
  const lower = base.toLowerCase();
  return lower.endsWith('.pem') || lower.endsWith('.key');
}

function hasGitSegment(relPath: string): boolean {
  return relPath.split(/[/\\]/).some((seg) => seg === '.git');
}

function resolveScopedBase(
  workspace: WarmWorkspaceManager,
  rawRoot: unknown,
  requireBaseAllowed = true
): { root: string; callDir: string; explicitRoot: boolean } {
  if (rawRoot === undefined || rawRoot === null || rawRoot === '') {
    const allowed = workspace.getAllowedRoots();
    if (allowed.size === 0) {
      throw new ToolArgumentError('no allowed roots in scope');
    }
    if (requireBaseAllowed) {
      // If serverRoot itself is allowed, use it; otherwise if a scoped token
      // narrowed access to a subdirectory within serverRoot, allow git
      // operations anchored at the first narrowed root inside serverRoot.
      for (const r of allowed) {
        if (isWithin(r, workspace.serverRoot)) {
          return { root: r, callDir: workspace.serverRoot, explicitRoot: false };
        }
      }
      const first = allowed.values().next().value as string;
      return { root: first, callDir: first, explicitRoot: false };
    }
    return { root: workspace.serverRoot, callDir: workspace.serverRoot, explicitRoot: false };
  }
  if (typeof rawRoot !== 'string') {
    throw new ToolArgumentError('argument "root" must be a string');
  }
  const contained = workspace.containAcrossAllowedRoots(rawRoot);
  let realDir: string;
  try {
    realDir = fs.realpathSync(contained.absPath);
  } catch {
    throw new ToolArgumentError(`root "${rawRoot}" does not exist`);
  }
  if (!fs.statSync(realDir).isDirectory()) {
    throw new ToolArgumentError(`root "${rawRoot}" is not a directory`);
  }
  return { root: contained.root, callDir: realDir, explicitRoot: true };
}

function resolveContainedTarget(
  workspace: WarmWorkspaceManager,
  rawRoot: unknown,
  rawPath: string
): { matchedRoot: string; callDir: string; realTarget: string; relToRoot: string } {
  const { callDir, explicitRoot } = resolveScopedBase(workspace, rawRoot, false);
  if (isUrlLike(rawPath)) {
    throw new ToolArgumentError(`path "${rawPath}" must be a filesystem path, not a URL`);
  }
  const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(callDir, rawPath);
  const contained = workspace.containAcrossAllowedRoots(candidate);

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(contained.absPath);
  } catch (err: any) {
    throw new ToolArgumentError(`path "${rawPath}" does not exist: ${err?.message ?? err}`);
  }
  if (explicitRoot && !isWithin(callDir, realTarget)) {
    throw new ToolArgumentError(`path "${rawPath}" escapes root "${String(rawRoot)}"`);
  }
  const relToRoot = path.relative(contained.root, realTarget);
  return { matchedRoot: contained.root, callDir, realTarget, relToRoot };
}

function loadGitignore(rootDir: string): Ignore {
  const ig = ignore();
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      ig.add(readTextSafe(rootDir, '.gitignore'));
    } catch {
      // Ignore unreadable .gitignore
    }
  }
  return ig;
}

function okJson(payload: unknown): InvokeResult {
  const raw = JSON.stringify(payload);
  const capped = capOutputBytes(raw, MAX_OUTPUT_BYTES);
  return { stdout: capped.text, stderr: '', exitCode: 0 };
}

function clampInt(raw: unknown, def: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === null) return def;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new ToolArgumentError(`argument "${name}" must be a number`);
  }
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

/**
 * Build the five primitive read-only MCP tools (`read_file`, `list_tree`,
 * `list_branches`, `list_commits`, `get_diff`), all confined through
 * `WarmWorkspaceManager.containAcrossAllowedRoots`.
 */
export function buildPrimitiveDirectTools(
  workspace: WarmWorkspaceManager
): Map<string, DirectToolDef> {
  const tools = new Map<string, DirectToolDef>();

  tools.set('read_file', {
    name: 'read_file',
    description:
      'Read a text file inside the allowed project roots with 1-based line numbers, 500-line window cap, and line-length truncation. Refuses .git/ and sensitive files (.env, *.pem, *.key).',
    properties: {
      root: { type: 'string', description: 'Optional project subdirectory inside allowed roots.' },
      path: { type: 'string', description: 'File path relative to root (or absolute within allowed roots).' },
      offset: { type: 'number', description: '1-based start line (default 1).' },
      limit: { type: 'number', description: 'Max lines to return (1..500, default 500).' },
    },
    required: ['path'],
    invoke: (args) => {
      const a = args ?? {};
      if (typeof a.path !== 'string' || a.path.trim() === '') {
        throw new ToolArgumentError('argument "path" must be a non-empty string');
      }
      const offset = clampInt(a.offset, 1, 1, Number.MAX_SAFE_INTEGER, 'offset');
      const limit = clampInt(a.limit, MAX_READ_LINES, 1, MAX_READ_LINES, 'limit');

      const { matchedRoot, realTarget, relToRoot } = resolveContainedTarget(workspace, a.root, a.path);
      if (hasGitSegment(relToRoot) || hasGitSegment(a.path)) {
        throw new ToolArgumentError(`refusing to read inside .git: "${a.path}"`);
      }
      if (isSensitiveFile(relToRoot)) {
        throw new ToolArgumentError(`refusing to read sensitive file: "${a.path}"`);
      }

      let content: string;
      try {
        content = readTextSafe(matchedRoot, realTarget);
      } catch (err: any) {
        throw new ToolArgumentError(`cannot read "${a.path}": ${err?.message ?? err}`);
      }

      const rawLines = content.length === 0 ? [] : content.split(/\r?\n/);
      if (content.endsWith('\n') && rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
        rawLines.pop();
      }
      const slice = windowSlice(rawLines, { offset: offset - 1, limit, maxLimit: MAX_READ_LINES });
      const lines = slice.items.map((line, idx) => {
        const trunc = truncateLine(line, MAX_LINE_CHARS);
        return {
          line: offset + idx,
          text: trunc.text,
          ...(trunc.truncated ? { truncated: true } : {}),
        };
      });

      return okJson({
        path: relToRoot.split(path.sep).join('/'),
        offset,
        limit: slice.limit,
        totalLines: rawLines.length,
        hasMore: slice.hasMore,
        lines,
      });
    },
  });

  tools.set('list_tree', {
    name: 'list_tree',
    description:
      'List files and directories inside the allowed project roots, sorting directories before files and honoring .gitignore.',
    properties: {
      root: { type: 'string', description: 'Optional project subdirectory inside allowed roots.' },
      path: { type: 'string', description: 'Directory path to list (default ".").' },
      depth: { type: 'number', description: 'Traversal depth (1..10, default 1).' },
      limit: { type: 'number', description: 'Maximum entries to return (1..10000, default 1000).' },
      includeFiles: { type: 'boolean', description: 'Include files in output (default true).' },
      includeDirectories: { type: 'boolean', description: 'Include directories in output (default true).' },
    },
    invoke: (args) => {
      const a = args ?? {};
      const relInput = typeof a.path === 'string' && a.path.trim() !== '' ? a.path : '.';
      const depth = clampInt(a.depth, 1, 1, MAX_TREE_DEPTH, 'depth');
      const limit = clampInt(a.limit, DEFAULT_TREE_LIMIT, 1, MAX_TREE_LIMIT, 'limit');
      const includeFiles = a.includeFiles === undefined ? true : Boolean(a.includeFiles);
      const includeDirectories = a.includeDirectories === undefined ? true : Boolean(a.includeDirectories);

      const { matchedRoot, realTarget, relToRoot } = resolveContainedTarget(workspace, a.root, relInput);
      if (!fs.statSync(realTarget).isDirectory()) {
        throw new ToolArgumentError(`path "${relInput}" must be a directory`);
      }

      const ig = loadGitignore(matchedRoot);
      const entries: Array<{ path: string; name: string; type: 'directory' | 'file' }> = [];
      let hasMore = false;

      const walk = (dir: string, currentDepth: number) => {
        if (hasMore) return;
        let dirents: fs.Dirent[];
        try {
          dirents = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }

        const classified: Array<{ name: string; full: string; rel: string; isDir: boolean }> = [];
        for (const d of dirents) {
          if (d.name === '.git') continue;
          const full = path.join(dir, d.name);
          let isDir = d.isDirectory();
          let isFile = d.isFile();
          if (d.isSymbolicLink()) {
            try {
              const real = fs.realpathSync(full);
              if (!isWithin(matchedRoot, real)) continue;
              const st = fs.statSync(real);
              isDir = st.isDirectory();
              isFile = st.isFile();
            } catch {
              continue;
            }
          }
          if (!isDir && !isFile) continue;

          const rel = path.relative(matchedRoot, full).split(path.sep).join('/');
          if (ig.ignores(isDir ? `${rel}/` : rel) || ig.ignores(rel)) continue;
          classified.push({ name: d.name, full, rel, isDir });
        }

        classified.sort((x, y) => {
          if (x.isDir !== y.isDir) return x.isDir ? -1 : 1;
          return x.name.localeCompare(y.name);
        });

        for (const item of classified) {
          const shouldEmit = item.isDir ? includeDirectories : includeFiles;
          if (shouldEmit) {
            if (entries.length >= limit) {
              hasMore = true;
              return;
            }
            entries.push({
              path: item.rel,
              name: item.name,
              type: item.isDir ? 'directory' : 'file',
            });
          }
          if (item.isDir && currentDepth < depth) {
            walk(item.full, currentDepth + 1);
            if (hasMore) return;
          }
        }
      };

      walk(realTarget, 1);

      return okJson({
        path: (relToRoot || '.').split(path.sep).join('/'),
        depth,
        limit,
        total: entries.length,
        hasMore,
        entries,
      });
    },
  });

  tools.set('list_branches', {
    name: 'list_branches',
    description: 'List local and remote git branches sorted by most recent committer date.',
    properties: {
      root: { type: 'string', description: 'Optional repository directory inside allowed roots.' },
    },
    invoke: async (args) => {
      const { callDir } = resolveScopedBase(workspace, args?.root);
      if (!(await isGitRepo(callDir))) {
        throw new ToolArgumentError(`directory "${callDir}" is not a git repository`);
      }
      const branches = await listBranches(callDir);
      return okJson({ branches });
    },
  });

  tools.set('list_commits', {
    name: 'list_commits',
    description: 'List paginated git commits with optional ref, author, date, and message filters.',
    properties: {
      root: { type: 'string', description: 'Optional repository directory inside allowed roots.' },
      ref: { type: 'string', description: 'Git ref to inspect (default HEAD).' },
      query: { type: 'string', description: 'Filter commit subjects/messages (--grep).' },
      since: { type: 'string', description: 'Include commits after date (--since).' },
      until: { type: 'string', description: 'Include commits before date (--until).' },
      author: { type: 'string', description: 'Filter commits by author (--author).' },
      page: { type: 'number', description: '1-based page number (default 1).' },
      perPage: { type: 'number', description: 'Commits per page (1..100, default 50).' },
      includeTotalCount: { type: 'boolean', description: 'Include total commit count.' },
      includeRefs: { type: 'boolean', description: 'Include ref decorations.' },
    },
    invoke: async (args) => {
      const a = args ?? {};
      const { callDir } = resolveScopedBase(workspace, a.root);
      if (!(await isGitRepo(callDir))) {
        throw new ToolArgumentError(`directory "${callDir}" is not a git repository`);
      }
      const res = await listCommits(callDir, {
        ...(typeof a.ref === 'string' ? { ref: a.ref } : {}),
        ...(typeof a.query === 'string' ? { query: a.query } : {}),
        ...(typeof a.since === 'string' ? { since: a.since } : {}),
        ...(typeof a.until === 'string' ? { until: a.until } : {}),
        ...(typeof a.author === 'string' ? { author: a.author } : {}),
        ...(typeof a.page === 'number' ? { page: a.page } : {}),
        ...(typeof a.perPage === 'number' ? { perPage: a.perPage } : {}),
        ...(typeof a.includeTotalCount === 'boolean' ? { includeTotalCount: a.includeTotalCount } : {}),
        ...(typeof a.includeRefs === 'boolean' ? { includeRefs: a.includeRefs } : {}),
      });
      return okJson(res);
    },
  });

  tools.set('get_diff', {
    name: 'get_diff',
    description: 'Compute per-file git diff between base and head (use base="WORKING" for working tree against HEAD).',
    properties: {
      root: { type: 'string', description: 'Optional repository directory inside allowed roots.' },
      base: { type: 'string', description: 'Base ref or "WORKING" (default "WORKING").' },
      head: { type: 'string', description: 'Head ref (default "HEAD").' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional relative paths to filter diff.' },
    },
    invoke: async (args) => {
      const a = args ?? {};
      const { callDir } = resolveScopedBase(workspace, a.root);
      if (!(await isGitRepo(callDir))) {
        throw new ToolArgumentError(`directory "${callDir}" is not a git repository`);
      }
      const base = typeof a.base === 'string' && a.base.trim() !== '' ? a.base : 'WORKING';
      const head = typeof a.head === 'string' && a.head.trim() !== '' ? a.head : 'HEAD';
      let relPaths: string[] | undefined;
      if (Array.isArray(a.paths)) {
        relPaths = a.paths.map((p) => {
          if (typeof p !== 'string' || p.trim() === '') {
            throw new ToolArgumentError('argument "paths" must contain non-empty strings');
          }
          const { realTarget } = resolveContainedTarget(workspace, a.root, p);
          return path.relative(callDir, realTarget).split(path.sep).join('/');
        });
      }
      const files = await getDiff(callDir, base, head, relPaths);
      return okJson({ base, head, files });
    },
  });

  return tools;
}
