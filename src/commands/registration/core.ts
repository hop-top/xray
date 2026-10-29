// src/commands/registration/core.ts
import { Command } from 'commander';
import { addCommonOptions } from '../common';
import { handleGenerateAction } from '../generate';
import { handleClearCacheAction } from '../clear-cache';
import { bindFlag, registerCompletionCommand, staticValues } from '../completion';
import { addQueryOutputFlags, runQueryCommand } from '../query';
import { handleDescribeAction } from '../describe';
import { registerStrategyCommand } from '../strategy-cmd';
import { registerAliasCommand } from '../alias';
import { registerPathsCommand } from '../paths';
import { registerLangCommand } from '../lang';
import { setCommandGroup, type HelpGroupId } from '../kit-cli';

// Root help group per top-level command name; unlisted/hidden commands
// fall into kit's default section.
const CORE_GROUPS: Record<string, HelpGroupId> = {
  map: 'analyze',
  scan: 'analyze',
  graph: 'analyze',
  query: 'analyze',
  strategy: 'strategy',
  alias: 'management',
  lang: 'management',
  cache: 'management',
  paths: 'management',
  describe: 'management',
  completion: 'management',
};

/**
 * Register all static core commands
 * These are built-in commands that don't depend on strategy discovery
 */
export function registerCoreCommands(program: Command): void {
  // Analysis commands
  addCommonOptions(program.command('map'))
    .description('Generate visual map of codebase')
    .action(handleGenerateAction);

  addCommonOptions(program.command('scan'))
    .description('Scan and discover files in codebase')
    .action(handleGenerateAction);

  addCommonOptions(program.command('graph'))
    .description('Generate control flow (CFG) and data flow (DFG) graphs')
    .action(handleGenerateAction);

  // Generate command (kept for backwards compatibility; hidden alias of `map`)
  addCommonOptions(program.command('generate', { hidden: true }))
    .description('Generate code analysis visualization [alias: map]')
    .action(handleGenerateAction);

  // Query command - call graph queries
  addQueryOutputFlags(
    program
      .command('query')
      .description('Query call graph using function-based syntax')
      .argument('[query]', 'Query string (e.g., "calls(main)", "callers(processData)")')
      .option('--graph <file>', 'Path to saved graph JSON file')
  )
    .option('--list-adapters', 'List available query adapters')
    .action(runQueryCommand);

  // Strategy management command
  program.addCommand(registerStrategyCommand());

  // Alias management command
  program.addCommand(registerAliasCommand());

  // Language pack management command
  program.addCommand(registerLangCommand());

  // System commands
  // `cache` noun-verb group (canonical form)
  const cache = new Command('cache').description('Cache management');
  cache
    .command('clear')
    .description('Clear SQLite cache (.xray_cache.db)')
    .action(handleClearCacheAction);
  program.addCommand(cache);

  // Hidden alias of `cache clear` for backwards compatibility
  program
    .command('clear-cache', { hidden: true })
    .description('[deprecated alias of `cache clear`] Clear SQLite cache (.xray_cache.db)')
    .action(handleClearCacheAction);

  // Introspect xray's own runtime paths (config + cache locations).
  // Note: distinct from the `config` strategy, which analyzes config files
  // in the user's project. See docs/dev/cli-config-noun-decision.md.
  registerPathsCommand(program);

  // Machine-readable capability surface (12fc Factor 1).
  // Walks the constructed commander tree and emits a JSON document
  // documenting every command's args, options, side-effect class,
  // idempotency, and exit codes.
  const describe = program
    .command('describe')
    .description('Emit machine-readable capability surface (12fc Factor 1)')
    .option('--format <fmt>', 'Output format (json)', 'json')
    .action(handleDescribeAction);
  bindFlag(describe, 'format', staticValues('json'));

  // `completion bash|zsh|fish|powershell` (kit, cobra protocol).
  registerCompletionCommand(program);

  for (const cmd of program.commands) {
    const group = CORE_GROUPS[cmd.name()];
    if (group) setCommandGroup(cmd, group);
  }
}
