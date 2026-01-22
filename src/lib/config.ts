import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { XrayScopeConfig, XrayConfig } from '../types/xray-config';

const CONFIG_FILENAMES = [
  '.xrayrc',
  '.xrayrc.json',
  '.xrayrc.js',
  'xray.config.js',
  'xray.config.json',
];

/**
 * Load configuration from the project directory
 */
export function loadConfig(configPath?: string): XrayConfig | null {
  // If explicit path provided, use it
  if (configPath) {
    const absPath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
    if (fs.existsSync(absPath)) {
      return loadConfigFile(absPath);
    } else {
      Logger.warn(`Config file not found: ${configPath}`);
      return null;
    }
  }

  // Search for config files in project root
  const cwd = process.cwd();
  for (const filename of CONFIG_FILENAMES) {
    const filepath = path.join(cwd, filename);
    if (fs.existsSync(filepath)) {
      Logger.info(`Using config file: ${filename}`);
      return loadConfigFile(filepath);
    }
  }

  // Check package.json for xray config
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.xray) {
        Logger.info('Using config from package.json');
        return packageJson.xray as XrayConfig;
      }
    } catch (error) {
      // Ignore package.json parsing errors
    }
  }

  return null;
}

/**
 * Load and parse a configuration file
 */
function loadConfigFile(filepath: string): XrayConfig {
  const ext = path.extname(filepath);

  try {
    if (ext === '.js') {
      // For .js files, use dynamic import (CommonJS)
      delete require.cache[require.resolve(filepath)];
      const config = require(filepath);
      return config.default || config;
    } else {
      // For .json files and others, parse as JSON
      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content) as XrayConfig;
    }
  } catch (error) {
    Logger.error(`Failed to load config file: ${filepath}`, error);
    throw error;
  }
}

/**
 * Get all scopes from config
 */
export function getScopes(config: XrayConfig | null): { [name: string]: XrayScopeConfig } {
  if (!config || !config.scopes) {
    return {};
  }
  return config.scopes;
}

/**
 * Get a specific scope by name
 */
export function getScope(config: XrayConfig | null, scopeName: string): XrayScopeConfig | null {
  if (!config || !config.scopes || !config.scopes[scopeName]) {
    return null;
  }
  return config.scopes[scopeName];
}

/**
 * Merge base config with scope config
 */
export function mergeScopeWithBase(baseConfig: XrayConfig, scopeConfig: XrayScopeConfig): XrayScopeConfig {
  return {
    paths: scopeConfig.paths || baseConfig.paths,
    output: scopeConfig.output || baseConfig.output,
    limit: scopeConfig.limit || baseConfig.limit,
    features: { ...(baseConfig.features || {}), ...(scopeConfig.features || {}) },
    anchor: scopeConfig.anchor || baseConfig.anchor,
    depth: scopeConfig.depth || baseConfig.depth,
    match: scopeConfig.match || baseConfig.match,
    catch: scopeConfig.catch || baseConfig.catch,
    format: scopeConfig.format || baseConfig.format,
    diagram: scopeConfig.diagram || baseConfig.diagram,
    queries: scopeConfig.queries || baseConfig.queries,
    json: scopeConfig.json !== undefined ? scopeConfig.json : baseConfig.json,
  };
}

/**
 * Merge CLI options with config file, with CLI taking precedence
 */
export function mergeConfig(config: XrayConfig | null, cliOptions: any, preset?: string): any {
  if (!config) {
    return cliOptions;
  }

  // If preset specified, use it as base
  let baseConfig = config;
  if (preset && config.presets && config.presets[preset]) {
    Logger.info(`Using preset: ${preset}`);
    baseConfig = { ...config, ...config.presets[preset] };
  }

  // Merge features
  const features = {
    ...(baseConfig.features || {}),
  };

  // CLI --with flags override config features
  const withFeatures = cliOptions.with || [];
  if (withFeatures.length > 0) {
    withFeatures.forEach((feature: string) => {
      if (feature === 'vars') features.vars = true;
      else if (feature === 'incs') features.incs = true;
      else if (feature === 'docs') features.docs = true;
      else if (feature === 'cost') features.cost = true;
      else if (feature === 'cf') features.cf = true;
      else if (feature === 'df') features.df = true;
    });
  }

  // Build final options with CLI taking precedence
  return {
    path: cliOptions.path && cliOptions.path.length > 0 ? cliOptions.path : (baseConfig.paths || [process.cwd()]),
    output: cliOptions.output || baseConfig.output,
    limit: cliOptions.limit || baseConfig.limit?.toString() || '4096',
    anchor: cliOptions.anchor || baseConfig.anchor,
    depth: cliOptions.depth || baseConfig.depth?.toString(),
    match: cliOptions.match && cliOptions.match.length > 0 ? cliOptions.match : (baseConfig.match || []),
    catch: cliOptions.catch && cliOptions.catch.length > 0 ? cliOptions.catch : (baseConfig.catch || []),
    query: cliOptions.query && cliOptions.query.length > 0 ? cliOptions.query : (baseConfig.queries || []),
    json: cliOptions.json ?? baseConfig.json ?? false,
    csv: cliOptions.csv || baseConfig.format === 'csv',
    xml: cliOptions.xml || baseConfig.format === 'xml',
    txt: cliOptions.txt || baseConfig.format === 'txt',
    dot: cliOptions.dot || baseConfig.diagram === 'dot',
    mermaid: cliOptions.mermaid || baseConfig.diagram === 'mermaid',
    with: Object.entries(features)
      .filter(([_, enabled]) => enabled)
      .map(([feature, _]) => feature),
  };
}
