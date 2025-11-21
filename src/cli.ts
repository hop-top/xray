import { Command } from 'commander';
import { Xray } from './index';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { QueryResolver } from './query-resolver';
import * as cliProgress from 'cli-progress';
import { Logger } from './logger';

const program = new Command();

program
  .name('xray')
  .description('X-ray your codebase - Generate AST, CFG, and DFG visualizations')
  .version('1.0.0');

program
  .command('generate')
  .description('Generate a code analysis visualization')
  .option('-r, --root <path>', 'Root directory of the repository', process.cwd())
  .option('-o, --output <path>', 'Output file path')
  .option('-t, --tokens <number>', 'Token limit', '4096')
  .option('--include-variables', 'Include local variables and constants in output', false)
  .option('--doc <config>', 'Include docstrings (all, none, or comma-separated list of kinds like class,function)', 'none')
  .option('--focus <path>', 'Focus on a specific file (Personalized PageRank)')
  .option('--max-depth <number>', 'Maximum depth of the tree to render')
  .option('--with-cost', 'Estimate and display the cost of the generated output', false)
  .option('--cfg', 'Enable Control Flow Graph (CFG) generation for functions/methods', false)
  .option('--dfg', 'Enable Data Flow Graph (DFG) generation for functions/methods', false)
  .option('--json', 'Output raw JSON graph instead of tree')
  .option('-q, --query <items...>', 'Override queries (e.g. .ts:path, path/to/dir, url)', [])
  .action(async (options) => {
    try {
      Logger.info(`Analyzing repo at: ${options.root}`);

      // Resolve queries
      const queries = QueryResolver.resolve(options.query || []);

      const progressBar = new cliProgress.SingleBar({
        format: 'Parsing |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} Files || Current: {file}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
      });

      let barStarted = false;

      const codegraph = new Xray({
        root: options.root,
        tokenLimit: parseInt(options.tokens),
        includeVariables: options.includeVariables || false,
        doc: options.doc,
        focus: options.focus,
        maxDepth: options.maxDepth ? parseInt(options.maxDepth) : undefined,
        withCost: options.withCost || false,
        enableCfg: options.cfg || false,
        enableDfg: options.dfg || false,
        queries: queries,
        onProgress: (current, total, file) => {
          if (!barStarted) {
            progressBar.start(total, 0, { file: 'Starting...' });
            barStarted = true;
          }
          progressBar.update(current, { file: file });
          if (current >= total) {
            progressBar.stop();
          }
        }
      });

      const result = await codegraph.run();

      if (options.output) {
        fs.writeFileSync(options.output, result);
        Logger.success(`Analysis written to ${options.output}`);
      } else {
        console.log(result);
      }
    } catch (error) {
      Logger.error('Error generating analysis:', error);
      process.exit(1);
    }
  });

program
  .command('clear-cache')
  .description('Clear the SQLite cache')
  .action(() => {
    const cachePath = path.join(process.cwd(), '.xray_cache.db');
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      Logger.success('Cache cleared.');
    } else {
      Logger.warn('No cache found.');
    }
  });

program.parse();
