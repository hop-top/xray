// src/commands/registration/core.ts
import { Command } from 'commander';
import { addCommonOptions } from '../common';
import { handleGenerateAction } from '../generate';
import { handleClearCacheAction } from '../clear-cache';
import { handleCompletionAction } from '../completion';
import { handleQueryAction } from '../query';
import { registerStrategyCommand } from '../strategy-cmd';
import { registerAliasCommand } from '../alias';
import { registerPathsCommand } from '../paths';

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

  // Generate command (kept for backwards compatibility)
  addCommonOptions(program.command('generate'))
    .description('Generate code analysis visualization [alias: map]')
    .action(handleGenerateAction);

  // Query command - call graph queries
  program
    .command('query')
    .description('Query call graph using function-based syntax')
    .argument('[query]', 'Query string (e.g., "calls(main)", "callers(processData)")')
    .option('--graph <file>', 'Path to saved graph JSON file')
    .option('--format <format>', 'Output format: json, table, tree (default: table)', 'table')
    .option('--list-adapters', 'List available query adapters')
    .action(handleQueryAction);

  // Strategy management command
  program.addCommand(registerStrategyCommand());

  // Alias management command
  program.addCommand(registerAliasCommand());

  // System commands
  program
    .command('clear-cache')
    .description('Clear SQLite cache (.xray_cache.db)')
    .action(handleClearCacheAction);

  // Introspect xray's own runtime paths (config + cache locations).
  // Note: distinct from the `config` strategy, which analyzes config files
  // in the user's project. See docs/dev/cli-config-noun-decision.md.
  registerPathsCommand(program);

  program
    .command('completion')
    .description('Generate shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action(handleCompletionAction);
}
