// src/commands/registration/core.ts
import { Command } from 'commander';
import { addCommonOptions } from '../common';
import { addGraphSourceOptions } from '../graph-source';
import { handleGenerateCommand } from '../generate';
import { handleClearCacheAction } from '../clear-cache';
import { bindFlag, registerCompletionCommand, staticValues } from '../completion';
import { addQueryOutputFlags, runQueryCommand } from '../query';
import { registerImpactCommand } from '../impact';
import { registerImportsCommand } from '../imports';
import { handleDescribeAction } from '../describe';
import { registerStrategyCommand } from '../strategy-cmd';
import { registerAliasCommand } from '../alias';
import { registerPathsCommand } from '../paths';
import { registerLangCommand } from '../lang';
import { registerMcpCommand } from '../mcp';
import { registerUpgradeCommand } from '../upgrade';
import { setCommandGroup, type HelpGroupId } from '../kit-cli';
import { declareEffect } from '../side-effect';
import { addResultFormat } from '../../lib/result-format';

// Root help group per top-level command name; unlisted/hidden commands
// fall into kit's default section.
const CORE_GROUPS: Record<string, HelpGroupId> = {
  map: 'analyze',
  graph: 'analyze',
  query: 'analyze',
  impact: 'analyze',
  imports: 'analyze',
  strategy: 'strategy',
  alias: 'management',
  lang: 'management',
  cache: 'management',
  paths: 'management',
  describe: 'management',
  upgrade: 'management',
  mcp: 'management',
  completion: 'management',
};

const POSITIONAL_ROOTS = 'Root directories to analyze (same as --path; not combinable with it)';

/**
 * Register all static core commands
 * These are built-in commands that don't depend on strategy discovery
 */
export function registerCoreCommands(program: Command): void {
  // Analysis commands
  // Both write the analysis output (`.xray_*.md` chunks, or the file
  // `-o` names) into the project; re-running rewrites the same files.
  declareEffect(addCommonOptions(program.command('map').argument('[paths...]', POSITIONAL_ROOTS))
    .description('Generate visual map of codebase')
    .action(handleGenerateCommand), 'write-local', 'conditional');

  const graphCmd = addCommonOptions(program.command('graph').argument('[paths...]', POSITIONAL_ROOTS))
    .description('Generate control flow (CFG) and data flow (DFG) graphs')
    .action(handleGenerateCommand);
  // `graph` is `map` with cf and df on; naming either under --with narrows to those.
  const withOption = graphCmd.options.find(o => o.long === '--with');
  if (withOption) {
    withOption.description =
      'Include feature: vars, incs, cost, docs, df, cf (repeatable); cf and df are on unless one is named, then only those [TypeScript, JavaScript, Python, Go]';
  }
  declareEffect(graphCmd, 'write-local', 'conditional');

  // Query command - call graph queries
  declareEffect(addQueryOutputFlags(addGraphSourceOptions(
    program
      .command('query')
      .description('Query call graph using function-based syntax')
      .argument('[query]', 'Query string (e.g., "calls(main)", "callers(processData)")')
  ))
    .option('--list-adapters', 'List available query adapters')
    .addHelpText('after', `
Without --graph the graph is built in memory for the configured roots
(--path, --lens, --scope; same resolution as \`impact\` and \`map --format
json\`) and no map file is written.

Examples:
  xray query "calls(main)"
  xray query -p ./api "callers(validateInput)"
  xray query --graph graph.json "calls(main)"
`)
    .action(runQueryCommand), 'read', 'yes');

  // Impact command - transitive callers of a symbol, grouped by area
  registerImpactCommand(program);

  // Imports command - per-file imports as the xray.imports/v1 contract
  registerImportsCommand(program);

  // Strategy management command
  program.addCommand(registerStrategyCommand());

  // Alias management command
  program.addCommand(registerAliasCommand());

  // Language pack management command
  program.addCommand(registerLangCommand());

  // System commands
  // `cache` noun-verb group (canonical form)
  const cache = new Command('cache').description('Cache management');
  declareEffect(addResultFormat(cache
    .command('clear')
    .description('Clear SQLite cache for this project'))
    .action(handleClearCacheAction), 'destructive-local', 'yes');
  program.addCommand(cache);

  // Hidden alias of `cache clear` for backwards compatibility
  declareEffect(addResultFormat(program
    .command('clear-cache', { hidden: true })
    .description('[deprecated alias of `cache clear`] Clear SQLite cache for this project'))
    .action(handleClearCacheAction), 'destructive-local', 'yes');

  // Introspect xray's own runtime paths (config + cache locations).
  // Note: distinct from the `config-files` strategy, which analyzes config files
  // in the user's project.
  registerPathsCommand(program);

  // Machine-readable capability surface (12fc Factor 1).
  // Walks the constructed commander tree and emits a JSON document
  // documenting every command's args, options, side-effect class,
  // idempotency, and exit codes.
  const describe = program
    .command('describe')
    .description('Emit machine-readable capability surface (12fc Factor 1)')
    .option('--format <fmt>', 'Output format (json)', 'json')
    .action(handleDescribeAction);
  declareEffect(describe, 'read', 'yes');
  bindFlag(describe, 'format', staticValues('json'));

  // Release check (no install action).
  registerUpgradeCommand(program);

  // Read-only analysis commands as MCP tools over stdio.
  registerMcpCommand(program);

  // `completion bash|zsh|fish|powershell` (kit, cobra protocol).
  registerCompletionCommand(program);

  for (const cmd of program.commands) {
    const group = CORE_GROUPS[cmd.name()];
    if (group) setCommandGroup(cmd, group);
  }
}
