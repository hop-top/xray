import * as fs from 'fs';
import * as path from 'path';
import { styles } from '../lib/tui';
import { Command } from 'commander';
import { Logger } from '../lib/logger';
import { StrategyLoader, PROJECT_STRATEGIES_ENV, projectStrategiesAllowed, reportSkippedProjectCode } from '../lib/strategy/loader';
import { installStrategy, findInstalledStrategyPackage, uninstallStrategyPackage } from './strategy-install';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyContextImpl } from '../lib/strategy/context';
import { normalizeDetectedStrategy } from '../lib/strategy/types';
import { FileWriteError, NotFoundError, UsageError } from '../lib/error/types';
import {
  addOutputFlags, assertFormat, columns, emit, outputRegistry, textFormatter,
} from '../lib/output';

interface StrategyRow { name: string; version: string; commands: string }

const strategyListRegistry = outputRegistry(
  textFormatter<StrategyRow[]>('text', (rows, put, s) => {
    rows.forEach((r) => put(s.accent(`  ${r.name}`) + ' ' + s.muted(`v${r.version}`)));
  })
);

export function registerStrategyCommand(): Command {
  const program = new Command('strategy')
    .description('Manage strategies (list, create, install, remove, enable, disable, info)');

  const listCmd = program
    .command('list')
    .alias('ls')
    .description('List all available strategies');
  addOutputFlags(listCmd, strategyListRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  }).action(async (_opts: unknown, cmd: Command) => {
    assertFormat(cmd, strategyListRegistry);
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    reportSkippedProjectCode('warn');

    Logger.info('Available Strategies:\n');
    const rows: StrategyRow[] = strategies.map((s) => ({
      name: s.name,
      version: s.version,
      commands: Object.keys(s.commands ?? {}).join(','),
    }));
    await emit(cmd, rows, {
      registry: strategyListRegistry,
      columns: columns('name', 'version', 'commands'),
      defaultFormat: 'text',
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
    });

  program
    .command('info <name>')
    .description('Show detailed information about a strategy')
    .action(async (name) => {
      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();
      const strategy = strategies.find(s => s.name === name);

      if (!strategy) {
        reportSkippedProjectCode('warn');
        Logger.info('\nAvailable strategies:');
        strategies.forEach(s => console.log(`  - ${s.name}`));
        throw new NotFoundError(`Strategy "${name}" not found.`);
      }

      Logger.info(`\nStrategy: ${strategy.name}`);
      Logger.output(styles().muted(`Version: ${strategy.version}`));

      if (strategy.fileTypes) {
        Logger.output(`\nFile Types: ${strategy.fileTypes().join(', ')}`);
      }

      if (strategy.commands) {
        Logger.output('\nCommands:');
        Object.entries(strategy.commands).forEach(([cmd, details]) => {
          Logger.output(`  - ${strategy.name}:${cmd} ${styles().muted(`- ${details.description}`)}`);
        });
      }

      const context = new StrategyContextImpl(process.cwd());
      const detected = normalizeDetectedStrategy(
        strategy,
        await strategy.detect(context)
      );
      Logger.output(`\nDetected in current project: ${detected ? styles().success('Yes') : styles().error('No')}`);
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
        if (!projectStrategiesAllowed()) {
          Logger.warn(
            `TypeScript strategies run code and are not loaded from a project unless ${PROJECT_STRATEGIES_ENV}=1 is set; ` +
            `use --yaml for a declarative strategy that always loads.`
          );
        }
        Logger.output(`  1. Edit the strategy file to implement detection and analysis logic`);
        Logger.output(`  2. Run 'xray strategy detect' to verify it works`);
        Logger.output(`  3. Test with 'xray ${name}:info'`);
      }
    });

  program
    .command('install <source>')
    .description('Install a strategy from a path or npm package')
    .action(async (source) => {
      const loader = new StrategyLoader();

      try {
        await installStrategy(source, loader);
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

      // Local file in a user-managed directory; never built-in, never node_modules.
      const removedFile = loader.findRemovableStrategyFile(name);

      // Installed package: by package name or strategy name, from package.json only.
      const { found, refused } = findInstalledStrategyPackage(name);

      if (removedFile) {
        fs.unlinkSync(removedFile);
        Logger.success(`Strategy removed: ${removedFile}`);
        if (found.length > 0) {
          Logger.warn(
            `The installed package ${found.map(f => f.name).join(', ')} was not removed; ` +
            `run \`xray strategy remove ${found[0].name}\` to remove it.`
          );
        }
        return;
      }

      if (found.length > 1) {
        throw new UsageError(
          `"${name}" matches several installed packages: ${found.map(f => f.name).join(', ')}. ` +
          `Name the package.`
        );
      }
      if (found.length === 1) {
        const target = found[0];
        try {
          uninstallStrategyPackage(target.name);
        } catch (err: any) {
          Logger.error(`Failed to remove strategy: ${err.message}`);
          process.exit(1);
        }
        Logger.success(`Strategy package removed: ${target.pkg.strategyName} (${target.name})`);
        return;
      }

      if (refused) {
        throw new UsageError(`${refused}; nothing was removed.`);
      }
      if (loader.isBuiltinStrategyFile(name)) {
        throw new UsageError(`"${name}" is a built-in strategy and cannot be removed.`);
      }
      reportSkippedProjectCode('warn');
      throw new NotFoundError(
        `Strategy "${name}" not found: no strategy file ${name}.{ts,js,yml,yaml} and no installed strategy package.`
      );
    });

  program
    .command('validate <name>')
    .description('Validate a strategy file')
    .action(async (name) => {
      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();
      const strategy = strategies.find(s => s.name === name);

      if (!strategy) {
        reportSkippedProjectCode('warn');
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
        Logger.output(`  Detection test: ${detected ? styles().success('Passed') : styles().warn('Not detected')}`);
      } catch (error: any) {
        Logger.output(`  Detection test: ${styles().error('Error')}`);
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
      reportSkippedProjectCode('warn');

      Logger.info('\nStrategy Search Paths:\n');
      paths.forEach((p, i) => {
        const exists = fs.existsSync(p);
        Logger.output(`  ${i + 1}. ${p} ${styles().muted(exists ? '' : '(not found)')}`);
      });
    });

  return program;
}
