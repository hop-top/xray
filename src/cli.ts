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
import { FileScanner } from './scanner';

const program = new Command();

program
  .name('xray')
  .description('X-ray your codebase - Generate AST, CFG, and DFG visualizations')
  .version('0.0.1-alpha.1');

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

// Map command - generates visual map
addCommonOptions(program.command('map'))
  .description('Generate visual map of codebase')
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

// Explore command action handler
const handleExploreAction = async (options: any) => {
    try {
      const paths = (options.path && options.path.length > 0 ? options.path : [process.cwd()])
        .map(resolvePath)
        .filter(Boolean) as string[];

      // Validate all paths exist
      for (const p of paths) {
        if (!fs.existsSync(p)) {
          Logger.error(`Path does not exist: ${p}`);
          process.exit(1);
        }
      }

      // Scan all paths and collect files
      let files: string[] = [];
      for (const p of paths) {
        const scanner = new FileScanner(p);
        const scannedFiles = scanner.scan().map((f: string) => path.join(p, f));
        files = files.concat(scannedFiles);
      }

      // Filter by type if specified
      if (options.type && options.type.length > 0) {
        const exts = options.type.map((t: string) => t.startsWith('.') ? t : `.${t}`);
        files = files.filter(f => exts.includes(path.extname(f)));
      }

      // Find files by pattern
      if (options.match && options.match.length > 0) {
        files = files.filter(f => {
          const fileName = path.basename(f).toLowerCase();
          const filePath = f.toLowerCase();

          return options.match.some((pattern: string) => {
            const isNegated = pattern.startsWith('!');
            const actualPattern = (isNegated ? pattern.slice(1) : pattern).toLowerCase();

            let matches = false;

            // Support glob-like patterns
            if (actualPattern.includes('*')) {
              const regex = new RegExp(actualPattern.replace(/\*/g, '.*'));
              matches = regex.test(filePath);
            } else {
              matches = fileName.includes(actualPattern) || filePath.includes(actualPattern);
            }

            return isNegated ? !matches : matches;
          });
        });

        Logger.info(`Found ${files.length} file(s) matching pattern(s):\n`);
        files.forEach(f => console.log(`  ${f}`));
        return;
      }

      // Search for keyword in code
      if (options.search && options.search.length > 0) {
        const keywords = options.search;
        Logger.info(`Searching for ${keywords.length} keyword(s) in ${files.length} files...\n`);

        const matches: Array<{ file: string; lines: Array<{ lineNum: number; content: string; keyword: string }> }> = [];

        for (const file of files) {
          try {
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');
            const matchingLines: Array<{ lineNum: number; content: string; keyword: string }> = [];

            lines.forEach((line, idx) => {
              keywords.forEach((keyword: string) => {
                if (line.toLowerCase().includes(keyword.toLowerCase())) {
                  matchingLines.push({ lineNum: idx + 1, content: line.trim(), keyword });
                }
              });
            });

            if (matchingLines.length > 0) {
              matches.push({ file, lines: matchingLines });
            }
          } catch (error) {
            // Skip files that can't be read
          }
        }

        if (matches.length === 0) {
          Logger.warn(`No matches found for keyword(s): ${keywords.join(', ')}`);
          return;
        }

        Logger.success(`Found matches in ${matches.length} file(s):\n`);
        matches.forEach(({ file, lines }) => {
          console.log(chalk.cyan(`${file}:`));
          lines.slice(0, 5).forEach(({ lineNum, content, keyword }) => {
            console.log(`  ${chalk.gray(`${lineNum}:`)} ${chalk.yellow(`[${keyword}]`)} ${content}`);
          });
          if (lines.length > 5) {
            console.log(chalk.gray(`  ... and ${lines.length - 5} more matches`));
          }
          console.log('');
        });
        return;
      }

      // Show statistics
      if (options.stats) {
        const extStats: Record<string, number> = {};
        let totalLines = 0;

        files.forEach(file => {
          const ext = path.extname(file);
          extStats[ext] = (extStats[ext] || 0) + 1;

          try {
            const content = fs.readFileSync(file, 'utf-8');
            totalLines += content.split('\n').length;
          } catch (error) {
            // Skip files that can't be read
          }
        });

        Logger.info('Codebase Statistics:\n');
        console.log(`  ${chalk.bold('Total Files:')} ${files.length}`);
        console.log(`  ${chalk.bold('Total Lines:')} ${totalLines.toLocaleString()}\n`);
        console.log(`  ${chalk.bold('Files by Type:')}`);

        Object.entries(extStats)
          .sort((a, b) => b[1] - a[1])
          .forEach(([ext, count]) => {
            console.log(`    ${ext.padEnd(10)} ${count}`);
          });
        return;
      }

      // Default: list all files
      Logger.info(`Found ${files.length} file(s):\n`);

      // Group by extension
      const byExt: Record<string, string[]> = {};
      files.forEach(f => {
        const ext = path.extname(f);
        if (!byExt[ext]) byExt[ext] = [];
        byExt[ext].push(f);
      });

      Object.entries(byExt)
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([ext, fileList]) => {
          console.log(chalk.cyan(`${ext} (${fileList.length}):`));
          fileList.slice(0, 10).forEach(f => console.log(`  ${f}`));
          if (fileList.length > 10) {
            console.log(chalk.gray(`  ... and ${fileList.length - 10} more`));
          }
          console.log('');
        });

    } catch (error) {
      Logger.error('Error exploring codebase:', error);
      process.exit(1);
    }
};

// Explore command (default command)
program
  .command('explore', { isDefault: true })
  .description('Quickly find files by patterns, search code for keywords, or explore the codebase [default command]')
  .option('-p, --path <path>', 'Root directory to explore (repeatable) [default: current directory]', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('-m, --match <pattern>', 'Find files matching pattern (e.g., "*.ts", "**/*test*") (repeatable)', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('-s, --search <keyword>', 'Search for keyword in code (repeatable)', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('-t, --type <ext>', 'Filter by file extension (e.g., ts, js, py) (repeatable)', (value: string, previous: string[]) => {
    return previous.concat([value]);
  }, [])
  .option('--stats', 'Show codebase statistics')
  .action(handleExploreAction);

// Completion command
program
  .command('completion')
  .description('Generate shell completion script')
  .argument('<shell>', 'Shell type: bash, zsh, or fish')
  .action((shell: string) => {
    const completions: Record<string, string> = {
      bash: `# xray completion for bash
# Add to ~/.bashrc or ~/.bash_profile:
# eval "$(xray completion bash)"

_xray_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="map scan graph generate explore clear-cache completion help"

  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  case "$prev" in
    -p|--path|-o|--output|-a|--anchor|--config)
      COMPREPLY=( $(compgen -f -- "$cur") )
      return 0
      ;;
    -w|--with)
      COMPREPLY=( $(compgen -W "vars incs docs cost cf df" -- "$cur") )
      return 0
      ;;
    --format)
      COMPREPLY=( $(compgen -W "txt csv xml json" -- "$cur") )
      return 0
      ;;
    --diagram)
      COMPREPLY=( $(compgen -W "mermaid dot" -- "$cur") )
      return 0
      ;;
    *)
      COMPREPLY=( $(compgen -W "--path --output --limit --with --anchor --depth --query --match --catch --txt --csv --xml --json --mermaid --dot --config --preset --scope --all-scopes --help" -- "$cur") )
      return 0
      ;;
  esac
}

complete -F _xray_completions xray`,

      zsh: `# xray completion for zsh
# Add to ~/.zshrc:
# eval "$(xray completion zsh)"

#compdef xray

_xray() {
  local -a commands features formats diagrams
  commands=(
    'map:Generate visual map of codebase'
    'scan:Scan and discover files in codebase'
    'graph:Generate control flow and data flow graphs'
    'generate:Generate code analysis visualization'
    'explore:Quickly find files and search code'
    'clear-cache:Clear SQLite cache'
    'completion:Generate shell completion script'
    'help:Display help for command'
  )

  features=(vars incs docs cost cf df)
  formats=(txt csv xml json)
  diagrams=(mermaid dot)

  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args' \\
    '(-p --path)'{-p,--path}'[Root directory to analyze]:path:_files -/' \\
    '(-o --output)'{-o,--output}'[Output file path]:file:_files' \\
    '(-l --limit)'{-l,--limit}'[Token limit]:number' \\
    '(-w --with)'{-w,--with}'[Include feature]:feature:($features)' \\
    '(-a --anchor)'{-a,--anchor}'[Focus on specific file]:file:_files' \\
    '(-d --depth)'{-d,--depth}'[Maximum depth]:number' \\
    '(-q --query)'{-q,--query}'[Override query]:query' \\
    '(-m --match)'{-m,--match}'[Match filename pattern]:pattern' \\
    '(-c --catch)'{-c,--catch}'[Match function/class name]:pattern' \\
    '--txt[Output in text format]' \\
    '--csv[Output in CSV format]' \\
    '--xml[Output in XML format]' \\
    '--json[Output raw JSON graph]' \\
    '--mermaid[Generate Mermaid diagram]' \\
    '--dot[Generate DOT diagram]' \\
    '--config[Path to config file]:file:_files' \\
    '--preset[Use named preset]:preset' \\
    '--scope[Use specific scope]:scope' \\
    '--all-scopes[Run all scopes]' \\
    '(-h --help)'{-h,--help}'[Display help]'

  case $state in
    command)
      _describe 'command' commands
      ;;
  esac
}

_xray`,

      fish: `# xray completion for fish
# Add to ~/.config/fish/completions/xray.fish

# Commands
complete -c xray -n '__fish_use_subcommand' -a map -d 'Generate visual map of codebase'
complete -c xray -n '__fish_use_subcommand' -a scan -d 'Scan and discover files in codebase'
complete -c xray -n '__fish_use_subcommand' -a graph -d 'Generate control flow and data flow graphs'
complete -c xray -n '__fish_use_subcommand' -a generate -d 'Generate code analysis visualization'
complete -c xray -n '__fish_use_subcommand' -a explore -d 'Quickly find files and search code'
complete -c xray -n '__fish_use_subcommand' -a clear-cache -d 'Clear SQLite cache'
complete -c xray -n '__fish_use_subcommand' -a completion -d 'Generate shell completion script'
complete -c xray -n '__fish_use_subcommand' -a help -d 'Display help for command'

# Options
complete -c xray -s p -l path -d 'Root directory to analyze' -r
complete -c xray -s o -l output -d 'Output file path' -r
complete -c xray -s l -l limit -d 'Token limit' -x
complete -c xray -s w -l with -d 'Include feature' -xa 'vars incs docs cost cf df'
complete -c xray -s a -l anchor -d 'Focus on specific file' -r
complete -c xray -s d -l depth -d 'Maximum depth' -x
complete -c xray -s q -l query -d 'Override query' -x
complete -c xray -s m -l match -d 'Match filename pattern' -x
complete -c xray -s c -l catch -d 'Match function/class name' -x
complete -c xray -l txt -d 'Output in text format'
complete -c xray -l csv -d 'Output in CSV format'
complete -c xray -l xml -d 'Output in XML format'
complete -c xray -l json -d 'Output raw JSON graph'
complete -c xray -l mermaid -d 'Generate Mermaid diagram'
complete -c xray -l dot -d 'Generate DOT diagram'
complete -c xray -l config -d 'Path to config file' -r
complete -c xray -l preset -d 'Use named preset' -x
complete -c xray -l scope -d 'Use specific scope' -x
complete -c xray -l all-scopes -d 'Run all scopes'
complete -c xray -s h -l help -d 'Display help'`
    };

    const script = completions[shell.toLowerCase()];

    if (!script) {
      Logger.error(`Unsupported shell: ${shell}`);
      Logger.info('Supported shells: bash, zsh, fish');
      Logger.info('');
      Logger.info('Usage:');
      Logger.info('  eval "$(xray completion bash)"   # For bash');
      Logger.info('  eval "$(xray completion zsh)"    # For zsh');
      Logger.info('  xray completion fish > ~/.config/fish/completions/xray.fish  # For fish');
      process.exit(1);
    }

    console.log(script);
  });

program.parse();
