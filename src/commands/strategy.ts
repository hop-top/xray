import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { Logger } from '../lib/logger';
import { StrategyLoader } from '../lib/strategy/loader';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyContextImpl } from '../lib/strategy/context';
import { StrategyRunner } from '../lib/strategy/runner';
import { resolvePath } from './common';
import { StrategyCommandOptions } from '../types/command-options';
import { normalizeDetectedStrategy } from '../lib/strategy/types';
import { NotFoundError, UsageError } from '../lib/error/types';

export const handleMetaStrategyCommand = async (commandName: string, options: StrategyCommandOptions) => {

  if (commandName === 'list') {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();

    Logger.info('Available Strategies:\n');
    strategies.forEach(strategy => {
      Logger.output(chalk.cyan(`  ${strategy.name}`) + ' ' + chalk.gray(`v${strategy.version}`));
    });

    if (strategies.length === 0) {
      Logger.warn('No strategies found.');
    }

  } else if (commandName === 'detect') {
    const startTime = Date.now();
    const projectPath = options.path && options.path.length > 0
      ? resolvePath(options.path[0])
      : process.cwd();

    if (!fs.existsSync(projectPath!)) {
      Logger.error(`Path does not exist: ${projectPath}`);
      process.exit(1);
    }

    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(projectPath!);
    const detector = new StrategyDetector(loader, context);

    Logger.info(`Detecting strategies for: ${projectPath}\n`);
    const detected = await detector.runDetection();

    if (detected.length === 0) {
      Logger.warn('No strategies detected for this project.');
    } else {
      Logger.info('Detected Strategies:\n');
      detected.forEach(strategy => {
        Logger.output(chalk.cyan(`  ${strategy.name}`) + ' ' + chalk.gray(`v${strategy.version}`));
      });
    }

  } else {
    Logger.error(`Unknown meta-strategy command: "${commandName}"`);
    Logger.info('\nAvailable meta-strategy commands:');
    Logger.output('  - strategy:list   - List all available strategies');
    Logger.output('  - strategy:detect - Detect applicable strategies');
    process.exit(1);
  }
};

// Handle strategy:command queries
export const handleStrategyCommand = async (query: string, options: StrategyCommandOptions) => {
  const startTime = Date.now();
  const [strategyName, commandName] = query.split(':');

  if (!commandName) {
    throw new UsageError(`Invalid query format: "${query}". Expected format: strategy:command (e.g., react:components)`);
  }

  // Handle meta-strategy commands
  if (strategyName === 'strategy') {
    await handleMetaStrategyCommand(commandName, options);
    return;
  }

  const projectPath = options.path && options.path.length > 0 ? resolvePath(options.path[0]) : process.cwd();

  if (!fs.existsSync(projectPath!)) {
    Logger.error(`Path does not exist: ${projectPath}`);
    process.exit(1);
  }

  // Load strategies
  const loader = new StrategyLoader();
  const strategies = await loader.discoverStrategies();
  const strategy = strategies.find(s => s.name === strategyName);

  if (!strategy) {
    Logger.info(`\nAvailable strategies:`);
    strategies.forEach(s => Logger.output(`  - ${s.name}`));
    throw new NotFoundError(`Strategy "${strategyName}" not found.`);
  }

  // Check if strategy has the requested command
  if (!strategy.commands || !strategy.commands[commandName]) {
    if (strategy.commands && Object.keys(strategy.commands).length > 0) {
      Logger.info(`\nAvailable commands for ${strategyName}:`);
      Object.keys(strategy.commands).forEach(cmd => {
        Logger.output(`  - ${strategyName}:${cmd}`);
      });
    }
    throw new NotFoundError(`Command "${commandName}" not found for strategy "${strategyName}".`);
  }

  // Create context
  const context = new StrategyContextImpl(projectPath!);

  // Detect if strategy applies
  const detected = normalizeDetectedStrategy(
    strategy,
    await strategy.detect(context)
  );
  if (!detected) {
    Logger.warn(`Strategy "${strategyName}" not detected for this project.`);
    Logger.info(`Make sure the project matches the strategy requirements.`);
    process.exit(1);
  }

  // Analyze files with the strategy
  Logger.info(`Analyzing ${strategyName} files...`);
  const fileTypes = strategy.fileTypes?.() || [];
  const ignorePatterns = strategy.ignorePatterns?.() || [];

  const allFiles = context.globFiles('**/*');
  const strategyFiles = allFiles.filter(file => {
    // Check file type
    if (!fileTypes.some(ext => file.endsWith(ext))) {
      return false;
    }
    // Check ignore patterns
    for (const pattern of ignorePatterns) {
      const globPattern = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
      if (new RegExp(globPattern).test(file)) {
        return false;
      }
    }
    return true;
  });

  // Analyze each file
  for (const file of strategyFiles) {
    const metadata = await strategy.analyze(file, context);

    // Store tags and metadata in context (use relative paths)
    for (const tag of metadata.tags) {
      context.addFileTag(file, tag);
    }

    context.setFileMetadata(file, strategyName, metadata.metadata);
  }

  // Execute strategy command
  const runner = new StrategyRunner();
  runner.register(strategy);

  const result = await runner.execute(strategyName, commandName, context, options);

  // Display results based on command type
  displayStrategyCommandResult(strategyName, commandName, result);
};

// Display strategy command results
const displayStrategyCommandResult = (strategyName: string, commandName: string, result: any) => {
  if (commandName === 'components' && Array.isArray(result)) {
    if (result.length === 0) {
      Logger.warn(`No ${strategyName} components found.`);
    } else {
      Logger.info(`\n${strategyName.charAt(0).toUpperCase() + strategyName.slice(1)} Components:\n`);
      result.forEach((comp: any) => {
        Logger.output(
          chalk.green(`  ${comp.name}`) + ' ' +
          chalk.gray(`(${comp.type})`) + ' ' +
          chalk.blue(`- ${comp.file}`)
        );
      });
      Logger.info(`\nTotal: ${result.length} component(s)`);
    }
  } else if (commandName === 'hooks' && Array.isArray(result)) {
    if (result.length === 0) {
      Logger.warn(`No custom ${strategyName} hooks found.`);
    } else {
      Logger.info(`\nCustom ${strategyName.charAt(0).toUpperCase() + strategyName.slice(1)} Hooks:\n`);
      result.forEach((hook: any) => {
        Logger.output(chalk.green(`  ${hook.name}`) + ' ' + chalk.blue(`- ${hook.file}`));
      });
      Logger.info(`\nTotal: ${result.length} hook(s)`);
    }
  } else if (commandName === 'contexts' && Array.isArray(result)) {
    if (result.length === 0) {
      Logger.warn(`No ${strategyName} contexts found.`);
    } else {
      Logger.info(`\n${strategyName.charAt(0).toUpperCase() + strategyName.slice(1)} Contexts:\n`);
      result.forEach((ctx: any) => {
        Logger.output(chalk.green(`  ${ctx.name}`) + ' ' + chalk.blue(`- ${ctx.file}`));
      });
      Logger.info(`\nTotal: ${result.length} context(s)`);
    }
  } else {
    // Generic display for unknown command types
    Logger.output(JSON.stringify(result, null, 2));
  }
};
