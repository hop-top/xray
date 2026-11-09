/**
 * Retry Handler - Selective retry logic for I/O and cache operations
 *
 * Key features:
 * - Only retry retryable errors (I/O + cache, not parsing)
 * - Exponential backoff between attempts
 * - Configurable max attempts and delays
 * - Collect all retry attempts for debugging
 * - Optional callbacks for retry events
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - "Selective retry (I/O + cache only, not parsing)"
 */

import { XrayError, UnknownError } from './types';

/**
 * Options for configuring retry behavior
 */
export interface RetryOptions {
  /**
   * Maximum number of attempts (including initial)
   * Default: 3
   */
  maxAttempts?: number;

  /**
   * Base delay in milliseconds before first retry
   * Delay doubles for each subsequent retry (exponential backoff)
   * Default: 100ms
   */
  baseDelay?: number;

  /**
   * Maximum delay in milliseconds between retries
   * Caps exponential backoff growth
   * Default: 5000ms (5 seconds)
   */
  maxDelay?: number;

  /**
   * Callback invoked before each retry attempt
   * @param attempt - The attempt number (2, 3, etc.)
   * @param error - The error from the previous attempt
   */
  onRetry?: (attempt: number, error: XrayError) => void;
}

/**
 * Result of retry operation
 */
export interface RetryResult<T> {
  /**
   * Whether operation succeeded
   */
  success: boolean;

  /**
   * Result data (only present on success)
   */
  data?: T;

  /**
   * Last error (only present on failure)
   */
  error?: XrayError;

  /**
   * All errors from all attempts
   */
  errors: XrayError[];

  /**
   * Total number of attempts made
   */
  attempts: number;
}

/**
 * RetryHandler manages retry logic for operations
 *
 * Only retries errors that are marked as retryable (I/O and cache operations).
 * Parsing errors are never retried as they are deterministic failures.
 *
 * Usage:
 * ```typescript
 * const handler = new RetryHandler({ maxAttempts: 3 });
 * const result = await handler.execute(async () => {
 *   return await readFile(path);
 * });
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(`Failed after ${result.attempts} attempts`);
 * }
 * ```
 */
export class RetryHandler {
  private maxAttempts: number;
  private baseDelay: number;
  private maxDelay: number;
  private onRetry?: (attempt: number, error: XrayError) => void;

  constructor(options: RetryOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelay = options.baseDelay ?? 100;
    this.maxDelay = options.maxDelay ?? 5000;
    this.onRetry = options.onRetry;
  }

  /**
   * Execute operation with retry logic
   *
   * Retries only if:
   * - Error is an XrayError
   * - Error is marked as retryable (isRetryable() returns true)
   * - Max attempts not yet reached
   */
  async execute<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
    const errors: XrayError[] = [];
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      attempts++;

      try {
        const data = await operation();
        return {
          success: true,
          data,
          errors,
          attempts,
        };
      } catch (err) {
        const xrayError = this.toXrayError(err);
        errors.push(xrayError);

        // Check if we should retry
        const shouldRetry = this.shouldRetry(xrayError, attempts);

        if (!shouldRetry) {
          // Don't retry - return failure immediately
          return {
            success: false,
            error: xrayError,
            errors,
            attempts,
          };
        }

        // We're going to retry - call callback and delay
        if (attempts < this.maxAttempts) {
          if (this.onRetry) {
            this.onRetry(attempts + 1, xrayError);
          }

          await this.delay(attempts + 1);
        }
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: errors[errors.length - 1],
      errors,
      attempts,
    };
  }

  /**
   * Determine if error should be retried
   */
  private shouldRetry(error: XrayError, currentAttempt: number): boolean {
    // Don't retry if we've hit max attempts
    if (currentAttempt >= this.maxAttempts) {
      return false;
    }

    // Only retry if error is marked as retryable
    return error.isRetryable();
  }

  /**
   * Calculate delay for retry attempt with exponential backoff
   */
  private async delay(attemptNumber: number): Promise<void> {
    // First attempt has no delay (attemptNumber = 1)
    if (attemptNumber === 1) {
      return;
    }

    // Exponential backoff: baseDelay * 2^(attemptNumber - 2)
    // attemptNumber = 2: baseDelay * 1 = baseDelay
    // attemptNumber = 3: baseDelay * 2
    // attemptNumber = 4: baseDelay * 4
    const exponentialDelay = this.baseDelay * Math.pow(2, attemptNumber - 2);

    // Cap at maxDelay
    const delayMs = Math.min(exponentialDelay, this.maxDelay);

    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * Convert any error to XrayError
   */
  private toXrayError(err: unknown): XrayError {
    if (err instanceof XrayError) {
      return err;
    }

    if (err instanceof Error) {
      return new UnknownError(err.message, err);
    }

    const message = typeof err === 'string' ? err : 'Unknown error occurred';
    return new UnknownError(message);
  }
}
