/**
 * Phase 5: Error Formatter Tests
 *
 * Testing ErrorFormatter for user-friendly error display
 *
 * Key behaviors:
 * - Format single errors with message and suggestion
 * - Format error collections with statistics
 * - Group errors by severity
 * - Provide actionable suggestions
 * - Support different output formats (text, JSON)
 * - Color-coded severity levels (for terminal output)
 */

import {
  ErrorFormatter,
  FormatterOptions,
  FormatOutput,
} from '../../src/lib/error/formatter';
import {
  FileReadError,
  ParseError,
  CacheWriteError,
  GraphBuildError,
  ConfigValidationError,
} from '../../src/lib/error/types';
import { CollectorResult } from '../../src/lib/error/collector';

describe('ErrorFormatter', () => {
  describe('formatError() - single error formatting', () => {
    it('formats error with message and suggestion', () => {
      const formatter = new ErrorFormatter();
      const error = new FileReadError('/test/file.ts');

      const output = formatter.formatError(error);

      expect(output).toContain('Failed to read file: /test/file.ts');
      expect(output).toContain('Check that the file exists');
    });

    it('includes error severity', () => {
      const formatter = new ErrorFormatter();
      const warning = new CacheWriteError('metadata');
      const error = new FileReadError('/test/file.ts');

      const warningOutput = formatter.formatError(warning);
      const errorOutput = formatter.formatError(error);

      expect(warningOutput).toContain('WARNING');
      expect(errorOutput).toContain('ERROR');
    });

    it('formats critical errors prominently', () => {
      const formatter = new ErrorFormatter();
      const error = new ConfigValidationError('Missing required field');

      const output = formatter.formatError(error);

      expect(output).toContain('CRITICAL');
      expect(output).toContain('Missing required field');
    });

    it('includes suggestion section', () => {
      const formatter = new ErrorFormatter();
      const error = new ParseError('/test/file.ts', 'TypeScript');

      const output = formatter.formatError(error);

      expect(output).toContain('Suggestion:');
      expect(output).toContain('valid syntax');
    });
  });

  describe('formatCollection() - multiple errors', () => {
    it('formats collection with statistics', () => {
      const formatter = new ErrorFormatter();

      const mockResult: CollectorResult<string, any> = {
        success: false,
        partialSuccess: true,
        stopped: false,
        results: [
          { item: 'file1', data: {} },
          { item: 'file2', data: {} },
        ],
        errors: [
          { item: 'file3', error: new FileReadError('/file3.ts') },
        ],
        errorsBySeverity: {
          warning: [],
          error: [{ item: 'file3', error: new FileReadError('/file3.ts') }],
          critical: [],
        },
        hasCriticalErrors: false,
        total: 3,
        successCount: 2,
        errorCount: 1,
        successRate: 0.666,
      };

      const output = formatter.formatCollection(mockResult);

      expect(output).toContain('2/3'); // success count
      expect(output).toContain('1 error');
    });

    it('groups errors by severity', () => {
      const formatter = new ErrorFormatter();

      const mockResult: CollectorResult<string, any> = {
        success: false,
        partialSuccess: true,
        stopped: false,
        results: [],
        errors: [
          { item: 'file1', error: new CacheWriteError('cache') },
          { item: 'file2', error: new FileReadError('/file2.ts') },
          { item: 'file3', error: new GraphBuildError('failed') },
        ],
        errorsBySeverity: {
          warning: [{ item: 'file1', error: new CacheWriteError('cache') }],
          error: [
            { item: 'file2', error: new FileReadError('/file2.ts') },
            { item: 'file3', error: new GraphBuildError('failed') },
          ],
          critical: [],
        },
        hasCriticalErrors: false,
        total: 3,
        successCount: 0,
        errorCount: 3,
        successRate: 0,
      };

      const output = formatter.formatCollection(mockResult);

      expect(output).toContain('1 warning');
      expect(output).toContain('2 errors');
    });

    it('shows success message when no errors', () => {
      const formatter = new ErrorFormatter();

      const mockResult: CollectorResult<string, any> = {
        success: true,
        partialSuccess: false,
        stopped: false,
        results: [
          { item: 'file1', data: {} },
          { item: 'file2', data: {} },
        ],
        errors: [],
        errorsBySeverity: {
          warning: [],
          error: [],
          critical: [],
        },
        hasCriticalErrors: false,
        total: 2,
        successCount: 2,
        errorCount: 0,
        successRate: 1.0,
      };

      const output = formatter.formatCollection(mockResult);

      expect(output).toContain('Success');
      expect(output).toContain('2/2');
    });

    it('highlights critical errors', () => {
      const formatter = new ErrorFormatter();

      const criticalError = new ConfigValidationError('Invalid config');
      const mockResult: CollectorResult<string, any> = {
        success: false,
        partialSuccess: false,
        stopped: false,
        results: [],
        errors: [{ item: 'config', error: criticalError }],
        errorsBySeverity: {
          warning: [],
          error: [],
          critical: [{ item: 'config', error: criticalError }],
        },
        hasCriticalErrors: true,
        total: 1,
        successCount: 0,
        errorCount: 1,
        successRate: 0,
      };

      const output = formatter.formatCollection(mockResult);

      expect(output).toContain('1 critical error');
      expect(output).toContain('0/1'); // Shows failure rate
    });
  });

  describe('formatList() - error list', () => {
    it('formats list of errors with item identifiers', () => {
      const formatter = new ErrorFormatter();

      const errors = [
        { item: 'file1.ts', error: new FileReadError('/file1.ts') },
        { item: 'file2.ts', error: new ParseError('/file2.ts', 'TypeScript') },
      ];

      const output = formatter.formatList(errors);

      expect(output).toContain('file1.ts');
      expect(output).toContain('file2.ts');
      expect(output).toContain('Failed to read file');
      expect(output).toContain('Failed to parse');
    });

    it('limits list length when too many errors', () => {
      const formatter = new ErrorFormatter({ maxListItems: 3 });

      const errors = [
        { item: 'file1.ts', error: new FileReadError('/file1.ts') },
        { item: 'file2.ts', error: new FileReadError('/file2.ts') },
        { item: 'file3.ts', error: new FileReadError('/file3.ts') },
        { item: 'file4.ts', error: new FileReadError('/file4.ts') },
        { item: 'file5.ts', error: new FileReadError('/file5.ts') },
      ];

      const output = formatter.formatList(errors);

      expect(output).toContain('file1.ts');
      expect(output).toContain('file2.ts');
      expect(output).toContain('file3.ts');
      expect(output).toContain('2 more'); // Should show count of remaining
    });

    it('returns empty string for empty list', () => {
      const formatter = new ErrorFormatter();

      const output = formatter.formatList([]);

      expect(output).toBe('');
    });
  });

  describe('options - colors', () => {
    it('includes color codes when colors enabled', () => {
      const formatter = new ErrorFormatter({ colors: true });
      const error = new FileReadError('/test/file.ts');

      const output = formatter.formatError(error);

      // Should contain ANSI color codes
      expect(output).toMatch(/\u001b\[\d+m/); // ANSI escape sequence
    });

    it('excludes color codes when colors disabled', () => {
      const formatter = new ErrorFormatter({ colors: false });
      const error = new FileReadError('/test/file.ts');

      const output = formatter.formatError(error);

      // Should not contain ANSI color codes
      expect(output).not.toMatch(/\u001b\[\d+m/);
    });
  });

  describe('options - verbose', () => {
    it('includes stack trace in verbose mode', () => {
      const formatter = new ErrorFormatter({ verbose: true });
      const error = new FileReadError('/test/file.ts');

      const output = formatter.formatError(error);

      expect(output).toContain('Stack trace:');
      expect(output).toContain('at ');
    });

    it('excludes stack trace in non-verbose mode', () => {
      const formatter = new ErrorFormatter({ verbose: false });
      const error = new FileReadError('/test/file.ts');

      const output = formatter.formatError(error);

      expect(output).not.toContain('Stack trace:');
    });
  });

  describe('formatSummary() - summary statistics', () => {
    it('formats concise summary', () => {
      const formatter = new ErrorFormatter();

      const mockResult: CollectorResult<string, any> = {
        success: false,
        partialSuccess: true,
        stopped: false,
        results: [{ item: 'file1', data: {} }],
        errors: [
          { item: 'file2', error: new FileReadError('/file2.ts') },
          { item: 'file3', error: new CacheWriteError('cache') },
        ],
        errorsBySeverity: {
          warning: [{ item: 'file3', error: new CacheWriteError('cache') }],
          error: [{ item: 'file2', error: new FileReadError('/file2.ts') }],
          critical: [],
        },
        hasCriticalErrors: false,
        total: 3,
        successCount: 1,
        errorCount: 2,
        successRate: 0.333,
      };

      const output = formatter.formatSummary(mockResult);

      expect(output).toContain('1/3');
      expect(output).toContain('1 error');
      expect(output).toContain('1 warning');
    });

    it('shows success rate percentage', () => {
      const formatter = new ErrorFormatter();

      const mockResult: CollectorResult<string, any> = {
        success: false,
        partialSuccess: true,
        stopped: false,
        results: [
          { item: 'file1', data: {} },
          { item: 'file2', data: {} },
          { item: 'file3', data: {} },
        ],
        errors: [{ item: 'file4', error: new FileReadError('/file4.ts') }],
        errorsBySeverity: {
          warning: [],
          error: [{ item: 'file4', error: new FileReadError('/file4.ts') }],
          critical: [],
        },
        hasCriticalErrors: false,
        total: 4,
        successCount: 3,
        errorCount: 1,
        successRate: 0.75,
      };

      const output = formatter.formatSummary(mockResult);

      expect(output).toContain('75%');
    });
  });

  describe('edge cases', () => {
    it('handles errors without stack traces', () => {
      const formatter = new ErrorFormatter({ verbose: true });
      const error = new FileReadError('/test/file.ts');
      error.stack = undefined; // Remove stack

      const output = formatter.formatError(error);

      expect(output).toBeDefined();
      expect(output).toContain('Failed to read file');
    });

    it('handles very long error messages', () => {
      const formatter = new ErrorFormatter();
      const longMessage = 'a'.repeat(1000);
      const error = new GraphBuildError(longMessage);

      const output = formatter.formatError(error);

      expect(output).toBeDefined();
      expect(output.length).toBeGreaterThan(0);
    });

    it('handles special characters in messages', () => {
      const formatter = new ErrorFormatter();
      const error = new FileReadError('/test/file with spaces & special.ts');

      const output = formatter.formatError(error);

      expect(output).toContain('file with spaces & special.ts');
    });
  });
});
