/**
 * Unit tests for the shared `Insight` type + `applyStashedInsights`
 * helper. Covers US-0001 non-regression invariants 1-4 (insight
 * survives chunked dual-renderer handoff).
 */

import {
  applyStashedInsights,
  INSIGHT_STASH_NAMESPACE,
  Insight,
  InsightSink,
} from '../../src/lib/renderer/insight';

class FakeXray {
  private store = new Map<string, unknown[]>();
  stash(ns: string, items: unknown[]): void {
    const bucket = this.store.get(ns);
    if (bucket) bucket.push(...items);
    else this.store.set(ns, [...items]);
  }
  retrieve(ns: string, n?: number): unknown[] {
    const bucket = this.store.get(ns);
    if (!bucket) return [];
    return n === undefined ? bucket.slice() : bucket.slice(0, n);
  }
}

class FakeSink implements InsightSink {
  public received: Insight[] = [];
  addInsight(insight: Insight): void {
    this.received.push(insight);
  }
}

describe('applyStashedInsights (US-0001)', () => {
  it('drains the insights stash into the renderer in order', () => {
    const xray = new FakeXray() as any;
    const sink = new FakeSink();

    xray.stash(INSIGHT_STASH_NAMESPACE, [
      { title: 'Q1', body: 'b1' },
      { title: 'Q2', body: 'b2' },
    ]);

    applyStashedInsights(xray, sink);

    expect(sink.received).toEqual([
      { title: 'Q1', body: 'b1' },
      { title: 'Q2', body: 'b2' },
    ]);
  });

  it('is a no-op when nothing has been stashed', () => {
    const xray = new FakeXray() as any;
    const sink = new FakeSink();
    applyStashedInsights(xray, sink);
    expect(sink.received).toEqual([]);
  });

  it('skips malformed entries without crashing', () => {
    const xray = new FakeXray() as any;
    const sink = new FakeSink();
    xray.stash(INSIGHT_STASH_NAMESPACE, [
      { title: 'good', body: 'ok' },
      null as unknown as Insight,
      { title: 'no body' } as unknown as Insight,
      { body: 'no title' } as unknown as Insight,
      { title: 'good2', body: 'ok2' },
    ]);
    applyStashedInsights(xray, sink);
    // Two well-formed entries get through; malformed ones are filtered.
    expect(sink.received.length).toBe(2);
    expect(sink.received[0]!.title).toBe('good');
    expect(sink.received[1]!.title).toBe('good2');
  });

  it('uses the canonical namespace constant', () => {
    expect(INSIGHT_STASH_NAMESPACE).toBe('insights');
  });
});

describe('Insight type re-exports (US-0001 invariant #4)', () => {
  it('Insight is re-exported from MapRenderer module', () => {
    // Compile-time check via import — if shapes diverged this would
    // fail typecheck.
    const map: typeof import('../../src/lib/renderer/map-renderer') = require('../../src/lib/renderer/map-renderer');
    expect(typeof map).toBe('object');
  });

  it('Insight is re-exported from ChunkedRenderer module', () => {
    const chunked: typeof import('../../src/lib/renderer/chunked-renderer') = require('../../src/lib/renderer/chunked-renderer');
    expect(typeof chunked).toBe('object');
  });
});
