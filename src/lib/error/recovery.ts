/**
 * Recovery Manager - Error recovery strategies
 *
 * Key features:
 * - Determine recovery eligibility
 * - Select appropriate recovery strategy
 * - Execute recovery with retry logic
 * - Support fallback operations
 * - Track recovery statistics
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - Recovery Manager
 */

import { XrayError, UnknownError } from './types';
import { RetryHandler } from './retry';

/**
 * Types of recovery strategies
 */
export type RecoveryStrategyType = 'retry' | 'skip' | 'fallback' | 'abort';

/**
 * Recovery strategy recommendation
 */
export interface RecoveryStrategy {
  /**
   * Type of recovery strategy
   */
  type: RecoveryStrategyType;

  /**
   * Human-readable description
   */
  description: string;

  /**
   * Whether automatic recovery is recommended
   */
  automatic: boolean;
}

/**
 * Result of recovery attempt
 */
export interface RecoveryResult<T = any> {
  /**
   * Whether recovery succeeded
   */
  recovered: boolean;

  /**
   * Recovery strategy used
   */
  strategy: RecoveryStrategyType;

  /**
   * Result data (only present on success)
   */
  data?: T;

  /**
   * Error (only present on failure)
   */
  error?: XrayError;

  /**
   * Whether fallback was used
   */
  usedFallback?: boolean;
}

/**
 * Recovery statistics
 */
export interface RecoveryStats {
  /**
   * Total recovery attempts
   */
  totalAttempts: number;

  /**
   * Successful recoveries
   */
  successfulRecoveries: number;

  /**
   * Failed recoveries
   */
  failedRecoveries: number;

  /**
   * Recoveries by strategy type
   */
  byStrategy: Record<RecoveryStrategyType, number>;
}

/**
 * RecoveryManager handles error recovery strategies
 *
 * Determines if errors are recoverable, selects appropriate
 * recovery strategies, and coordinates retry/fallback logic.
 *
 * Usage:
 * ```typescript
 * const manager = new RecoveryManager();
 *
 * // Check if recoverable
 * if (manager.canRecover(error)) {
 *   const strategy = manager.getStrategy(error);
 *   console.log(strategy.description);
 * }
 *
 * // Attempt recovery
 * const result = await manager.attemptRecovery(error, async () => {
 *   return await retryOperation();
 * });
 * ```
 */
export class RecoveryManager {
  private retryHandler: RetryHandler;
  private stats: RecoveryStats;

  constructor() {
    this.retryHandler = new RetryHandler({ maxAttempts: 3 });
    this.stats = {
      totalAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      byStrategy: {
        retry: 0,
        skip: 0,
        fallback: 0,
        abort: 0,
      },
    };
  }

  /**
   * Determine if error is recoverable
   */
  canRecover(error: XrayError): boolean {
    return error.recoverable;
  }

  /**
   * Get recommended recovery strategy for error
   */
  getStrategy(error: XrayError): RecoveryStrategy {
    // Non-recoverable errors - abort
    if (!error.recoverable) {
      return {
        type: 'abort',
        description: 'Error is non-recoverable. Operation must abort.',
        automatic: false,
      };
    }

    // Retryable errors (I/O and cache) - retry
    if (error.isRetryable()) {
      return {
        type: 'retry',
        description: 'Error is transient. Retry operation with backoff.',
        automatic: true,
      };
    }

    // Recoverable but not retryable (parsing errors) - skip
    // Cache errors can also use fallback
    if (error.severity === 'warning') {
      return {
        type: 'fallback',
        description: 'Use fallback or continue without this item.',
        automatic: true,
      };
    }

    return {
      type: 'skip',
      description: 'Skip this item and continue with others.',
      automatic: true,
    };
  }

  /**
   * Attempt recovery for error
   *
   * Executes recovery strategy based on error type
   */
  async attemptRecovery<T>(
    error: XrayError,
    operation: () => Promise<T>
  ): Promise<RecoveryResult<T>> {
    const strategy = this.getStrategy(error);
    this.stats.totalAttempts++;
    this.stats.byStrategy[strategy.type]++;

    // Abort non-recoverable errors
    if (strategy.type === 'abort') {
      this.stats.failedRecoveries++;
      return {
        recovered: false,
        strategy: 'abort',
        error,
      };
    }

    // Skip non-retryable errors
    if (strategy.type === 'skip') {
      this.stats.failedRecoveries++;
      return {
        recovered: false,
        strategy: 'skip',
        error,
      };
    }

    // Retry retryable errors
    if (strategy.type === 'retry') {
      const result = await this.retryHandler.execute(operation);

      if (result.success) {
        this.stats.successfulRecoveries++;
        return {
          recovered: true,
          strategy: 'retry',
          data: result.data,
        };
      } else {
        this.stats.failedRecoveries++;
        return {
          recovered: false,
          strategy: 'retry',
          error: result.error,
        };
      }
    }

    // Fallback strategy - try operation once (caller should provide fallback)
    try {
      const data = await operation();
      this.stats.successfulRecoveries++;
      return {
        recovered: true,
        strategy: 'fallback',
        data,
      };
    } catch (err) {
      this.stats.failedRecoveries++;
      return {
        recovered: false,
        strategy: 'fallback',
        error: this.toXrayError(err),
      };
    }
  }

  /**
   * Attempt operation with fallback
   *
   * Tries primary operation, falls back to secondary if it fails
   */
  async attemptWithFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<RecoveryResult<T>> {
    this.stats.totalAttempts++;
    this.stats.byStrategy.fallback++;

    // Try primary
    try {
      const data = await primary();
      this.stats.successfulRecoveries++;
      return {
        recovered: true,
        strategy: 'fallback',
        data,
        usedFallback: false,
      };
    } catch (primaryErr) {
      // Try fallback
      try {
        const data = await fallback();
        this.stats.successfulRecoveries++;
        return {
          recovered: true,
          strategy: 'fallback',
          data,
          usedFallback: true,
        };
      } catch (fallbackErr) {
        this.stats.failedRecoveries++;
        return {
          recovered: false,
          strategy: 'fallback',
          error: this.toXrayError(fallbackErr),
          usedFallback: true,
        };
      }
    }
  }

  /**
   * Get recovery statistics
   */
  getStats(): RecoveryStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.stats = {
      totalAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      byStrategy: {
        retry: 0,
        skip: 0,
        fallback: 0,
        abort: 0,
      },
    };
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
