import { handleMetaStrategyCommand } from './strategy';
import type { Command } from 'commander';
import { addExploreOutputFlags, handleExploreAction } from './explore';
import { program, theme } from './root-program';
import { setCommandGroup } from './kit-cli';
import { declareEffect } from './side-effect';
import { registerCoreCommands } from './registration/core';
import { registerStrategyCommands } from './registration/strategies';
import { registerAliases } from './registration/aliases';
import { captureReservedNames } from '../lib/alias-resolver';
import { bindValueCompleters } from './completion';
import { ExploreCommandOptions } from '../types/command-options';
import type { CodeLoadingOptions } from '../lib/strategy/loader';

/**
 * Register all commands (static core + dynamic strategies + aliases).
 * `projectCode: false` keeps strategy code in the working
 * directory from loading (shell completion). `configPath` (root
 * `--config`) is the config aliases come from instead of discovery.
 */
export async function registerCommands(options: CodeLoadingOptions = {}, configPath?: string) {
  // 1. Register static core commands
  registerCoreCommands(program);

  // 2. Register dynamic strategy commands
  await registerStrategyCommands(program, options);

  // 3. Register explore command (default) with backward compatibility
  registerExploreCommand();

  // 4. Register user-defined aliases from config (reserved names = every command above)
  captureReservedNames(program);
  await registerAliases(program, options, configPath);

  // 5. Bind flag/argument value completers across the full tree.
  bindValueCompleters(program, options);

  return program;
}

/**
 * Register explore command as default
 */
function registerExploreCommand(): void {
  const explore = program
    .command('explore', { isDefault: true })
    .description('Quickly find files by patterns, search code for keywords, or explore codebase [default command]')
    .option('-p, --path <path>', 'Root directory to explore (repeatable) [default: current directory]', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('-m, --match <pattern>', 'Find files matching pattern (e.g., "*.ts", "**/*test*"); with --search or --stats, restricts them to these files (repeatable)', (value: string, previous: string[]) => {
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
    .action(async (options: ExploreCommandOptions, cmd: Command) => {
      if (options.listStrategies) {
        await handleMetaStrategyCommand('list', options as any, cmd);
        return;
      }

      // Handle regular explore options
      await handleExploreAction(options, cmd);
    });
  declareEffect(explore, 'read', 'yes');
  setCommandGroup(explore, 'analyze');
}

// Export the program for testing; theme for themed output.
export { program, theme };
