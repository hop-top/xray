// src/commands/registration/strategies.ts
import { Command } from 'commander';
import { StrategyLoader } from '../../lib/strategy/loader';
import { StrategyContextImpl } from '../../lib/strategy/context';
import { Strategy } from '../../lib/strategy/types';
import { Logger } from '../../lib/logger';
import { StrategyCacheManager } from './cache';

/**
 * Register dynamic strategy commands
 * Discovers all available strategies and registers their commands
 */
export async function registerStrategyCommands(program: Command): Promise<void> {
  const loader = new StrategyLoader();
  const cacheManager = new StrategyCacheManager();

  try {
    // Try to use cached strategies first
    const cached = await cacheManager.getCached();
    let strategies: Strategy[];

    if (cached) {
      Logger.debug('Using cached strategies');
      // Load strategies from cache
      strategies = await loader.discoverStrategies();

      // Validate that loaded strategies match cache
      if (!cacheManager.validateCache(strategies, cached)) {
        Logger.debug('Cache validation failed, reloading strategies');
        strategies = await loader.discoverStrategies();
        await cacheManager.save(strategies);
      }
    } else {
      // No cache or invalid cache - load fresh
      Logger.debug('Loading strategies from disk');
      strategies = await loader.discoverStrategies();
      await cacheManager.save(strategies);
    }

    // Register each strategy as a command group
    for (const strategy of strategies) {
      try {
        registerStrategyCommand(program, strategy);
      } catch (error: any) {
        // Log but don't fail - other strategies can still work
        Logger.warn(`Failed to register strategy "${strategy.name}": ${error.message}`);
      }
    }

    Logger.debug(`Registered ${strategies.length} strategies with dynamic commands`);
  } catch (error: any) {
    // Strategy discovery failed - continue with static commands only
    Logger.warn(`Strategy discovery failed: ${error.message}`);
    Logger.info('Continuing with built-in commands only');
  }
}

/**
 * Register a single strategy and its commands
 */
function registerStrategyCommand(program: Command, strategy: Strategy): void {
  // Skip strategies without commands
  if (!strategy.commands || Object.keys(strategy.commands).length === 0) {
    Logger.debug(`Strategy "${strategy.name}" has no commands, skipping`);
    return;
  }

  // Create strategy subcommand group
  const strategyCmd = program
    .command(strategy.name)
    .description(`${strategy.name} strategy commands`);

  // Register each command under the strategy
  for (const [cmdName, cmdDef] of Object.entries(strategy.commands)) {
    // Validate command definition
    if (!cmdDef.handler || typeof cmdDef.handler !== 'function') {
      Logger.warn(
        `Strategy "${strategy.name}" has invalid command "${cmdName}" (missing or invalid handler)`
      );
      continue;
    }

    strategyCmd
      .command(cmdName)
      .description(cmdDef.description || `Execute ${cmdName} command`)
      .option('-p, --path <path>', 'Project path to analyze', process.cwd())
      .allowUnknownOption() // Allow strategy-specific options
      .action(async (options: any, command: Command) => {
        await executeStrategyCommand(strategy, cmdName, cmdDef, options, command);
      });
  }
}

/**
 * Execute a strategy command
 */
async function executeStrategyCommand(
  strategy: Strategy,
  cmdName: string,
  cmdDef: any,
  options: any,
  command: Command
): Promise<void> {
  const projectPath = options.path || process.cwd();
  const context = new StrategyContextImpl(projectPath);

  try {
    Logger.info(`Executing ${strategy.name}:${cmdName}...`);

    // Execute the command handler
    const result = await cmdDef.handler(context, options);

    // Display results
    displayStrategyResult(strategy.name, cmdName, result);
  } catch (error: any) {
    Logger.error(`Error executing ${strategy.name}:${cmdName}: ${error.message}`);
    // Show stack trace in debug mode
    const { LogLevel } = await import('../../lib/logger');
    if (Logger.getLevel() === LogLevel.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Format and display strategy command results
 */
function displayStrategyResult(strategyName: string, cmdName: string, result: any): void {
  const title = formatTitle(strategyName, cmdName);

  if (Array.isArray(result)) {
    console.log(`\n${title}:\n`);

    if (result.length === 0) {
      console.log('  (none found)');
    } else {
      result.forEach((item: any) => {
        if (typeof item === 'object') {
          const name = item.name || item.title || item.id || JSON.stringify(item);
          console.log(`  ${name}`);

          if (item.file) {
            console.log(`    → ${item.file}${item.line ? `:${item.line}` : ''}`);
          }

          if (item.description) {
            console.log(`    ${item.description}`);
          }
        } else {
          console.log(`  ${item}`);
        }
      });
    }

    console.log(`\nTotal: ${result.length}\n`);
  } else if (typeof result === 'object' && result !== null) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result !== undefined && result !== null) {
    console.log(result);
  }
}

/**
 * Format command title for display
 */
function formatTitle(strategyName: string, cmdName: string): string {
  const title = `${strategyName} ${cmdName}`;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
