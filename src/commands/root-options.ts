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
import { Command, Option } from 'commander';
import { Logger } from '../lib/logger';
import { UsageError } from '../lib/error/types';
import { disableColor, setTheme } from '../lib/tui';
import { createCLI, HELP_GROUPS, type CLIResult } from './kit-cli';
import { declareEffect } from './side-effect';
import { registerHelpAll } from './help-all';

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
 * value resolves once the preAction hook has changed directory.
 *
 * Tokens are classified by commander itself, using the root program's
 * own option definitions, so the early read cannot disagree with the
 * real parse: a value-taking option (`--log-level`, `--config`, `-C`)
 * consumes the next token whatever it looks like, `--` ends parsing,
 * and unknown options are skipped. Argv commander would reject (a
 * missing option value) yields undefined; the real parse reports it.
 */
export function rootConfigFromArgv(
  program: Command,
  argv: readonly string[],
  cwd: string = process.cwd()
): string | undefined {
  // Fresh Options carry flags only: kit's version/help listeners (which
  // exit the process) and the preAction hook stay on the real program.
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
 *
 * Commander hands everything from the first option the root does not own
 * to the default command, so `xray --format json alias list` reaches
 * explore with `alias list` as its query instead of running `alias`. When
 * that happens `stray` is the offending option (without any `=value`) and
 * `word` / `rest` are what explore's own options leave over.
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
  respectTerminalColor(result.program);
  configureRootProgram(result.program);
  registerHelpAll(result.program, version);
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
  // Commander-raised usage errors (bad flag, missing argument, unknown
  // help topic) render through the same `✖ <message>` path as UsageError.
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
