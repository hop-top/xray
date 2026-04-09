import { Command } from 'commander';
import { BUILTIN_PRESET_NAMES } from '../lib/plugins/presets';
import { StrategyContextImpl } from '../lib/strategy/context';
import { ExtensionOverrideCommandOptions } from '../types/command-options';
import type { XrayExtensionConfig } from '../types/xray-config';

const appendOptionValue = (
  value: string,
  previous: string[] = []
): string[] => previous.concat([value]);

// Helper to resolve paths relative to PWD
export const resolvePath = (p: string | undefined): string | undefined => {
  if (!p) return undefined;
  return require('path').isAbsolute(p) ? p : require('path').resolve(process.cwd(), p);
};

// Helper to determine output path with smart extension handling
export const resolveOutputPath = (outputOption: string | undefined, format: 'txt' | 'csv' | 'xml' | 'json'): string | undefined => {
  if (!outputOption) {
    // No output specified - use default .xray
    return require('path').resolve(process.cwd(), '.xray');
  }

  const path = require('path');

  // If output starts with '.', use it as-is (e.g., .xray, .output)
  if (outputOption.startsWith('.')) {
    return resolvePath(outputOption);
  }

  // If output has an extension, use it as-is
  if (path.extname(outputOption)) {
    return resolvePath(outputOption);
  }

  // No extension - append format-based extension
  const outputExtensions: Record<string, string> = {
    txt: '.txt',
    csv: '.csv',
    xml: '.xml',
    json: '.json'
  };

  return resolvePath(outputOption + outputExtensions[format]);
};

const cloneExtensionConfig = (
  config: XrayExtensionConfig
): XrayExtensionConfig => ({
  ...config,
  hints: config.hints ? [...config.hints] : undefined,
  enabledSurfaces: config.enabledSurfaces
    ? { ...config.enabledSurfaces }
    : undefined,
  config: config.config ? { ...config.config } : undefined,
});

const cloneExtensionConfigs = (
  configs?: Record<string, XrayExtensionConfig>
): Record<string, XrayExtensionConfig> => {
  const cloned: Record<string, XrayExtensionConfig> = {};

  for (const [name, config] of Object.entries(configs || {})) {
    cloned[name] = cloneExtensionConfig(config);
  }

  return cloned;
};

const ensureExtensionConfig = (
  overrides: Record<string, XrayExtensionConfig>,
  extensionName: string
): XrayExtensionConfig => {
  if (!overrides[extensionName]) {
    overrides[extensionName] = {};
  }

  return overrides[extensionName];
};

const parseExtensionPair = (
  spec: string,
  separator: '=' | ':',
  flagName: string
): [string, string] => {
  const separatorIndex = spec.indexOf(separator);

  if (separatorIndex <= 0 || separatorIndex === spec.length - 1) {
    throw new Error(
      `Invalid ${flagName} value "${spec}". Expected <extension>${separator}<value>.`
    );
  }

  return [
    spec.slice(0, separatorIndex).trim(),
    spec.slice(separatorIndex + 1).trim(),
  ];
};

export function buildExtensionOverrides(
  options: ExtensionOverrideCommandOptions = {}
): Record<string, XrayExtensionConfig> | undefined {
  const overrides = cloneExtensionConfigs(options.extensions);
  let hasOverrides = Object.keys(overrides).length > 0;

  for (const extensionName of options.enableExtension || []) {
    ensureExtensionConfig(overrides, extensionName).enabled = true;
    hasOverrides = true;
  }

  for (const extensionName of options.disableExtension || []) {
    ensureExtensionConfig(overrides, extensionName).enabled = false;
    hasOverrides = true;
  }

  for (const thresholdSpec of options.extensionThreshold || []) {
    const [extensionName, rawThreshold] = parseExtensionPair(
      thresholdSpec,
      '=',
      '--extension-threshold'
    );
    const threshold = Number(rawThreshold);

    if (!Number.isFinite(threshold)) {
      throw new Error(
        `Invalid --extension-threshold value "${thresholdSpec}". ` +
          'Threshold must be a number.'
      );
    }

    ensureExtensionConfig(overrides, extensionName).threshold = threshold;
    hasOverrides = true;
  }

  for (const hintSpec of options.extensionHint || []) {
    const [extensionName, hint] = parseExtensionPair(
      hintSpec,
      '=',
      '--extension-hint'
    );
    const config = ensureExtensionConfig(overrides, extensionName);
    config.hints = [...(config.hints || []), hint];
    hasOverrides = true;
  }

  for (const surfaceSpec of options.enableSurface || []) {
    const [extensionName, surface] = parseExtensionPair(
      surfaceSpec,
      ':',
      '--enable-surface'
    );
    const config = ensureExtensionConfig(overrides, extensionName);
    config.enabledSurfaces = {
      ...(config.enabledSurfaces || {}),
      [surface]: true,
    };
    hasOverrides = true;
  }

  for (const surfaceSpec of options.disableSurface || []) {
    const [extensionName, surface] = parseExtensionPair(
      surfaceSpec,
      ':',
      '--disable-surface'
    );
    const config = ensureExtensionConfig(overrides, extensionName);
    config.enabledSurfaces = {
      ...(config.enabledSurfaces || {}),
      [surface]: false,
    };
    hasOverrides = true;
  }

  return hasOverrides ? overrides : undefined;
}

export function normalizeExtensionOptions<
  T extends ExtensionOverrideCommandOptions
>(options: T): T & ExtensionOverrideCommandOptions {
  const extensions = buildExtensionOverrides(options);

  if (!extensions) {
    return options;
  }

  return {
    ...options,
    extensions,
  };
}

export function createStrategyContext(
  projectPath: string,
  options: ExtensionOverrideCommandOptions = {}
): StrategyContextImpl {
  return new StrategyContextImpl(projectPath, {
    extensions: buildExtensionOverrides(options),
  });
}

export const addExtensionOverrideOptions = (cmd: Command): Command => {
  return cmd
    .option(
      '--enable-extension <name>',
      'Enable an extension at runtime (repeatable)',
      appendOptionValue,
      []
    )
    .option(
      '--disable-extension <name>',
      'Disable an extension at runtime (repeatable)',
      appendOptionValue,
      []
    )
    .option(
      '--extension-threshold <name=value>',
      'Override an extension threshold at runtime (repeatable)',
      appendOptionValue,
      []
    )
    .option(
      '--extension-hint <name=value>',
      'Add an extension hint at runtime (repeatable)',
      appendOptionValue,
      []
    )
    .option(
      '--enable-surface <name:surface>',
      'Enable an extension surface at runtime (repeatable)',
      appendOptionValue,
      []
    )
    .option(
      '--disable-surface <name:surface>',
      'Disable an extension surface at runtime (repeatable)',
      appendOptionValue,
      []
    );
};

// Common options for all commands
export const addCommonOptions = (cmd: Command) => {
  return addExtensionOverrideOptions(
    cmd
    .option('-p, --path <path>', 'Root directory to analyze (repeatable) [default: current directory]', (value: string, previous: string[]) => {
      return previous.concat([value]);
    }, [])
    .option('-o, --output <path>', 'Output file path [default: .xray, auto-appends format extension if no extension given]')
    .option('-l, --limit <number>', 'Token limit per chunk [default: 4096]')
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
    .option('--no-chunk', 'Disable chunked output (single file output)')
    .option('--group <mode>', 'Chunk grouping mode: directory (default) or community', 'directory')
    .option('--config <path>', 'Path to config file (auto-detect if not specified)')
    .option('--lens <name>', 'Use named lens (config-file option overlay)')
    .option('--scope <name>', 'Use specific scope from config file')
    .option('--all-scopes', 'Run all scopes defined in config file')
    .option('--detect', 'Enable strategy detection (auto-detects when no path is provided)')
    .option('--skip-detect', 'Skip strategy detection and auto-configuration')
    .option('--share [path]', 'Generate a shareable summary markdown (optional path override)')
    .option(
      '--preset <spec>',
      `Apply a plugin preset (built-in name, ./local/path, or @scope/pkg). Repeatable. Built-ins: ${BUILTIN_PRESET_NAMES.join(', ')}.`,
      (value: string, previous: string[]) => previous.concat([value]),
      []
    )
  )
    .option('--no-telemetry', 'Disable telemetry for this session');
};
