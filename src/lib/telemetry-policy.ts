/**
 * When telemetry is forced off, whatever consent was saved.
 *
 * One decision point: the consent flow (`handleFirstRunConsent`) and the
 * telemetry plugin (every recorder: CLI tracker, `Xray` auto-register,
 * library use) both ask `telemetryOffReason()`. A run that is not a
 * person at a terminal (subprocess, pipe, CI, MCP server, machine-format
 * output, including commands whose default output is machine-readable)
 * never records, so a tool driving xray cannot leak repository
 * details through it. Interactive TTY runs keep the saved consent.
 *
 * Kept free of config / tui imports: the plugin loads it.
 */
import { parseMcpRequest, ROOT_VALUE_FLAGS } from '../commands/mcp';
import { isMachineFormat } from './output-format';

export type TelemetryOffReason =
  | 'flag'
  | 'env'
  | 'mcp'
  | 'ci'
  | 'machine-format'
  | 'non-tty';

/** Machine-readable policy, published by `xray describe`. */
export const TELEMETRY_POLICY = {
  flag: '--no-telemetry',
  env: ['XRAY_NO_TELEMETRY', 'DO_NOT_TRACK'],
  defaultOff: ['non-tty', 'machine-format', 'ci', 'mcp'],
} as const;

export const CI_ENV_VARS = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'JENKINS_URL',
  'BUILDKITE',
  'TEAMCITY_VERSION',
] as const;

/** Legacy per-format flags that select a machine format. */
const MACHINE_FORMAT_ALIASES = new Set(['--json', '--csv', '--xml']);

/** Set, non-empty, and not `0` / `false`. */
function envOn(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

/**
 * `--format <machine>` / `--format=<machine>` or a machine alias anywhere
 * before `--`, on any command. Read from argv because telemetry starts
 * before commander parses.
 */
export function selectsMachineFormat(argv: readonly string[]): boolean {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return false;
    if (MACHINE_FORMAT_ALIASES.has(a)) return true;
    if (a.startsWith('--format=') && isMachineFormat(a.slice('--format='.length))) return true;
    if (a === '--format' && isMachineFormat(argv[i + 1])) return true;
  }
  return false;
}

/**
 * Commands whose `--format` defaults to a machine format (json): a plain
 * `xray imports` is a machine run unless a human format is asked for.
 * Kept as a list (the policy loads before, and without, the command
 * modules); a test checks it against the registered commands' defaults.
 */
export const MACHINE_DEFAULT_COMMANDS: readonly string[] = ['describe', 'imports'];

/** Explicit `--format` values that make a machine-default command a human run. */
const HUMAN_FORMATS = new Set(['text', 'table', 'txt']);

/** The command named on the command line: first token not a root flag (or its value), before `--`. */
function invokedCommand(argv: readonly string[]): string | undefined {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return undefined;
    if (ROOT_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    return a;
  }
  return undefined;
}

/** Explicit `--format <v>` / `--format=<v>` value before `--` (last wins), lowercased. */
function explicitFormat(argv: readonly string[]): string | undefined {
  let format: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a.startsWith('--format=')) format = a.slice('--format='.length);
    else if (a === '--format' && i + 1 < argv.length) format = argv[++i];
  }
  return format?.toLowerCase();
}

/** A machine-default command without an explicit human `--format`. */
export function machineByDefault(argv: readonly string[]): boolean {
  const cmd = invokedCommand(argv);
  if (cmd === undefined || !MACHINE_DEFAULT_COMMANDS.includes(cmd)) return false;
  const format = explicitFormat(argv);
  return format === undefined || !HUMAN_FORMATS.has(format);
}

export interface TelemetryRuntime {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdoutIsTTY?: boolean;
}

/** Why telemetry is forced off for this run, or null when consent decides. */
export function telemetryOffReason(rt: TelemetryRuntime = {}): TelemetryOffReason | null {
  const argv = rt.argv ?? process.argv;
  const env = rt.env ?? process.env;
  const stdoutIsTTY = rt.stdoutIsTTY ?? Boolean(process.stdout.isTTY);

  if (argv.includes(TELEMETRY_POLICY.flag)) return 'flag';
  if (TELEMETRY_POLICY.env.some(k => envOn(env[k]))) return 'env';
  if (parseMcpRequest(argv)) return 'mcp';
  if (CI_ENV_VARS.some(k => env[k])) return 'ci';
  if (selectsMachineFormat(argv) || machineByDefault(argv)) return 'machine-format';
  if (!stdoutIsTTY) return 'non-tty';
  return null;
}
