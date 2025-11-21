import { Command } from 'commander';
import { Xray } from './index';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

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
  .option('--cfg', 'Enable Control Flow Graph (CFG) generation for functions/methods', false)
  .option('--dfg', 'Enable Data Flow Graph (DFG) generation for functions/methods', false)
  .option('--json', 'Output raw JSON graph instead of tree')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`Analyzing repo at: ${options.root}`));

      const codegraph = new Xray({
        root: options.root,
        tokenLimit: parseInt(options.tokens),
        includeVariables: options.includeVariables || false,
        doc: options.doc,
        focus: options.focus,
        enableCfg: options.cfg || false,
        enableDfg: options.dfg || false,
      });

      const result = await codegraph.run();

      if (options.output) {
        fs.writeFileSync(options.output, result);
        console.log(chalk.green(`Analysis written to ${options.output}`));
      } else {
        console.log(result);
      }
    } catch (error) {
      console.error(chalk.red('Error generating analysis:'), error);
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
      console.log(chalk.green('Cache cleared.'));
    } else {
      console.log(chalk.yellow('No cache found.'));
    }
  });

program.parse();
