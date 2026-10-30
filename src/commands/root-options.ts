/**
 * Root program for xray, built on the hop-top kit CLI contract.
 *
 * Kit (`createCLI`) owns: `-v/--version`, `-h/--help`, `--quiet`,
 * `--no-color`, `--no-hints`, `--offline`, `-V/--verbose` (stackable
 * count), help layout + ANALYZE/STRATEGY/MANAGEMENT groups. Kit's root
 * output-flag suite (`--format`, `-o`, ...) is disabled so leaf commands
 * keep their own `--format` / `-o`.
 *
 * xray adds: `--log-level <level>`, `--config`, `--no-telemetry`,
 * `-C/--chdir`. The preAction hook applies them and propagates root
 * values onto the active subcommand's opts so handlers that read
 * `options.config`, `options.telemetry`, etc. keep working without
 * walking the parent chain.
 *
 * Verbosity precedence: `--quiet` (error) > `--log-level <level>` >
 * `-V` count (0 = info, >=1 = debug).
 *
 * Kept free of parser / native-module imports so the wiring can be
 * exercised in isolation.
 */
import * as path from 'path';
import { Command } from 'commander';
import { Logger } from '../lib/logger';
import { UsageError } from '../lib/error/types';
import { disableColor, setTheme } from '../lib/tui';
import { createCLI, HELP_GROUPS, type CLIResult } from './kit-cli';

// Root flag attribute keys forwarded onto the invoked subcommand's opts.
// `color` covers `--no-color`, `telemetry` covers `--no-telemetry`.
const ROOT_OPTION_KEYS = [
  'config',
  'telemetry',
  'quiet',
  'color',
  'chdir',
] as const;

export const VERBOSITY_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

/** Map a `-V` count onto xray's level ladder (0 = info, >=1 = debug). */
export function levelForVerboseCount(count: number): string {
  return count > 0 ? 'debug' : 'info';
}

/**
 * Whether `--no-color` was passed on the command line.
 *
 * Kit registers `--no-color` with an explicit `false` default, so
 * `opts().color` is `false` even when the flag is absent. The option
 * value source distinguishes an explicit flag from that default.
 */
export function colorDisabledByFlag(program: Command): boolean {
  return program.getOptionValueSource('color') === 'cli';
}

/**
 * Resolve the effective log level from parsed root opts, or `undefined`
 * when nothing was requested (keep the current level).
 */
export function resolveLogLevel(rootOpts: Record<string, unknown>): string | undefined {
  if (rootOpts.quiet) return 'error';
  const explicit = rootOpts.logLevel;
  if (typeof explicit === 'string' && explicit.length > 0) {
    const lvl = explicit.toLowerCase();
    if (!(VERBOSITY_LEVELS as readonly string[]).includes(lvl)) {
      throw new UsageError(
        `invalid --log-level '${explicit}' (expected one of: ${VERBOSITY_LEVELS.join(', ')})`
      );
    }
    return lvl;
  }
  const count = typeof rootOpts.verbose === 'number' ? rootOpts.verbose : 0;
  return count > 0 ? levelForVerboseCount(count) : undefined;
}

/**
 * Root `--config` from argv (process.argv shape), as an absolute path,
 * for config loads that run before commander parses (alias
 * registration, telemetry consent). Relative values resolve against
 * `-C/--chdir` (itself relative to `cwd`), matching where the parsed
 * value resolves once the preAction hook has changed directory. Last
 * occurrence wins; scanning stops at `--`.
 */
export function rootConfigFromArgv(argv: readonly string[], cwd: string = process.cwd()): string | undefined {
  let config: string | undefined;
  let chdir: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a.startsWith('--config=')) config = a.slice('--config='.length);
    else if (a === '--config' && i + 1 < argv.length) config = argv[++i];
    else if (a.startsWith('--chdir=')) chdir = a.slice('--chdir='.length);
    else if ((a === '-C' || a === '--chdir') && i + 1 < argv.length) chdir = argv[++i];
  }
  if (config === undefined || config === '') return undefined;
  const base = chdir ? path.resolve(cwd, chdir) : cwd;
  return path.resolve(base, config);
}

/**
 * Build the kit root program and attach xray's root flags + hooks.
 */
export function createRootProgram(version: string): CLIResult {
  const result = createCLI({
    name: 'xray',
    version,
    description: 'X-ray your codebase - Generate AST, CFG, and DFG visualizations',
    disable: { format: true },
    groups: HELP_GROUPS.map((g) => ({ ...g })),
  });
  setTheme(result.theme);
  respectTerminalColor(result.program);
  configureRootProgram(result.program);
  return result;
}

/**
 * Kit styles help and errors whenever NO_COLOR / --no-color are absent,
 * even when the stream is not a terminal. Gate both on commander's own
 * color detection (TTY, NO_COLOR, FORCE_COLOR) so piped output stays plain.
 */
function respectTerminalColor(program: Command): void {
  const defaults = new Command().configureOutput();
  const current = program.configureOutput();
  const flagOff = () => process.argv.includes('--no-color');
  const outColors = () => !flagOff() && Boolean(defaults.getOutHasColors?.());
  const errColors = () => !flagOff() && Boolean(defaults.getErrHasColors?.());
  const strip = (str: string) => (defaults.stripColor ? defaults.stripColor(str) : str);
  const kitOutputError = current.outputError;
  program.configureOutput({
    getOutHasColors: outColors,
    getErrHasColors: errColors,
    outputError: (str, write) => {
      const sink = (s: string) => write(errColors() ? s : strip(s));
      if (kitOutputError) kitOutputError(str, sink);
      else sink(str);
    },
  });
}

export function configureRootProgram(program: Command): Command {
  return program
    .option(
      '--log-level <level>',
      `Set log level: ${VERBOSITY_LEVELS.join(', ')} (default: info; overrides -V)`
    )
    .option(
      '--config <path>',
      'Path to config file (auto-detect if not specified)'
    )
    .option('--no-telemetry', 'Disable telemetry for this session')
    .option(
      '-C, --chdir <path>',
      'Change to <path> before running the command'
    )
    .hook('preAction', (thisCommand, actionCommand) => {
      const rootOpts = thisCommand.opts();

      // Apply --chdir before any handler runs so all relative paths
      // resolve against the requested working directory. Known limitation:
      // the preAction hook fires *after* commander parses argv, so any
      // pre-parse work (telemetry consent + config auto-detect in
      // src/index.ts) sees the launch CWD, not --chdir's target. That's
      // acceptable for observational/best-effort lookups — a fix would
      // need a top-level argv scan before constructing the program.
      if (
        typeof rootOpts.chdir === 'string' &&
        rootOpts.chdir.length > 0
      ) {
        try {
          process.chdir(rootOpts.chdir);
        } catch (err: any) {
          throw new UsageError(`--chdir: ${err.message}`);
        }
      }

      // TUI styling auto-detects (NO_COLOR, TTY); --no-color forces it off.
      const colorOff = colorDisabledByFlag(thisCommand);
      if (colorOff) disableColor();

      const level = resolveLogLevel(rootOpts);
      if (level !== undefined) Logger.setLevel(level);

      // Propagate root globals onto the subcommand's opts so handlers
      // that read `options.config` / `options.telemetry` keep working.
      const effective: Record<string, unknown> = { ...rootOpts, color: !colorOff };
      const subOpts = actionCommand.opts();
      for (const key of ROOT_OPTION_KEYS) {
        if (
          subOpts[key] === undefined &&
          effective[key] !== undefined
        ) {
          actionCommand.setOptionValueWithSource(
            key,
            effective[key],
            'cli'
          );
        }
      }
    });
}
