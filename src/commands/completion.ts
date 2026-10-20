import { Logger } from '../lib/logger';
import { StrategyLoader } from '../lib/strategy/loader';
import { StrategyCacheManager } from './registration/cache';

/**
 * Generate dynamic shell completion including strategy commands
 */
export const handleCompletionAction = async (shell: string) => {
  // Load strategies to include in completion
  const { coreCommands, strategyCommands } = await loadCommandsForCompletion();

  const generators: Record<string, () => string> = {
    bash: () => generateBashCompletion(coreCommands, strategyCommands),
    zsh: () => generateZshCompletion(coreCommands, strategyCommands),
    fish: () => generateFishCompletion(coreCommands, strategyCommands)
  };

  const generator = generators[shell.toLowerCase()];

  if (!generator) {
    Logger.error(`Unsupported shell: ${shell}`);
    Logger.info('Supported shells: bash, zsh, fish');
    Logger.info('');
    Logger.info('Usage:');
    Logger.info('  eval "$(xray completion bash)"   # For bash');
    Logger.info('  eval "$(xray completion zsh)"    # For zsh');
    Logger.info('  xray completion fish > ~/.config/fish/completions/xray.fish  # For fish');
    process.exit(1);
  }

  console.log(generator());
};

/**
 * Load all commands for completion generation
 */
async function loadCommandsForCompletion() {
  const coreCommands = [
    'map', 'scan', 'graph', 'generate', 'query',
    'strategy', 'alias', 'lang', 'explore', 'clear-cache', 'completion', 'help'
  ];

  const strategyCommands: Record<string, string[]> = {};

  try {
    // Try to load from cache first for speed
    const cacheManager = new StrategyCacheManager();
    const cached = await cacheManager.getCached();

    if (cached) {
      // Use cached strategy information
      for (const strategy of cached) {
        if (strategy.commands) {
          strategyCommands[strategy.name] = Object.keys(strategy.commands);
        }
      }
    } else {
      // Load strategies directly
      const loader = new StrategyLoader();
      const strategies = await loader.discoverStrategies();

      for (const strategy of strategies) {
        if (strategy.commands) {
          strategyCommands[strategy.name] = Object.keys(strategy.commands);
        }
      }
    }
  } catch (error: any) {
    Logger.debug(`Could not load strategies for completion: ${error.message}`);
    // Continue with just core commands
  }

  return { coreCommands, strategyCommands };
}

/**
 * Generate Bash completion script
 */
function generateBashCompletion(
  coreCommands: string[],
  strategyCommands: Record<string, string[]>
): string {
  const allCommands = [...coreCommands, ...Object.keys(strategyCommands)].join(' ');

  const strategyCompletions = Object.entries(strategyCommands)
    .map(([strategy, commands]) => {
      return `    ${strategy})
      COMPREPLY=( $(compgen -W "${commands.join(' ')}" -- "$cur") )
      return 0
      ;;`;
    })
    .join('\n');

  return `# xray completion for bash
# Add to ~/.bashrc or ~/.bash_profile:
# eval "$(xray completion bash)"

_xray_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${allCommands}"

  # First level: main commands
  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  # Second level: strategy subcommands
  local main_cmd="\${COMP_WORDS[1]}"
  case "$main_cmd" in
${strategyCompletions}
  esac

  # Option completions
  case "$prev" in
    -p|--path|-o|--output|-a|--anchor|--config|--graph)
      COMPREPLY=( $(compgen -f -- "$cur") )
      return 0
      ;;
    --format)
      COMPREPLY=( $(compgen -W "txt csv xml json mermaid dot table tree text" -- "$cur") )
      return 0
      ;;
    *)
      COMPREPLY=( $(compgen -W "--path --output --limit --anchor --depth --query --match --graph --format --json --csv --xml --txt --mermaid --dot --help" -- "$cur") )
      return 0
      ;;
  esac
}

complete -F _xray_completions xray`;
}

/**
 * Generate Zsh completion script
 */
function generateZshCompletion(
  coreCommands: string[],
  strategyCommands: Record<string, string[]>
): string {
  const coreCommandDefs = coreCommands
    .map(cmd => `    '${cmd}:${getCommandDescription(cmd)}'`)
    .join('\n');

  const strategyCases = Object.entries(strategyCommands)
    .map(([strategy, commands]) => {
      const cmdDefs = commands
        .map(cmd => `      '${cmd}:${strategy} ${cmd} command'`)
        .join('\n');
      return `    ${strategy})
      local -a ${strategy}_commands
      ${strategy}_commands=(
${cmdDefs}
      )
      _describe '${strategy} commands' ${strategy}_commands
      ;;`;
    })
    .join('\n');

  return `# xray completion for zsh
# Add to ~/.zshrc:
# eval "$(xray completion zsh)"

#compdef xray

_xray() {
  local -a commands
  commands=(
${coreCommandDefs}
  )

  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args' \\
    '(-p --path)'{-p,--path}'[Project path]:path:_files -/' \\
    '(-o --output)'{-o,--output}'[Output file path]:file:_files' \\
    '--graph[Load graph from file]:file:_files' \\
    '--format[Output format]:format:(txt csv xml json mermaid dot table tree text)' \\
    '(-h --help)'{-h,--help}'[Display help]'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case "\${words[1]}" in
${strategyCases}
      esac
      ;;
  esac
}

_xray`;
}

/**
 * Generate Fish completion script
 */
function generateFishCompletion(
  coreCommands: string[],
  strategyCommands: Record<string, string[]>
): string {
  const coreCompletions = coreCommands
    .map(cmd => `complete -c xray -n '__fish_use_subcommand' -a ${cmd} -d '${getCommandDescription(cmd)}'`)
    .join('\n');

  const strategyCompletions = Object.entries(strategyCommands)
    .map(([strategy, commands]) => {
      const condition = `__fish_seen_subcommand_from ${strategy}`;
      return commands
        .map(cmd => `complete -c xray -n '${condition}' -a ${cmd} -d '${strategy} ${cmd} command'`)
        .join('\n');
    })
    .join('\n\n');

  return `# xray completion for fish
# Save to ~/.config/fish/completions/xray.fish

# Core commands
${coreCompletions}

# Strategy subcommands
${strategyCompletions}

# Global options
complete -c xray -s p -l path -d 'Project path' -r
complete -c xray -s o -l output -d 'Output file path' -r
complete -c xray -l graph -d 'Load graph from file' -r
complete -c xray -l format -d 'Output format' -xa 'txt csv xml json mermaid dot table tree text'
complete -c xray -s h -l help -d 'Display help'`;
}

/**
 * Get description for core commands
 */
function getCommandDescription(cmd: string): string {
  const descriptions: Record<string, string> = {
    map: 'Generate visual map of codebase',
    scan: 'Scan and discover files',
    graph: 'Generate CFG and DFG graphs',
    generate: 'Generate analysis visualization',
    query: 'Query call graph',
    strategy: 'Manage strategies',
    alias: 'Manage aliases',
    explore: 'Find files and search code',
    'lang': 'Manage language packs (tree-sitter grammars)',
    'clear-cache': 'Clear SQLite cache',
    completion: 'Generate shell completion',
    help: 'Display help'
  };

  return descriptions[cmd] || cmd;
}