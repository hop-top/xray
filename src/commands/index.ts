import { Command } from 'commander';
import { handleMetaStrategyCommand } from './strategy';
import { handleExploreAction } from './explore';
import { Logger } from '../lib/logger';
import { registerCoreCommands } from './registration/core';
import { registerStrategyCommands } from './registration/strategies';
import { registerAliases } from './registration/aliases';
import { ExploreCommandOptions } from '../types/command-options';

const program = new Command();

program
  .name('xray')
  .description('X-ray your codebase - Generate AST, CFG, and DFG visualizations')
  .version('0.0.1-alpha.1')
  .option('-v, --verbose [level]', 'Set verbosity level: silent, error, warn, info (default), debug', 'info')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if (options.verbose) {
      Logger.setLevel(options.verbose);
    }
  });

/**
 * Register all commands (static core + dynamic strategies + aliases)
 */
export async function registerCommands() {
  // 1. Register static core commands
  registerCoreCommands(program);

  // 2. Register dynamic strategy commands
  await registerStrategyCommands(program);

  // 3. Register explore command (default) with backward compatibility
  registerExploreCommand();

  // 4. Register user-defined aliases from config
  await registerAliases(program);

  return program;
}

/**
 * Register explore command as default
 */
function registerExploreCommand(): void {
  program
    .command('explore', { isDefault: true })
    .description('Quickly find files by patterns, search code for keywords, or explore codebase [default command]')
    .argument('[query]', 'Search query or pattern')
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
    .action(async (query: string | undefined, options: ExploreCommandOptions) => {
      if (options.listStrategies) {
        await handleMetaStrategyCommand('list', options as any);
        return;
      }

      // Handle regular explore options
      await handleExploreAction(query, options);
    });
}

// Export the program for testing
export { program };