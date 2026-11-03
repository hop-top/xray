/**
 * When telemetry is forced off, whatever consent was saved.
 *
 * One decision point: the consent flow (`handleFirstRunConsent`) and the
 * telemetry plugin (every recorder: CLI tracker, `Xray` auto-register,
 * library use) both ask `telemetryOffReason()`. A run that is not a
 * person at a terminal (subprocess, pipe, CI, MCP server, machine-format
 * output) never records, so a tool driving xray cannot leak repository
 * details through it. Interactive TTY runs keep the saved consent.
 *
 * Kept free of config / tui imports: the plugin loads it.
 */
import { parseMcpRequest } from '../commands/mcp';
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
  if (selectsMachineFormat(argv)) return 'machine-format';
  if (!stdoutIsTTY) return 'non-tty';
  return null;
}
