// src/commands/registration/strategies.ts
import { Command } from 'commander';
import { StrategyLoader } from '../../lib/strategy/loader';
import { StrategyContextImpl } from '../../lib/strategy/context';
import {
  Extension,
  ExtensionCommandOption,
  Strategy,
  StrategyCommand,
  normalizeDetectedStrategy,
} from '../../lib/strategy/types';
import { Logger } from '../../lib/logger';
import { StrategyCacheManager } from './cache';
import { StrategyCommandOptions } from '../../types/command-options';
import {
  addExtensionOverrideOptions,
  createStrategyContext,
  normalizeExtensionOptions,
} from '../common';

/**
 * Register dynamic strategy commands
 * Discovers all available strategies and registers their commands
 */
export async function registerStrategyCommands(program: Command): Promise<void> {
  return registerExtensionCommands(program);
}

export async function registerExtensionCommands(
  program: Command
): Promise<void> {
  const loader = new StrategyLoader();
  const cacheManager = new StrategyCacheManager();

  try {
    // Try to use cached strategies first
    const cached = await cacheManager.getCached();
    let strategies: Strategy[];

    if (cached) {
      Logger.debug('Found valid strategy cache metadata');
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

    const extensions = await loader.discoverExtensions(strategies);

    // Register each extension as a command group
    for (const extension of extensions) {
      try {
        registerStrategyCommand(program, extension);
      } catch (error: any) {
        Logger.warn(`Failed to register extension "${extension.name}": ${error.message}`);
      }
    }

    Logger.debug(`Registered ${extensions.length} extensions with dynamic commands`);
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
 * Register a single extension and its commands
 */
function registerStrategyCommand(
  program: Command,
  extension: Strategy | Extension
): void {
  if (!extension.commands || Object.keys(extension.commands).length === 0) {
    Logger.debug(`Extension "${extension.name}" has no commands, skipping`);
    return;
  }

  const strategyCmd = program
    .command(extension.name)
    .description(`${extension.name} commands`);

  for (const [cmdName, cmdDef] of Object.entries(
    extension.commands as Record<string, StrategyCommand>
  )) {
    if (!cmdDef.handler || typeof cmdDef.handler !== 'function') {
      Logger.warn(
        `Extension "${extension.name}" has invalid command "${cmdName}" ` +
          '(missing or invalid handler)'
      );
      continue;
    }

    const cmd = addExtensionOverrideOptions(
      strategyCmd
        .command(cmdName)
        .description(cmdDef.description || `Execute ${cmdName} command`)
        .option('-p, --path <path>', 'Project path to analyze', process.cwd())
    );

    if (cmdDef.options) {
      for (const [optName, optDef] of Object.entries(cmdDef.options)) {
        const { flags, description, fn } = toCommanderOption(optName, optDef);
        const defaultValue =
          typeof optDef === 'object' && optDef.repeatable ? [] : undefined;

        if (fn) {
          cmd.option(flags, description, fn, defaultValue);
        } else {
          cmd.option(flags, description, defaultValue as any);
        }
      }
    }

    cmd
      .allowUnknownOption()
      .action(async (options: StrategyCommandOptions) => {
        const normalizedOptions = normalizeExtensionOptions(options);
        await executeStrategyCommand(
          extension,
          cmdName,
          cmdDef,
          normalizedOptions
        );
      });
  }
}

/**
 * Execute an extension command
 */
async function executeStrategyCommand(
  extension: Strategy | Extension,
  cmdName: string,
  cmdDef: StrategyCommand,
  options: StrategyCommandOptions
): Promise<void> {
  const projectPath = options.path || process.cwd();
  const detectionSource =
    'strategy' in extension && extension.strategy
      ? extension.strategy
      : extension;

  try {
    const context = createStrategyContext(projectPath, options);
    Logger.info(`Executing ${extension.name}:${cmdName}...`);

    const detected = normalizeDetectedStrategy(
      detectionSource,
      await extension.detect(context)
    );
    if (!detected) {
      Logger.warn(
        `Extension "${extension.name}" did not detect an applicable project ` +
          `at ${projectPath}`
      );
    }

    await analyzeProjectFiles(extension, context);

    const result = await cmdDef.handler(context, options);

    displayStrategyResult(extension.name, cmdName, result);
  } catch (error: any) {
    handleStrategyCommandError(error, extension.name, cmdName, projectPath);
  }
}

function toCommanderOption(
  optionName: string,
  optionValue: ExtensionCommandOption
): {
  flags: string;
  description: string;
  fn?: (value: string, previous: any) => any;
} {
  if (typeof optionValue === 'string') {
    const placeholder = optionName.includes('show-') ? '' : ` <${optionName}>`;
    return {
      flags: `--${optionName}${placeholder}`.trim(),
      description: optionValue,
    };
  }

  const aliasPrefix = optionValue.alias ? `-${optionValue.alias}, ` : '';
  const placeholder =
    optionValue.type === 'boolean'
      ? ''
      : ` ${optionValue.placeholder || `<${optionName}>`}`;

  let fn: ((value: string, previous: any) => any) | undefined;

  if (optionValue.repeatable) {
    if (optionValue.type === 'number') {
      fn = (val, prev) => (prev || []).concat([Number(val)]);
    } else {
      fn = (val, prev) => (prev || []).concat([val]);
    }
  } else if (optionValue.type === 'number') {
    fn = (val) => Number(val);
  }

  return {
    flags: `${aliasPrefix}--${optionName}${placeholder}`,
    description: optionValue.description,
    fn,
  };
}

/**
 * Analyze all relevant project files for an extension, populating tags and
 * metadata in context
 */
async function analyzeProjectFiles(
  strategy: Strategy | Extension,
  context: StrategyContextImpl
): Promise<void> {
  if (typeof strategy.analyze !== 'function') {
    return;
  }

  const { globSync } = await import('glob');
  const path = await import('path');

  const fileTypes = strategy.fileTypes?.() || [];
  const ignorePatterns = strategy.ignorePatterns?.() || ['**/node_modules/**', '**/.git/**'];
  const projectRoot = context.getProjectRoot();

  // Build glob patterns from file types
  let patterns: string[];
  if (fileTypes.length > 0) {
    patterns = fileTypes.map(ext => `**/*${ext}`);
  } else {
    patterns = ['**/*'];
  }

  // Collect all matching files using glob with ignore support
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const files = globSync(pattern, {
      cwd: projectRoot,
      nodir: true,
      ignore: ignorePatterns
    });
    for (const file of files) {
      seen.add(file);
    }
  }

  // Analyze each file and populate context
  for (const file of seen) {
    const fullPath = path.join(projectRoot, file);
    try {
      const metadata = await strategy.analyze(fullPath, context);

      // Store tags in context
      for (const tag of metadata.tags) {
        context.addFileTag(file, tag);
      }

      // Store metadata in context
      if (metadata.metadata && Object.keys(metadata.metadata).length > 0) {
        context.setFileMetadata(file, strategy.name, metadata.metadata);
      }
    } catch (error: any) {
      Logger.debug(`Failed to analyze ${file}: ${error.message}`);
    }
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
