import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { Logger } from '../lib/logger';
import { StrategyLoader } from '../lib/strategy/loader';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyContextImpl } from '../lib/strategy/context';
import { normalizeDetectedStrategy } from '../lib/strategy/types';
import { FileWriteError, NotFoundError } from '../lib/error/types';

export function registerStrategyCommand(): Command {
  const program = new Command('strategy')
    .description('Manage strategies (list, create, install, remove, enable, disable, info)');

  program
    .command('list')
    .alias('ls')
    .description('List all available strategies')
    .action(async () => {
      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();

      Logger.info('Available Strategies:\n');
      strategies.forEach(strategy => {
        Logger.output(chalk.cyan(`  ${strategy.name}`) + ' ' + chalk.gray(`v${strategy.version}`));
      });

      if (strategies.length === 0) {
        Logger.warn('No strategies found.');
      }
    });

  program
    .command('detect')
    .description('Detect applicable strategies for the current project')
    .option('-p, --path <paths...>', 'Project path(s)')
    .action(async (options) => {
      const projectPath = options.path && options.path.length > 0 ? options.path[0] : process.cwd();

      if (!fs.existsSync(projectPath)) {
        Logger.error(`Path does not exist: ${projectPath}`);
        process.exit(1);
      }

      const loader = new StrategyLoader();
      const context = new StrategyContextImpl(projectPath);
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
    });

  program
    .command('info <name>')
    .description('Show detailed information about a strategy')
    .action(async (name) => {
      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();
      const strategy = strategies.find(s => s.name === name);

      if (!strategy) {
        Logger.info('\nAvailable strategies:');
        strategies.forEach(s => console.log(`  - ${s.name}`));
        throw new NotFoundError(`Strategy "${name}" not found.`);
      }

      Logger.info(`\nStrategy: ${strategy.name}`);
      Logger.output(chalk.gray(`Version: ${strategy.version}`));

      if (strategy.fileTypes) {
        Logger.output(`\nFile Types: ${strategy.fileTypes().join(', ')}`);
      }

      if (strategy.commands) {
        Logger.output('\nCommands:');
        Object.entries(strategy.commands).forEach(([cmd, details]) => {
          Logger.output(`  - ${strategy.name}:${cmd} ${chalk.gray(`- ${details.description}`)}`);
        });
      }

      const context = new StrategyContextImpl(process.cwd());
      const detected = normalizeDetectedStrategy(
        strategy,
        await strategy.detect(context)
      );
      Logger.output(`\nDetected in current project: ${detected ? chalk.green('Yes') : chalk.red('No')}`);
    });

  program
    .command('create <name>')
    .description('Create a new strategy scaffold')
    .option('-d, --dir <directory>', 'Output directory')
    .option('--yaml', 'Create YAML format strategy (simpler, no code needed)')
    .option('--ts', 'Create TypeScript format strategy (full control)')
    .action(async (name, options) => {
      const dir = options.dir || path.join(process.cwd(), '.xray/strategies');

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const fileName = name.toLowerCase().replace(/\s+/g, '-');
      const isYaml = options.yaml || (!options.ts && !options.dir);
      const fileExt = isYaml ? '.yml' : '.ts';
      const filePath = path.join(dir, `${fileName}${fileExt}`);

      if (fs.existsSync(filePath)) {
        Logger.error(`Strategy file already exists: ${filePath}`);
        process.exit(1);
      }

      if (isYaml) {
        const template = `name: ${name}
version: 0.1.0
detect:
  files: []
  dependencies: []
fileTypes: []
tags: []
commands: {}
`;
        try {
          fs.writeFileSync(filePath, template);
          Logger.success(`\nStrategy created: ${filePath}`);
          Logger.info('\nNext steps:');
        } catch (err: any) {
          throw new FileWriteError(filePath, err);
        }
        Logger.output(`  1. Edit the YAML file to configure detection rules`);
        Logger.output(`  2. Run 'xray strategy detect' to verify it works`);
        Logger.output(`  3. Test with 'xray explore ${name}:info'`);
      } else {
        const template = `import { Strategy, StrategyContext, FileMetadata } from '../../../src/lib/strategy/types';

export const ${name.replace(/-/g, '_').replace(/\s+/g, '_')}Strategy: Strategy = {
  name: '${name}',
  version: '0.1.0',
  detect: (ctx: StrategyContext) => {
    return ctx.hasFiles('**/*.example');
  },
  fileTypes: () => ['.example'],
  ignorePatterns: () => ['node_modules/**', '.git/**'],
  analyze: async (file: string, ctx: StrategyContext): Promise<FileMetadata> => {
    const content = await ctx.readFile(file);
    return {
      tags: [],
      metadata: {},
      exports: [],
      imports: []
    };
  },
  commands: {
    info: {
      description: 'Show information about detected patterns',
      handler: async (ctx: StrategyContext) => {
        const files = ctx.globFiles('**/*.example');
        return files;
      }
    }
  }
};
`;
        try {
          fs.writeFileSync(filePath, template);
          Logger.success(`\nStrategy created: ${filePath}`);
          Logger.info('\nNext steps:');
        } catch (err: any) {
          throw new FileWriteError(filePath, err);
        }
        Logger.output(`  1. Edit the strategy file to implement detection and analysis logic`);
        Logger.output(`  2. Run 'xray strategy detect' to verify it works`);
        Logger.output(`  3. Test with 'xray ${name}:info'`);
      }
    });

  program
    .command('install <source>')
    .description('Install a strategy from a path or npm package')
    .option('-g, --global', 'Install globally', false)
    .action(async (source, options) => {
      const loader = new StrategyLoader();
      const strategyPaths = loader.getStrategyPaths();

      if (options.global) {
        const xdgDataHome = process.env.XDG_DATA_HOME || path.join(process.env.HOME || '', '.local/share');
        const globalPath = path.join(xdgDataHome, 'xray/strategies');
        if (!fs.existsSync(globalPath)) {
          fs.mkdirSync(globalPath, { recursive: true });
        }
        Logger.info(`Installing to global strategies: ${globalPath}`);
      }

      try {
        let strategyPath = source;
        let strategyName = '';

        if (source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) {
          const absolutePath = path.resolve(source);
          if (!fs.existsSync(absolutePath)) {
            Logger.error(`Path does not exist: ${absolutePath}`);
            process.exit(1);
          }
          strategyPath = absolutePath;
          strategyName = path.basename(absolutePath).replace(/\.(ts|js|yml|yaml)$/, '');
        } else {
          Logger.warn(`\nInstalling from npm: ${source}`);
          const { execSync } = require('child_process');
          try {
            execSync(`npm install ${source}`, {
              stdio: 'inherit',
              cwd: process.cwd()
            });
          } catch {
            Logger.error('Failed to install npm package');
            process.exit(1);
          }
          strategyName = source;
          strategyPath = path.join(process.cwd(), 'node_modules', source);
        }

        const strategy = await loader.loadStrategy(strategyPath);
        Logger.success(`\nStrategy installed: ${strategy.name} v${strategy.version}`);
      } catch (error: any) {
        Logger.error(`Failed to install strategy: ${error.message}`);
        process.exit(1);
      }
    });

  program
    .command('remove <name>')
    .alias('uninstall')
    .description('Remove an installed strategy')
    .action(async (name) => {
      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();
      const strategy = strategies.find(s => s.name === name);

      if (!strategy) {
        throw new NotFoundError(`Strategy "${name}" not found.`);
      }

      const strategyPaths = loader.getStrategyPaths();
      let removed = false;

      for (const searchPath of strategyPaths) {
        if (!fs.existsSync(searchPath)) continue;

        const files = fs.readdirSync(searchPath);
        const strategyFile = files.find(f =>
          f === `${name}.ts` || f === `${name}.js` || f === `${name}.yml` || f === `${name}.yaml`
        );

        if (strategyFile) {
          const filePath = path.join(searchPath, strategyFile);
          fs.unlinkSync(filePath);
          Logger.success(`Strategy removed: ${filePath}`);
          removed = true;
          break;
        }
      }

      if (!removed) {
        Logger.warn(`Could not find strategy file to remove for "${name}"`);
      }
    });

  program
    .command('validate <name>')
    .description('Validate a strategy file')
    .action(async (name) => {
      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();
      const strategy = strategies.find(s => s.name === name);

      if (!strategy) {
        throw new NotFoundError(`Strategy "${name}" not found.`);
      }

      Logger.info(`\nValidating strategy: ${name}`);
      Logger.output(`  Name: ${strategy.name}`);
      Logger.output(`  Version: ${strategy.version}`);
      Logger.output(`  Has detect: ${typeof strategy.detect === 'function' ? 'Yes' : 'No'}`);
      Logger.output(`  Has analyze: ${typeof strategy.analyze === 'function' ? 'Yes' : 'No'}`);
      Logger.output(`  Commands: ${strategy.commands ? Object.keys(strategy.commands).join(', ') : 'None'}`);

      const context = new StrategyContextImpl(process.cwd());
      try {
        const detected = normalizeDetectedStrategy(
          strategy,
          await strategy.detect(context)
        );
        Logger.output(`  Detection test: ${detected ? chalk.green('Passed') : chalk.yellow('Not detected')}`);
      } catch (error: any) {
        Logger.output(`  Detection test: ${chalk.red('Error')}`);
        Logger.error(`  Error: ${error.message}`);
      }

      Logger.success('\nValidation complete.');
    });

  program
    .command('path')
    .description('Show strategy search paths')
    .action(() => {
      const loader = new StrategyLoader();
      const paths = loader.getStrategyPaths();

      Logger.info('\nStrategy Search Paths:\n');
      paths.forEach((p, i) => {
        const exists = fs.existsSync(p);
        Logger.output(`  ${i + 1}. ${p} ${chalk.gray(exists ? '' : '(not found)')}`);
      });
    });

  return program;
}
