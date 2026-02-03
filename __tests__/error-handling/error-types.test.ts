// Jest is configured globally, no import needed
import {
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
} from '../../src/lib/error/types';

/**
 * Phase 1.1: XrayError Base Class Tests
 *
 * Testing XrayError base class behavior as specified in:
 * docs/plans/2026-02-02-error-handling-design.md#60-81
 *
 * Tests cover:
 * - Severity/recoverability assignment
 * - isRetryable() logic
 * - getSuggestion() abstract method
 */

describe('XrayError', () => {
  describe('severity and recoverability assignment', () => {
    it('assigns critical severity and non-recoverable for system errors', () => {
      // This will fail until we implement XrayError
      // Expected: XrayError with severity='critical', recoverable=false
      const error = new (class extends XrayError {
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('System failure', 'critical', false);

      expect(error.severity).toBe('critical');
      expect(error.recoverable).toBe(false);
      expect(error.message).toBe('System failure');
    });

    it('assigns warning severity and recoverable for minor issues', () => {
      const error = new (class extends XrayError {
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('Minor issue', 'warning', true);

      expect(error.severity).toBe('warning');
      expect(error.recoverable).toBe(true);
      expect(error.message).toBe('Minor issue');
    });

    it('assigns error severity and non-recoverable by default', () => {
      const error = new (class extends XrayError {
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('Default error', 'error', false);

      expect(error.severity).toBe('error');
      expect(error.recoverable).toBe(false);
    });
  });

  describe('isRetryable()', () => {
    it('returns false for non-recoverable errors', () => {
      const error = new (class extends XrayError {
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('Non-recoverable', 'error', false);

      expect(error.isRetryable()).toBe(false);
    });

    it('returns false for recoverable errors by default (parsing errors not retryable)', () => {
      const error = new (class extends XrayError {
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('Recoverable but not retryable', 'warning', true);

      expect(error.isRetryable()).toBe(false);
    });

    it('returns true when explicitly marked as retryable (I/O and cache errors)', () => {
      const error = new (class extends XrayError {
        constructor(message: string) {
          super(message, 'error', true);
          this.retryable = true; // Will be set in concrete I/O error classes
        }
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('Retryable I/O error');

      expect(error.isRetryable()).toBe(true);
    });
  });

  describe('getSuggestion() abstract method', () => {
    it('requires concrete classes to implement getSuggestion()', () => {
      const error = new (class extends XrayError {
        getSuggestion(): string {
          return 'Check file permissions';
        }
      })('File error', 'error', false);

      expect(error.getSuggestion()).toBe('Check file permissions');
    });

    it('allows different suggestions for different error types', () => {
      const fileError = new (class extends XrayError {
        getSuggestion(): string {
          return 'Check file permissions';
        }
      })('File error', 'error', false);

      const parseError = new (class extends XrayError {
        getSuggestion(): string {
          return 'Fix syntax errors in the file';
        }
      })('Parse error', 'error', false);

      expect(fileError.getSuggestion()).not.toBe(parseError.getSuggestion());
    });
  });

  describe('error properties', () => {
    it('extends Error with proper name and stack', () => {
      const error = new (class TestError extends XrayError {
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('Test message', 'error', false);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('TestError');
      expect(error.stack).toBeDefined();
    });

    it('preserves original error cause when provided', () => {
      const cause = new Error('Original error');
      const error = new (class extends XrayError {
        getSuggestion(): string {
          return 'Test suggestion';
        }
      })('Wrapped error', 'error', false, cause);

      expect(error.cause).toBe(cause);
    });
  });
});

/**
 * Phase 1.3: Concrete Error Classes Tests
 *
 * Testing concrete error implementations as specified in:
 * docs/plans/2026-02-02-error-handling-design.md#96-194
 *
 * Tests cover:
 * - Correct severity/recoverability for each error type
 * - getSuggestion() returns actionable text
 * - Retryable flag set correctly for I/O and cache errors
 */

describe('FileReadError', () => {
  it('has error severity and is recoverable', () => {
    const error = new FileReadError('/path/to/file.ts');

    expect(error.severity).toBe('error');
    expect(error.recoverable).toBe(true);
    expect(error.message).toBe('Failed to read file: /path/to/file.ts');
  });

  it('is retryable (I/O operation)', () => {
    const error = new FileReadError('/path/to/file.ts');

    expect(error.isRetryable()).toBe(true);
  });

  it('provides actionable suggestion', () => {
    const error = new FileReadError('/path/to/file.ts');

    expect(error.getSuggestion()).toContain('file');
    expect(error.getSuggestion().length).toBeGreaterThan(10);
  });

  it('preserves cause error', () => {
    const cause = new Error('ENOENT');
    const error = new FileReadError('/path/to/file.ts', cause);

    expect(error.cause).toBe(cause);
  });
});

describe('FileAccessError', () => {
  it('has error severity and is recoverable', () => {
    const error = new FileAccessError('/path/to/file.ts');

    expect(error.severity).toBe('error');
    expect(error.recoverable).toBe(true);
  });

  it('is retryable (I/O operation)', () => {
    const error = new FileAccessError('/path/to/file.ts');

    expect(error.isRetryable()).toBe(true);
  });

  it('provides actionable suggestion about permissions', () => {
    const error = new FileAccessError('/path/to/file.ts');

    expect(error.getSuggestion()).toMatch(/permission|access/i);
  });
});

describe('ParseError', () => {
  it('has error severity and is recoverable', () => {
    const error = new ParseError('/path/to/file.ts', 'TypeScript');

    expect(error.severity).toBe('error');
    expect(error.recoverable).toBe(true);
  });

  it('is NOT retryable (parsing is deterministic)', () => {
    const error = new ParseError('/path/to/file.ts', 'TypeScript');

    expect(error.isRetryable()).toBe(false);
  });

  it('includes file and language in message', () => {
    const error = new ParseError('/path/to/file.ts', 'TypeScript');

    expect(error.message).toContain('/path/to/file.ts');
    expect(error.message).toContain('TypeScript');
  });

  it('provides actionable suggestion about syntax', () => {
    const error = new ParseError('/path/to/file.ts', 'TypeScript');

    expect(error.getSuggestion()).toMatch(/syntax|valid/i);
  });
});

describe('CacheReadError', () => {
  it('has warning severity and is recoverable', () => {
    const error = new CacheReadError('metadata');

    expect(error.severity).toBe('warning');
    expect(error.recoverable).toBe(true);
  });

  it('is retryable (cache I/O operation)', () => {
    const error = new CacheReadError('metadata');

    expect(error.isRetryable()).toBe(true);
  });

  it('provides actionable suggestion', () => {
    const error = new CacheReadError('metadata');

    expect(error.getSuggestion()).toMatch(/cache|rebuild/i);
  });
});

describe('CacheWriteError', () => {
  it('has warning severity and is recoverable', () => {
    const error = new CacheWriteError('metadata');

    expect(error.severity).toBe('warning');
    expect(error.recoverable).toBe(true);
  });

  it('is retryable (cache I/O operation)', () => {
    const error = new CacheWriteError('metadata');

    expect(error.isRetryable()).toBe(true);
  });

  it('provides actionable suggestion', () => {
    const error = new CacheWriteError('metadata');

    expect(error.getSuggestion()).toMatch(/cache|disk space|permission/i);
  });
});

describe('GraphBuildError', () => {
  it('has error severity and is non-recoverable', () => {
    const error = new GraphBuildError('Circular dependency detected');

    expect(error.severity).toBe('error');
    expect(error.recoverable).toBe(false);
  });

  it('is NOT retryable (non-recoverable)', () => {
    const error = new GraphBuildError('Circular dependency detected');

    expect(error.isRetryable()).toBe(false);
  });

  it('includes reason in message', () => {
    const error = new GraphBuildError('Circular dependency detected');

    expect(error.message).toContain('Circular dependency detected');
  });

  it('provides actionable suggestion', () => {
    const error = new GraphBuildError('Circular dependency detected');

    expect(error.getSuggestion()).toMatch(/graph|structure/i);
  });
});

describe('RankError', () => {
  it('has error severity and is non-recoverable', () => {
    const error = new RankError('Invalid rank configuration');

    expect(error.severity).toBe('error');
    expect(error.recoverable).toBe(false);
  });

  it('is NOT retryable (non-recoverable)', () => {
    const error = new RankError('Invalid rank configuration');

    expect(error.isRetryable()).toBe(false);
  });

  it('provides actionable suggestion', () => {
    const error = new RankError('Invalid rank configuration');

    expect(error.getSuggestion()).toMatch(/rank|algorithm/i);
  });
});

describe('ConfigValidationError', () => {
  it('has critical severity and is non-recoverable', () => {
    const error = new ConfigValidationError('Missing required field: rootDir');

    expect(error.severity).toBe('critical');
    expect(error.recoverable).toBe(false);
  });

  it('is NOT retryable (non-recoverable)', () => {
    const error = new ConfigValidationError('Missing required field: rootDir');

    expect(error.isRetryable()).toBe(false);
  });

  it('includes validation details in message', () => {
    const error = new ConfigValidationError('Missing required field: rootDir');

    expect(error.message).toContain('Missing required field: rootDir');
  });

  it('provides actionable suggestion about config', () => {
    const error = new ConfigValidationError('Missing required field: rootDir');

    expect(error.getSuggestion()).toMatch(/config|configuration/i);
  });
});

describe('GraphQueryError', () => {
  it('has error severity and is non-recoverable', () => {
    const error = new GraphQueryError('Invalid query syntax');

    expect(error.severity).toBe('error');
    expect(error.recoverable).toBe(false);
  });

  it('is NOT retryable (non-recoverable)', () => {
    const error = new GraphQueryError('Invalid query syntax');

    expect(error.isRetryable()).toBe(false);
  });

  it('provides actionable suggestion about query', () => {
    const error = new GraphQueryError('Invalid query syntax');

    expect(error.getSuggestion()).toMatch(/query|syntax/i);
  });
});

describe('UnknownError', () => {
  it('has critical severity and is non-recoverable', () => {
    const error = new UnknownError('Something went wrong');

    expect(error.severity).toBe('critical');
    expect(error.recoverable).toBe(false);
  });

  it('is NOT retryable (non-recoverable)', () => {
    const error = new UnknownError('Something went wrong');

    expect(error.isRetryable()).toBe(false);
  });

  it('wraps original error as cause', () => {
    const cause = new Error('Original error');
    const error = new UnknownError('Something went wrong', cause);

    expect(error.cause).toBe(cause);
  });

  it('provides actionable suggestion about reporting', () => {
    const error = new UnknownError('Something went wrong');

    expect(error.getSuggestion()).toMatch(/report|issue|unexpected/i);
  });
});

