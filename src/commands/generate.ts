import { Xray } from '../lib/xray';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { QueryResolver } from '../lib/query-resolver';
import * as cliProgress from 'cli-progress';
import { Logger } from '../lib/logger';
import { loadConfig, mergeConfig, getScopes, getScope, mergeScopeWithBase } from '../lib/config';
import { FileScanner } from '../lib/scanner';
import { StrategyLoader } from '../lib/strategy/loader';
import { StrategyDetector } from '../lib/strategy/detector';
import { StrategyContextImpl } from '../lib/strategy/context';
import { StrategyRunner } from '../lib/strategy/runner';
import { XrayScopeConfig } from '../types/xray-config';
import { resolvePath, resolveOutputPath } from './common';

// Helper function to run a single xray generation
export const runSingleXray = async (mergedOptions: any, scopeName?: string) => {
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
export const handleGenerateAction = async (options: any) => {
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