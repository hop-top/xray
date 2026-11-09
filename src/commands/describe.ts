// src/commands/describe.ts
//
// 12-Factor AI-CLI Apps spec, Factor 1 (Capability Introspection): CLIs
// MUST expose a machine-readable surface so callers (agents, pipelines,
// dashboards) can discover commands, options, side-effects, and exit
// codes without parsing `--help` text.
//
// `xray describe` walks the constructed commander tree and emits a JSON
// document with the active surface. Side-effect class and idempotency
// are the annotations each leaf declares to kit (see side-effect.ts).

import { Command, Option } from 'commander';
import { Logger } from '../lib/logger';
import {
  EXIT_CONFLICT,
  EXIT_CONSENT_REFUSED,
  EXIT_GENERIC,
  EXIT_NOT_FOUND,
  EXIT_SUCCESS,
  EXIT_TRANSIENT,
  EXIT_UNAUTHORIZED,
  EXIT_USAGE,
  UsageError,
} from '../lib/error/types';
import { JSON_DEFAULT_COMMANDS } from '../lib/error/report';
import { TELEMETRY_POLICY } from '../lib/telemetry-policy';
import { declaredEffect, declaredExitCodes, omittedFromDescribe } from './side-effect';

const SCHEMA_URL = 'https://hop-top.dev/schemas/cli-capabilities/v1.json';
const SPEC = '12fc/v1';

type SideEffect = 'read' | 'write' | 'write-local' | 'write-shared' | 'destructive' | 'destructive-local' | 'destructive-shared' | 'interactive';
type Idempotent = 'yes' | 'conditional' | 'no';

const TIERS: ReadonlySet<string> = new Set<SideEffect>([
  'read', 'write', 'write-local', 'write-shared',
  'destructive', 'destructive-local', 'destructive-shared', 'interactive',
]);
const IDEMPOTENCY: ReadonlySet<string> = new Set<Idempotent>(['yes', 'conditional', 'no']);

// Conservative exit-code listings: what the dispatcher / handler can
// demonstrably produce. Every command can hit 0 (success), 1 (generic),
// 2 (usage). Specific commands add 3 (not found) / 4 (conflict) where a
// handler throws them; a real-exit test pins each entry.
const EXTRA_EXIT_CODES: Record<string, number[]> = {
  'alias.remove': [EXIT_NOT_FOUND],
  // Destructive: refused (unauthorized) unless the caller confirms.
  'strategy.remove': [EXIT_NOT_FOUND, EXIT_UNAUTHORIZED],
  'cache.clear': [EXIT_UNAUTHORIZED],
  'clear-cache': [EXIT_UNAUTHORIZED],
  'strategy.detect': [EXIT_NOT_FOUND],
  'strategy.info': [EXIT_NOT_FOUND],
  'strategy.validate': [EXIT_NOT_FOUND],
  'strategy.install': [EXIT_NOT_FOUND],
  'strategy.create': [EXIT_CONFLICT],
  'build.run': [EXIT_NOT_FOUND],
  // Runs the repo's recipe: refused (unauthorized) unless confirmed; unknown target / missing tool: not found.
  'build.exec': [EXIT_NOT_FOUND, EXIT_UNAUTHORIZED],
  // A root that does not exist (positional or --path) is not found.
  map: [EXIT_NOT_FOUND],
  graph: [EXIT_NOT_FOUND],
  // --graph names a file that does not exist.
  query: [EXIT_NOT_FOUND],
  impact: [EXIT_NOT_FOUND],
  imports: [EXIT_NOT_FOUND],
  'alias.set': [EXIT_CONFLICT],
  explore: [EXIT_NOT_FOUND],
  // --check: the release lookup failed.
  upgrade: [EXIT_TRANSIENT],
};

// Commands whose machine output is a versioned document: schema id (the
// payload's `schema` field) and the schema file shipped in the package.
const OUTPUT_SCHEMAS: Record<string, OutputSchemaDoc> = {
  imports: { schema: 'xray.imports/v1', path: 'schemas/xray.imports.v1.json', formats: ['json', 'yaml'] },
};

// Numbers are kit's taxonomy (12-Factor AI-CLI Apps, Factor 11).
const EXIT_CODES: Record<string, string> = {
  [EXIT_SUCCESS]: 'success',
  [EXIT_GENERIC]: 'generic failure',
  [EXIT_USAGE]: 'usage error (bad flag, missing arg)',
  [EXIT_NOT_FOUND]: 'not found (alias, config, strategy, path)',
  [EXIT_CONFLICT]: 'conflict (resource collision, already exists)',
  [EXIT_UNAUTHORIZED]: 'unauthorized / permission denied, or a destructive command refused without --confirm=yes',
  [EXIT_TRANSIENT]: 'transient failure (a retry may clear it)',
  [EXIT_CONSENT_REFUSED]: 'consent refused',
};

// Machine-readable failures: when the caller asked for JSON, a failing
// command writes one `@hop-top/kit` error envelope (output/error) to stderr
// and leaves stdout empty; the exit code is unchanged.
const ERRORS: ErrorsDoc = {
  format: 'json',
  stream: 'stderr',
  enabledBy: ['--format json', '--format=json', '--json'],
  defaultFor: [...JSON_DEFAULT_COMMANDS],
  required: ['code', 'message', 'exit_code', 'transience'],
  optional: ['cause', 'suggested_fix', 'alternatives'],
  transience: ['transient', 'permanent', 'unknown'],
  codes: {
    GENERIC: EXIT_GENERIC,
    USAGE: EXIT_USAGE,
    NOT_FOUND: EXIT_NOT_FOUND,
    CONFLICT: EXIT_CONFLICT,
    UNAUTHORIZED: EXIT_UNAUTHORIZED,
    TRANSIENT: EXIT_TRANSIENT,
    CONSENT_REFUSED: EXIT_CONSENT_REFUSED,
  },
};

interface ErrorsDoc {
  /** Wire format of the error object. */
  format: 'json';
  /** Stream it is written to; stdout stays empty. */
  stream: 'stderr';
  /** Argv forms that select it. */
  enabledBy: string[];
  /** Commands whose errors are JSON without a flag (their output defaults to JSON); an explicit other `--format` keeps text. */
  defaultFor: string[];
  /** Fields present in every error object. */
  required: string[];
  /** Fields present when the failure has them. */
  optional: string[];
  /** Values of `transience`. */
  transience: string[];
  /** `code` values and the exit code each comes with. */
  codes: Record<string, number>;
}

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
  errors: ErrorsDoc;
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

/**
 * Tier and idempotency come from the annotations every runnable leaf
 * declares (kit's `kit/side-effect` and `kit/idempotent`), the same ones
 * kit's gates act on. A command that only groups subcommands runs nothing
 * and reports read / yes. An undeclared leaf is a defect: describe fails
 * rather than guess a tier.
 */
function classify(qualifiedName: string, cmd: Command): {
  sideEffect: SideEffect;
  idempotent: Idempotent;
  exitCodes: number[];
} {
  let sideEffect: SideEffect = 'read';
  let idempotent: Idempotent = 'yes';
  if (cmd.commands.length === 0) {
    const declared = declaredEffect(cmd);
    if (declared.tier === undefined || !TIERS.has(declared.tier)) {
      throw new Error(`command "${qualifiedName.replace(/\./g, ' ')}" declares no valid kit/side-effect tier`);
    }
    if (declared.idempotent === undefined || !IDEMPOTENCY.has(declared.idempotent)) {
      throw new Error(`command "${qualifiedName.replace(/\./g, ' ')}" declares no valid kit/idempotent class`);
    }
    sideEffect = declared.tier as SideEffect;
    idempotent = declared.idempotent as Idempotent;
  }
  const base = [EXIT_SUCCESS, EXIT_GENERIC, EXIT_USAGE];
  const extras = [...(EXTRA_EXIT_CODES[qualifiedName] ?? []), ...declaredExitCodes(cmd)];
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
    subcommands: (cmd.commands || []).filter((sub) => !omittedFromDescribe(sub)).map((sub) => walk(sub, [...parentPath, name])),
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
    errors: ERRORS,
    telemetry: {
      defaultOff: [...TELEMETRY_POLICY.defaultOff],
      env: [...TELEMETRY_POLICY.env],
      flag: TELEMETRY_POLICY.flag,
    },
    commands: (root.commands || []).filter((cmd) => !omittedFromDescribe(cmd)).map((cmd) => walk(cmd)),
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
