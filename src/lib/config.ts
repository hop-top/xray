import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';
import {
  XrayScopeConfig,
  XrayConfig,
  XrayExtensionConfig,
} from '../types/xray-config';
import { assertPatternLengths, quotePattern } from './path-match';
import { isWithin, realpathLoose } from './confine';
import { terminalSafe } from './terminal-safe';
import { FileReadError, FileWriteError, NotFoundError, UsageError } from './error/types';

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
const { configDir: xdgConfigDir } = require('@hop-top/kit/xdg') as {
  configDir: (tool: string) => string;
};

let configPathLogged = false;

const CONFIG_FILENAMES = [
  '.xrayrc',
  '.xrayrc.json',
  'xray.config.json',
];

/** Config that is code, not data: never discovered, never loaded. */
const CODE_CONFIG_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

/** Legacy code configs a directory walk skips; noted once each at debug level. */
const IGNORED_CODE_CONFIGS = ['.xrayrc.js', 'xray.config.js'];
const notedCodeConfigs = new Set<string>();

/**
 * Reject a config path that would be executed rather than parsed. Config
 * is JSON only; the file is not opened.
 */
export function assertDataConfig(filepath: string): void {
  if (CODE_CONFIG_EXTENSIONS.has(path.extname(filepath).toLowerCase())) {
    throw new UsageError(
      `config file ${filepath} is JavaScript, which xray does not load; use .xrayrc.json`
    );
  }
}

function noteIgnoredCodeConfigs(dir: string): void {
  for (const filename of IGNORED_CODE_CONFIGS) {
    const filepath = path.join(dir, filename);
    if (!notedCodeConfigs.has(filepath) && fs.existsSync(filepath)) {
      notedCodeConfigs.add(filepath);
      Logger.debug(`Ignoring ${filepath}: JavaScript config is not loaded; use .xrayrc.json`);
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

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
      noteIgnoredCodeConfigs(currentDir);

      // Check package.json
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const content = fs.readFileSync(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(content);
          if (isPlainObject(packageJson.xray)) {
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
 * Directories searched for a global `config.json`, highest
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
 * Order: <kit config dir>/config.json, legacy ~/.config/xray/config.json,
 * then ~/.xrayrc.json, ~/.xrayrc.
 * Returns the absolute path to the global config, or null if not found
 */
export function findGlobalConfigPath(): string | null {
  const homeDir = os.homedir();

  for (const dir of globalConfigDirs()) {
    const filepath = path.join(dir, 'config.json');
    if (fs.existsSync(filepath)) {
      return filepath;
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

/** `paths` entries resolved against `dir`; non-arrays / non-strings untouched. */
function resolveAgainst(dir: string, paths: string[] | undefined): string[] | undefined {
  return Array.isArray(paths)
    ? paths.map(p => (typeof p === 'string' && p !== '' ? path.resolve(dir, p) : p))
    : paths;
}

/** A relative file path resolved against `dir`; empty strings and non-strings untouched. */
function resolveFile<T>(dir: string, value: T): T | string {
  return typeof value === 'string' && value.trim() !== '' ? path.resolve(dir, value) : value;
}

/**
 * `queries` entries with local paths resolved against `dir`. An entry is
 * `<path>`, `.ext:<path>` or a comma list of those; URLs are left alone.
 */
function resolveQueries(dir: string, queries: unknown): unknown {
  if (!Array.isArray(queries)) return queries;
  return queries.map(entry => {
    if (typeof entry !== 'string') return entry;
    return entry
      .split(',')
      .map(part => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const colon = trimmed.indexOf(':');
        const prefix = colon > 0 && trimmed.startsWith('.') ? trimmed.slice(0, colon + 1) : '';
        const target = trimmed.slice(prefix.length);
        if (target.startsWith('http://') || target.startsWith('https://')) return trimmed;
        return prefix + path.resolve(dir, target);
      })
      .join(',');
  });
}

/** `paths`, `output`, `share` and `queries` of one config level resolved against `dir`. */
function resolveLevel<T extends XrayScopeConfig>(dir: string, level: T): T {
  const out: T = { ...level };
  if (level.paths !== undefined) out.paths = resolveAgainst(dir, level.paths);
  if (level.output !== undefined) out.output = resolveFile(dir, level.output) as string;
  if (level.share !== undefined) out.share = resolveFile(dir, level.share) as typeof level.share;
  if (level.queries !== undefined) out.queries = resolveQueries(dir, level.queries) as string[];
  return out;
}

function withResolvedPaths(
  dir: string,
  entries: Record<string, XrayScopeConfig>
): Record<string, XrayScopeConfig> {
  const out: Record<string, XrayScopeConfig> = {};
  for (const [name, entry] of Object.entries(entries)) {
    out[name] = entry && typeof entry === 'object' ? resolveLevel(dir, entry) : entry;
  }
  return out;
}

/**
 * Copy of `config` with relative `paths`, `output`, `share` and `queries`
 * (top level, `lenses.<name>` and `scopes.<name>`) resolved against the
 * directory of `filepath` (the file defining them, like tsconfig/eslint);
 * absolute paths and URLs kept. Done per file before merging so each value
 * keeps its own base. Command-line values are not touched: they resolve
 * against the working directory.
 */
export function resolveConfigPaths(config: XrayConfig, filepath: string): XrayConfig {
  if (!config || typeof config !== 'object') return config;
  const dir = path.dirname(path.resolve(filepath));
  const resolved: XrayConfig = resolveLevel(dir, config);
  if (config.lenses && typeof config.lenses === 'object') {
    resolved.lenses = withResolvedPaths(dir, config.lenses);
  }
  if (config.scopes && typeof config.scopes === 'object') {
    resolved.scopes = withResolvedPaths(dir, config.scopes);
  }
  return resolved;
}

/**
 * What `assertConfigConfined` checks. A key is true when the run uses the
 * value and the command line does not override it; a value the command
 * line supplies is the user's own and is never checked.
 */
export interface ConfineOptions {
  paths: boolean;
  output: boolean;
  queries: boolean;
  share: boolean;
  /** `--lens <name>`: only that lens is checked, besides the top level. */
  lens?: string;
  /** `--scope <name>`: only that scope is checked, besides the top level. */
  scope?: string;
  /** `--all-scopes`: every scope is checked. */
  allScopes?: boolean;
}

/** Whether `file` is the user's own global config (their choice; never confined). */
function isUserGlobalConfig(file: string): boolean {
  const global = findGlobalConfigPath();
  return global !== null && realpathLoose(path.resolve(global)) === realpathLoose(path.resolve(file));
}

/** Local paths named by `queries` entries: `<path>`, `.ext:<path>`, comma lists; URLs are not paths. */
function localQueryPaths(entries: unknown[]): Array<{ index: number; value: string }> {
  const found: Array<{ index: number; value: string }> = [];
  entries.forEach((entry, index) => {
    if (typeof entry !== 'string') return;
    for (const part of entry.split(',')) {
      let value = part.trim();
      if (!value) continue;
      const colon = value.indexOf(':');
      if (colon > 0 && value.startsWith('.')) value = value.slice(colon + 1);
      if (value.startsWith('http://') || value.startsWith('https://')) continue;
      found.push({ index, value });
    }
  });
  return found;
}

/**
 * A config file may not point a run outside its project: the project root
 * is the directory of the file that supplies the value, symlinks resolved.
 * `paths` (scan roots), `output` and `share` (files written) and `queries`
 * (files read) that resolve elsewhere are a usage error unless the command
 * line gives the value. The user's own global config is exempt. `config`
 * is as loaded; values are already absolute (see resolveConfigPaths).
 * Values still relative are judged against the config file's directory.
 */
export function assertConfigConfined(config: XrayConfig, file: string, o: ConfineOptions): void {
  if (!config || typeof config !== 'object') return;
  const root = realpathLoose(path.dirname(path.resolve(file)));

  const refuse = (key: string, value: string, flag: string): never => {
    throw new UsageError(
      `config ${terminalSafe(file)}: ${terminalSafe(key)} resolves to ${terminalSafe(value)}, ` +
      `outside the project ${terminalSafe(root)}; pass ${flag} on the command line to use it`
    );
  };
  const check = (key: string, value: string, flag: string): void => {
    const real = realpathLoose(path.resolve(path.dirname(path.resolve(file)), value));
    if (!isWithin(root, real)) refuse(key, real, flag);
  };

  const scopeLevel = (prefix: string, c: XrayScopeConfig | undefined): void => {
    if (!c || typeof c !== 'object') return;
    const at = (k: string) => `${prefix}${k}`;
    if (o.paths && Array.isArray(c.paths)) {
      c.paths.forEach((p, i) => {
        if (typeof p === 'string' && p !== '') check(at(`paths[${i}]`), p, '--path');
      });
    }
    if (o.output && typeof c.output === 'string' && c.output !== '') {
      check(at('output'), c.output, '-o/--output');
    }
    if (o.share && typeof c.share === 'string' && c.share.trim() !== '') {
      check(at('share'), c.share, '--share <path>');
    }
    if (o.queries && Array.isArray(c.queries)) {
      for (const { index, value } of localQueryPaths(c.queries)) {
        check(at(`queries[${index}]`), value, '--query');
      }
    }
  };

  scopeLevel('', config);
  const named = (group: Record<string, XrayScopeConfig> | undefined, kind: string, only?: string, all?: boolean) => {
    if (!group || typeof group !== 'object') return;
    for (const [name, entry] of Object.entries(group)) {
      if (all || name === only) scopeLevel(`${kind}.${name}.`, entry);
    }
  };
  named(config.lenses, 'lenses', o.lens);
  named(config.scopes, 'scopes', o.scope, o.allScopes);
}

/**
 * Load configuration from the project directory
 * Supports directory tree walking and global config merging.
 * `resolvePaths`: absolutize config scan paths against their defining
 * file's directory (see resolveConfigPaths). Off by default so callers
 * that load-modify-save a config (aliases) keep the file's own paths.
 * `confine`: refuse scan roots, outputs and query files that leave the
 * project of the file supplying them (see assertConfigConfined).
 */
export function loadConfig(
  configPath?: string,
  searchPath?: string,
  options: { resolvePaths?: boolean; confine?: ConfineOptions } = {}
): XrayConfig | null {
  const load = (file: string): XrayConfig => {
    const config = options.resolvePaths ? resolveConfigPaths(loadConfigFile(file), file) : loadConfigFile(file);
    if (options.confine && !isUserGlobalConfig(file)) assertConfigConfined(config, file, options.confine);
    return config;
  };

  // If explicit path provided, use it (no merging)
  if (configPath) {
    assertDataConfig(configPath);
    const absPath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
    if (fs.existsSync(absPath)) {
      return load(absPath);
    } else {
      Logger.warn(`Config file not found: ${configPath}`);
      return null;
    }
  }

  // Find global config
  const globalConfigPath = findGlobalConfigPath();
  const globalConfig = globalConfigPath ? load(globalConfigPath) : null;

  // Find project config by walking up directory tree
  const projectConfigPath = findConfigPath(searchPath);
  const projectConfig = projectConfigPath ? load(projectConfigPath) : null;

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
  assertDataConfig(filepath);

  try {
    let content: string;
    try {
      content = fs.readFileSync(filepath, 'utf-8');
    } catch (err: any) {
      throw new FileReadError(filepath, err);
    }
    const parsed = JSON.parse(content);
    // A manifest is not config: only its `xray` key is.
    if (path.basename(filepath) === 'package.json') {
      return (isPlainObject(parsed?.xray) ? parsed.xray : {}) as XrayConfig;
    }
    return parsed as XrayConfig;
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
    queries: scopeConfig.queries || baseConfig.queries,
    json: scopeConfig.json !== undefined ? scopeConfig.json : baseConfig.json,
    chunked: scopeConfig.chunked !== undefined ? scopeConfig.chunked : (baseConfig.chunked !== undefined ? baseConfig.chunked : true),
  };
}

/**
 * Whether `filepath` holds plain JSON config that `saveConfig` can
 * rewrite: not package.json (a manifest) and not a non-JSON file.
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
 * overrides global), else the global config. An unreadable project
 * config is assumed to be the source.
 */
function findPathsConfigFile(configPath?: string): string | null {
  if (configPath) return path.resolve(configPath);
  const project = findConfigPath();
  const global = findGlobalConfigPath();
  if (!project || !global) return project ?? global;
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
 * `match` in a config (top level, lens or scope) must be an array of
 * strings; a bare string would be read character by character.
 */
function assertMatchShape(value: unknown, where: string, cliOptions: any): void {
  if (value === undefined) return;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return;
  const files = consultedConfigFiles(cliOptions?.config, cliOptions?.path?.[0]);
  const odd = Array.isArray(value) ? value.find((v) => typeof v !== 'string') : undefined;
  const got = Array.isArray(value)
    ? `an array holding ${odd === null ? 'null' : typeof odd}`
    : value === null ? 'null' : typeof value;
  throw new UsageError(
    `${quotePattern(where, 120)} in ${files.length > 0 ? files.join(', ') : 'config'} must be an array of strings, got ${got}`
  );
}

function assertConfigMatchShapes(config: XrayConfig, cliOptions: any): void {
  assertMatchShape((config as any).match, 'match', cliOptions);
  for (const kind of ['lenses', 'scopes'] as const) {
    const group = (config as any)[kind];
    if (!group || typeof group !== 'object') continue;
    for (const [name, entry] of Object.entries<any>(group)) {
      if (entry && typeof entry === 'object') assertMatchShape(entry.match, `${kind}.${name}.match`, cliOptions);
    }
  }
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

  assertConfigMatchShapes(config, cliOptions);

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
  // cf/df are one selection: naming either on the command line replaces the
  // config's, so `graph --with cf` is cf only whatever the config says.
  if (withFeatures.includes('cf') || withFeatures.includes('df')) {
    features.cf = false;
    features.df = false;
  }
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

  // Over-long patterns fail here, naming where they came from.
  if (cliOptions.match && cliOptions.match.length > 0) {
    assertPatternLengths(cliOptions.match, '--match');
  } else if (baseConfig.match && baseConfig.match.length > 0) {
    const files = consultedConfigFiles(cliOptions?.config, cliOptions?.path?.[0]);
    assertPatternLengths(baseConfig.match, `"match" in ${files.length > 0 ? files.join(', ') : 'config'}`);
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
    // Resolved selection (see resolveFormatFlags): CLI beats config, and a
    // CLI choice on an axis must not be re-overridden by config booleans.
    outputFormat: cliOptions.outputFormat ?? (baseConfig.json ? 'json' : baseConfig.format),
    // commander's `--no-chunk` defaults `chunk` to true: only an explicit false is a CLI choice.
    chunked: cliOptions.chunk === false ? false : baseConfig.chunked !== false,
    detect: cliOptions.detect ?? false,
    languages: cliOptions.lang && cliOptions.lang.length > 0 ? cliOptions.lang : baseConfig.languages,
    skipDetect: cliOptions.skipDetect ?? baseConfig.skipDetect ?? false,
    group: cliOptions.group,
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
