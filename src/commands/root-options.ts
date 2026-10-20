/**
 * Standard global flags for the xray root program.
 *
 * Declared once on the root `Command` so every subcommand inherits the
 * same surface. The preAction hook propagates root values onto the
 * active subcommand's opts so existing handlers that read
 * `options.config`, `options.telemetry`, etc. keep working without
 * walking the parent chain.
 *
 * Extracted from `index.ts` so the option wiring can be exercised in
 * isolation (no parser / native-module imports).
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import { Logger } from '../lib/logger';
import { UsageError } from '../lib/error/types';

// Root flag attribute keys forwarded onto the invoked subcommand's opts.
// `color` covers `--no-color` (commander stores the boolean under
// `color`). `telemetry` covers `--no-telemetry` the same way.
const ROOT_OPTION_KEYS = [
  'config',
  'telemetry',
  'quiet',
  'color',
  'chdir',
] as const;

const VERBOSITY_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

/**
 * Rewrite `-v` / `--verbose` so commander cannot mis-consume the next token.
 *
 * `-v, --verbose [level]` takes an OPTIONAL value, and commander binds the
 * next non-dash token to it. In `xray -v map .` that token is the subcommand
 * name, which becomes the "level" (silently falling back to info) while
 * routing falls through to the default command. A bare flag (next token not
 * a known level) is therefore pinned to `--verbose=debug`, which commander
 * accepts without looking ahead. Explicit levels (`-v debug`,
 * `--verbose=warn`) are left untouched. Stops at `--`. Pure: returns a copy.
 */
export function normalizeVerboseArgv(argv: string[]): string[] {
  const out = argv.slice(0, 2);
  const rest = argv.slice(2);
  const end = rest.indexOf('--');
  const head = end === -1 ? rest : rest.slice(0, end);
  const tail = end === -1 ? [] : rest.slice(end);
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a === '-v' || a === '--verbose') {
      const next = head[i + 1];
      if (next !== undefined && VERBOSITY_LEVELS.includes(next.toLowerCase())) {
        out.push('--verbose=' + next.toLowerCase());
        i++;
      } else {
        out.push('--verbose=debug');
      }
    } else {
      out.push(a);
    }
  }
  return out.concat(tail);
}

export function configureRootProgram(program: Command, version: string): Command {
  return program
    .name('xray')
    .description(
      'X-ray your codebase - Generate AST, CFG, and DFG visualizations'
    )
    .version(version)
    .option(
      '-v, --verbose [level]',
      'Set verbosity level: silent, error, warn, info (default), debug',
      'info'
    )
    .option(
      '--config <path>',
      'Path to config file (auto-detect if not specified)'
    )
    .option('--no-telemetry', 'Disable telemetry for this session')
    .option(
      '--quiet',
      'Suppress info and success output (errors still shown)'
    )
    .option('--no-color', 'Disable ANSI color output')
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

      // chalk auto-detects color support; --no-color forces it off.
      if (rootOpts.color === false) {
        chalk.level = 0;
      }

      // --quiet wins over --verbose for the user-visible streams.
      if (rootOpts.quiet) {
        Logger.setLevel('error');
      } else if (rootOpts.verbose) {
        // Bare `-v` yields `true`: treat as debug (verbose).
        Logger.setLevel(rootOpts.verbose === true ? 'debug' : rootOpts.verbose);
      }

      // Propagate root globals onto the subcommand's opts so handlers
      // that read `options.config` / `options.telemetry` keep working.
      const subOpts = actionCommand.opts();
      for (const key of ROOT_OPTION_KEYS) {
        if (
          subOpts[key] === undefined &&
          rootOpts[key] !== undefined
        ) {
          actionCommand.setOptionValueWithSource(
            key,
            rootOpts[key],
            'cli'
          );
        }
      }
    })
    .addHelpText(
      'after',
      `
Groups:
  ANALYZE:     map  scan  graph  query  explore
  STRATEGY:    strategy  build  cicd  config  container  express  infrastructure  markdown  package-manager  react  rest-api
  MANAGEMENT:  alias  cache  completion  describe  paths
`
    );
}
