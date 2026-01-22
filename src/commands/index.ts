import { Command } from 'commander';
import { addCommonOptions } from './common';
import { handleGenerateAction } from './generate';
import { handleStrategyCommand, handleMetaStrategyCommand } from './strategy';
import { handleExploreAction } from './explore';
import { registerStrategyCommand } from './strategy-cmd';
import { handleClearCacheAction } from './clear-cache';
import { handleCompletionAction } from './completion';
import * as path from 'path';
import * as fs from 'fs';

const program = new Command();

program
  .name('xray')
  .description('X-ray your codebase - Generate AST, CFG, and DFG visualizations')
  .version('0.0.1-alpha.1');

// Register all commands
addCommonOptions(program.command('map'))
  .description('Generate visual map of codebase')
  .action(handleGenerateAction);

// Scan command - file system discovery
addCommonOptions(program.command('scan'))
  .description('Scan and discover files in codebase')
  .action(handleGenerateAction);

// Graph command - generate graph structures (CFG/DFG)
addCommonOptions(program.command('graph'))
  .description('Generate control flow (CFG) and data flow (DFG) graphs')
  .action(handleGenerateAction);

// Generate command (kept for backwards compatibility)
addCommonOptions(program.command('generate'))
  .description('Generate code analysis visualization [alias: map]')
  .action(handleGenerateAction);

// Clear cache command
program
  .command('clear-cache')
  .description('Clear SQLite cache (.xray_cache.db)')
  .action(handleClearCacheAction);

// Explore command (default command)
program
  .command('explore', { isDefault: true })
  .description('Quickly find files by patterns, search code for keywords, or explore codebase [default command]')
  .argument('[query]', 'Strategy command query (e.g., react:components, react:hooks)')
  .option('-p, --path <path>', 'Root directory to explore (repeatable) [default: current directory]', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('-m, --match <pattern>', 'Find files matching pattern (e.g., "*.ts", "**/*test*") (repeatable)', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('-s, --search <keyword>', 'Search for keyword in code (repeatable)', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('-t, --type <ext>', 'Filter by file extension (e.g., ts, js, py) (repeatable)', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('--list-strategies', 'List all available strategies')
  .action(async (query: string | undefined, options: any) => {
    // Handle strategy:command queries (e.g., react:components)
    if (query && query.includes(':')) {
      await handleStrategyCommand(query, options);
      return;
    }

    // List available strategies
    if (options.listStrategies) {
      await handleMetaStrategyCommand('list', options);
      return;
    }

    // Handle regular explore options
    await handleExploreAction(query, options);
  });

// Completion command
program
  .command('completion')
  .description('Generate shell completion script')
  .argument('<shell>', 'Shell type: bash, zsh, or fish')
  .action(handleCompletionAction);

// Strategy management command
program.addCommand(registerStrategyCommand());

export function registerCommands() {
  // For consistency with expected interface
  return program;
}

// Export the program for testing
export { program };