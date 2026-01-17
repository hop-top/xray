#!/usr/bin/env node
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

// Common options for all commands
const addCommonOptions = (cmd: Command) => {
  return cmd
    .option('-p, --path <paths...>', 'Root directories of the repository (repeatable)', [process.cwd()])
    .option('-o, --output <path>', 'Output file path')
    .option('-l, --limit <number>', 'Token limit', '4096')
    .option('-w, --with <feature>', 'Include features: vars, incs, cost, docs, df, cf (repeatable)', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('-a, --anchor <path>', 'Focus on a specific file (Personalized PageRank)')
    .option('-d, --depth <number>', 'Maximum depth of the tree to render')
    .option('--json', 'Output raw JSON graph instead of tree')
    .option('-q, --query <items...>', 'Override queries (e.g. .ts:path, path/to/dir, url)', [])
    .option('-m, --match <patterns...>', 'Match filename patterns (repeatable, prefix with ! to negate)', [])
    .option('-c, --catch <patterns...>', 'Match function/class names (repeatable, prefix with ! to negate)', [])
    .option('--csv', 'Output in CSV format')
    .option('--xml', 'Output in XML format')
    .option('--txt', 'Output in text format (default)')
    .option('--mermaid', 'Generate Mermaid diagram (default)')
    .option('--dot', 'Generate DOT diagram');
};

// Shared action handler for all generation commands
const handleGenerateAction = async (options: any) => {
  try {
    // Resolve paths relative to PWD
    const paths = (options.path || [process.cwd()]).map((p: string) =>
      path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
    );
    const anchor = options.anchor ?
      (path.isAbsolute(options.anchor) ? options.anchor : path.resolve(process.cwd(), options.anchor)) :
      undefined;
    const outputPath = options.output ?
      (path.isAbsolute(options.output) ? options.output : path.resolve(process.cwd(), options.output)) :
      undefined;

    Logger.info(`Analyzing repo at: ${paths.join(', ')}`);

    // Parse --with features
    const withFeatures = options.with || [];
    const includeVariables = withFeatures.includes('vars');
    const includeImports = withFeatures.includes('incs');
    const includeDocs = withFeatures.includes('docs');
    const withCost = withFeatures.includes('cost');
    const enableDfg = withFeatures.includes('df');
    const enableCfg = withFeatures.includes('cf');

    // Resolve queries
    const queries = QueryResolver.resolve(options.query || []);

    // Determine format (only one allowed)
    let format: 'txt' | 'csv' | 'xml' = 'txt'; // default
    if (options.csv) format = 'csv';
    else if (options.xml) format = 'xml';

    // Determine diagram type (only one allowed)
    let diagram: 'mermaid' | 'dot' = 'mermaid'; // default
    if (options.dot) diagram = 'dot';

    const progressBar = new cliProgress.SingleBar({
      format: 'Parsing |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} Files || Current: {file}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    let barStarted = false;

    // Process multiple paths
    const results: string[] = [];

    for (let i = 0; i < paths.length; i++) {
      const currentPath = paths[i];

      if (paths.length > 1) {
        Logger.info(`\nProcessing path ${i + 1}/${paths.length}: ${currentPath}`);
      }

      barStarted = false; // Reset for each path

      const codegraph = new Xray({
        path: currentPath,
        limit: parseInt(options.limit),
        anchor,
        depth: options.depth ? parseInt(options.depth) : undefined,
        features: {
          vars: includeVariables,
          incs: includeImports,
          docs: includeDocs,
          cost: withCost,
          cf: enableCfg,
          df: enableDfg,
        },
        queries: queries,
        match: options.match || [],
        catch: options.catch || [],
        format,
        diagram,
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

      // Add path header for multi-path output
      if (paths.length > 1) {
        results.push(`\n${'='.repeat(80)}`);
        results.push(`Path: ${currentPath}`);
        results.push('='.repeat(80));
        results.push(result);
      } else {
        results.push(result);
      }
    }

    const finalOutput = results.join('\n');

    if (outputPath) {
      fs.writeFileSync(outputPath, finalOutput);
      Logger.success(`Analysis written to ${outputPath}`);
    } else {
      console.log(finalOutput);
    }
  } catch (error) {
    Logger.error('Error generating analysis:', error);
    process.exit(1);
  }
};

// Map command (most commonly used - generates visual map)
addCommonOptions(program.command('map'))
  .description('Generate a visual map of your codebase (most common)')
  .action(handleGenerateAction);

// Scan command - file system discovery
addCommonOptions(program.command('scan'))
  .description('Scan and discover files in your codebase')
  .action(handleGenerateAction);

// Graph command - generate graph structures (CFG/DFG)
addCommonOptions(program.command('graph'))
  .description('Generate control flow and data flow graphs')
  .action(handleGenerateAction);

// Generate command (kept for backwards compatibility)
addCommonOptions(program.command('generate'))
  .description('Generate a code analysis visualization (alias for map)')
  .action(handleGenerateAction);

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
