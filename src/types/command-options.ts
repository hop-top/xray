/**
 * Command Options Type Definitions
 * ==================================
 *
 * Type-safe interfaces for CLI command options.
 *
 * These types provide:
 * - IntelliSense support in command handlers
 * - Compile-time validation of option access
 * - Self-documenting CLI interface
 */
import type { XrayExtensionConfig } from './xray-config';

/**
 * Shared runtime override options for extension-aware commands
 */
export interface ExtensionOverrideCommandOptions {
  /** Pre-merged extension config bag */
  extensions?: Record<string, XrayExtensionConfig>;

  /** Force-enable a named extension (repeatable) */
  enableExtension?: string[];

  /** Force-disable a named extension (repeatable) */
  disableExtension?: string[];

  /** Override extension threshold as <name>=<number> (repeatable) */
  extensionThreshold?: string[];

  /** Add repeatable extension hints as <name>=<hint> */
  extensionHint?: string[];

  /** Enable an extension surface as <name>:<surface> (repeatable) */
  enableSurface?: string[];

  /** Disable an extension surface as <name>:<surface> (repeatable) */
  disableSurface?: string[];
}

/**
 * Base options available to all commands
 */
export interface BaseCommandOptions extends ExtensionOverrideCommandOptions {
  /** Verbosity level: silent, error, warn, info (default), debug */
  verbose?: 'silent' | 'error' | 'warn' | 'info' | 'debug';

  /** Path to config file (auto-detect if not specified) */
  config?: string;

  /** Disable telemetry for this session */
  telemetry?: boolean;
}

/**
 * Common options shared by analysis commands (map, graph)
 */
export interface CommonAnalysisOptions extends BaseCommandOptions {
  /** Root directory to analyze (repeatable) */
  path?: string[];

  /** Output file path */
  output?: string;

  /** Token limit per chunk (default: 4096) */
  limit?: string | number;

  /** Include features: vars, incs, cost, docs, df, cf (repeatable); df/cf: TypeScript only for now */
  with?: string[];

  /** Focus on specific file (Personalized PageRank) */
  anchor?: string;

  /** Maximum depth of tree to render */
  depth?: string | number;

  /** Override query (e.g. .ts:path, path/to/dir, url) (repeatable) */
  query?: string[];

  /** Match filename pattern (prefix ! to negate) (repeatable) */
  match?: string[];

  /** Match function/class name (prefix ! to negate) (repeatable) */
  catch?: string[];

  /** Output format: txt (default), csv, xml, json */
  format?: string;

  /** Alias of --format txt */
  txt?: boolean;

  /** Alias of --format csv */
  csv?: boolean;

  /** Alias of --format xml */
  xml?: boolean;

  /** Alias of --format json (raw JSON graph) */
  json?: boolean;

  /** Disable chunked output (single file output) */
  chunk?: boolean;

  /** Use named lens (config-file option overlay) */
  lens?: string;

  /** Use specific scope from config file */
  scope?: string;

  /** Run all scopes defined in config file */
  allScopes?: boolean;

  /** Enable strategy detection */
  detect?: boolean;

  /** Languages to parse (comma-separated names/bundles; repeatable). Overrides config `languages` */
  lang?: string[];

  /** Skip strategy detection and auto-configuration */
  skipDetect?: boolean;

  /** Generate a shareable summary markdown (optional path override) */
  share?: boolean | string;

  /**
   * Apply one or more plugin presets. Repeatable flag: each value is a
   * built-in name (`insights` | `onboarding` | `exploration`), a local
   * path (`./my-preset.js`), or an npm package (`@scope/pkg`). Distinct
   * from the `--lens` config-file overlay flag above (see docs).
   */
  preset?: string[];
}

/**
 * Options for the query command
 */
export interface QueryCommandOptions extends BaseCommandOptions {
  /** Path to saved graph JSON file (otherwise the graph is built for the roots) */
  graph?: string;

  /** Root directories to analyze when no graph file is given (repeatable) */
  path?: string[];

  /** Named lens / scope from the config file */
  lens?: string;
  scope?: string;

  /** Languages to parse */
  lang?: string[];

  /** Output format: table (default), json, yaml, csv, tree */
  format?: string;

  /** List available query adapters */
  listAdapters?: boolean;
}

/**
 * Options for the explore command
 */
export interface ExploreCommandOptions extends BaseCommandOptions {
  /** Root directory to explore (repeatable) */
  path?: string[];

  /** Find files matching pattern (e.g., wildcard patterns) (repeatable) */
  match?: string[];

  /** Search for keyword in code (repeatable) */
  search?: string[];

  /** Filter by file extension (e.g., ts, js, py) (repeatable) */
  type?: string[];

  /** List all available strategies */
  listStrategies?: boolean;

  /** Show file statistics */
  stats?: boolean;
}

/**
 * Options for strategy commands
 */
export interface StrategyCommandOptions extends BaseCommandOptions {
  /** Output in JSON format */
  json?: boolean;

  /** Root path for strategy operations */
  path?: string;
}

/**
 * Options for the clear-cache command
 */
export interface ClearCacheCommandOptions extends BaseCommandOptions {
  // No additional options beyond base
}

/**
 * Options for the completion command
 */
export interface CompletionCommandOptions extends BaseCommandOptions {
  // Shell type is passed as an argument, not an option
}

/**
 * Options for alias commands
 */
export interface AliasCommandOptions extends BaseCommandOptions {
  /** Root path for alias operations */
  path?: string;

  /** `--format`, forwarded to the target command */
  format?: string;

  /** List all aliases */
  list?: boolean;

  /** Delete an alias */
  delete?: string;

  /** Force operation without confirmation */
  force?: boolean;
}

/**
 * Union type of all command options for generic handlers
 */
export type AnyCommandOptions =
  | CommonAnalysisOptions
  | QueryCommandOptions
  | ExploreCommandOptions
  | StrategyCommandOptions
  | ClearCacheCommandOptions
  | CompletionCommandOptions
  | AliasCommandOptions;
