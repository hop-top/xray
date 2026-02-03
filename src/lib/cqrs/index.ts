/**
 * CQRS Architecture - Public API
 *
 * Provides command-query separation for Xray with:
 * - Immutable state (AnalysisState)
 * - Commands for state mutation
 * - Queries for state reading
 * - Command orchestrator for composition
 * - Full separation of concerns
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - CQRS Architecture
 */

// State
export {
  AnalysisState,
  AnalysisStateBuilder,
  StateSnapshot,
  PartialState,
} from '../state/analysis-state';

// Commands
export {
  Command,
  CommandResult,
  ScanFilesCommand,
  ScanFilesOptions,
  ParseFilesCommand,
  ParseFilesOptions,
  BuildGraphCommand,
  RankNodesCommand,
  RankNodesOptions,
} from '../commands';

// Orchestrator
export {
  CommandOrchestrator,
  OrchestratorOptions,
  Workflow,
  WorkflowResult,
  HistoryEntry,
} from '../commands/orchestrator';

// Queries
export {
  Query,
  QueryResult,
  GetFilesQuery,
  GetFilesOptions,
  GetGraphQuery,
  GetGraphOptions,
  GetNodeRanksQuery,
  GetNodeRanksOptions,
  SearchNodesQuery,
  SearchNodesOptions,
  GetStatisticsQuery,
  Statistics,
} from '../queries';
