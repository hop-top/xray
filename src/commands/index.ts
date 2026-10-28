import { handleMetaStrategyCommand } from './strategy';
import type { Command } from 'commander';
import { addExploreOutputFlags, handleExploreAction } from './explore';
import { program, theme } from './root-program';
import { setCommandGroup } from './kit-cli';
import { registerCoreCommands } from './registration/core';
import { registerStrategyCommands } from './registration/strategies';
import { registerAliases } from './registration/aliases';
import { ExploreCommandOptions } from '../types/command-options';

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
  const explore = program
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
    .option('--stats', 'Show codebase statistics')
    .option('--list-strategies', 'List all available strategies');
  addExploreOutputFlags(explore)
    .action(async (query: string | undefined, options: ExploreCommandOptions, cmd: Command) => {
      if (options.listStrategies) {
        await handleMetaStrategyCommand('list', options as any);
        return;
      }

      // Handle regular explore options
      await handleExploreAction(query, options, cmd);
    });
  setCommandGroup(explore, 'analyze');
}

// Export the program for testing; theme for themed output.
export { program, theme };
