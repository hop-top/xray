/**
 * Error Handling Types
 *
 * Implements dual categorization error system:
 * - Severity: User-facing impact (warning, error, critical)
 * - Recoverability: System-level recovery capability
 *
 * Reference: docs/plans/2026-02-02-error-handling-design.md
 */

/**
 * Base class for all Xray errors with dual categorization
 *
 * Severity levels (user-facing):
 * - warning: Analysis continues, partial results available
 * - error: Stage fails, but system continues with other stages
 * - critical: System-level failure, cannot continue
 *
 * Recoverability (system-facing):
 * - recoverable: Error collector can continue processing other items
 * - non-recoverable: Must stop current operation
 */
export abstract class XrayError extends Error {
  severity: 'warning' | 'error' | 'critical';
  recoverable: boolean;
  retryable?: boolean;
  cause?: Error;

  constructor(
    message: string,
    severity: 'warning' | 'error' | 'critical',
    recoverable: boolean,
    cause?: Error
  ) {
    super(message);
    this.severity = severity;
    this.recoverable = recoverable;
    this.name = this.constructor.name;

    if (cause) {
      this.cause = cause;
    }

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Determines if operation should be retried
   *
   * Retry logic:
   * - Only I/O and cache operations are retryable
   * - Parsing errors are NOT retryable (deterministic failure)
   * - Non-recoverable errors are never retryable
   */
  isRetryable(): boolean {
    if (!this.recoverable) return false;
    return this.retryable === true;
  }

  /**
   * Returns actionable suggestion for fixing the error
   *
   * Must be implemented by concrete error classes to provide
   * context-specific guidance to users
   */
  abstract getSuggestion(): string;
}

/**
 * File I/O Errors (Recoverable + Retryable)
 */

export class FileReadError extends XrayError {
  constructor(filePath: string, cause?: Error) {
    super(`Failed to read file: ${filePath}`, 'error', true, cause);
    this.retryable = true;
  }

  getSuggestion(): string {
    return 'Check that the file exists and is readable. Verify file permissions.';
  }
}

export class FileAccessError extends XrayError {
  constructor(filePath: string, cause?: Error) {
    super(`Cannot access file: ${filePath}`, 'error', true, cause);
    this.retryable = true;
  }

  getSuggestion(): string {
    return 'Check file permissions. Ensure the file is not locked by another process.';
  }
}

export class FileWriteError extends XrayError {
  constructor(filePath: string, cause?: Error) {
    super(`Failed to write file: ${filePath}`, 'error', true, cause);
    this.retryable = true;
  }

  getSuggestion(): string {
    return 'Check disk space and file permissions. Ensure the directory is writable.';
  }
}

/**
 * Parsing Errors (Recoverable + Non-Retryable)
 */

export class ParseError extends XrayError {
  constructor(filePath: string, language: string, cause?: Error) {
    super(`Failed to parse ${language} file: ${filePath}`, 'error', true, cause);
    // Parsing is deterministic - never retry
  }

  getSuggestion(): string {
    return 'Ensure the file contains valid syntax. Check for compilation errors.';
  }
}

/**
 * Cache Errors (Warning + Recoverable + Retryable)
 */

export class CacheReadError extends XrayError {
  constructor(cacheType: string, cause?: Error) {
    super(`Failed to read from cache: ${cacheType}`, 'warning', true, cause);
    this.retryable = true;
  }

  getSuggestion(): string {
    return 'Cache will be rebuilt. This may slow down analysis.';
  }
}

export class CacheWriteError extends XrayError {
  constructor(cacheType: string, cause?: Error) {
    super(`Failed to write to cache: ${cacheType}`, 'warning', true, cause);
    this.retryable = true;
  }

  getSuggestion(): string {
    return 'Check disk space and permissions. Cache will not be updated.';
  }
}

/**
 * Graph Errors (Error + Non-Recoverable)
 */

export class GraphBuildError extends XrayError {
  constructor(reason: string, cause?: Error) {
    super(`Failed to build graph: ${reason}`, 'error', false, cause);
  }

  getSuggestion(): string {
    return 'Check for circular dependencies or invalid graph structure.';
  }
}

export class RankError extends XrayError {
  constructor(reason: string, cause?: Error) {
    super(`Failed to rank nodes: ${reason}`, 'error', false, cause);
  }

  getSuggestion(): string {
    return 'Check rank algorithm configuration and graph connectivity.';
  }
}

/**
 * Configuration Errors (Critical + Non-Recoverable)
 */

export class ConfigValidationError extends XrayError {
  constructor(message: string, cause?: Error) {
    super(`Configuration validation failed: ${message}`, 'critical', false, cause);
  }

  getSuggestion(): string {
    return 'Review and fix xray configuration file. Check documentation for required fields.';
  }
}

/**
 * Query Errors (Error + Non-Recoverable)
 */

export class GraphQueryError extends XrayError {
  constructor(reason: string, cause?: Error) {
    super(`Graph query failed: ${reason}`, 'error', false, cause);
  }

  getSuggestion(): string {
    return 'Check query syntax and ensure graph is built successfully.';
  }
}

/**
 * Unknown/Unexpected Errors (Critical + Non-Recoverable)
 */

export class UnknownError extends XrayError {
  constructor(message: string, cause?: Error) {
    super(`Unexpected error: ${message}`, 'critical', false, cause);
  }

  getSuggestion(): string {
    return 'This is an unexpected error. Please report this issue with the error details.';
  }
}
