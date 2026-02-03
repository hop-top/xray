/**
 * Error Handling System - Public API
 *
 * Provides comprehensive error handling for Xray with:
 * - Dual categorization (severity + recoverability)
 * - Selective retry (I/O + cache only)
 * - Collect-and-continue pattern
 * - Stage-level error boundaries
 * - User-friendly formatting
 * - Recovery strategies
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - Error Handling Architecture
 */

// Error Types
export {
  XrayError,
  FileReadError,
  FileAccessError,
  ParseError,
  CacheReadError,
  CacheWriteError,
  GraphBuildError,
  RankError,
  ConfigValidationError,
  GraphQueryError,
  UnknownError,
} from './types';

// Error Boundary
export {
  ErrorBoundary,
  BoundaryOptions,
  BoundaryResult,
} from './boundary';

// Retry Handler
export {
  RetryHandler,
  RetryOptions,
  RetryResult,
} from './retry';

// Error Collector
export {
  ErrorCollector,
  CollectorOptions,
  CollectorResult,
  SuccessEntry,
  ErrorEntry,
  ErrorsBySeverity,
} from './collector';

// Error Formatter
export {
  ErrorFormatter,
  FormatterOptions,
  FormatOutput,
} from './formatter';

// Recovery Manager
export {
  RecoveryManager,
  RecoveryStrategy,
  RecoveryResult,
  RecoveryStats,
  RecoveryStrategyType,
} from './recovery';
