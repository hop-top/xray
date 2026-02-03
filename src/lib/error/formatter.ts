/**
 * Error Formatter - User-friendly error display
 *
 * Key features:
 * - Format single errors with message and suggestion
 * - Format error collections with statistics
 * - Group errors by severity
 * - Optional color coding for terminal output
 * - Verbose mode with stack traces
 * - Limit long error lists
 *
 * Reference: IMPLEMENTATION_CONTEXT.md - Error Formatter
 */

import { XrayError } from './types';
import { CollectorResult, ErrorEntry } from './collector';

/**
 * Options for configuring formatter behavior
 */
export interface FormatterOptions {
  /**
   * Include ANSI color codes in output
   * Default: false
   */
  colors?: boolean;

  /**
   * Include stack traces and detailed information
   * Default: false
   */
  verbose?: boolean;

  /**
   * Maximum number of items to show in error lists
   * Default: 10
   */
  maxListItems?: number;
}

/**
 * Formatted output
 */
export interface FormatOutput {
  text: string;
}

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

/**
 * ErrorFormatter formats errors for user-friendly display
 *
 * Provides methods to format single errors, error collections,
 * and summary statistics in human-readable format.
 *
 * Usage:
 * ```typescript
 * const formatter = new ErrorFormatter({ colors: true });
 *
 * // Format single error
 * const errorMsg = formatter.formatError(error);
 * console.error(errorMsg);
 *
 * // Format collection result
 * const summary = formatter.formatCollection(collectorResult);
 * console.log(summary);
 * ```
 */
export class ErrorFormatter {
  private colors: boolean;
  private verbose: boolean;
  private maxListItems: number;

  constructor(options: FormatterOptions = {}) {
    this.colors = options.colors ?? false;
    this.verbose = options.verbose ?? false;
    this.maxListItems = options.maxListItems ?? 10;
  }

  /**
   * Format single error with message and suggestion
   */
  formatError(error: XrayError): string {
    const lines: string[] = [];

    // Severity label
    const severityLabel = this.formatSeverity(error.severity);
    lines.push(`${severityLabel} ${error.message}`);

    // Suggestion
    lines.push('');
    lines.push(`${this.colorize('Suggestion:', 'bold')} ${error.getSuggestion()}`);

    // Stack trace in verbose mode
    if (this.verbose && error.stack) {
      lines.push('');
      lines.push(this.colorize('Stack trace:', 'gray'));
      lines.push(this.colorize(error.stack, 'gray'));
    }

    return lines.join('\n');
  }

  /**
   * Format collection result with statistics
   */
  formatCollection(result: CollectorResult<any, any>): string {
    const lines: string[] = [];

    // Header with statistics
    if (result.success) {
      lines.push(
        this.colorize(`✓ Success: Processed ${result.successCount}/${result.total} items`, 'green')
      );
      return lines.join('\n');
    }

    // Summary line
    const summary = `Processed ${result.successCount}/${result.total} items`;
    lines.push(this.colorize(summary, result.partialSuccess ? 'yellow' : 'red'));

    // Error breakdown by severity
    const { errorsBySeverity } = result;
    const severityCounts: string[] = [];

    if (errorsBySeverity.critical.length > 0) {
      severityCounts.push(
        this.colorize(`${errorsBySeverity.critical.length} critical error${errorsBySeverity.critical.length === 1 ? '' : 's'}`, 'red')
      );
    }

    if (errorsBySeverity.error.length > 0) {
      severityCounts.push(
        `${errorsBySeverity.error.length} error${errorsBySeverity.error.length === 1 ? '' : 's'}`
      );
    }

    if (errorsBySeverity.warning.length > 0) {
      severityCounts.push(
        this.colorize(`${errorsBySeverity.warning.length} warning${errorsBySeverity.warning.length === 1 ? '' : 's'}`, 'yellow')
      );
    }

    if (severityCounts.length > 0) {
      lines.push('  ' + severityCounts.join(', '));
    }

    return lines.join('\n');
  }

  /**
   * Format list of errors with item identifiers
   */
  formatList(errors: ErrorEntry<any>[]): string {
    if (errors.length === 0) {
      return '';
    }

    const lines: string[] = [];
    const itemsToShow = Math.min(errors.length, this.maxListItems);

    for (let i = 0; i < itemsToShow; i++) {
      const entry = errors[i];
      const severityLabel = this.formatSeverity(entry.error.severity, true);
      lines.push(`  ${severityLabel} ${entry.item}: ${entry.error.message}`);
    }

    // Show remaining count if truncated
    const remaining = errors.length - itemsToShow;
    if (remaining > 0) {
      lines.push(this.colorize(`  ... and ${remaining} more`, 'gray'));
    }

    return lines.join('\n');
  }

  /**
   * Format concise summary statistics
   */
  formatSummary(result: CollectorResult<any, any>): string {
    const parts: string[] = [];

    // Success count
    const successPart = `${result.successCount}/${result.total}`;
    parts.push(successPart);

    // Success rate percentage
    const percentage = Math.round(result.successRate * 100);
    parts.push(`(${percentage}%)`);

    // Error breakdown
    const { errorsBySeverity } = result;

    if (errorsBySeverity.error.length > 0) {
      parts.push(`${errorsBySeverity.error.length} error${errorsBySeverity.error.length === 1 ? '' : 's'}`);
    }

    if (errorsBySeverity.warning.length > 0) {
      parts.push(`${errorsBySeverity.warning.length} warning${errorsBySeverity.warning.length === 1 ? '' : 's'}`);
    }

    if (errorsBySeverity.critical.length > 0) {
      parts.push(`${errorsBySeverity.critical.length} critical`);
    }

    return parts.join(', ');
  }

  /**
   * Format severity label with optional color
   */
  private formatSeverity(severity: 'warning' | 'error' | 'critical', short = false): string {
    const labels = {
      warning: short ? '[WARN]' : '[WARNING]',
      error: short ? '[ERR]' : '[ERROR]',
      critical: short ? '[CRIT]' : '[CRITICAL]',
    };

    const colors = {
      warning: 'yellow',
      error: 'red',
      critical: 'red',
    };

    const label = labels[severity];
    const color = colors[severity] as keyof typeof COLORS;

    return this.colorize(label, color);
  }

  /**
   * Apply color to text if colors enabled
   */
  private colorize(text: string, color: keyof typeof COLORS): string {
    if (!this.colors) {
      return text;
    }

    return `${COLORS[color]}${text}${COLORS.reset}`;
  }
}
