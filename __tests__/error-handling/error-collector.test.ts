/**
 * Phase 4: Error Collector Tests
 *
 * Testing ErrorCollector for collect-and-continue pattern
 *
 * Key behaviors:
 * - Process multiple items, collecting errors without stopping
 * - Return partial results even when some items fail
 * - Categorize errors by severity
 * - Track which items succeeded vs failed
 * - Support batch processing with error tolerance
 */

import {
  ErrorCollector,
  CollectorOptions,
  CollectorResult,
} from '../../src/lib/error/collector';
import {
  FileReadError,
  ParseError,
  CacheWriteError,
  GraphBuildError,
} from '../../src/lib/error/types';

describe('ErrorCollector', () => {
  describe('collect() - basic collection', () => {
    it('collects all successful results', async () => {
      const collector = new ErrorCollector<string, number>();

      await collector.collect('item1', async () => 10);
      await collector.collect('item2', async () => 20);
      await collector.collect('item3', async () => 30);

      const result = collector.getResult();

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(result.partialSuccess).toBe(false);
    });

    it('collects errors without stopping', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => 'success1');
      await collector.collect('item2', async () => {
        throw new FileReadError('/file2.ts');
      });
      await collector.collect('item3', async () => 'success3');

      const result = collector.getResult();

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.partialSuccess).toBe(true);
    });

    it('continues after multiple errors', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => {
        throw new FileReadError('/file1.ts');
      });
      await collector.collect('item2', async () => {
        throw new ParseError('/file2.ts', 'TypeScript');
      });
      await collector.collect('item3', async () => 'success');

      const result = collector.getResult();

      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(2);
      expect(result.partialSuccess).toBe(true);
    });

    it('handles all failures gracefully', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => {
        throw new FileReadError('/file1.ts');
      });
      await collector.collect('item2', async () => {
        throw new ParseError('/file2.ts', 'TypeScript');
      });

      const result = collector.getResult();

      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(2);
      expect(result.partialSuccess).toBe(false);
    });
  });

  describe('result tracking', () => {
    it('tracks item identifiers with results', async () => {
      const collector = new ErrorCollector<string, number>();

      await collector.collect('file1', async () => 10);
      await collector.collect('file2', async () => 20);

      const result = collector.getResult();

      expect(result.results[0]).toEqual({ item: 'file1', data: 10 });
      expect(result.results[1]).toEqual({ item: 'file2', data: 20 });
    });

    it('tracks item identifiers with errors', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('file1', async () => {
        throw new FileReadError('/file1.ts');
      });
      await collector.collect('file2', async () => {
        throw new ParseError('/file2.ts', 'TypeScript');
      });

      const result = collector.getResult();

      expect(result.errors[0].item).toBe('file1');
      expect(result.errors[0].error).toBeInstanceOf(FileReadError);
      expect(result.errors[1].item).toBe('file2');
      expect(result.errors[1].error).toBeInstanceOf(ParseError);
    });
  });

  describe('error categorization', () => {
    it('categorizes errors by severity', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => {
        throw new CacheWriteError('cache'); // warning
      });
      await collector.collect('item2', async () => {
        throw new FileReadError('/file.ts'); // error
      });
      await collector.collect('item3', async () => {
        throw new GraphBuildError('failed'); // error (non-recoverable)
      });

      const result = collector.getResult();

      expect(result.errorsBySeverity.warning).toHaveLength(1);
      expect(result.errorsBySeverity.error).toHaveLength(2);
      expect(result.errorsBySeverity.critical).toHaveLength(0);
    });

    it('tracks critical errors separately', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => {
        throw new FileReadError('/file.ts'); // error
      });

      const result = collector.getResult();

      expect(result.hasCriticalErrors).toBe(false);
    });
  });

  describe('statistics', () => {
    it('provides total counts', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => 'success');
      await collector.collect('item2', async () => {
        throw new FileReadError('/file.ts');
      });
      await collector.collect('item3', async () => 'success');
      await collector.collect('item4', async () => {
        throw new ParseError('/file.ts', 'TypeScript');
      });

      const result = collector.getResult();

      expect(result.total).toBe(4);
      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(2);
    });

    it('calculates success rate', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => 'success');
      await collector.collect('item2', async () => {
        throw new FileReadError('/file.ts');
      });
      await collector.collect('item3', async () => 'success');
      await collector.collect('item4', async () => 'success');

      const result = collector.getResult();

      expect(result.successRate).toBe(0.75); // 3/4 = 75%
    });

    it('handles zero items', () => {
      const collector = new ErrorCollector<string, string>();

      const result = collector.getResult();

      expect(result.total).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.success).toBe(true); // No items = success
    });
  });

  describe('options - stopOnCritical', () => {
    it('continues by default even with critical errors', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => {
        throw new GraphBuildError('critical'); // non-recoverable
      });
      await collector.collect('item2', async () => 'success');

      const result = collector.getResult();

      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
    });

    it('stops on critical error when stopOnCritical is true', async () => {
      const collector = new ErrorCollector<string, string>({
        stopOnCritical: true,
      });

      await collector.collect('item1', async () => 'success1');
      await collector.collect('item2', async () => {
        throw new GraphBuildError('critical');
      });
      await collector.collect('item3', async () => 'success3');

      const result = collector.getResult();

      // Should stop after critical error - item3 not processed
      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.stopped).toBe(true);
    });
  });

  describe('options - maxErrors', () => {
    it('stops after reaching max errors', async () => {
      const collector = new ErrorCollector<string, string>({
        maxErrors: 2,
      });

      await collector.collect('item1', async () => {
        throw new FileReadError('/file1.ts');
      });
      await collector.collect('item2', async () => {
        throw new FileReadError('/file2.ts');
      });
      await collector.collect('item3', async () => {
        throw new FileReadError('/file3.ts');
      });

      const result = collector.getResult();

      expect(result.errors).toHaveLength(2);
      expect(result.stopped).toBe(true);
    });

    it('continues when under max errors', async () => {
      const collector = new ErrorCollector<string, string>({
        maxErrors: 3,
      });

      await collector.collect('item1', async () => {
        throw new FileReadError('/file1.ts');
      });
      await collector.collect('item2', async () => 'success');
      await collector.collect('item3', async () => {
        throw new FileReadError('/file2.ts');
      });

      const result = collector.getResult();

      expect(result.errors).toHaveLength(2);
      expect(result.stopped).toBe(false);
    });
  });

  describe('options - onError callback', () => {
    it('calls onError for each error', async () => {
      const capturedErrors: Array<{ item: string; error: any }> = [];

      const collector = new ErrorCollector<string, string>({
        onError: (item: string, error: any) => {
          capturedErrors.push({ item, error });
        },
      });

      await collector.collect('item1', async () => {
        throw new FileReadError('/file1.ts');
      });
      await collector.collect('item2', async () => {
        throw new ParseError('/file2.ts', 'TypeScript');
      });

      expect(capturedErrors).toHaveLength(2);
      expect(capturedErrors[0].item).toBe('item1');
      expect(capturedErrors[0].error).toBeInstanceOf(FileReadError);
      expect(capturedErrors[1].item).toBe('item2');
      expect(capturedErrors[1].error).toBeInstanceOf(ParseError);
    });

    it('does not call onError for successes', async () => {
      let errorCount = 0;

      const collector = new ErrorCollector<string, string>({
        onError: () => {
          errorCount++;
        },
      });

      await collector.collect('item1', async () => 'success');
      await collector.collect('item2', async () => 'success');

      expect(errorCount).toBe(0);
    });
  });

  describe('collectAll() - batch processing', () => {
    it('processes multiple items in batch', async () => {
      const collector = new ErrorCollector<string, number>();

      const items = ['a', 'b', 'c'];
      await collector.collectAll(items, async (item: string) => {
        return item.charCodeAt(0);
      });

      const result = collector.getResult();

      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toEqual({ item: 'a', data: 97 });
      expect(result.results[1]).toEqual({ item: 'b', data: 98 });
      expect(result.results[2]).toEqual({ item: 'c', data: 99 });
    });

    it('handles mixed success and failure in batch', async () => {
      const collector = new ErrorCollector<number, string>();

      const items = [1, 2, 3, 4];
      await collector.collectAll(items, async (item: number) => {
        if (item % 2 === 0) {
          throw new FileReadError(`/file${item}.ts`);
        }
        return `success${item}`;
      });

      const result = collector.getResult();

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(2);
      expect(result.partialSuccess).toBe(true);
    });

    it('respects stopOnCritical in batch', async () => {
      const collector = new ErrorCollector<number, string>({
        stopOnCritical: true,
      });

      const items = [1, 2, 3, 4];
      await collector.collectAll(items, async (item: number) => {
        if (item === 2) {
          throw new GraphBuildError('critical');
        }
        return `success${item}`;
      });

      const result = collector.getResult();

      // Should process item1, fail on item2, stop before item3 and item4
      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.stopped).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles undefined results', async () => {
      const collector = new ErrorCollector<string, any>();

      await collector.collect('item1', async () => undefined);

      const result = collector.getResult();

      expect(result.success).toBe(true);
      expect(result.results[0].data).toBeUndefined();
    });

    it('handles null results', async () => {
      const collector = new ErrorCollector<string, any>();

      await collector.collect('item1', async () => null);

      const result = collector.getResult();

      expect(result.success).toBe(true);
      expect(result.results[0].data).toBeNull();
    });

    it('handles non-XrayError exceptions', async () => {
      const collector = new ErrorCollector<string, string>();

      await collector.collect('item1', async () => {
        throw new Error('regular error');
      });

      const result = collector.getResult();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBeDefined();
    });
  });
});
