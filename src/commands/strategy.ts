import * as fs from 'fs';
import { styles } from '../lib/tui';
import { Logger } from '../lib/logger';
import type { Command } from 'commander';
import { NotFoundError, UsageError } from '../lib/error/types';
import { runStrategyList } from './strategy-cmd';
import { StrategyLoader, reportSkippedProjectCode } from '../lib/strategy/loader';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyContextImpl } from '../lib/strategy/context';
import { resolvePath } from './common';
import { StrategyCommandOptions } from '../types/command-options';

export const handleMetaStrategyCommand = async (commandName: string, options: StrategyCommandOptions, cmd: Command) => {

  if (commandName === 'list') {
    await runStrategyList(cmd);

  } else if (commandName === 'detect') {
    const startTime = Date.now();
    const projectPath = options.path && options.path.length > 0
      ? resolvePath(options.path[0])
      : process.cwd();

    if (!fs.existsSync(projectPath!)) {
      throw new NotFoundError(`Path does not exist: ${projectPath}`);
    }

    const loader = new StrategyLoader();
    const context = new StrategyContextImpl(projectPath!);
    const detector = new StrategyDetector(loader, context);

    reportSkippedProjectCode('warn');
    Logger.info(`Detecting strategies for: ${projectPath}\n`);
    const detected = await detector.runDetection();

    if (detected.length === 0) {
      Logger.warn('No strategies detected for this project.');
    } else {
      Logger.info('Detected Strategies:\n');
      detected.forEach(strategy => {
        Logger.output(styles().accent(`  ${strategy.name}`) + ' ' + styles().muted(`v${strategy.version}`));
      });
    }

  } else {
    Logger.info('\nAvailable meta-strategy commands:');
    Logger.info('  - strategy list   - List all available strategies');
    Logger.info('  - strategy detect - Detect applicable strategies');
    throw new UsageError(`Unknown meta-strategy command: "${commandName}"`);
  }
};
