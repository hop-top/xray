/**
 * Phase 3: Retry Handler Tests
 *
 * Testing RetryHandler for selective retry logic
 *
 * Key behaviors:
 * - Retry only retryable errors (I/O + cache)
 * - Never retry parsing errors (deterministic)
 * - Exponential backoff between retries
 * - Configurable max attempts
 * - Collect all retry attempts for debugging
 * - Stop early if error becomes non-retryable
 */

import {
  RetryHandler,
  RetryOptions,
  RetryResult,
} from '../../src/lib/error/retry';
import {
  FileReadError,
  ParseError,
  CacheReadError,
  GraphBuildError,
} from '../../src/lib/error/types';

describe('RetryHandler', () => {
  describe('shouldRetry() - retry eligibility', () => {
    it('returns true for retryable errors', async () => {
      const handler = new RetryHandler();
      const error = new FileReadError('/test/file.ts');

      const result = await handler.execute(async () => {
        throw error;
      });

      // Should have attempted retries
      expect(result.attempts).toBeGreaterThan(1);
    });

    it('returns false for non-retryable errors', async () => {
      const handler = new RetryHandler();
      const error = new ParseError('/test/file.ts', 'TypeScript');

      const result = await handler.execute(async () => {
        throw error;
      });

      // Should not retry parsing errors
      expect(result.attempts).toBe(1);
    });

    it('returns false for non-recoverable errors', async () => {
      const handler = new RetryHandler();
      const error = new GraphBuildError('Circular dependency');

      const result = await handler.execute(async () => {
        throw error;
      });

      // Should not retry non-recoverable errors
      expect(result.attempts).toBe(1);
    });
  });

  describe('execute() - retry logic', () => {
    it('succeeds on first attempt when operation works', async () => {
      const handler = new RetryHandler();

      const result = await handler.execute(async () => {
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('retries up to max attempts for retryable errors', async () => {
      const handler = new RetryHandler({ maxAttempts: 3 });
      let callCount = 0;

      const result = await handler.execute(async () => {
        callCount++;
        throw new FileReadError('/test/file.ts');
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(callCount).toBe(3);
      expect(result.errors).toHaveLength(3);
    });

    it('stops retrying after successful attempt', async () => {
      const handler = new RetryHandler({ maxAttempts: 5 });
      let callCount = 0;

      const result = await handler.execute(async () => {
        callCount++;
        if (callCount < 3) {
          throw new FileReadError('/test/file.ts');
        }
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(3);
      expect(result.errors).toHaveLength(2);
    });

    it('does not retry non-retryable errors', async () => {
      const handler = new RetryHandler({ maxAttempts: 3 });
      let callCount = 0;

      const result = await handler.execute(async () => {
        callCount++;
        throw new ParseError('/test/file.ts', 'TypeScript');
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });
  });

  describe('exponential backoff', () => {
    it('waits between retry attempts', async () => {
      const handler = new RetryHandler({
        maxAttempts: 3,
        baseDelay: 10,
      });

      const start = Date.now();

      await handler.execute(async () => {
        throw new CacheReadError('test');
      });

      const elapsed = Date.now() - start;

      // Should have delayed between attempts
      // baseDelay=10ms: attempt 1 immediate, attempt 2 after 10ms, attempt 3 after 20ms
      // Total minimum: ~30ms (but be lenient due to timing variance)
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });

    it('uses exponential backoff (delay doubles each retry)', async () => {
      const handler = new RetryHandler({
        maxAttempts: 4,
        baseDelay: 10,
      });

      const timestamps: number[] = [];

      await handler.execute(async () => {
        timestamps.push(Date.now());
        throw new CacheReadError('test');
      });

      // Check delays increased: ~0ms, ~10ms, ~20ms, ~40ms
      expect(timestamps).toHaveLength(4);

      if (timestamps.length >= 3) {
        const delay1 = timestamps[1] - timestamps[0];
        const delay2 = timestamps[2] - timestamps[1];

        // Second delay should be roughly double the first (within tolerance)
        expect(delay2).toBeGreaterThanOrEqual(delay1 * 1.5);
      }
    });

    it('respects maxDelay cap', async () => {
      const handler = new RetryHandler({
        maxAttempts: 5,
        baseDelay: 100,
        maxDelay: 150,
      });

      const timestamps: number[] = [];

      await handler.execute(async () => {
        timestamps.push(Date.now());
        throw new CacheReadError('test');
      });

      // Even with exponential backoff, delays should not exceed maxDelay
      for (let i = 1; i < timestamps.length; i++) {
        const delay = timestamps[i] - timestamps[i - 1];
        expect(delay).toBeLessThanOrEqual(200); // maxDelay + tolerance
      }
    });
  });

  describe('retry result', () => {
    it('includes all error attempts', async () => {
      const handler = new RetryHandler({ maxAttempts: 3 });

      const result = await handler.execute(async () => {
        throw new FileReadError('/test/file.ts');
      });

      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toBeInstanceOf(FileReadError);
      expect(result.errors[1]).toBeInstanceOf(FileReadError);
      expect(result.errors[2]).toBeInstanceOf(FileReadError);
    });

    it('includes attempt count', async () => {
      const handler = new RetryHandler({ maxAttempts: 4 });

      const result = await handler.execute(async () => {
        throw new CacheReadError('test');
      });

      expect(result.attempts).toBe(4);
    });

    it('returns last error when all retries exhausted', async () => {
      const handler = new RetryHandler({ maxAttempts: 3 });

      const result = await handler.execute(async () => {
        throw new FileReadError('/test/file.ts');
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(FileReadError);
      expect(result.error?.message).toContain('/test/file.ts');
    });
  });

  describe('options - maxAttempts', () => {
    it('defaults to 3 attempts', async () => {
      const handler = new RetryHandler();
      let callCount = 0;

      await handler.execute(async () => {
        callCount++;
        throw new FileReadError('/test/file.ts');
      });

      expect(callCount).toBe(3);
    });

    it('respects custom maxAttempts', async () => {
      const handler = new RetryHandler({ maxAttempts: 5 });
      let callCount = 0;

      await handler.execute(async () => {
        callCount++;
        throw new FileReadError('/test/file.ts');
      });

      expect(callCount).toBe(5);
    });

    it('allows single attempt (no retry)', async () => {
      const handler = new RetryHandler({ maxAttempts: 1 });
      let callCount = 0;

      await handler.execute(async () => {
        callCount++;
        throw new FileReadError('/test/file.ts');
      });

      expect(callCount).toBe(1);
    });
  });

  describe('options - onRetry callback', () => {
    it('calls onRetry before each retry attempt', async () => {
      const retries: Array<{ attempt: number; error: any }> = [];

      const handler = new RetryHandler({
        maxAttempts: 3,
        onRetry: (attempt: number, error: any) => {
          retries.push({ attempt, error });
        },
      });

      await handler.execute(async () => {
        throw new FileReadError('/test/file.ts');
      });

      // onRetry called before attempt 2 and 3 (not before first attempt)
      expect(retries).toHaveLength(2);
      expect(retries[0].attempt).toBe(2);
      expect(retries[1].attempt).toBe(3);
    });

    it('does not call onRetry when no retry occurs', async () => {
      let retryCalled = false;

      const handler = new RetryHandler({
        maxAttempts: 3,
        onRetry: () => {
          retryCalled = true;
        },
      });

      await handler.execute(async () => {
        return 'success';
      });

      expect(retryCalled).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles operation that throws non-Error objects', async () => {
      const handler = new RetryHandler();

      const result = await handler.execute(async () => {
        throw 'string error';
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('handles operation that returns undefined', async () => {
      const handler = new RetryHandler();

      const result = await handler.execute(async () => {
        return undefined;
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('handles operation that returns null', async () => {
      const handler = new RetryHandler();

      const result = await handler.execute(async () => {
        return null;
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });
});
