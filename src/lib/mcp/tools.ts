/**
 * MCP tool surface derived from the commander tree.
 *
 * Kit's `commanderBridge` enumerates leaves and maps their options to
 * JSON Schema; this module narrows that set to xray's read-only
 * analysis commands and fills what the kit projection leaves out:
 * positional arguments, repeatable options as arrays, negated flags
 * (`--no-x`) as booleans, the per-call
 * `root`, and removal of flags that write files or run code.
 *
 * Pure (no I/O): tool selection, schema shaping and argv building are
 * unit-tested against small commander trees.
 */
import type { Argument, Command, Option } from 'commander';
import type { FlagSchema, Leaf } from '@hop-top/kit/dist/mcp';
import { getCommandGroup } from '../../commands/kit-cli';

/** Per-call working directory parameter, present on every tool. */
export const ROOT_PARAM = 'root';

/** Core commands exposed as tools (strategy noun commands are added generically). */
const CORE_TOOLS: readonly string[][] = [
  ['map'], ['scan'], ['graph'], ['explore'], ['query'],
  ['strategy', 'list'], ['strategy', 'detect'],
];

/** Commands whose CLI result is files (`-o`), collected by the runner. */
const FILE_OUTPUT_TOOLS = new Set(['map', 'scan', 'graph']);

/**
 * Flags never offered over MCP: they write files the server does not
 * own, load code from an arbitrary path, or build and run project code.
 */
export const DENIED_FLAGS: ReadonlySet<string> = new Set([
  'output',            // file output; the runner owns it for map/scan/graph
  'share',             // writes a summary file into the project
  'template',          // template files are executable
  'preset',            // loads plugin code from a path or package
  'exec-binary',       // go-cli: builds + runs the scanned repo
  'binary',            // go-cli: runs a given binary
  'unsafe-no-sandbox', // go-cli: disables the sandbox
  'allow-cgo',         // go-cli: runs the C toolchain on repo code
  'show-secrets',      // config: prints secret values verbatim
]);

/** Flags whose values are filesystem paths, kept inside the server root. */
export const PATH_FLAGS: ReadonlySet<string> = new Set(['path', 'anchor', 'graph']);

/** One exposed tool: MCP name, command path and parameter kinds. */
export interface ToolDef {
  name: string;
  path: string[];
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

/** Whether a command path is one of the read-only tools. */
export function isExposedPath(root: Command, path: string[]): boolean {
  if (CORE_TOOLS.some((p) => p.length === path.length && p.every((s, i) => s === path[i]))) {
    return true;
  }
  // `<strategy> <noun>`: every subcommand of a dynamic strategy group.
  if (path.length !== 2 || path[0] === 'strategy') return false;
  const top = (root.commands as Command[]).find((c) => c.name() === path[0]);
  return top !== undefined && getCommandGroup(top) === 'strategy';
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

/**
 * Shape one kit leaf into the exposed tool leaf + its ToolDef: drop
 * denied flags, widen repeatable options to arrays, add positional
 * arguments and `root`.
 */
export function shapeLeaf(leaf: Leaf, cmd: Command): { leaf: Leaf; def: ToolDef } {
  const properties: Record<string, FlagSchema> = {};
  const required: string[] = [];

  for (const [key, schema] of Object.entries(leaf.properties)) {
    if (DENIED_FLAGS.has(key) || key === ROOT_PARAM) continue;
    const opt = findOption(cmd, key);
    if (opt && isFlag(opt)) {
      properties[key] = { type: 'boolean', description: schema.description };
    } else if (opt && isRepeatable(opt)) {
      properties[key] = { type: 'array', items: { type: 'string' }, description: schema.description };
    } else {
      properties[key] = schema;
    }
  }
  for (const key of leaf.required ?? []) {
    if (key in properties) required.push(key);
  }

  const positionals: string[] = [];
  for (const arg of cmd.registeredArguments as readonly Argument[]) {
    let key = arg.name();
    if (key in properties || key === ROOT_PARAM) key = `${key}-arg`;
    properties[key] = arg.variadic
      ? { type: 'array', items: { type: 'string' }, description: arg.description }
      : { type: 'string', description: arg.description };
    if (arg.required) required.push(key);
    positionals.push(key);
  }

  const fileOutput = leaf.path.length === 1 && FILE_OUTPUT_TOOLS.has(leaf.path[0]);
  properties[ROOT_PARAM] = {
    type: 'string',
    description:
      'Directory to run in (absolute, or relative to the server root); must be inside the server root. Default: server root.',
  };

  const name = toolNameFor(leaf.path);
  const shaped: Leaf = {
    path: [name],
    description: leaf.description,
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(leaf.class ? { class: leaf.class } : {}),
  };
  return { leaf: shaped, def: { name, path: leaf.path, positionals, fileOutput } };
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

/**
 * Translate tool arguments into the command's argv (path first,
 * options as `--key=value`, positionals after `--`). `mapPath` rewrites
 * path-valued flags (containment + absolutising). Unknown or denied
 * keys and type mismatches throw ToolArgumentError.
 */
export function buildArgv(
  def: ToolDef,
  cmd: Command,
  args: Record<string, unknown> | undefined,
  mapPath: (value: string) => string
): string[] {
  const opts: string[] = [];
  const positionals: string[] = [];
  const given = args ?? {};

  for (const [key, v] of Object.entries(given)) {
    if (key === ROOT_PARAM || v === undefined || v === null) continue;
    if (def.positionals.includes(key)) continue;
    const opt = DENIED_FLAGS.has(key) ? undefined : findOption(cmd, key);
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
      opts.push(`--${key}=${PATH_FLAGS.has(key) ? mapPath(val) : val}`);
    }
  }

  for (const key of def.positionals) {
    const v = given[key];
    if (v === undefined || v === null) continue;
    positionals.push(...values(key, v));
  }

  return [...def.path, ...opts, ...(positionals.length > 0 ? ['--', ...positionals] : [])];
}
