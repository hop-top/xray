import { Command } from 'commander';
import { BUILTIN_PRESET_NAMES } from '../lib/plugins/presets';

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
  const extensions: Record<string, string> = {
    txt: '.txt',
    csv: '.csv',
    xml: '.xml',
    json: '.json'
  };

  return resolvePath(outputOption + extensions[format]);
};

// Common options for all commands
export const addCommonOptions = (cmd: Command) => {
  return cmd
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
    .option('--no-telemetry', 'Disable telemetry for this session');
};
