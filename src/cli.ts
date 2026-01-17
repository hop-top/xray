#!/usr/bin/env node
import { Command } from 'commander';
import { Xray } from './index';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { QueryResolver } from './query-resolver';
import * as cliProgress from 'cli-progress';
import { Logger } from './logger';
import { loadConfig, mergeConfig, getScopes, getScope, mergeScopeWithBase, XrayScopeConfig } from './config';

const program = new Command();

program
  .name('xray')
  .description('X-ray your codebase - Generate AST, CFG, and DFG visualizations')
  .version('1.0.0');

// Common options for all commands
const addCommonOptions = (cmd: Command) => {
  return cmd
    .option('-p, --path <path>', 'Root directory to analyze (repeatable) [default: current directory]', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('-o, --output <path>', 'Output file path [default: .xray, auto-appends format extension if no extension given]')
    .option('-l, --limit <number>', 'Token limit [default: 4096]')
    .option('-w, --with <feature>', 'Include feature: vars, incs, cost, docs, df, cf (repeatable)', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('-a, --anchor <path>', 'Focus on specific file (Personalized PageRank)')
    .option('-d, --depth <number>', 'Maximum depth of tree to render')
    .option('-q, --query <item>', 'Override query (e.g. .ts:path, path/to/dir, url) (repeatable)', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('-m, --match <pattern>', 'Match filename pattern (prefix ! to negate) (repeatable)', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('-c, --catch <pattern>', 'Match function/class name (prefix ! to negate) (repeatable)', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('--txt', 'Output in text format (default)')
    .option('--csv', 'Output in CSV format')
    .option('--xml', 'Output in XML format')
    .option('--json', 'Output raw JSON graph')
    .option('--mermaid', 'Generate Mermaid diagram (default)')
    .option('--dot', 'Generate DOT diagram')
    .option('--config <path>', 'Path to config file (auto-detect if not specified)')
    .option('--preset <name>', 'Use named preset from config file')
    .option('--scope <name>', 'Use specific scope from config file')
    .option('--all-scopes', 'Run all scopes defined in config file');
};

// Helper to resolve paths relative to PWD
const resolvePath = (p: string | undefined): string | undefined => {
  if (!p) return undefined;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
};

// Helper to determine output path with smart extension handling
const resolveOutputPath = (outputOption: string | undefined, format: 'txt' | 'csv' | 'xml' | 'json'): string | undefined => {
  if (!outputOption) {
    // No output specified - use default .xray
    return path.resolve(process.cwd(), '.xray');
  }

  // If output starts with '.', use it as-is (e.g., .xray, .output)
  if (outputOption.startsWith('.')) {
    return resolvePath(outputOption);
  }

  // If output has an extension, use it as-is
  if (path.extname(outputOption)) {
    return resolvePath(outputOption);
  }

  // No extension - append format-based extension
  const extensions: Record<string, string> = {
    txt: '.txt',
    csv: '.csv',
    xml: '.xml',
    json: '.json'
  };

  return resolvePath(outputOption + extensions[format]);
};

// Helper function to run a single xray generation
const runSingleXray = async (mergedOptions: any, scopeName?: string) => {
  // Resolve paths relative to PWD
  const paths = (mergedOptions.path || [process.cwd()]).map(resolvePath).filter(Boolean) as string[];
  const anchor = resolvePath(mergedOptions.anchor);

  // Determine format first (needed for output path resolution)
  const format: 'txt' | 'csv' | 'xml' | 'json' =
    mergedOptions.json ? 'json' :
    mergedOptions.csv ? 'csv' :
    mergedOptions.xml ? 'xml' : 'txt';

  const outputPath = resolveOutputPath(mergedOptions.output, format);

  if (scopeName) {
    Logger.info(`Running scope: ${chalk.bold(scopeName)}`);
  }
  Logger.info(`Analyzing repo at: ${paths.join(', ')}`);

  // Parse features from --with flags
  const withFeatures = new Set(mergedOptions.with || []);
  const features = {
    vars: withFeatures.has('vars'),
    incs: withFeatures.has('incs'),
    docs: withFeatures.has('docs'),
    cost: withFeatures.has('cost'),
    cf: withFeatures.has('cf'),
    df: withFeatures.has('df'),
  };

  // Resolve queries
  const queries = QueryResolver.resolve(mergedOptions.query || []);

  // Determine diagram type
  const diagram: 'mermaid' | 'dot' = mergedOptions.dot ? 'dot' : 'mermaid';

  // Setup progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Parsing |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} Files || Current: {file}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });

  // Process each path and collect results
  const results = await Promise.all(
    paths.map(async (currentPath, i) => {
      if (paths.length > 1) {
        Logger.info(`\nProcessing path ${i + 1}/${paths.length}: ${currentPath}`);
      }

      let barStarted = false;

      const xray = new Xray({
        path: currentPath,
        limit: parseInt(mergedOptions.limit),
        anchor,
        depth: mergedOptions.depth ? parseInt(mergedOptions.depth) : undefined,
        features,
        queries,
        match: mergedOptions.match || [],
        catch: mergedOptions.catch || [],
        format,
        diagram,
        onProgress: (current, total, file) => {
          if (!barStarted) {
            progressBar.start(total, 0, { file: 'Starting...' });
            barStarted = true;
          }
          progressBar.update(current, { file });
          if (current >= total) {
            progressBar.stop();
          }
        }
      });

      const result = await xray.run();

      // Add path header for multi-path output
      if (paths.length > 1) {
        return `\n${'='.repeat(80)}\nPath: ${currentPath}\n${'='.repeat(80)}\n${result}`;
      }
      return result;
    })
  );

  const finalOutput = results.join('\n');

  fs.writeFileSync(outputPath!, finalOutput);
  Logger.success(`Analysis written to ${outputPath}`);
};

// Shared action handler for all generation commands
const handleGenerateAction = async (options: any) => {
  try {
    // Load config file
    const config = loadConfig(options.config);

    // Handle --all-scopes flag
    if (options.allScopes) {
      const scopes = getScopes(config);
      const scopeNames = Object.keys(scopes);

      if (scopeNames.length === 0) {
        Logger.error('No scopes defined in config file');
        process.exit(1);
      }

      Logger.info(`Running ${scopeNames.length} scopes: ${scopeNames.join(', ')}`);

      for (const scopeName of scopeNames) {
        const scopeConfig = scopes[scopeName];
        const mergedScope = config ? mergeScopeWithBase(config, scopeConfig) : scopeConfig;
        const mergedOptions = mergeConfig({ ...mergedScope } as any, {}, undefined);
        await runSingleXray(mergedOptions, scopeName);
      }

      return;
    }

    // Handle --scope flag
    if (options.scope) {
      const scopeConfig = getScope(config, options.scope);

      if (!scopeConfig) {
        Logger.error(`Scope "${options.scope}" not found in config file`);
        process.exit(1);
      }

      const mergedScope = config ? mergeScopeWithBase(config, scopeConfig) : scopeConfig;
      const mergedOptions = mergeConfig({ ...mergedScope } as any, options, undefined);
      await runSingleXray(mergedOptions, options.scope);

      return;
    }

    // Regular flow: merge config with CLI options
    const mergedOptions = mergeConfig(config, options, options.preset);
    await runSingleXray(mergedOptions);

  } catch (error) {
    Logger.error('Error generating analysis:', error);
    process.exit(1);
  }
};

// Map command (most commonly used - generates visual map)
addCommonOptions(program.command('map'))
  .description('Generate visual map of codebase [default command]')
  .action(handleGenerateAction);

// Scan command - file system discovery
addCommonOptions(program.command('scan'))
  .description('Scan and discover files in codebase')
  .action(handleGenerateAction);

// Graph command - generate graph structures (CFG/DFG)
addCommonOptions(program.command('graph'))
  .description('Generate control flow (CFG) and data flow (DFG) graphs')
  .action(handleGenerateAction);

// Generate command (kept for backwards compatibility)
addCommonOptions(program.command('generate'))
  .description('Generate code analysis visualization [alias: map]')
  .action(handleGenerateAction);

program
  .command('clear-cache')
  .description('Clear SQLite cache (.xray_cache.db)')
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
