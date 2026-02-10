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
    handleStrategyDiscoveryError(error);
  }
}

/**
 * Handle strategy discovery errors gracefully
 */
function handleStrategyDiscoveryError(error: any): void {
  if (error.code === 'ENOENT') {
    Logger.debug('Strategy directory not found - no custom strategies available');
  } else if (error.code === 'EACCES') {
    Logger.warn('Permission denied reading strategies - continuing with built-in commands');
  } else if (error.message?.includes('Cannot find module')) {
    Logger.debug(`Strategy module loading failed: ${error.message}`);
  } else {
    Logger.warn(`Strategy discovery failed: ${error.message}`);
  }

  Logger.info('Continuing with built-in commands only');
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

  try {
    const context = new StrategyContextImpl(projectPath);
    Logger.info(`Executing ${strategy.name}:${cmdName}...`);

    // Execute the command handler
    const result = await cmdDef.handler(context, options);

    // Display results
    displayStrategyResult(strategy.name, cmdName, result);
  } catch (error: any) {
    handleStrategyCommandError(error, strategy.name, cmdName, projectPath);
  }
}

/**
 * Handle strategy command execution errors with helpful messages
 */
async function handleStrategyCommandError(
  error: any,
  strategyName: string,
  cmdName: string,
  projectPath: string
): Promise<never> {
  const { LogLevel } = await import('../../lib/logger');

  // Categorize and provide helpful error messages
  if (error.code === 'ENOENT') {
    Logger.error(`Project path not found: ${projectPath}`);
    Logger.info('');
    Logger.info('Tip: Use the -p option to specify a valid project directory');
    Logger.info(`Example: xray ${strategyName} ${cmdName} -p /path/to/project`);
  } else if (error.code === 'EACCES') {
    Logger.error(`Permission denied accessing: ${error.path || projectPath}`);
    Logger.info('');
    Logger.info('Tip: Check file permissions or run with appropriate privileges');
  } else if (error.message?.includes('package.json')) {
    Logger.error(`Failed to read package.json in: ${projectPath}`);
    Logger.info('');
    Logger.info('Tip: Ensure you\'re running this command in a valid project directory');
    Logger.info(`Current path: ${projectPath}`);
  } else if (error.message?.includes('not found') || error.message?.includes('Cannot find')) {
    Logger.error(`Resource not found: ${error.message}`);
    Logger.info('');
    Logger.info(`Command: xray ${strategyName} ${cmdName}`);
    Logger.info(`Path: ${projectPath}`);
  } else {
    // Generic error with helpful context
    Logger.error(`Error executing ${strategyName}:${cmdName}: ${error.message}`);
    Logger.info('');
    Logger.info(`Project: ${projectPath}`);

    if (error.cause) {
      Logger.info(`Cause: ${error.cause}`);
    }
  }

  // Show stack trace in debug mode
  if (Logger.getLevel() === LogLevel.DEBUG) {
    Logger.debug('Stack trace:');
    Logger.debug(error.stack);
  } else {
    Logger.info('');
    Logger.info('Run with -v debug for detailed error information');
  }

  process.exit(1);
}

/**
 * Format and display strategy command results
 */
function displayStrategyResult(strategyName: string, cmdName: string, result: any): void {
  const title = formatTitle(strategyName, cmdName);

  if (Array.isArray(result)) {
    Logger.output(`\n${title}:\n`);

    if (result.length === 0) {
      Logger.output('  (none found)');
    } else {
      result.forEach((item: any) => {
        if (typeof item === 'object') {
          const name = item.name || item.title || item.id || JSON.stringify(item);
          Logger.output(`  ${name}`);

          if (item.file) {
            Logger.output(`    → ${item.file}${item.line ? `:${item.line}` : ''}`);
          }

          if (item.description) {
            Logger.output(`    ${item.description}`);
          }
        } else {
          Logger.output(`  ${item}`);
        }
      });
    }

    Logger.output(`\nTotal: ${result.length}\n`);
  } else if (typeof result === 'object' && result !== null) {
    Logger.output(JSON.stringify(result, null, 2));
  } else if (result !== undefined && result !== null) {
    Logger.output(result);
  }
}

/**
 * Format command title for display
 */
function formatTitle(strategyName: string, cmdName: string): string {
  const title = `${strategyName} ${cmdName}`;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
