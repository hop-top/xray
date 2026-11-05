// src/commands/describe.ts
//
// 12-Factor AI-CLI Apps spec, Factor 1 (Capability Introspection): CLIs
// MUST expose a machine-readable surface so callers (agents, pipelines,
// dashboards) can discover commands, options, side-effects, and exit
// codes without parsing `--help` text.
//
// `xray describe` walks the constructed commander tree and emits a JSON
// document with the active surface. Side-effect class and idempotency
// are declared in maps below — for any command not in the maps, the
// defaults err on the safe side (read / yes).

import { Command, Option } from 'commander';
import { Logger } from '../lib/logger';
import { UsageError } from '../lib/error/types';
import { TELEMETRY_POLICY } from '../lib/telemetry-policy';

const SCHEMA_URL = 'https://hop-top.dev/schemas/cli-capabilities/v1.json';
const SPEC = '12fc/v1';

type SideEffect = 'read' | 'write' | 'write-local' | 'destructive-local';

/** Tiers a command may declare with kit's `kit/side-effect` annotation. */
const DECLARABLE: ReadonlySet<string> = new Set<SideEffect>(['read', 'write', 'write-local', 'destructive-local']);
type Idempotent = 'yes' | 'conditional' | 'no';

// Per-command classification. Dot-separated for nested commands
// ('cache.clear'). Missing entries fall back to defaults below.
const SIDE_EFFECTS: Record<string, SideEffect> = {
  map: 'write-local',
  generate: 'write-local',
  scan: 'read',
  graph: 'write-local',
  query: 'read',
  impact: 'read',
  imports: 'read',
  explore: 'read',
  describe: 'read',
  paths: 'read',
  completion: 'read',
  strategy: 'read',
  'cache.clear': 'destructive-local',
  'clear-cache': 'destructive-local',
  'alias.set': 'write-local',
  'alias.remove': 'write-local',
  'alias.list': 'read',
};

const IDEMPOTENT: Record<string, Idempotent> = {
  map: 'conditional',
  generate: 'conditional',
  scan: 'yes',
  graph: 'conditional',
  query: 'yes',
  impact: 'yes',
  imports: 'yes',
  explore: 'yes',
  describe: 'yes',
  paths: 'yes',
  completion: 'yes',
  strategy: 'yes',
  'cache.clear': 'yes',
  'clear-cache': 'yes',
  'alias.set': 'conditional',
  'alias.remove': 'no',
  'strategy.remove': 'no',
  'lang.remove': 'yes',
  'alias.list': 'yes',
};

// Conservative exit-code listings — what the dispatcher / handler can
// demonstrably produce. Every command can hit 0 (success), 1 (generic),
// 2 (usage). Specific commands add 3/4/5 where applicable.
const EXTRA_EXIT_CODES: Record<string, number[]> = {
  'alias.remove': [3],
  'strategy.remove': [3],
  impact: [3],
  imports: [3],
  paths: [3],
  'alias.set': [5],
};

// Commands whose machine output is a versioned document: schema id (the
// payload's `schema` field) and the schema file shipped in the package.
const OUTPUT_SCHEMAS: Record<string, OutputSchemaDoc> = {
  imports: { schema: 'xray.imports/v1', path: 'schemas/xray.imports.v1.json', formats: ['json', 'yaml'] },
};

const EXIT_CODES: Record<string, string> = {
  '0': 'success',
  '1': 'generic failure',
  '2': 'usage error (bad flag, missing arg)',
  '3': 'not found (alias, config, strategy, path)',
  '4': 'unauthorized / permission denied',
  '5': 'conflict (resource collision)',
};

interface ArgumentDoc {
  name: string;
  required: boolean;
  variadic: boolean;
  description: string;
}

interface OptionDoc {
  name: string;
  short: string | null;
  type: 'boolean' | 'string' | 'number';
  required: boolean;
  default: unknown;
  description: string;
  choices?: string[];
}

interface OutputSchemaDoc {
  /** Schema id carried in the payload. */
  schema: string;
  /** JSON Schema file, relative to the package root. */
  path: string;
  /** `--format` values that emit the document. */
  formats: string[];
}

interface CommandDoc {
  name: string;
  qualifiedName: string;
  description: string;
  hidden: boolean;
  arguments: ArgumentDoc[];
  options: OptionDoc[];
  subcommands: CommandDoc[];
  sideEffect: SideEffect;
  idempotent: Idempotent;
  exitCodes: number[];
  output?: OutputSchemaDoc;
}

// Telemetry policy, so a consumer can verify a subprocess run records
// nothing: `defaultOff` lists the run kinds forced off whatever consent
// was saved; `env` / `flag` force it off on any run.
interface TelemetryDoc {
  defaultOff: string[];
  env: string[];
  flag: string;
}

interface DescribeDoc {
  $schema: string;
  tool: string;
  version: string;
  spec: string;
  exitCodes: Record<string, string>;
  telemetry: TelemetryDoc;
  commands: CommandDoc[];
}

interface DescribeOptions {
  format?: string;
}

function parseOption(opt: Option): OptionDoc {
  // Commander stores `flags` like '-l, --limit <number>' or '--graph <file>'
  // or '--list-strategies' (boolean). We reflect:
  //   - short = first '-x' token if present
  //   - name  = '--long' (always present for non-positional options)
  //   - type  = inferred from arg placeholder: `<number>` → number,
  //             `<...>` → string, none → boolean
  const argTok = opt.flags.match(/[<[][^>\]]+[>\]]/)?.[0] ?? '';
  let type: OptionDoc['type'] = 'boolean';
  if (argTok) {
    type = /number|int|count/i.test(argTok) ? 'number' : 'string';
  }
  return {
    name: opt.long ?? opt.flags,
    short: opt.short ?? null,
    type,
    required: Boolean((opt as any).mandatory),
    default: opt.defaultValue ?? null,
    description: opt.description ?? '',
    ...(Array.isArray(opt.argChoices) && opt.argChoices.length > 0
      ? { choices: opt.argChoices.slice() }
      : {}),
  };
}

function parseArguments(cmd: Command): ArgumentDoc[] {
  // Commander stores positionals under `registeredArguments` (newer) or
  // `_args` (older). Both expose `_name`, `required`, `variadic`,
  // `description`.
  const raw = (cmd as any).registeredArguments ?? (cmd as any)._args ?? [];
  return raw.map((a: any) => ({
    name: a._name ?? a.name ?? '',
    required: Boolean(a.required),
    variadic: Boolean(a.variadic),
    description: a.description ?? '',
  }));
}

function classify(qualifiedName: string, cmd?: Command): {
  sideEffect: SideEffect;
  idempotent: Idempotent;
  exitCodes: number[];
} {
  // A tier declared on the command (what kit's gates act on) wins over the table.
  const declared = (cmd as unknown as { annotations?: Record<string, string> } | undefined)
    ?.annotations?.['kit/side-effect'];
  const sideEffect: SideEffect =
    declared !== undefined && DECLARABLE.has(declared)
      ? (declared as SideEffect)
      : SIDE_EFFECTS[qualifiedName] ?? 'read';
  const idempotent =
    IDEMPOTENT[qualifiedName] ?? (sideEffect === 'read' ? 'yes' : 'conditional');
  const base = [0, 1, 2];
  const extras = EXTRA_EXIT_CODES[qualifiedName] ?? [];
  const exitCodes = Array.from(new Set([...base, ...extras])).sort((a, b) => a - b);
  return { sideEffect, idempotent, exitCodes };
}

function walk(cmd: Command, parentPath: string[] = []): CommandDoc {
  const name = cmd.name();
  const qualifiedName = [...parentPath, name].join('.');
  const cls = classify(qualifiedName, cmd);
  const output = Object.prototype.hasOwnProperty.call(OUTPUT_SCHEMAS, qualifiedName)
    ? OUTPUT_SCHEMAS[qualifiedName]
    : undefined;

  return {
    name,
    qualifiedName,
    description: cmd.description() || '',
    hidden: Boolean((cmd as any)._hidden),
    arguments: parseArguments(cmd),
    options: (cmd.options || []).map(parseOption),
    subcommands: (cmd.commands || []).map((sub) => walk(sub, [...parentPath, name])),
    sideEffect: cls.sideEffect,
    idempotent: cls.idempotent,
    exitCodes: cls.exitCodes,
    ...(output ? { output: { ...output, formats: [...output.formats] } } : {}),
  };
}

/**
 * Build the describe document from a constructed commander root.
 * Exported so tests can drive it with a synthetic program.
 */
export function buildDescribeDoc(
  root: Command,
  tool: string,
  version: string,
): DescribeDoc {
  return {
    $schema: SCHEMA_URL,
    tool,
    version,
    spec: SPEC,
    exitCodes: EXIT_CODES,
    telemetry: {
      defaultOff: [...TELEMETRY_POLICY.defaultOff],
      env: [...TELEMETRY_POLICY.env],
      flag: TELEMETRY_POLICY.flag,
    },
    commands: (root.commands || []).map((cmd) => walk(cmd)),
  };
}

export async function handleDescribeAction(options: DescribeOptions): Promise<void> {
  const fmt = options.format ?? 'json';
  if (fmt !== 'json') {
    throw new UsageError(`--format: unsupported value '${fmt}' (only 'json')`);
  }

  // Lazy require to avoid a circular import at module load (describe is
  // registered by registration/core, which is loaded by commands/index,
  // which is loaded by src/index — we need the *root* program here).
  // The constructed program lives on commands/index's module exports.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { program } = require('./index');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { version } = require('../../package.json');

  const doc = buildDescribeDoc(program, 'xray', version);
  Logger.output(JSON.stringify(doc, null, 2));
}
