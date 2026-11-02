/**
 * Graph line 0 is a real value: tree shows it as editor line 1 (:L1).
 */
import { formatTree } from '../../src/commands/query';
import type { QueryResult } from '../../src/lib/query/types';

const meta = { queryType: 'calls', executionTime: 0 } as any;

const flat = (line: number | undefined): QueryResult => ({
  nodes: [{ id: 'a', name: 'zero', file: 'a.ts', line }],
  edges: [],
  metadata: meta,
});

const edged: QueryResult = {
  nodes: [
    { id: 'm', name: 'main', file: 'a.ts', line: 0 },
    { id: 'h', name: 'helper', file: 'a.ts', line: 0 },
  ],
  edges: [{ from: 'm', to: 'h', type: 'calls' } as any],
  metadata: meta,
};

describe('formatTree line 0', () => {
  test('flat node: graph line 0 shows :L1', () => {
    expect(formatTree(flat(0))).toContain('zero (a.ts:L1)');
  });
  test('edge tree: graph line 0 shows :L1 for root and child', () => {
    const out = formatTree(edged);
    expect(out).toContain('main (a.ts:L1)');
    expect(out).toContain('helper (a.ts:L1)');
  });
  test('missing line stays blank', () => {
    expect(formatTree(flat(undefined))).not.toContain(':L');
  });
});
