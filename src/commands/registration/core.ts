// src/commands/registration/core.ts
import { Command } from 'commander';
import { addCommonOptions } from '../common';
import { addGraphSourceOptions } from '../graph-source';
import { handleGenerateCommand } from '../generate';
import { handleClearCacheAction } from '../clear-cache';
import { registerCompletionCommand } from '../completion';
import { addQueryOutputFlags, runQueryCommand } from '../query';
import { registerImpactCommand } from '../impact';
import { registerImportsCommand } from '../imports';
import { registerSpecCommand } from '../describe';
import { registerStrategyCommand } from '../strategy-cmd';
import { registerAliasCommand } from '../alias';
import { registerConfigCommand } from '../paths';
import { registerLangCommand } from '../lang';
import { registerWatchCommand } from '../watch';
import { registerTuiCommand } from '../tui';
import { registerServeCommand } from '../serve';
import { registerUpgradeCommand } from '../upgrade';
import { registerHandbookCommand } from '../handbook';
import { registerDiagramCommand } from '../diagram';
import { registerAskCommand } from '../ask';
import { registerReviewCommand } from '../review';
import { registerSkillsCommand } from '../skills';
import { setCommandGroup, type HelpGroupId } from '../kit-cli';
import { declareEffect } from '../side-effect';
import { addResultFormat } from '../../lib/result-format';

// Root help group per top-level command name; unlisted/hidden commands
// fall into kit's default section.
const CORE_GROUPS: Record<string, HelpGroupId> = {
  // ANALYZE
  map: 'analyze',
  query: 'analyze',
  impact: 'analyze',
  imports: 'analyze',
  review: 'analyze',
  ask: 'analyze',
  // COMPOSE
  handbook: 'compose',
  diagram: 'compose',
  // INTERACT
  tui: 'interact',
  // LIFECYCLE
  serve: 'lifecycle',
  watch: 'lifecycle',
  // MANAGEMENT (hidden from default -h)
  strategy: 'management',
  config: 'management',
  language: 'management',
  skill: 'management',
  alias: 'management',
  cache: 'management',
  spec: 'management',
  upgrade: 'management',
  completion: 'management',
};

const POSITIONAL_ROOTS = 'Root directories to analyze (same as --path; not combinable with it)';

/**
 * Register all static core commands
 * These are built-in commands that don't depend on strategy discovery
 */
export function registerCoreCommands(program: Command): void {
  // Primary map command (includes CFG/DFG flow via --flow or --with control-flow,data-flow)
  declareEffect(addCommonOptions(program.command('map').argument('[paths...]', POSITIONAL_ROOTS))
    .option('--since <ref>', 'Focus ranking on files changed since <ref> (e.g. main, HEAD~1)')
    .option('--changed', 'Focus ranking on staged and unstaged working-tree changes vs HEAD')
    .description('Generate structural codebase map (and optional CFG/DFG via --flow)')
    .action(handleGenerateCommand), 'write-local', 'conditional');

  // Query command - call graph queries
  declareEffect(addQueryOutputFlags(addGraphSourceOptions(
    program
      .command('query')
      .description('Query call graph using function-based syntax')
      .argument('[query]', 'Query string (e.g., "calls(main)", "callers(processData)")')
  ))
    .option('--filter <expr>', 'Filter query results using boolean DSL (e.g., "kind:function -file:test")')
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

  // Handbook command - deterministic architectural handbook generator
  registerHandbookCommand(program);

  // Diagram command - deterministic Mermaid architecture, call, CFG, and DFG exporter
  registerDiagramCommand(program);

  // Ask command - read-only BYOK codebase Q&A
  registerAskCommand(program);

  // Review command - deterministic diff review (with optional --llm)
  registerReviewCommand(program);

  // Watch command - live incremental background indexer
  registerWatchCommand(program);

  // Interactive terminal codebase explorer
  registerTuiCommand(program);

  // Local Web UI, read-only REST API, and MCP server (HTTP + stdio)
  registerServeCommand(program);

  // Strategy management command
  program.addCommand(registerStrategyCommand());

  // Alias management command
  program.addCommand(registerAliasCommand());

  // Workspace skill management command
  registerSkillsCommand(program);

  // Language pack management command
  program.addCommand(registerLangCommand());

  // Cache management command
  const cache = new Command('cache').description('Manage analysis cache');
  declareEffect(addResultFormat(cache
    .command('clear')
    .description('Clear SQLite cache for this project'))
    .action(handleClearCacheAction), 'destructive-local', 'yes');
  program.addCommand(cache);

  // Configuration and runtime path inspection (`config path`, `config paths`)
  registerConfigCommand(program);

  // Machine-readable capability manifest (12fc Factor 1)
  registerSpecCommand(program);

  // Release check (`upgrade check`)
  registerUpgradeCommand(program);

  // `completion bash|zsh|fish|powershell` (kit, cobra protocol)
  registerCompletionCommand(program);

  for (const cmd of program.commands) {
    const group = CORE_GROUPS[cmd.name()];
    if (group) setCommandGroup(cmd, group);
  }
}
