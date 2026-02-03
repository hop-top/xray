/**
 * Error Collector - Collect-and-continue pattern for batch operations
 *
 * Key features:
 * - Process multiple items without stopping on errors
 * - Return partial results when some items fail
 * - Categorize errors by severity
 * - Track success/failure statistics
 * - Optional stopping conditions (max errors, critical errors)
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - "Collect-and-continue pattern (maximize partial results)"
 */

import { XrayError, UnknownError } from './types';

/**
 * Options for configuring collector behavior
 */
export interface CollectorOptions {
  /**
   * Stop collecting after encountering a non-recoverable (critical) error
   * Default: false (continue despite critical errors)
   */
  stopOnCritical?: boolean;

  /**
   * Maximum number of errors before stopping
   * Default: undefined (no limit)
   */
  maxErrors?: number;

  /**
   * Callback invoked for each error
   * @param item - The item identifier
   * @param error - The error that occurred
   */
  onError?: (item: any, error: XrayError) => void;
}

/**
 * Result entry for successful operation
 */
export interface SuccessEntry<TItem, TResult> {
  item: TItem;
  data: TResult;
}

/**
 * Result entry for failed operation
 */
export interface ErrorEntry<TItem> {
  item: TItem;
  error: XrayError;
}

/**
 * Errors categorized by severity
 */
export interface ErrorsBySeverity {
  warning: ErrorEntry<any>[];
  error: ErrorEntry<any>[];
  critical: ErrorEntry<any>[];
}

/**
 * Final result from collector
 */
export interface CollectorResult<TItem, TResult> {
  /**
   * Whether all operations succeeded
   */
  success: boolean;

  /**
   * Whether some operations succeeded and some failed
   */
  partialSuccess: boolean;

  /**
   * Whether collection was stopped early (due to maxErrors or stopOnCritical)
   */
  stopped: boolean;

  /**
   * Successful results
   */
  results: SuccessEntry<TItem, TResult>[];

  /**
   * Failed operations
   */
  errors: ErrorEntry<TItem>[];

  /**
   * Errors categorized by severity
   */
  errorsBySeverity: ErrorsBySeverity;

  /**
   * Whether any critical errors occurred
   */
  hasCriticalErrors: boolean;

  /**
   * Total items processed (including failures)
   */
  total: number;

  /**
   * Number of successful operations
   */
  successCount: number;

  /**
   * Number of failed operations
   */
  errorCount: number;

  /**
   * Success rate (0.0 to 1.0)
   */
  successRate: number;
}

/**
 * ErrorCollector implements collect-and-continue pattern
 *
 * Processes multiple items, collecting errors without stopping,
 * to maximize partial results even when some items fail.
 *
 * Usage:
 * ```typescript
 * const collector = new ErrorCollector<string, FileData>();
 *
 * for (const filePath of filePaths) {
 *   await collector.collect(filePath, async () => {
 *     return await readFile(filePath);
 *   });
 * }
 *
 * const result = collector.getResult();
 * console.log(`Processed ${result.successCount}/${result.total} files`);
 * ```
 */
export class ErrorCollector<TItem, TResult> {
  private options: CollectorOptions;
  private results: SuccessEntry<TItem, TResult>[] = [];
  private errors: ErrorEntry<TItem>[] = [];
  private stopped = false;

  constructor(options: CollectorOptions = {}) {
    this.options = options;
  }

  /**
   * Collect result from single operation
   *
   * Executes operation and collects result or error.
   * Continues to next item even if this one fails.
   */
  async collect(
    item: TItem,
    operation: () => Promise<TResult>
  ): Promise<void> {
    // Check if we should stop
    if (this.shouldStop()) {
      this.stopped = true;
      return;
    }

    try {
      const data = await operation();
      this.results.push({ item, data });
    } catch (err) {
      const xrayError = this.toXrayError(err);
      const errorEntry: ErrorEntry<TItem> = { item, error: xrayError };
      this.errors.push(errorEntry);

      // Call error callback
      if (this.options.onError) {
        this.options.onError(item, xrayError);
      }

      // Check if this error should stop collection
      if (this.shouldStopAfterError(xrayError)) {
        this.stopped = true;
      }
    }
  }

  /**
   * Collect results from multiple items in batch
   *
   * Convenience method for processing arrays of items.
   */
  async collectAll(
    items: TItem[],
    operation: (item: TItem) => Promise<TResult>
  ): Promise<void> {
    for (const item of items) {
      if (this.stopped) {
        break;
      }
      await this.collect(item, () => operation(item));
    }
  }

  /**
   * Get final result with statistics
   */
  getResult(): CollectorResult<TItem, TResult> {
    const total = this.results.length + this.errors.length;
    const successCount = this.results.length;
    const errorCount = this.errors.length;

    const errorsBySeverity = this.categorizeErrors();
    const hasCriticalErrors = errorsBySeverity.critical.length > 0;

    const success = errorCount === 0;
    const partialSuccess = successCount > 0 && errorCount > 0;
    const successRate = total === 0 ? 0 : successCount / total;

    return {
      success,
      partialSuccess,
      stopped: this.stopped,
      results: this.results,
      errors: this.errors,
      errorsBySeverity,
      hasCriticalErrors,
      total,
      successCount,
      errorCount,
      successRate,
    };
  }

  /**
   * Check if collection should stop before processing next item
   */
  private shouldStop(): boolean {
    // Already stopped
    if (this.stopped) {
      return true;
    }

    // Check max errors limit
    if (this.options.maxErrors !== undefined) {
      if (this.errors.length >= this.options.maxErrors) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if collection should stop after this error
   */
  private shouldStopAfterError(error: XrayError): boolean {
    // Stop on non-recoverable errors if configured
    if (this.options.stopOnCritical && !error.recoverable) {
      return true;
    }

    return false;
  }

  /**
   * Categorize errors by severity
   */
  private categorizeErrors(): ErrorsBySeverity {
    const categorized: ErrorsBySeverity = {
      warning: [],
      error: [],
      critical: [],
    };

    for (const entry of this.errors) {
      categorized[entry.error.severity].push(entry);
    }

    return categorized;
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
