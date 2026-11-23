/**
 * Root program for xray, built on the hop-top kit CLI contract.
 *
 * Kit (`createCLI`) owns: `-v/--version`, `-h/--help`, `--help-all`,
 * `--quiet`, `--no-color`, `--no-hints`, `--offline`, `-V/--verbose`
 * (stackable count), help layout + command groups. Kit's root
 * output-flag suite (`--format`, `-o`, ...) is disabled so leaf commands
 * keep their own `--format` / `-o`.
 *
 * xray adds: `-c/--config`, `--no-telemetry`, `-C/--chdir`. The
 * preAction hook applies them and propagates root values onto the
 * active subcommand's opts so handlers that read `options.config`,
 * `options.telemetry`, etc. keep working without walking the parent
 * chain.
 *
 * Verbosity precedence: `--quiet` (error) > `-V` count (0 = info, >=1 = debug).
 *
 * Kept free of parser / native-module imports so the wiring can be
 * exercised in isolation.
 */
import * as path from 'path';
import { Command, Option } from 'commander';
import { Logger } from '../lib/logger';
import { UsageError } from '../lib/error/types';
import { disableColor, setTheme } from '../lib/tui';
import { createCLI, HELP_GROUPS, type CLIResult } from './kit-cli';
import { declareEffect } from './side-effect';

// Root flag attribute keys forwarded onto the invoked subcommand's opts.
// `color` covers `--no-color`, `telemetry` covers `--no-telemetry`.
const ROOT_OPTION_KEYS = [
  'config',
  'telemetry',
  'quiet',
  'color',
  'chdir',
  'offline',
] as const;

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

const VALID_LOG_LEVELS = new Set(['silent', 'error', 'warn', 'info', 'debug']);

/**
 * Resolve the effective log level from parsed root opts (and `XRAY_LOG_LEVEL`),
 * or `undefined` when nothing was requested (keep the current level).
 */
export function resolveLogLevel(rootOpts: Record<string, unknown>): string | undefined {
  if (rootOpts.quiet) return 'error';
  const count = typeof rootOpts.verbose === 'number' ? rootOpts.verbose : 0;
  if (count > 0) return levelForVerboseCount(count);
  const envLevel = process.env.XRAY_LOG_LEVEL?.trim().toLowerCase();
  if (envLevel && VALID_LOG_LEVELS.has(envLevel)) return envLevel;
  return undefined;
}

/**
 * Root `--config` from argv (process.argv shape), as an absolute path,
 * for config loads that run before commander parses (alias
 * registration, telemetry consent). Relative values resolve against
 * `-C/--chdir` (itself relative to `cwd`), matching where the parsed
 * value resolves once the preAction hook has changed directory.
 */
export function rootConfigFromArgv(
  program: Command,
  argv: readonly string[],
  cwd: string = process.cwd()
): string | undefined {
  const scan = new Command()
    .allowUnknownOption()
    .allowExcessArguments()
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {}, outputError: () => {} });
  for (const o of program.options) scan.addOption(new Option(o.flags));
  try {
    scan.parseOptions(argv.slice(2));
  } catch {
    return undefined;
  }
  const { config, chdir } = scan.opts<{ config?: string; chdir?: string }>();
  if (typeof config !== 'string' || config === '') return undefined;
  const base = typeof chdir === 'string' && chdir !== '' ? path.resolve(cwd, chdir) : cwd;
  return path.resolve(base, config);
}

/** What commander makes of argv before any command is chosen. */
interface ArgvScan {
  /** Operands after the root options (command word, then its arguments). */
  operands: string[];
  /** Tokens from the first option root does not own, in argv order. */
  unknown: string[];
  /** `-C/--chdir` as given, if any. */
  chdir?: string;
}

/** Classify argv with `program`'s root options plus those of `extra`. */
function scanArgv(program: Command, argv: readonly string[], extra?: Command): ArgvScan {
  const scan = new Command()
    .allowUnknownOption()
    .allowExcessArguments()
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {}, outputError: () => {} });
  for (const o of program.options) scan.addOption(new Option(o.flags));
  for (const o of extra?.options ?? []) scan.addOption(new Option(o.flags));
  try {
    const { operands, unknown } = scan.parseOptions(argv.slice(2));
    const chdir = scan.opts<{ chdir?: unknown }>().chdir;
    return { operands, unknown, chdir: typeof chdir === 'string' && chdir !== '' ? chdir : undefined };
  } catch {
    return { operands: [], unknown: [] };
  }
}

/**
 * What argv asks for, once root options are set aside.
 */
export interface DefaultRoute {
  /** The would-be command word or query; undefined for bare `xray`. */
  word?: string;
  /** Operands after `word`. */
  rest: string[];
  /** Option before `word` that the root does not own, if any. */
  stray?: string;
  /** Directory relative paths resolve against (`-C` applied). */
  base: string;
}

export function defaultRouteFromArgv(
  program: Command,
  argv: readonly string[],
  cwd: string = process.cwd()
): DefaultRoute {
  const root = scanArgv(program, argv);
  const base = root.chdir ? path.resolve(cwd, root.chdir) : cwd;
  if (root.operands.length > 0) {
    const [word, ...rest] = root.operands;
    return { word, rest, base };
  }
  const first = root.unknown[0];
  if (first === undefined || !first.startsWith('-')) return { rest: [], base };
  const explore = program.commands.find((c) => c.name() === 'explore');
  const [word, ...rest] = scanArgv(program, argv, explore).operands;
  return { word, rest, stray: first.split('=')[0], base };
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
  // Kit's own `help <command>`: prints, changes nothing.
  for (const c of result.program.commands) if (c.name() === 'help') declareEffect(c, 'read', 'yes');
  // Keep per-group `--help-<id>` flags working without cluttering root FLAGS:.
  // `--help-all` stays visible and documents the hidden groups.
  for (const opt of result.program.options as Option[]) {
    if (opt.long === '--help-all') {
      opt.description = 'Show all commands including hidden groups (STRATEGY, MANAGEMENT)';
    } else if (opt.long && opt.long.startsWith('--help-')) {
      opt.hideHelp();
    }
  }
  respectTerminalColor(result.program);
  configureRootProgram(result.program);
  return result;
}

/**
 * Kit styles help whenever NO_COLOR / --no-color are absent, even when
 * the stream is not a terminal. Gate it on commander's own color
 * detection (TTY, NO_COLOR, FORCE_COLOR) so piped output stays plain.
 * Usage errors bypass kit's error styling and go through the logger.
 */
function respectTerminalColor(program: Command): void {
  const defaults = new Command().configureOutput();
  const flagOff = () => process.argv.includes('--no-color');
  const outColors = () => !flagOff() && Boolean(defaults.getOutHasColors?.());
  const errColors = () => !flagOff() && Boolean(defaults.getErrHasColors?.());
  program.configureOutput({
    getOutHasColors: outColors,
    getErrHasColors: errColors,
    outputError: (str) => {
      Logger.error(str.replace(/^error: /, '').trimEnd());
    },
  });
}

export function configureRootProgram(program: Command): Command {
  return program
    .option(
      '-c, --config <path>',
      'Path to config file (auto-detect if not specified)'
    )
    .option('--no-telemetry', 'Disable telemetry for this session')
    .option(
      '-C, --chdir <path>',
      'Change to <path> before running the command'
    )
    .hook('preAction', (thisCommand, actionCommand) => {
      const rootOpts = thisCommand.opts();

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

      const colorOff = colorDisabledByFlag(thisCommand);
      if (colorOff) disableColor();

      const level = resolveLogLevel(rootOpts);
      if (level !== undefined) Logger.setLevel(level);

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
