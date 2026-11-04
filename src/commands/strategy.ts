import * as fs from 'fs';
import { styles } from '../lib/tui';
import { Logger } from '../lib/logger';
import { StrategyLoader, reportSkippedProjectCode } from '../lib/strategy/loader';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyContextImpl } from '../lib/strategy/context';
import { resolvePath } from './common';
import { StrategyCommandOptions } from '../types/command-options';

export const handleMetaStrategyCommand = async (commandName: string, options: StrategyCommandOptions) => {

  if (commandName === 'list') {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    reportSkippedProjectCode('warn');

    Logger.info('Available Strategies:\n');
    strategies.forEach(strategy => {
      Logger.output(styles().accent(`  ${strategy.name}`) + ' ' + styles().muted(`v${strategy.version}`));
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
    Logger.error(`Unknown meta-strategy command: "${commandName}"`);
    Logger.info('\nAvailable meta-strategy commands:');
    Logger.output('  - strategy list   - List all available strategies');
    Logger.output('  - strategy detect - Detect applicable strategies');
    process.exit(1);
  }
};
