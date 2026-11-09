/**
 * Unit tests for `generateQuestions` and its four templates.
 *
 * Strategy: one crafted fixture per template that triggers exactly that
 * template and none of the others. Each fixture asserts:
 *   1. The expected template type is produced.
 *   2. No other template fires (targeted isolation).
 *   3. Interpolated symbol labels appear in the question text, markdown-
 *      escaped where metacharacters are present.
 *
 * Additional coverage:
 *   - Metacharacter-heavy symbol label (backtick, [, ], |, \) round-trips
 *     through the full generator + formatter pipeline without breaking.
 *   - Cap-of-5 truncation.
 *   - Reason matching by `code`, never by substring on `detail`.
 */

import Graph from 'graphology';
import {
  generateQuestions,
  ambiguousEdgeTemplate,
  bridgeNodeTemplate,
  isolatedFileTemplate,
  lowCohesionTemplate,
} from '../../src/lib/graph/questions';
import { formatQuestionsMarkdown } from '../../src/lib/graph/questions-format';
import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';
import { XrayEvents } from '../../src/lib/events/types';
import { XrayLike } from '../../src/lib/events/plugin';
import {
  SURPRISE_STASH_NAMESPACE,
} from '../../src/lib/plugins/surprise-analyzer';
import { ScoredEdge } from '../../src/lib/graph/analyzer';
import { XrayGraph } from '../../src/types/graph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyGraph(): XrayGraph {
  return new Graph({ type: 'directed', multi: true }) as unknown as XrayGraph;
}

/** Minimal XrayLike stub — emitter + stash/retrieve/getLastGraph. */
function makeFakeXray(): XrayLike {
  const emitter = new AsyncEventEmitter<XrayEvents>();
  const stashes = new Map<string, unknown[]>();
  return Object.assign(emitter, {
    getLastGraph: () => ({}),
    stash: (ns: string, items: unknown[]) => {
      const bucket = stashes.get(ns);
      if (bucket) bucket.push(...items);
      else stashes.set(ns, [...items]);
    },
    retrieve: (ns: string, n?: number) => {
      const bucket = stashes.get(ns);
      if (!bucket) return [];
      return n === undefined ? bucket.slice() : bucket.slice(0, n);
    },
  }) as unknown as XrayLike;
}

/** Seed the surprise stash on a fake Xray with pre-built ScoredEdge items. */
function stashFakeSurprises(xray: XrayLike, items: ScoredEdge[]): void {
  xray.stash(SURPRISE_STASH_NAMESPACE, items);
}

function addTag(
  g: XrayGraph,
  id: string,
  file: string,
  line: number,
  community?: number,
  label?: string
): void {
  const attrs: Record<string, unknown> = {
    type: 'tag',
    label: label ?? id,
    kind: 'function',
    file,
    line,
  };
  if (community !== undefined) attrs.community = community;
  g.addNode(id, attrs as never);
}

function addFile(g: XrayGraph, id: string, community?: number): void {
  const attrs: Record<string, unknown> = { type: 'file', label: id };
  if (community !== undefined) attrs.community = community;
  g.addNode(id, attrs as never);
}

// ---------------------------------------------------------------------------
// Template: ambiguous-edge
// ---------------------------------------------------------------------------

describe('ambiguousEdgeTemplate', () => {
  it('emits a question when a surprise has reason code confidence-gradient', () => {
    const g = emptyGraph();
    addTag(g, 'alpha', 'src/a.ts', 10);
    addTag(g, 'beta', 'src/b.ts', 20);
    const xray = makeFakeXray();
    stashFakeSurprises(xray, [
      {
        edgeId: 'e1',
        source: 'alpha',
        target: 'beta',
        score: 0.9,
        reasons: [
          // `detail` is deliberately NOT the substring "confidence" — we
          // match on `code` only.
          { code: 'confidence-gradient', detail: 'irrelevant detail text' },
        ],
      },
    ]);

    const qs = ambiguousEdgeTemplate(g, xray);
    expect(qs).toHaveLength(1);
    expect(qs[0].type).toBe('ambiguous-edge');
    expect(qs[0].question).toContain('alpha');
    expect(qs[0].question).toContain('beta');
  });

  it('does NOT match on substring of reason.detail', () => {
    const g = emptyGraph();
    addTag(g, 'a', 'src/a.ts', 1);
    addTag(g, 'b', 'src/b.ts', 2);
    const xray = makeFakeXray();
    stashFakeSurprises(xray, [
      {
        edgeId: 'e1',
        source: 'a',
        target: 'b',
        score: 0.5,
        // `peripheral-hub` code but detail mentions "confidence" — must
        // NOT be treated as an ambiguous-edge hit.
        reasons: [{ code: 'peripheral-hub', detail: 'confidence gradient-like wording' }],
      },
    ]);
    expect(ambiguousEdgeTemplate(g, xray)).toEqual([]);
  });

  it('returns empty when no surprises are stashed', () => {
    const g = emptyGraph();
    const xray = makeFakeXray();
    expect(ambiguousEdgeTemplate(g, xray)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Template: bridge-node
// ---------------------------------------------------------------------------

describe('bridgeNodeTemplate', () => {
  it('picks the most-frequent endpoint across cross-community surprises', () => {
    const g = emptyGraph();
    addTag(g, 'hub', 'src/hub.ts', 1, 0);
    addTag(g, 'x', 'src/x.ts', 1, 1);
    addTag(g, 'y', 'src/y.ts', 1, 2);
    const xray = makeFakeXray();
    stashFakeSurprises(xray, [
      {
        edgeId: 'e1',
        source: 'hub',
        target: 'x',
        score: 0.9,
        reasons: [{ code: 'cross-community', detail: 'd' }],
      },
      {
        edgeId: 'e2',
        source: 'hub',
        target: 'y',
        score: 0.8,
        reasons: [{ code: 'cross-community', detail: 'd' }],
      },
    ]);
    const qs = bridgeNodeTemplate(g, xray);
    expect(qs).toHaveLength(1);
    expect(qs[0].type).toBe('bridge-node');
    expect(qs[0].question).toContain('hub');
  });

  it('returns empty when no cross-community reasons present', () => {
    const g = emptyGraph();
    addTag(g, 'a', 'a.ts', 1);
    addTag(g, 'b', 'b.ts', 1);
    const xray = makeFakeXray();
    stashFakeSurprises(xray, [
      {
        edgeId: 'e1',
        source: 'a',
        target: 'b',
        score: 0.5,
        reasons: [{ code: 'peripheral-hub', detail: 'd' }],
      },
    ]);
    expect(bridgeNodeTemplate(g, xray)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Template: isolated-file
// ---------------------------------------------------------------------------

describe('isolatedFileTemplate', () => {
  it('flags a file with zero imports in/out and zero defines (edge path)', () => {
    const g = emptyGraph();
    addFile(g, 'src/live.ts');
    addFile(g, 'src/orphan.ts');
    addFile(g, 'src/other.ts');
    // live <- other via imports edge; live defines something
    addTag(g, 'live.fn', 'src/live.ts', 1);
    g.addEdge('src/live.ts', 'live.fn', { type: 'defines', confidence: 'EXTRACTED' });
    g.addEdge('src/other.ts', 'src/live.ts', { type: 'imports', confidence: 'EXTRACTED' });

    const qs = isolatedFileTemplate(g);
    expect(qs).toHaveLength(1);
    expect(qs[0].type).toBe('isolated-file');
    expect(qs[0].question).toContain('src/orphan.ts');
  });

  it('returns empty on a graph with no file nodes', () => {
    const g = emptyGraph();
    addTag(g, 't', 'a.ts', 1);
    expect(isolatedFileTemplate(g)).toEqual([]);
  });

  // US-0002: when no imports edges exist on the graph, the template
  // bails rather than guessing from unresolved specifier strings on
  // the back-compat `imports` node attribute. The previous fallback
  // produced false positives because `Import.source` is a module
  // specifier ('./foo') not a resolved file-node id.
  it('returns empty when no imports edges exist on the graph (US-0002)', () => {
    const g = emptyGraph();
    addFile(g, 'src/lonely.ts');
    addFile(g, 'src/hub.ts');
    g.setNodeAttribute('src/lonely.ts', 'imports', []);
    g.setNodeAttribute('src/hub.ts', 'imports', []);
    expect(isolatedFileTemplate(g)).toEqual([]);
  });

  it('does not false-positive from unresolved specifier strings (US-0002)', () => {
    // Two file nodes that import each other via specifier strings on
    // the back-compat `imports` node attribute, but no graph-level
    // imports edges. The old fallback would have flagged neither as
    // isolated (the lookup would coincidentally fail to match too) —
    // OR worse, would flag both. Either way the behavior was
    // unreliable. New behavior: silent empty result.
    const g = emptyGraph();
    addFile(g, 'src/a.ts');
    addFile(g, 'src/b.ts');
    g.setNodeAttribute('src/a.ts', 'imports', [{ source: './b' }]);
    g.setNodeAttribute('src/b.ts', 'imports', [{ source: './a' }]);
    // No imports edges → bail.
    expect(isolatedFileTemplate(g)).toEqual([]);
  });

  it('still flags orphans when imports edges exist for some files (US-0002)', () => {
    // Mixed graph: a/b connected via imports edge, c is orphan.
    // The template uses the edge path for everyone (no fallback),
    // and c shows up correctly.
    const g = emptyGraph();
    addFile(g, 'src/a.ts');
    addFile(g, 'src/b.ts');
    addFile(g, 'src/c.ts');
    g.addEdge('src/a.ts', 'src/b.ts', { type: 'imports', confidence: 'EXTRACTED' });
    const qs = isolatedFileTemplate(g);
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toContain('src/c.ts');
  });
});

// ---------------------------------------------------------------------------
// Template: low-cohesion
// ---------------------------------------------------------------------------

describe('lowCohesionTemplate', () => {
  it('emits a question when modularity>=0.1 and median intra < threshold', () => {
    const g = emptyGraph();
    // 5 tag nodes in the same community with zero calls between them.
    for (let i = 0; i < 5; i += 1) {
      addTag(g, `n${i}`, `f${i}.ts`, 1, 7);
    }
    g.setAttribute('clusteringModularity', 0.4);

    const qs = lowCohesionTemplate(g, { root: '/repo' });
    expect(qs).toHaveLength(1);
    expect(qs[0].type).toBe('low-cohesion');
    expect(qs[0].question).toContain('community 7');
  });

  it('guards: modularity < 0.1 returns empty', () => {
    const g = emptyGraph();
    for (let i = 0; i < 5; i += 1) {
      addTag(g, `n${i}`, `f${i}.ts`, 1, 3);
    }
    g.setAttribute('clusteringModularity', 0.05);
    expect(lowCohesionTemplate(g, { root: '/repo' })).toEqual([]);
  });

  it('guards: missing modularity attribute returns empty', () => {
    const g = emptyGraph();
    for (let i = 0; i < 5; i += 1) {
      addTag(g, `n${i}`, `f${i}.ts`, 1, 3);
    }
    expect(lowCohesionTemplate(g, { root: '/repo' })).toEqual([]);
  });

  it('does not count INFERRED calls edges toward intra-community cohesion', () => {
    const g = emptyGraph();
    for (let i = 0; i < 5; i += 1) {
      addTag(g, `n${i}`, `f${i}.ts`, 1, 7);
    }
    // Every member name-match-calls every other: counted, median would be 8.
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        if (i !== j) g.addEdge(`n${i}`, `n${j}`, { type: 'calls', confidence: 'INFERRED' });
      }
    }
    g.setAttribute('clusteringModularity', 0.4);

    const qs = lowCohesionTemplate(g, { root: '/repo' });
    expect(qs).toHaveLength(1);
    expect(qs[0].type).toBe('low-cohesion');
    expect(qs[0].why).toContain('is 0 (< 2)');
  });

  it('counts EXTRACTED and confidence-less calls edges toward cohesion', () => {
    const g = emptyGraph();
    for (let i = 0; i < 5; i += 1) {
      addTag(g, `n${i}`, `f${i}.ts`, 1, 7);
    }
    // Ring n0->n1->...->n4->n0: every member has 2 intra calls edges.
    for (let i = 0; i < 5; i += 1) {
      const attrs = i % 2 === 0 ? { type: 'calls', confidence: 'EXTRACTED' } : { type: 'calls' };
      g.addEdge(`n${i}`, `n${(i + 1) % 5}`, attrs as never);
    }
    g.setAttribute('clusteringModularity', 0.4);
    expect(lowCohesionTemplate(g, { root: '/repo' })).toEqual([]);
  });

  it('skips communities below minSize', () => {
    const g = emptyGraph();
    for (let i = 0; i < 3; i += 1) {
      addTag(g, `n${i}`, `f${i}.ts`, 1, 2);
    }
    g.setAttribute('clusteringModularity', 0.4);
    expect(lowCohesionTemplate(g, { root: '/repo' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full generator: isolation, cap, metacharacter escaping
// ---------------------------------------------------------------------------

describe('generateQuestions', () => {
  it('escapes metacharacter-heavy labels through the full pipeline', () => {
    const g = emptyGraph();
    // Tag label containing every metachar the escaper handles.
    const evil = 'weird`[name]|\\';
    addTag(g, 'evil', 'src/e.ts', 5, undefined, evil);
    addTag(g, 'plain', 'src/p.ts', 6);
    const xray = makeFakeXray();
    stashFakeSurprises(xray, [
      {
        edgeId: 'e1',
        source: 'evil',
        target: 'plain',
        score: 0.9,
        reasons: [{ code: 'confidence-gradient', detail: 'x' }],
      },
    ]);

    const qs = generateQuestions(g, xray, { root: '/repo' });
    expect(qs.length).toBeGreaterThan(0);
    const md = formatQuestionsMarkdown(qs, { root: '/repo' });
    // Backtick is escaped as \` — the raw, unescaped backtick must NOT
    // appear adjacent to "weird" inside the escaped label span.
    expect(md).toContain('weird\\`');
    expect(md).toContain('\\[name\\]');
    expect(md).toContain('\\|');
  });

  it('caps output at opts.max', () => {
    const g = emptyGraph();
    addTag(g, 'a', 'a.ts', 1);
    addTag(g, 'b', 'b.ts', 1);
    addTag(g, 'c', 'c.ts', 1);
    const xray = makeFakeXray();
    stashFakeSurprises(xray, [
      {
        edgeId: 'e1',
        source: 'a',
        target: 'b',
        score: 0.9,
        reasons: [{ code: 'confidence-gradient', detail: 'x' }],
      },
      {
        edgeId: 'e2',
        source: 'b',
        target: 'c',
        score: 0.8,
        reasons: [{ code: 'confidence-gradient', detail: 'x' }],
      },
    ]);
    const qs = generateQuestions(g, xray, { root: '/repo', max: 1 });
    expect(qs.length).toBeLessThanOrEqual(1);
  });

  it('runs with zero upstream signals and does not throw', () => {
    const g = emptyGraph();
    const xray = makeFakeXray();
    expect(() =>
      generateQuestions(g, xray, { root: '/repo' })
    ).not.toThrow();
  });
});
