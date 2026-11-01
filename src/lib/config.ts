import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';
import {
  XrayScopeConfig,
  XrayConfig,
  XrayExtensionConfig,
} from '../types/xray-config';
import { FileReadError, FileWriteError, NotFoundError, UsageError } from './error/types';

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
const { configDir: xdgConfigDir } = require('@hop-top/kit/xdg') as {
  configDir: (tool: string) => string;
};

let configPathLogged = false;

const CONFIG_FILENAMES = [
  '.xrayrc',
  '.xrayrc.json',
  '.xrayrc.js',
  'xray.config.js',
  'xray.config.json',
];

/**
 * Find config file by walking up the directory tree
 * Stops BEFORE entering home directory to avoid treating global configs as project configs
 * Returns the absolute path to the config file, or null if not found
 */
export function findConfigPath(startDir?: string): string | null {
  const searchDir = startDir || process.cwd();
  let currentDir = path.resolve(searchDir);
  const root = path.parse(currentDir).root;
  // Resolve symlinks to ensure proper comparison (e.g., /var vs /private/var on macOS)
  const homeDir = fs.realpathSync(os.homedir());

  // Walk up directory tree
  while (currentDir !== root) {
    // Get the real path for comparison (resolve symlinks)
    const realCurrentDir = fs.existsSync(currentDir) ? fs.realpathSync(currentDir) : currentDir;

    // Skip searching in home directory itself (those are global configs)
    if (realCurrentDir !== homeDir) {
      // Check all config filenames
      for (const filename of CONFIG_FILENAMES) {
        const filepath = path.join(currentDir, filename);
        if (fs.existsSync(filepath)) {
          return filepath;
        }
      }

      // Check package.json
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const content = fs.readFileSync(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(content);
          if (packageJson.xray) {
            return packageJsonPath;
          }
        } catch (err: any) {
          // Ignore package.json parsing errors (both read and parse errors)
          if (err.code !== 'ENOENT') {
            Logger.debug(`Failed to read/parse package.json: ${err.message}`);
          }
        }
      }
    }

    // Stop if we've reached home directory
    if (realCurrentDir === homeDir) {
      break;
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached root
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Directories searched for a global `config.json` / `config.js`, highest
 * priority first: the kit XDG config dir, then the legacy
 * `$XDG_CONFIG_HOME|~/.config/xray` location (differs from the kit dir on
 * macOS/Windows when XDG_CONFIG_HOME is unset), so pre-existing user config
 * keeps resolving.
 */
export function globalConfigDirs(): string[] {
  const legacy = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'xray'
  );
  const kit = xdgConfigDir('xray');
  return kit === legacy ? [kit] : [kit, legacy];
}

/**
 * Find global config file.
 * Order: <kit config dir>/config.{json,js}, legacy ~/.config/xray/config.{json,js},
 * then ~/.xrayrc.json, ~/.xrayrc.
 * Returns the absolute path to the global config, or null if not found
 */
export function findGlobalConfigPath(): string | null {
  const homeDir = os.homedir();

  for (const dir of globalConfigDirs()) {
    for (const filename of ['config.json', 'config.js']) {
      const filepath = path.join(dir, filename);
      if (fs.existsSync(filepath)) {
        return filepath;
      }
    }
  }

  // Fallback to home directory dotfiles
  for (const filename of ['.xrayrc.json', '.xrayrc']) {
    const filepath = path.join(homeDir, filename);
    if (fs.existsSync(filepath)) {
      return filepath;
    }
  }

  return null;
}

/**
 * Load only the global (per-user) config, never merged with project config.
 * Returns null when no global config exists.
 */
export function loadGlobalConfig(): XrayConfig | null {
  const globalPath = findGlobalConfigPath();
  return globalPath ? loadConfigFile(globalPath) : null;
}

/**
 * Deep merge two config objects
 * Project config takes precedence over global config
 */
function mergeSingleExtensionConfig(
  base: XrayExtensionConfig | undefined,
  override: XrayExtensionConfig | undefined
): XrayExtensionConfig | undefined {
  if (!base) return override;
  if (!override) return base;

  // --extension-hint semantics are additive ("Add an extension hint at
  // runtime") so override hints concatenate onto base hints; only when
  // override has no hints do we fall back to the base array.
  const mergedHints = override.hints
    ? Array.from(new Set([...(base.hints ?? []), ...override.hints]))
    : base.hints;

  const merged: XrayExtensionConfig = {
    ...base,
    ...override,
    hints: mergedHints,
  };

  if (base.enabledSurfaces || override.enabledSurfaces) {
    merged.enabledSurfaces = {
      ...(base.enabledSurfaces || {}),
      ...(override.enabledSurfaces || {}),
    };
  }

  if (base.config || override.config) {
    merged.config = {
      ...(base.config || {}),
      ...(override.config || {}),
    };
  }

  return merged;
}

function mergeExtensionConfigs(
  base: Record<string, XrayExtensionConfig> | undefined,
  override: Record<string, XrayExtensionConfig> | undefined
): Record<string, XrayExtensionConfig> | undefined {
  if (!base && !override) {
    return undefined;
  }

  const merged: Record<string, XrayExtensionConfig> = {
    ...(base || {}),
  };

  for (const [name, config] of Object.entries(override || {})) {
    merged[name] = mergeSingleExtensionConfig(base?.[name], config)!;
  }

  return merged;
}

function mergeConfigs(global: XrayConfig | null, project: XrayConfig | null): XrayConfig | null {
  if (!global && !project) return null;
  if (!global) return project;
  if (!project) return global;

  // Deep merge logic
  const merged: XrayConfig = { ...global };

  // Merge top-level properties
  Object.keys(project).forEach(key => {
    const projectValue = (project as any)[key];
    const globalValue = (merged as any)[key];

    if (projectValue === undefined || projectValue === null) {
      return; // Keep global value
    }

    if (key === 'extensions') {
      merged.extensions = mergeExtensionConfigs(
        global.extensions,
        project.extensions
      );
      return;
    }

    // Deep merge for objects
    if (typeof projectValue === 'object' && !Array.isArray(projectValue) &&
        typeof globalValue === 'object' && !Array.isArray(globalValue)) {
      (merged as any)[key] = { ...globalValue, ...projectValue };
    } else {
      // Override for primitives and arrays
      (merged as any)[key] = projectValue;
    }
  });

  return merged;
}

/**
 * Load configuration from the project directory
 * Supports directory tree walking and global config merging
 */
export function loadConfig(
  configPath?: string,
  searchPath?: string,
  options: { projectCode?: boolean } = {}
): XrayConfig | null {
  const projectCode = options.projectCode ?? true;

  // If explicit path provided, use it (no merging)
  if (configPath) {
    const absPath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
    if (fs.existsSync(absPath)) {
      return loadConfigFile(absPath);
    } else {
      Logger.warn(`Config file not found: ${configPath}`);
      return null;
    }
  }

  // Find global config
  const globalConfigPath = findGlobalConfigPath();
  const globalConfig = globalConfigPath ? loadConfigFile(globalConfigPath) : null;

  // Find project config by walking up directory tree
  let projectConfigPath = findConfigPath(searchPath);
  if (projectConfigPath && !projectCode && path.extname(projectConfigPath) === '.js') {
    // JS config is code; without project code only data configs load.
    Logger.debug(`Skipping JS project config: ${projectConfigPath}`);
    projectConfigPath = null;
  }
  const projectConfig = projectConfigPath ? loadConfigFile(projectConfigPath) : null;

  if (projectConfigPath && !searchPath && !configPathLogged) {
    configPathLogged = true;
    const relativePath = path.relative(process.cwd(), projectConfigPath);
    const displayPath = relativePath.startsWith('..') ? projectConfigPath : relativePath;
    Logger.debug(`Using config file: ${displayPath}`);
  }

  // Merge configs (project overrides global)
  return mergeConfigs(globalConfig, projectConfig);
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
      let content: string;
      try {
        content = fs.readFileSync(filepath, 'utf-8');
      } catch (err: any) {
        throw new FileReadError(filepath, err);
      }
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
    extensions: mergeExtensionConfigs(
      baseConfig.extensions,
      scopeConfig.extensions
    ),
    anchor: scopeConfig.anchor || baseConfig.anchor,
    depth: scopeConfig.depth || baseConfig.depth,
    match: scopeConfig.match || baseConfig.match,
    catch: scopeConfig.catch || baseConfig.catch,
    format: scopeConfig.format || baseConfig.format,
    diagram: scopeConfig.diagram || baseConfig.diagram,
    queries: scopeConfig.queries || baseConfig.queries,
    json: scopeConfig.json !== undefined ? scopeConfig.json : baseConfig.json,
    chunked: scopeConfig.chunked !== undefined ? scopeConfig.chunked : (baseConfig.chunked !== undefined ? baseConfig.chunked : true),
  };
}

/**
 * Whether `filepath` holds plain JSON config that `saveConfig` can
 * rewrite: not JS (code) and not package.json (a manifest).
 */
export function isWritableConfigFile(filepath: string): boolean {
  const base = path.basename(filepath);
  if (base === 'package.json') return false;
  const ext = path.extname(base);
  return ext === '.json' || base === '.xrayrc';
}

/**
 * Save config to .xrayrc.json
 */
export function saveConfig(config: XrayConfig, configPath?: string): void {
  const resolvedPath = configPath || path.join(process.cwd(), '.xrayrc.json');

  // Pretty print with 2-space indent
  const json = JSON.stringify(config, null, 2);

  try {
    fs.writeFileSync(resolvedPath, json, 'utf-8');
  } catch (err: any) {
    throw new FileWriteError(resolvedPath, err);
  }
}

/** Where the scan roots in merged options came from. */
export type ScanRootSource = 'cli' | 'config';

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Config file that supplied the scan roots: root `--config`, else the
 * discovered project config when it sets `paths`/`scopes` (project
 * overrides global), else the global config. JS/unreadable project
 * config is assumed to be the source.
 */
function findPathsConfigFile(configPath?: string): string | null {
  if (configPath) return path.resolve(configPath);
  const project = findConfigPath();
  const global = findGlobalConfigPath();
  if (!project || !global || path.extname(project) === '.js') return project ?? global;
  try {
    // Same parse as loadConfigFile.
    const cfg = JSON.parse(fs.readFileSync(project, 'utf-8'));
    return cfg && (cfg.paths || cfg.scopes) ? project : global;
  } catch {
    return project;
  }
}

/**
 * Drop scan roots that are missing or not directories, before any scan.
 * Config roots: warn (root + config file it came from), skip; none left ->
 * NotFoundError. CLI roots: any missing -> NotFoundError (a typo must not
 * yield an empty map). `configPath` is root `--config`, else discovery
 * (same lookup as `xray paths`) names the file.
 */
export function validateScanRoots(
  roots: string[],
  source: ScanRootSource,
  configPath?: string
): string[] {
  const missing = roots.filter(r => !isDirectory(r));
  if (missing.length === 0) return roots;

  if (source === 'cli') {
    throw new NotFoundError(`Path does not exist or is not a directory: ${missing.join(', ')}`);
  }

  const configFile = findPathsConfigFile(configPath) ?? 'config file';
  for (const r of missing) {
    Logger.warn(`Skipping scan path from ${configFile}: ${r} does not exist or is not a directory`);
  }
  const kept = roots.filter(r => !missing.includes(r));
  if (kept.length === 0) {
    throw new NotFoundError(
      `No configured scan path exists (paths in ${configFile}: ${missing.join(', ')}); fix "paths" or pass --path`
    );
  }
  return kept;
}

/**
 * Config files `loadConfig` consults for these options: root `--config`
 * alone, else the discovered project config then the global one.
 */
function consultedConfigFiles(configPath?: string, searchPath?: string): string[] {
  if (configPath) return [path.resolve(configPath)];
  return [findConfigPath(searchPath), findGlobalConfigPath()].filter((p): p is string => Boolean(p));
}

/**
 * `--lens <name>` must name a lens under `lenses`; otherwise UsageError
 * (exit 2) naming the lens, the config file(s) consulted and known lenses.
 */
function assertLensDefined(config: XrayConfig | null, lens: string, cliOptions: any): void {
  if (config?.lenses && Object.prototype.hasOwnProperty.call(config.lenses, lens)) return;
  const files = consultedConfigFiles(cliOptions?.config, cliOptions?.path?.[0]);
  const known = Object.keys(config?.lenses || {});
  if (!config) {
    const where = cliOptions?.config ? ` (${path.resolve(cliOptions.config)} not loaded)` : '';
    throw new UsageError(
      `Unknown lens "${lens}": no config file found${where}; define "lenses" in .xrayrc.json`
    );
  }
  const source = files.length > 0 ? files.join(', ') : 'config';
  if (known.length === 0) {
    throw new UsageError(`Unknown lens "${lens}": no lenses defined in ${source}`);
  }
  throw new UsageError(`Unknown lens "${lens}" in ${source}; known lenses: ${known.join(', ')}`);
}

/**
 * Merge CLI options with config file, with CLI taking precedence.
 * Throws UsageError when `lens` is not defined in `config.lenses`.
 */
export function mergeConfig(config: XrayConfig | null, cliOptions: any, lens?: string): any {
  if (lens) assertLensDefined(config, lens, cliOptions);

  // No config file: resolve CLI options against an empty base so the
  // result has the same shape (chunked, outputFormat, ...) as with one.
  if (!config) {
    config = {} as XrayConfig;
  }

  // If lens specified, use it as base. Deep-merge features so a lens
  // that sets only one feature does not wipe out base features set at
  // the top-level config (matches `mergeScopeWithBase` semantics).
  let baseConfig = config;
  if (lens && config.lenses) {
    const lensConfig = config.lenses[lens];
    Logger.debug(`Using lens: ${lens}`);
    baseConfig = {
      ...config,
      ...lensConfig,
      features: {
        ...(config.features || {}),
        ...(lensConfig.features || {}),
      },
      extensions: mergeExtensionConfigs(
        config.extensions,
        lensConfig.extensions
      ),
    };
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
    path: cliOptions.path && cliOptions.path.length > 0 ? cliOptions.path : (baseConfig.paths || []),
    pathSource: (cliOptions.path && cliOptions.path.length > 0 ? 'cli' : 'config') as ScanRootSource,
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
    // Resolved selection (see resolveFormatFlags): CLI beats config, and a
    // CLI choice on an axis must not be re-overridden by config booleans.
    outputFormat: cliOptions.outputFormat ?? (baseConfig.json ? 'json' : baseConfig.format),
    outputDiagram: cliOptions.outputDiagram ?? baseConfig.diagram,
    chunked: cliOptions.chunk !== false && (cliOptions.chunk ?? (baseConfig.chunked !== false)),
    detect: cliOptions.detect ?? false,
    languages: cliOptions.lang && cliOptions.lang.length > 0 ? cliOptions.lang : baseConfig.languages,
    skipDetect: cliOptions.skipDetect ?? baseConfig.skipDetect ?? false,
    share: cliOptions.share ?? baseConfig.share ?? false,
    extensions: mergeExtensionConfigs(
      baseConfig.extensions,
      cliOptions.extensions
    ) || {},
    // Forward plugin preset specs and the selected lens name so the
    // CLI dispatcher in `src/commands/generate.ts` can read them back
    // out of the merged options object. Without these two fields,
    // `--preset insights` and `--lens quick` silently no-op whenever
    // a config file is present.
    preset: cliOptions.preset || [],
    lens,
    with: Object.entries(features)
      .filter(([_, enabled]) => enabled)
      .map(([feature, _]) => feature),
  };
}
