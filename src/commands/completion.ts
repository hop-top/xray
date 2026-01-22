import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../lib/logger';

export const handleCompletionAction = (shell: string) => {
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
};