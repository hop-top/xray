/**
 * Phase 2: Error Boundary Tests
 *
 * Testing ErrorBoundary for stage-level error handling
 *
 * Key behaviors:
 * - Wraps async operations with try-catch
 * - Catches and transforms errors to XrayError types
 * - Provides stage context for errors
 * - Integrates with event system
 * - Allows graceful continuation after errors
 */

import {
  ErrorBoundary,
  BoundaryOptions,
} from '../../src/lib/error/boundary';
import {
  XrayError,
  FileReadError,
  UnknownError,
} from '../../src/lib/error/types';

describe('ErrorBoundary', () => {
  describe('execute() - wrapping operations', () => {
    it('executes operation successfully and returns result', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.error).toBeUndefined();
    });

    it('catches errors and returns error result', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        throw new Error('test error');
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(XrayError);
      expect(result.data).toBeUndefined();
    });

    it('wraps non-XrayError as UnknownError', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        throw new Error('regular error');
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(UnknownError);
      expect(result.error?.cause).toBeInstanceOf(Error);
    });

    it('preserves XrayError types when caught', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        throw new FileReadError('/test/file.ts');
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(FileReadError);
    });
  });

  describe('stage context', () => {
    it('includes stage name in error context', async () => {
      const boundary = new ErrorBoundary('file-reading');

      const result = await boundary.execute(async () => {
        throw new Error('read failed');
      });

      expect(result.stage).toBe('file-reading');
    });

    it('adds stage information to wrapped errors', async () => {
      const boundary = new ErrorBoundary('parsing');

      const result = await boundary.execute(async () => {
        throw new Error('parse failed');
      });

      expect(result.error?.message).toContain('parse failed');
      expect(result.stage).toBe('parsing');
    });
  });

  describe('error transformation', () => {
    it('transforms known error patterns to XrayError types', async () => {
      const boundary = new ErrorBoundary('file-ops');

      const result = await boundary.execute(async () => {
        const err: any = new Error('ENOENT: no such file');
        err.code = 'ENOENT';
        throw err;
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(XrayError);
    });

    it('preserves stack trace information', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        throw new Error('test error');
      });

      expect(result.error?.stack).toBeDefined();
      expect(result.error?.stack).toContain('test error');
    });
  });

  describe('options - onError callback', () => {
    it('calls onError callback when error occurs', async () => {
      const errors: XrayError[] = [];
      const options: BoundaryOptions = {
        onError: (error: XrayError) => {
          errors.push(error);
        },
      };

      const boundary = new ErrorBoundary('test-stage', options);

      await boundary.execute(async () => {
        throw new FileReadError('/test/file.ts');
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(FileReadError);
    });

    it('does not call onError when operation succeeds', async () => {
      let errorCalled = false;
      const options: BoundaryOptions = {
        onError: () => {
          errorCalled = true;
        },
      };

      const boundary = new ErrorBoundary('test-stage', options);

      await boundary.execute(async () => {
        return 'success';
      });

      expect(errorCalled).toBe(false);
    });
  });

  describe('options - rethrow', () => {
    it('rethrows error when rethrow option is true', async () => {
      const options: BoundaryOptions = {
        rethrow: true,
      };

      const boundary = new ErrorBoundary('test-stage', options);

      await expect(
        boundary.execute(async () => {
          throw new FileReadError('/test/file.ts');
        })
      ).rejects.toThrow(FileReadError);
    });

    it('does not rethrow by default', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        throw new FileReadError('/test/file.ts');
      });

      expect(result.success).toBe(false);
      // Should not throw - just return error result
    });
  });

  describe('synchronous operations', () => {
    it('handles synchronous operations', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        return 42;
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('handles synchronous errors', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        throw new Error('sync error');
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('result type', () => {
    it('returns result with success, data, and stage', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        return { foo: 'bar' };
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('stage');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ foo: 'bar' });
      expect(result.stage).toBe('test-stage');
    });

    it('returns result with success, error, and stage on failure', async () => {
      const boundary = new ErrorBoundary('test-stage');

      const result = await boundary.execute(async () => {
        throw new Error('fail');
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('stage');
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(XrayError);
      expect(result.stage).toBe('test-stage');
    });
  });
});
