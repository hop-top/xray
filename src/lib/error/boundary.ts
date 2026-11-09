/**
 * Error Boundary - Stage-level error handling
 *
 * Wraps async operations with try-catch and provides:
 * - Error transformation to XrayError types
 * - Stage context for debugging
 * - Optional error callbacks
 * - Standardized result format
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - "Stage-level error boundaries"
 */

import { XrayError, UnknownError } from './types';

/**
 * Options for configuring error boundary behavior
 */
export interface BoundaryOptions {
  /**
   * Callback invoked when an error is caught
   * Useful for logging, metrics, or event emission
   */
  onError?: (error: XrayError) => void;

  /**
   * If true, rethrow the error after handling
   * Useful when error needs to propagate to caller
   */
  rethrow?: boolean;
}

/**
 * Result of boundary-wrapped operation
 */
export interface BoundaryResult<T> {
  /**
   * Whether operation completed successfully
   */
  success: boolean;

  /**
   * Stage name where operation was executed
   */
  stage: string;

  /**
   * Result data (only present on success)
   */
  data?: T;

  /**
   * Error details (only present on failure)
   */
  error?: XrayError;
}

/**
 * ErrorBoundary wraps operations with error handling
 *
 * Usage:
 * ```typescript
 * const boundary = new ErrorBoundary('file-reading');
 * const result = await boundary.execute(async () => {
 *   return readFile(path);
 * });
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error.getSuggestion());
 * }
 * ```
 */
export class ErrorBoundary {
  private stage: string;
  private options: BoundaryOptions;

  constructor(stage: string, options: BoundaryOptions = {}) {
    this.stage = stage;
    this.options = options;
  }

  /**
   * Execute an operation within the error boundary
   *
   * Catches all errors, transforms them to XrayError types,
   * and returns a standardized result
   */
  async execute<T>(operation: () => Promise<T>): Promise<BoundaryResult<T>> {
    try {
      const data = await operation();
      return {
        success: true,
        stage: this.stage,
        data,
      };
    } catch (err) {
      const xrayError = this.transformError(err);

      // Call error callback if provided
      if (this.options.onError) {
        this.options.onError(xrayError);
      }

      // Rethrow if requested
      if (this.options.rethrow) {
        throw xrayError;
      }

      return {
        success: false,
        stage: this.stage,
        error: xrayError,
      };
    }
  }

  /**
   * Transform any error to XrayError
   *
   * - XrayError: pass through unchanged
   * - Node.js errors (ENOENT, etc.): transform to appropriate XrayError
   * - Other errors: wrap as UnknownError
   */
  private transformError(err: unknown): XrayError {
    // Already an XrayError - pass through
    if (err instanceof XrayError) {
      return err;
    }

    // Standard Error object
    if (err instanceof Error) {
      // Could add pattern matching here for common Node.js errors
      // For now, wrap as UnknownError
      return new UnknownError(err.message, err);
    }

    // Non-Error object
    const message = typeof err === 'string' ? err : 'Unknown error occurred';
    return new UnknownError(message);
  }
}
