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

/**
 * CLI Exit Code Taxonomy
 *
 * Maps error categories to POSIX-style exit codes so callers (humans, agents,
 * pipelines) can distinguish failure modes without parsing stderr. The
 * numbers come from `@hop-top/kit` (12-Factor AI-CLI Apps, Factor 11); they
 * are re-exported here, never redefined.
 *
 * - 0   success
 * - 1   generic unexpected error (default; non-CodedError throws)
 * - 2   usage error (bad flag, missing required arg, commander parse failure)
 * - 3   not-found (alias, config, strategy, file path)
 * - 4   conflict (name collision, resource already exists)
 * - 5   unauthorized / permission denied
 * - 6   transient (a retry may clear it)
 * - 7   consent refused (re-invoke with --confirm=yes)
 */
// Legacy `node` module resolution ignores kit's `exports` map: types come
// from dist, the runtime require goes through the exported subpath.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const kitExit = require('@hop-top/kit/output') as typeof import('@hop-top/kit/dist/output');

export const EXIT_SUCCESS: number = kitExit.EXIT_OK;
export const EXIT_GENERIC: number = kitExit.EXIT_GENERIC;
export const EXIT_USAGE: number = kitExit.EXIT_USAGE;
export const EXIT_NOT_FOUND: number = kitExit.EXIT_NOT_FOUND;
export const EXIT_CONFLICT: number = kitExit.EXIT_CONFLICT;
export const EXIT_UNAUTHORIZED: number = kitExit.EXIT_UNAUTHORIZED;
export const EXIT_TRANSIENT: number = kitExit.EXIT_TRANSIENT;
export const EXIT_CONSENT_REFUSED: number = kitExit.EXIT_CONSENT_REFUSED;

const CODED_BRAND = Symbol.for('xray.CodedError');

/**
 * Base class for CLI-level errors that carry a structured exit code.
 *
 * Throw a CodedError (or subclass) from any command handler instead of calling
 * process.exit directly. The top-level dispatcher in src/commands catches
 * CodedError and exits with err.exitCode; everything else exits 1.
 */
export class CodedError extends Error {
  /**
   * Built-in strategies are compiled into a second copy of this module
   * (dist/src/lib), so a plain prototype check misses their errors.
   * `instanceof CodedError` matches the brand; subclasses keep the
   * prototype check.
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (this === CodedError) {
      return typeof value === 'object' && value !== null &&
        (value as Record<symbol, unknown>)[CODED_BRAND] === true;
    }
    return Function.prototype[Symbol.hasInstance].call(this, value);
  }

  readonly [CODED_BRAND] = true;
  readonly exitCode: number;
  readonly code: string;
  cause?: Error;
  /** Valid names to retry with: the envelope's `alternatives`. */
  alternatives?: string[];
  /** One line of what to do instead: the envelope's `suggested_fix`. */
  suggestedFix?: string;

  constructor(message: string, exitCode: number, code: string, cause?: Error) {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
    this.name = this.constructor.name;
    if (cause) {
      this.cause = cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Attach machine-readable help to a coded error. It travels in the JSON
 * envelope (`alternatives`, `suggested_fix`); text mode prints its own.
 */
export function withHelp<E extends CodedError>(err: E, help: { alternatives?: string[]; suggestedFix?: string }): E {
  if (help.alternatives && help.alternatives.length > 0) err.alternatives = [...help.alternatives];
  if (help.suggestedFix) err.suggestedFix = help.suggestedFix;
  return err;
}

/**
 * Usage error: invalid invocation, bad flag, missing required arg.
 * Exit code 2.
 */
export class UsageError extends CodedError {
  constructor(message: string, cause?: Error) {
    super(message, EXIT_USAGE, 'USAGE', cause);
  }
}

/**
 * Not-found error: alias/config/strategy/file path missing.
 * Exit code 3.
 */
export class NotFoundError extends CodedError {
  constructor(message: string, cause?: Error) {
    super(message, EXIT_NOT_FOUND, 'NOT_FOUND', cause);
  }
}

/**
 * Conflict error: name collision with built-in command or other resource.
 * Exit code 4 (kit EXIT_CONFLICT).
 */
export class ConflictError extends CodedError {
  constructor(message: string, cause?: Error) {
    super(message, EXIT_CONFLICT, 'CONFLICT', cause);
  }
}

/**
 * Unauthorized error: authentication/permission failure (reserved).
 * Exit code 5 (kit EXIT_UNAUTHORIZED).
 */
export class UnauthorizedError extends CodedError {
  constructor(message: string, cause?: Error) {
    super(message, EXIT_UNAUTHORIZED, 'UNAUTHORIZED', cause);
  }
}

/**
 * Transient error: the operation failed for a reason a retry may clear
 * (network down, remote unavailable). Exit code 6 (kit EXIT_TRANSIENT).
 */
export class TransientError extends CodedError {
  constructor(message: string, cause?: Error) {
    super(message, EXIT_TRANSIENT, 'TRANSIENT', cause);
  }
}
