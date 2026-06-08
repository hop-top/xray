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
      // resolve against the requested working directory.
      if (
        typeof rootOpts.chdir === 'string' &&
        rootOpts.chdir.length > 0
      ) {
        process.chdir(rootOpts.chdir);
      }

      // chalk auto-detects color support; --no-color forces it off.
      if (rootOpts.color === false) {
        chalk.level = 0;
      }

      // --quiet wins over --verbose for the user-visible streams.
      if (rootOpts.quiet) {
        Logger.setLevel('error');
      } else if (rootOpts.verbose) {
        Logger.setLevel(rootOpts.verbose);
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
    });
}
