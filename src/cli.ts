import { Command } from 'commander';
import { RepoMap } from './index';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

const program = new Command();

program
  .name('repomap')
  .description('Generate a token-bounded repository map using Tree-sitter and PageRank')
  .version('1.0.0');

program
  .command('generate')
  .description('Generate a repository map')
  .option('-r, --root <path>', 'Root directory of the repository', process.cwd())
  .option('-o, --output <path>', 'Output file path')
  .option('-t, --tokens <number>', 'Token limit', '4096')
  .option('--include-variables', 'Include local variables and constants in output', false)
  .option('--doc <config>', 'Include docstrings (all, none, or comma-separated list of kinds like class,function)', 'none')
  .option('--focus <path>', 'Focus on a specific file (Personalized PageRank)')
  .option('--json', 'Output raw JSON graph instead of tree')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`Analyzing repo at: ${options.root}`));

      const repoMap = new RepoMap({
        root: options.root,
        tokenLimit: parseInt(options.tokens),
        includeVariables: options.includeVariables || false,
        doc: options.doc,
        focus: options.focus,
      });

      const result = await repoMap.run();

      if (options.output) {
        fs.writeFileSync(options.output, result);
        console.log(chalk.green(`Map written to ${options.output}`));
      } else {
        console.log(result);
      }
    } catch (error) {
      console.error(chalk.red('Error generating map:'), error);
      process.exit(1);
    }
  });

program
  .command('clear-cache')
  .description('Clear the SQLite cache')
  .action(() => {
    const cachePath = path.join(process.cwd(), '.repomap_cache.db');
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      console.log(chalk.green('Cache cleared.'));
    } else {
      console.log(chalk.yellow('No cache found.'));
    }
  });

program.parse();
