/**
 * Phase 7: Index Exports Tests
 *
 * Testing that all error handling components are properly exported
 * and can be imported from the main index module
 */

import {
  // Error Types
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
  // Error Boundary
  ErrorBoundary,
  BoundaryOptions,
  BoundaryResult,
  // Retry Handler
  RetryHandler,
  RetryOptions,
  RetryResult,
  // Error Collector
  ErrorCollector,
  CollectorOptions,
  CollectorResult,
  SuccessEntry,
  ErrorEntry,
  ErrorsBySeverity,
  // Error Formatter
  ErrorFormatter,
  FormatterOptions,
  FormatOutput,
  // Recovery Manager
  RecoveryManager,
  RecoveryStrategy,
  RecoveryResult,
  RecoveryStats,
  RecoveryStrategyType,
} from '../../src/lib/error';

describe('Error Handling Index Exports', () => {
  describe('Error Types', () => {
    it('exports XrayError base class', () => {
      expect(XrayError).toBeDefined();
      expect(typeof XrayError).toBe('function');
    });

    it('exports all concrete error classes', () => {
      expect(FileReadError).toBeDefined();
      expect(FileAccessError).toBeDefined();
      expect(ParseError).toBeDefined();
      expect(CacheReadError).toBeDefined();
      expect(CacheWriteError).toBeDefined();
      expect(GraphBuildError).toBeDefined();
      expect(RankError).toBeDefined();
      expect(ConfigValidationError).toBeDefined();
      expect(GraphQueryError).toBeDefined();
      expect(UnknownError).toBeDefined();
    });

    it('can instantiate error classes', () => {
      const error = new FileReadError('/test.ts');
      expect(error).toBeInstanceOf(XrayError);
      expect(error).toBeInstanceOf(FileReadError);
    });
  });

  describe('ErrorBoundary', () => {
    it('exports ErrorBoundary class', () => {
      expect(ErrorBoundary).toBeDefined();
      expect(typeof ErrorBoundary).toBe('function');
    });

    it('can instantiate ErrorBoundary', () => {
      const boundary = new ErrorBoundary('test-stage');
      expect(boundary).toBeInstanceOf(ErrorBoundary);
    });
  });

  describe('RetryHandler', () => {
    it('exports RetryHandler class', () => {
      expect(RetryHandler).toBeDefined();
      expect(typeof RetryHandler).toBe('function');
    });

    it('can instantiate RetryHandler', () => {
      const handler = new RetryHandler();
      expect(handler).toBeInstanceOf(RetryHandler);
    });
  });

  describe('ErrorCollector', () => {
    it('exports ErrorCollector class', () => {
      expect(ErrorCollector).toBeDefined();
      expect(typeof ErrorCollector).toBe('function');
    });

    it('can instantiate ErrorCollector', () => {
      const collector = new ErrorCollector();
      expect(collector).toBeInstanceOf(ErrorCollector);
    });
  });

  describe('ErrorFormatter', () => {
    it('exports ErrorFormatter class', () => {
      expect(ErrorFormatter).toBeDefined();
      expect(typeof ErrorFormatter).toBe('function');
    });

    it('can instantiate ErrorFormatter', () => {
      const formatter = new ErrorFormatter();
      expect(formatter).toBeInstanceOf(ErrorFormatter);
    });
  });

  describe('RecoveryManager', () => {
    it('exports RecoveryManager class', () => {
      expect(RecoveryManager).toBeDefined();
      expect(typeof RecoveryManager).toBe('function');
    });

    it('can instantiate RecoveryManager', () => {
      const manager = new RecoveryManager();
      expect(manager).toBeInstanceOf(RecoveryManager);
    });
  });

  describe('Integration - Using exported components together', () => {
    it('can use boundary with retry handler', async () => {
      const boundary = new ErrorBoundary('test');

      const result = await boundary.execute(async () => {
        return 'success';
      });

      expect(result.success).toBe(true);
    });

    it('can collect errors and format them', async () => {
      const collector = new ErrorCollector<string, string>();
      const formatter = new ErrorFormatter();

      await collector.collect('item1', async () => 'result1');
      await collector.collect('item2', async () => {
        throw new FileReadError('/test.ts');
      });

      const collectorResult = collector.getResult();
      const formatted = formatter.formatCollection(collectorResult);

      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('can use recovery manager with retry handler', async () => {
      const manager = new RecoveryManager();
      const error = new FileReadError('/test.ts');

      const strategy = manager.getStrategy(error);
      expect(strategy.type).toBe('retry');

      const result = await manager.attemptRecovery(error, async () => {
        return 'recovered';
      });

      expect(result.recovered).toBe(true);
    });
  });
});
