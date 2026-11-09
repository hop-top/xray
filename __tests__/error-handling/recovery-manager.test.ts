/**
 * Phase 6: Recovery Manager Tests
 *
 * Testing RecoveryManager for error recovery strategies
 *
 * Key behaviors:
 * - Determine if error is recoverable
 * - Provide recovery strategies based on error type
 * - Track recovery attempts
 * - Support fallback operations
 * - Coordinate retry and collector for recovery
 */

import {
  RecoveryManager,
  RecoveryStrategy,
  RecoveryResult,
} from '../../src/lib/error/recovery';
import {
  FileReadError,
  FileAccessError,
  ParseError,
  CacheReadError,
  GraphBuildError,
  ConfigValidationError,
} from '../../src/lib/error/types';

describe('RecoveryManager', () => {
  describe('canRecover() - recovery eligibility', () => {
    it('returns true for recoverable errors', () => {
      const manager = new RecoveryManager();

      expect(manager.canRecover(new FileReadError('/test.ts'))).toBe(true);
      expect(manager.canRecover(new ParseError('/test.ts', 'TypeScript'))).toBe(true);
      expect(manager.canRecover(new CacheReadError('metadata'))).toBe(true);
    });

    it('returns false for non-recoverable errors', () => {
      const manager = new RecoveryManager();

      expect(manager.canRecover(new GraphBuildError('failed'))).toBe(false);
      expect(manager.canRecover(new ConfigValidationError('invalid'))).toBe(false);
    });
  });

  describe('getStrategy() - recovery strategy selection', () => {
    it('suggests retry for I/O errors', () => {
      const manager = new RecoveryManager();
      const error = new FileReadError('/test/file.ts');

      const strategy = manager.getStrategy(error);

      expect(strategy.type).toBe('retry');
      expect(strategy.description).toContain('Retry');
    });

    it('suggests skip for parsing errors', () => {
      const manager = new RecoveryManager();
      const error = new ParseError('/test/file.ts', 'TypeScript');

      const strategy = manager.getStrategy(error);

      expect(strategy.type).toBe('skip');
      expect(strategy.description).toContain('Skip');
    });

    it('suggests retry for cache errors (retryable I/O)', () => {
      const manager = new RecoveryManager();
      const error = new CacheReadError('metadata');

      const strategy = manager.getStrategy(error);

      // Cache errors are retryable I/O operations
      expect(strategy.type).toBe('retry');
      expect(strategy.description).toContain('Retry');
    });

    it('suggests abort for non-recoverable errors', () => {
      const manager = new RecoveryManager();
      const error = new GraphBuildError('circular dependency');

      const strategy = manager.getStrategy(error);

      expect(strategy.type).toBe('abort');
      expect(strategy.description).toContain('abort');
    });
  });

  describe('attemptRecovery() - recovery execution', () => {
    it('executes retry recovery successfully', async () => {
      const manager = new RecoveryManager();
      let attempts = 0;

      const result = await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new FileReadError('/test.ts');
          }
          return 'success';
        }
      );

      expect(result.recovered).toBe(true);
      expect(result.data).toBe('success');
      expect(result.strategy).toBe('retry');
    });

    it('returns failure when recovery fails', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => {
          throw new FileReadError('/test.ts');
        }
      );

      expect(result.recovered).toBe(false);
      expect(result.error).toBeInstanceOf(FileReadError);
    });

    it('skips operation for non-retryable errors', async () => {
      const manager = new RecoveryManager();
      let operationCalled = false;

      const result = await manager.attemptRecovery(
        new ParseError('/test.ts', 'TypeScript'),
        async () => {
          operationCalled = true;
          return 'success';
        }
      );

      // Should not retry parsing errors
      expect(result.recovered).toBe(false);
      expect(result.strategy).toBe('skip');
    });

    it('aborts for non-recoverable errors', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptRecovery(
        new GraphBuildError('failed'),
        async () => {
          return 'success';
        }
      );

      expect(result.recovered).toBe(false);
      expect(result.strategy).toBe('abort');
    });
  });

  describe('attemptWithFallback() - fallback recovery', () => {
    it('uses primary operation when successful', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptWithFallback(
        async () => 'primary',
        async () => 'fallback'
      );

      expect(result.recovered).toBe(true);
      expect(result.data).toBe('primary');
      expect(result.usedFallback).toBe(false);
    });

    it('falls back when primary fails', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptWithFallback(
        async () => {
          throw new FileReadError('/test.ts');
        },
        async () => 'fallback'
      );

      expect(result.recovered).toBe(true);
      expect(result.data).toBe('fallback');
      expect(result.usedFallback).toBe(true);
    });

    it('fails when both primary and fallback fail', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptWithFallback(
        async () => {
          throw new FileReadError('/test.ts');
        },
        async () => {
          throw new FileReadError('/fallback.ts');
        }
      );

      expect(result.recovered).toBe(false);
      expect(result.usedFallback).toBe(true);
      expect(result.error).toBeInstanceOf(FileReadError);
    });
  });

  describe('recovery tracking', () => {
    it('tracks number of recovery attempts', async () => {
      const manager = new RecoveryManager();

      await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => {
          throw new FileReadError('/test.ts');
        }
      );

      const stats = manager.getStats();

      expect(stats.totalAttempts).toBeGreaterThan(0);
    });

    it('tracks successful recoveries', async () => {
      const manager = new RecoveryManager();

      await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => 'success'
      );

      const stats = manager.getStats();

      expect(stats.successfulRecoveries).toBe(1);
    });

    it('tracks failed recoveries', async () => {
      const manager = new RecoveryManager();

      await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => {
          throw new FileReadError('/test.ts');
        }
      );

      const stats = manager.getStats();

      expect(stats.failedRecoveries).toBeGreaterThan(0);
    });

    it('tracks recovery by strategy type', async () => {
      const manager = new RecoveryManager();

      await manager.attemptRecovery(
        new FileReadError('/test1.ts'),
        async () => 'success'
      );

      await manager.attemptRecovery(
        new ParseError('/test2.ts', 'TypeScript'),
        async () => 'success'
      );

      const stats = manager.getStats();

      expect(stats.byStrategy.retry).toBeGreaterThan(0);
      expect(stats.byStrategy.skip).toBeGreaterThan(0);
    });
  });

  describe('reset()', () => {
    it('resets recovery statistics', async () => {
      const manager = new RecoveryManager();

      await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => 'success'
      );

      manager.reset();

      const stats = manager.getStats();

      expect(stats.totalAttempts).toBe(0);
      expect(stats.successfulRecoveries).toBe(0);
      expect(stats.failedRecoveries).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles operation that returns undefined', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => undefined
      );

      expect(result.recovered).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('handles operation that returns null', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptRecovery(
        new FileReadError('/test.ts'),
        async () => null
      );

      expect(result.recovered).toBe(true);
      expect(result.data).toBeNull();
    });

    it('handles errors during fallback', async () => {
      const manager = new RecoveryManager();

      const result = await manager.attemptWithFallback(
        async () => {
          throw new CacheReadError('primary');
        },
        async () => {
          throw new Error('fallback error');
        }
      );

      expect(result.recovered).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
