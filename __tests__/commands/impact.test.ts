/**
 * `xray impact <symbol>`: BFS over inbound `calls` edges from every tag
 * matching <symbol>, shortest depth per caller, per-edge confidence,
 * grouped by first path segment (one root) or root/segment (multi-root).
 *
 * Engine + renderer are exercised in-process on fixture graphs; the CLI
 * surface (formats, flags, exit codes, in-process build) runs the built
 * bin, as query-output.test.ts does.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphSerializer } from '../../src/lib/graph/serializer';
import { FunctionAdapter } from '../../src/lib/query/adapters/function';
import { computeImpact, groupKey, renderImpactBrief, renderImpactText, impactToQueryResult, BRIEF_MAX_CHARS } from '../../src/lib/query/impact';
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../../src/lib/query/types';
import { formatTree } from '../../src/commands/query';
import { coverageLine } from '../../src/commands/impact';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

const PLAIN = {
  accent: (s: string) => s, muted: (s: string) => s, success: (s: string) => s,
  error: (s: string) => s, warn: (s: string) => s, bold: (s: string) => s,
};

function tag(file: string, name: string, line: number, kind = 'function'): SerializedNode {
  return { id: `${file}::${name}`, type: 'tag', label: name, kind, file, line };
}

function calls(from: SerializedNode, to: SerializedNode, confidence: 'EXTRACTED' | 'INFERRED' = 'EXTRACTED'): SerializedEdge {
  return { source: from.id, target: to.id, type: 'calls', confidence };
}

function graphOf(nodes: SerializedNode[], edges: SerializedEdge[], roots?: Array<{ label: string; path: string }>): SerializedGraph {
  return {
    metadata: {
      version: '1.0', timestamp: '2026-01-01T00:00:00.000Z', projectPath: '/p',
      nodeCount: nodes.length, edgeCount: edges.length, ...(roots ? { roots } : {}),
    },
    nodes,
    edges,
  };
}

const load = (g: SerializedGraph) => new GraphSerializer().deserialize(g);

/*
 * Diamond: T <- A <- B, and T <- B directly; C -> B.
 * Edge A->T is inserted before B->T so a DFS from T reaches B through A
 * first. Shortest depths: A=1, B=1, C=2.
 */
const T = tag('pkg/t.go', 'T', 10);
const A = tag('pkg/a.go', 'A', 20);
const B = tag('pkg/b.go', 'B', 30);
const C = tag('cmd/c.go', 'C', 40);
const diamond = () => graphOf([T, A, B, C], [calls(A, T), calls(B, A), calls(B, T), calls(C, B)]);

describe('impact engine (computeImpact)', () => {
  test('diamond: BFS gives shortest depth per caller and finds every caller within --depth', () => {
    const r = computeImpact(load(diamond()), 'T', { depth: 2 });
    const depth = Object.fromEntries(r.nodes.map(n => [n.name, n.depth]));
    expect(depth).toEqual({ A: 1, B: 1, C: 2 });
  });

  test('diamond: FunctionAdapter DFS callers() is wrong on the same fixture (why impact does not reuse it)', () => {
    // Pins the DFS defect the impact engine exists to avoid: B is
    // reported at depth 2 (not shortest) and C is missing (incomplete).
    const q = new FunctionAdapter().execute('callers(T, recursive=true, depth=2)', load(diamond()));
    const depth = Object.fromEntries(q.nodes.map(n => [n.name, n.depth]));
    expect(depth.B).toBe(2);
    expect(depth.C).toBeUndefined();
  });

  test('--depth bounds the walk; default depth is 3', () => {
    const D = tag('cmd/d.go', 'D', 50);
    const E = tag('cmd/e.go', 'E', 60);
    const g = graphOf([T, A, D, E, C], [calls(A, T), calls(C, A), calls(D, C), calls(E, D)]);
    expect(computeImpact(load(g), 'T', { depth: 1 }).nodes.map(n => n.name)).toEqual(['A']);
    expect(computeImpact(load(g), 'T').nodes.map(n => n.name).sort()).toEqual(['A', 'C', 'D']);
    expect(computeImpact(load(g), 'T', { depth: 4 }).nodes).toHaveLength(4);
  });

  test('per-edge confidence carried; a caller is EXTRACTED only via an all-EXTRACTED shortest path', () => {
    const g = graphOf([T, A, B, C], [calls(A, T, 'INFERRED'), calls(B, T), calls(C, A)]);
    const r = computeImpact(load(g), 'T');
    const conf = Object.fromEntries(r.nodes.map(n => [n.name, n.confidence]));
    expect(conf).toEqual({ A: 'INFERRED', B: 'EXTRACTED', C: 'INFERRED' });
    const edge = r.edges.find(e => e.from === A.id && e.to === T.id);
    expect(edge?.confidence).toBe('INFERRED');
    expect(r.counts.EXTRACTED).toBe(2);
    expect(r.counts.INFERRED).toBe(1);
  });

  test('--strict drops INFERRED edges (and callers reachable only through them)', () => {
    const g = graphOf([T, A, B, C], [calls(A, T, 'INFERRED'), calls(B, T), calls(C, A)]);
    const r = computeImpact(load(g), 'T', { strict: true });
    expect(r.nodes.map(n => n.name)).toEqual(['B']);
    expect(r.counts.INFERRED).toBe(0);
  });

  test('every tag matching the symbol seeds the walk (exact label and glob, as findNodes)', () => {
    const T2 = tag('other/t.go', 'T', 5);
    const Tx = tag('pkg/tx.go', 'Txn', 7);
    const g = graphOf([T, T2, Tx, A, B, C], [calls(A, T), calls(B, T2), calls(C, Tx)]);
    const exact = computeImpact(load(g), 'T');
    expect(exact.symbol.matches.map(m => m.id).sort()).toEqual([T2.id, T.id].sort());
    expect(exact.nodes.map(n => n.name).sort()).toEqual(['A', 'B']);
    const glob = computeImpact(load(g), 'T*');
    expect(glob.nodes.map(n => n.name).sort()).toEqual(['A', 'B', 'C']);
  });

  test('a seed calling itself or another seed is not its own caller', () => {
    const g = graphOf([T, A], [calls(T, T), calls(A, T)]);
    expect(computeImpact(load(g), 'T').nodes.map(n => n.name)).toEqual(['A']);
  });

  test('unknown symbol: no matches, no callers', () => {
    const r = computeImpact(load(diamond()), 'Nope');
    expect(r.symbol.matches).toEqual([]);
    expect(r.nodes).toEqual([]);
  });

  test('json shape is {symbol, nodes, edges, groups, counts}', () => {
    const r = computeImpact(load(diamond()), 'T');
    expect(Object.keys(r).sort()).toEqual(['counts', 'edges', 'groups', 'nodes', 'symbol']);
  });
});

describe('impact grouping', () => {
  test('one root: first path segment under the root', () => {
    expect(groupKey('internal/dispatch/x.go', undefined)).toBe('internal');
    expect(groupKey('main.go', undefined)).toBe('.');
  });

  test('multi-root: root label from metadata.roots, then first path segment under it', () => {
    const roots = [{ label: 'api', path: '/r/api' }, { label: 'web', path: '/r/web' }];
    expect(groupKey('api/internal/x.go', roots)).toBe('api/internal');
    expect(groupKey('web/src/a.ts', roots)).toBe('web/src');
    // file at a root's top level: the root label alone
    expect(groupKey('api/main.go', roots)).toBe('api');
    // not under any root label: first segment, as one root
    expect(groupKey('other/x.go', roots)).toBe('other');
  });

  test('multi-root fixture groups callers by root/package (flat keys)', () => {
    const roots = [{ label: 'api', path: '/r/api' }, { label: 'web', path: '/r/web' }];
    const t = tag('api/pkg/t.go', 'T', 1);
    const a = tag('api/internal/a.go', 'A', 2);
    const a2 = tag('api/internal/a2.go', 'A2', 2);
    const b = tag('api/cmd/b.go', 'B', 3);
    const w = tag('web/src/w.ts', 'W', 4);
    const g = graphOf([t, a, a2, b, w], [calls(a, t), calls(a2, t), calls(b, t), calls(w, t, 'INFERRED')], roots);
    const r = computeImpact(load(g), 'T', { roots });
    expect(r.groups.map(x => [x.name, x.count])).toEqual([['api/internal', 2], ['api/cmd', 1], ['web/src', 1]]);
    expect(r.nodes.find(n => n.name === 'W')?.group).toBe('web/src');
  });
});

describe('impact text output', () => {
  test('header, grouped depth sections, confidence counts', () => {
    const r = computeImpact(load(diamond()), 'T');
    const lines: string[] = [];
    renderImpactText(r, l => lines.push(l ?? ''), PLAIN);
    const text = lines.join('\n');
    expect(lines[0]).toBe('T (function, pkg/t.go:L11) — 3 callers across 2 groups');
    expect(text).toContain('  pkg: 2 callers — A (pkg/a.go:L21), B (pkg/b.go:L31)');
    expect(text).toMatch(/depth 2:\n {4}cmd: 1 caller — C \(cmd\/c\.go:L41\)/);
    expect(lines[lines.length - 1]).toBe('edges: EXTRACTED 3 · INFERRED 0');
  });

  test('long groups are capped with "…and X more"', () => {
    const many = Array.from({ length: 8 }, (_, i) => tag(`pkg/f${i}.go`, `F${i}`, i + 1));
    const g = graphOf([T, ...many], many.map(m => calls(m, T)));
    const lines: string[] = [];
    renderImpactText(computeImpact(load(g), 'T'), l => lines.push(l ?? ''), PLAIN);
    expect(lines.join('\n')).toContain('…and 3 more');
  });

  test('unknown symbol says so', () => {
    const lines: string[] = [];
    renderImpactText(computeImpact(load(diamond()), 'Nope'), l => lines.push(l ?? ''), PLAIN);
    expect(lines.join('\n')).toContain('Nope: no matching symbol in the graph');
  });

  test('text shows editor (1-based) lines; graph lines are 0-based', () => {
    const lines: string[] = [];
    renderImpactText(computeImpact(load(graphOf([tag('a.ts', 'z', 0), tag('a.ts', 'y', 3)], [calls(tag('a.ts', 'y', 3), tag('a.ts', 'z', 0))])), 'z'), l => lines.push(l ?? ''), PLAIN);
    expect(lines[0]).toBe('z (function, a.ts:L1) — 1 caller across 1 group');
    expect(lines[1]).toBe('  .: 1 caller — y (a.ts:L4)');
  });

  test('header and "defined:" line use the callers\' 1-based :L form', () => {
    const T2 = tag('other/t.go', 'T', 4);
    const lines: string[] = [];
    renderImpactText(computeImpact(load(graphOf([T, T2, A], [calls(A, T)])), 'T'), l => lines.push(l ?? ''), PLAIN);
    expect(lines[1]).toBe('  defined: function, pkg/t.go:L11; function, other/t.go:L5');
    const one: string[] = [];
    renderImpactText(computeImpact(load(diamond()), 'T'), l => one.push(l ?? ''), PLAIN);
    expect(one[0]).toMatch(/^T \(function, pkg\/t\.go:L11\) — /);
  });

  test('INFERRED callers are marked "(inferred)"; footer counts are labelled edges', () => {
    // A <- T is INFERRED; C reaches T only through A, so C is INFERRED too.
    const g = graphOf([T, A, B, C], [calls(A, T, 'INFERRED'), calls(B, T), calls(C, A)]);
    const lines: string[] = [];
    renderImpactText(computeImpact(load(g), 'T'), l => lines.push(l ?? ''), PLAIN);
    const text = lines.join('\n');
    expect(text).toContain('  pkg: 2 callers — A (pkg/a.go:L21) (inferred), B (pkg/b.go:L31)');
    expect(text).toMatch(/cmd: 1 caller — C \(cmd\/c\.go:L41\) \(inferred\)$/m);
    expect(text).not.toMatch(/B \(pkg\/b\.go:L31\) \(inferred\)/);
    expect(lines[lines.length - 1]).toBe('edges: EXTRACTED 2 · INFERRED 1');
  });

  test('tree view marks INFERRED callers "(inferred)" after the location', () => {
    const g = graphOf([T, A, B], [calls(A, T, 'INFERRED'), calls(B, T)]);
    const tree = formatTree(impactToQueryResult(computeImpact(load(g), 'T')), PLAIN);
    expect(tree).toContain('A (pkg/a.go:L21) (inferred)');
    expect(tree).toMatch(/B \(pkg\/b\.go:L31\)$/m);
    expect(tree).toMatch(/T \(pkg\/t\.go:L11\)$/m);
  });

  test('coverage line: "served from cache" when every root hit, else files parsed', () => {
    const c = { files: 4, parsed: 3, skipped: [] };
    expect(coverageLine(c, [{ label: 'a', hit: true }, { label: 'b', hit: true }]))
      .toBe('coverage: served from cache (3 files) · skipped grammars: none');
    expect(coverageLine(c, [{ label: 'a', hit: true }, { label: 'b', hit: false }]))
      .toBe('coverage: 3 files parsed · skipped grammars: none');
    expect(coverageLine(c)).toBe('coverage: 3 files parsed · skipped grammars: none');
  });

  test('tree view roots at the symbol (callee -> caller edges)', () => {
    const q = impactToQueryResult(computeImpact(load(diamond()), 'T'));
    expect(q.edges.every(e => q.nodes.some(n => n.id === e.to))).toBe(true);
    expect(q.edges.some(e => e.from === T.id)).toBe(true);
  });
});

describe('impact brief output (renderImpactBrief)', () => {
  const brief = (g: SerializedGraph, sym = 'T') => renderImpactBrief(computeImpact(load(g), sym));

  test('header (same as text), one line per group, edges footer', () => {
    expect(brief(diamond()).split('\n')).toEqual([
      'T (function, pkg/t.go:L11) — 3 callers across 2 groups',
      '  pkg: 2 callers — A (pkg/a.go:L21), B (pkg/b.go:L31)',
      '  cmd: 1 caller — C (cmd/c.go:L41)',
      'edges: EXTRACTED 3 · INFERRED 0',
    ]);
  });

  test('groups in result order (most callers first), callers shallowest first, top 3 then "…and N more"', () => {
    const many = Array.from({ length: 5 }, (_, i) => tag(`svc/f${i}.go`, `F${i}`, i + 1));
    const deep = tag('svc/z.go', 'Deep', 0);
    const g = graphOf([T, A, deep, ...many], [calls(A, T), ...many.map(m => calls(m, T)), calls(deep, many[0])]);
    const lines = brief(g).split('\n');
    expect(lines[1]).toBe('  svc: 6 callers — F0 (svc/f0.go:L2), F1 (svc/f1.go:L3), F2 (svc/f2.go:L4), …and 3 more');
    expect(lines[2]).toBe('  pkg: 1 caller — A (pkg/a.go:L21)');
    expect(lines).toHaveLength(4);
  });

  test('INFERRED callers keep the "(inferred)" marker', () => {
    const g = graphOf([T, A, B], [calls(A, T, 'INFERRED'), calls(B, T)]);
    expect(brief(g)).toContain('  pkg: 2 callers — A (pkg/a.go:L21) (inferred), B (pkg/b.go:L31)\n');
    expect(brief(g).split('\n').pop()).toBe('edges: EXTRACTED 1 · INFERRED 1');
  });

  test('several definitions: header only (no "defined:" line)', () => {
    const T2 = tag('other/t.go', 'T', 4);
    const lines = brief(graphOf([T, T2, A], [calls(A, T)])).split('\n');
    expect(lines[0]).toBe('T (2 definitions) — 1 caller across 1 group');
    expect(lines[1]).toBe('  pkg: 1 caller — A (pkg/a.go:L21)');
  });

  test('empty on no match and on zero callers', () => {
    expect(brief(diamond(), 'Nope')).toBe('');
    expect(brief(graphOf([T], []))).toBe('');
  });

  test(`hard cap ${1200} chars, cut at a line end, ending "…"`, () => {
    expect(BRIEF_MAX_CHARS).toBe(1200);
    const groups = Array.from({ length: 40 }, (_, i) => tag(`area${String(i).padStart(2, '0')}/some/long/path/file.go`, `Caller${i}`, i));
    const out = brief(graphOf([T, ...groups], groups.map(m => calls(m, T))));
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out.endsWith('\n…')).toBe(true);
    expect(out.startsWith('T (function, pkg/t.go:L11) — 40 callers across 40 groups\n')).toBe(true);
    // every kept line is whole
    for (const l of out.split('\n').slice(1, -1)) expect(l).toMatch(/^ {2}area\d\d: 1 caller — Caller\d+ \(area\d\d\/some\/long\/path\/file\.go:L\d+\)$/);
    expect(out).not.toContain('edges:');
  });

  test('under the cap: untouched', () => {
    expect(brief(diamond())).not.toContain('…');
  });
});

describe('xray impact (built CLI)', () => {
  let dir: string;
  let graphFile: string;
  let repo: string;

  function run(args: string[], cwd = dir) {
    return spawnSync(process.execPath, [BIN, '--no-telemetry', ...args], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0', XDG_CONFIG_HOME: path.join(dir, 'xdg') },
      timeout: 90_000,
    });
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-impact-'));
    graphFile = path.join(dir, 'graph.json');
    fs.writeFileSync(graphFile, JSON.stringify(diamond()));
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-impact-repo-'));
    fs.mkdirSync(path.join(repo, 'lib'));
    fs.writeFileSync(path.join(repo, 'lib', 'core.ts'), 'export function target() { return 1; }\n');
    fs.writeFileSync(
      path.join(repo, 'lib', 'use.ts'),
      "import { target } from './core';\nexport function useIt() { return target(); }\n"
    );
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('default text summary on stdout', () => {
    const r = run(['impact', 'T', '--graph', graphFile]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('T (function, pkg/t.go:L11) — 3 callers across 2 groups');
    expect(r.stdout).toContain('depth 2:');
    expect(r.stdout).toContain('edges: EXTRACTED 3 · INFERRED 0');
  });

  test('--format json is one document {symbol, nodes, edges, groups, counts}', () => {
    const r = run(['impact', 'T', '--graph', graphFile, '--format', 'json']);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(Object.keys(doc).sort()).toEqual(['counts', 'edges', 'groups', 'nodes', 'symbol']);
    expect(doc.nodes.find((n: any) => n.name === 'B').depth).toBe(1);
    // Result documents are 1-based like text; the saved graph stays 0-based.
    expect(doc.symbol.matches[0].line).toBe(11);
  });

  test('--format tree prints the call tree', () => {
    const r = run(['impact', 'T', '--graph', graphFile, '--format', 'tree']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Call Tree:');
    expect(r.stdout).toMatch(/└─→ T|├─→ T/);
  });

  test('query --format tree and impact --format tree agree on (1-based) lines for the same graph', () => {
    const loc = (out: string) => Object.fromEntries(
      [...out.matchAll(/([A-Z]) \(([^:)]+):L(\d+)\)/g)].map(m => [m[1], `${m[2]}:L${m[3]}`])
    );
    const q = run(['query', '--graph', graphFile, '--format', 'tree', 'callers(T, recursive=true)']);
    const i = run(['impact', 'T', '--graph', graphFile, '--format', 'tree']);
    expect(q.status).toBe(0);
    expect(i.status).toBe(0);
    const ql = loc(q.stdout);
    const il = loc(i.stdout);
    expect(Object.keys(ql).sort()).toEqual(['A', 'B', 'C']);
    for (const n of Object.keys(ql)) expect(ql[n]).toBe(il[n]);
    expect(ql.A).toBe('pkg/a.go:L21'); // graph line 20 -> editor line 21
  });

  test('query table, csv and json all show editor (1-based) lines', () => {
    const q = ['query', '--graph', graphFile, 'callers(T)'];
    const table = run([...q, '--format', 'table']).stdout;
    expect(table).toMatch(/^A\s+function\s+pkg\/a\.go\s+21\s*$/m);
    expect(run([...q, '--format', 'csv']).stdout).toContain('A,function,pkg/a.go,21');
    const json = JSON.parse(run([...q, '--format', 'json']).stdout);
    expect(json.nodes.find((n: any) => n.name === 'A').line).toBe(21);
  });

  test('impact table and query table agree on (1-based) lines; impact csv and json agree too', () => {
    const lineOf = (out: string, name: string) => out.split('\n').find(l => l.startsWith(name + ' '))?.trim().split(/\s+/);
    const q = run(['query', '--graph', graphFile, '--format', 'table', 'callers(T)']).stdout;
    const i = run(['impact', 'T', '--graph', graphFile, '--format', 'table', '--depth', '1']).stdout;
    // query cols: name kind file line; impact cols: name file line depth group confidence
    expect(lineOf(i, 'A')?.[2]).toBe('21');
    expect(lineOf(i, 'A')?.[2]).toBe(lineOf(q, 'A')?.[3]);
    expect(lineOf(i, 'B')?.[2]).toBe(lineOf(q, 'B')?.[3]);
    expect(run(['impact', 'T', '--graph', graphFile, '--format', 'csv']).stdout).toContain('A,pkg/a.go,21,1,pkg,EXTRACTED');
    const doc = JSON.parse(run(['impact', 'T', '--graph', graphFile, '--format', 'json']).stdout);
    expect(doc.nodes.find((n: any) => n.name === 'A').line).toBe(21);
  });

  test('--depth 1 differs from the default', () => {
    const one = JSON.parse(run(['impact', 'T', '--graph', graphFile, '--format', 'json', '--depth', '1']).stdout);
    const three = JSON.parse(run(['impact', 'T', '--graph', graphFile, '--format', 'json']).stdout);
    expect(one.nodes).toHaveLength(2);
    expect(three.nodes).toHaveLength(3);
  });

  test.each([['0'], ['-1'], ['x'], ['1.5']])('--depth %s is a usage error (exit 2)', (d) => {
    const r = run(['impact', 'T', '--graph', graphFile, '--depth', d]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  test('unknown --format is a usage error (exit 2)', () => {
    expect(run(['impact', 'T', '--graph', graphFile, '--format', 'bogus']).status).toBe(2);
  });

  test('missing <symbol> is a usage error (exit 2)', () => {
    expect(run(['impact', '--graph', graphFile]).status).toBe(2);
  });

  test('missing graph file exits 3, nothing on stdout', () => {
    const r = run(['impact', 'T', '--graph', path.join(dir, 'nope.json')]);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Graph file not found');
  });

  test('without --graph: builds in-process, prints one coverage line, writes no map file', () => {
    const before = fs.readdirSync(repo).sort();
    const r = run(['impact', 'target', '-p', repo], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('target (function, lib/core.ts:L1) — 1 caller across 1 group');
    expect(r.stdout).toContain('useIt (lib/use.ts:L2)');
    expect(r.stderr).toMatch(/coverage: 2 files parsed/);
    expect(r.stderr).not.toContain('Analyzing repo at');
    const after = fs.readdirSync(repo).sort();
    expect(after).toEqual(before);
    expect(fs.existsSync(path.join(repo, '.xray'))).toBe(false);
  });

  describe('config match narrows the built graph', () => {
    let narrowed: string;
    beforeAll(() => {
      narrowed = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-impact-match-'));
      fs.cpSync(repo, narrowed, { recursive: true });
      fs.writeFileSync(path.join(narrowed, '.xrayrc.json'), JSON.stringify({ match: ['lib/core.ts'] }));
    });
    afterAll(() => fs.rmSync(narrowed, { recursive: true, force: true }));

    test('one stderr line names the patterns; the walk is narrowed', () => {
      const r = run(['impact', 'target', '-p', narrowed], narrowed);
      expect(r.status).toBe(0);
      const notes = r.stderr.split('\n').filter(l => l.includes('narrows the graph'));
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain('"lib/core.ts"');
      expect(r.stdout).not.toContain('useIt');
    });

    test('--format json keeps stdout parseable', () => {
      const r = run(['impact', 'target', '-p', narrowed, '--format', 'json'], narrowed);
      expect(r.status).toBe(0);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
      expect(r.stderr).toContain('narrows the graph');
    });

    test.each([
      ['before the subcommand', ['--quiet', 'impact', 'target']],
      ['after the subcommand', ['impact', 'target', '--quiet']],
    ])('--quiet %s: no note', (_w, args) => {
      const r = run([...args, '-p', narrowed], narrowed);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    });

    test('a pattern with ESC and newline reaches stderr escaped, never raw', () => {
      const evil = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-impact-evil-'));
      try {
        fs.cpSync(repo, evil, { recursive: true });
        fs.writeFileSync(path.join(evil, '.xrayrc.json'), JSON.stringify({ match: ['lib/core.ts', '\u001b[2J\nforged: ok'] }));
        const r = run(['impact', 'target', '-p', evil], evil);
        expect(r.status).toBe(0);
        expect(r.stderr).toContain('narrows the graph');
        expect(r.stderr).not.toContain('\u001b');
        expect(r.stderr).not.toContain('\nforged');
        expect(r.stderr).toContain('\\u001b[2J\\nforged');
      } finally {
        fs.rmSync(evil, { recursive: true, force: true });
      }
    });

    test('no match configured: no note', () => {
      expect(run(['impact', 'target', '-p', repo], repo).stderr).not.toContain('narrows the graph');
    });

    test('--graph is not narrowed by config: no note', () => {
      expect(run(['impact', 'T', '--graph', graphFile], narrowed).stderr).not.toContain('narrows the graph');
    });
  });

  test('missing --path exits 3', () => {
    expect(run(['impact', 'target', '-p', path.join(dir, 'missing-root')]).status).toBe(3);
  });

  test('describe lists impact as read / idempotent, exit 3 declared', () => {
    const r = run(['describe']);
    expect(r.status).toBe(0);
    const cmd = JSON.parse(r.stdout).commands.find((c: any) => c.name === 'impact');
    expect(cmd).toBeDefined();
    expect(cmd.sideEffect).toBe('read');
    expect(cmd.idempotent).toBe('yes');
    expect(cmd.exitCodes).toContain(3);
  });

  test('--help lists --cols and -o/--output (the format registry accepts them)', () => {
    const r = run(['impact', '--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\s+--cols <cols\.\.\.>/m);
    expect(r.stdout).toMatch(/^\s+-o, --output <path>/m);
    // and they work
    const out = path.join(dir, 'impact.csv');
    expect(run(['impact', 'T', '--graph', graphFile, '--cols', 'name,depth', '-o', out]).status).toBe(0);
    expect(fs.readFileSync(out, 'utf-8').split('\n')[0]).toBe('name,depth');
  });

  describe('two-root graph (alpha + beta, Go cross-root calls)', () => {
    let work: string;
    let g2: string;
    const w = (rel: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
      fs.writeFileSync(path.join(work, rel), body);
    };

    beforeAll(() => {
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-impact-roots-'));
      w('alpha/go.mod', 'module example.com/alpha\n\ngo 1.22\n');
      w('alpha/greet/greet.go', 'package greet\n\nfunc Hello() string { return "hi" }\n');
      w('alpha/internal/run/run.go',
        'package run\n\nimport "example.com/alpha/greet"\n\nfunc Start() string { return greet.Hello() }\n\nfunc Again() string { return greet.Hello() }\n');
      w('alpha/cmd/app/main.go', 'package main\n\nimport "example.com/alpha/greet"\n\nfunc main() { println(greet.Hello()) }\n');
      w('beta/go.mod', 'module example.com/beta\n\ngo 1.22\n');
      w('beta/pkg/use/use.go', 'package use\n\nimport "example.com/alpha/greet"\n\nfunc Use() string { return greet.Hello() }\n');
      g2 = path.join(work, 'g.json');
      const m = run(['map', '--skip-detect', '-p', 'alpha', '-p', 'beta', '--format', 'json', '-o', g2], work);
      expect(m.status).toBe(0);
    });
    afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

    test('text groups by root then package', () => {
      const r = run(['impact', 'Hello', '--graph', g2], work);
      expect(r.status).toBe(0);
      expect(r.stdout.split('\n').slice(0, 4)).toEqual([
        'Hello (function, alpha/greet/greet.go:L3) — 4 callers across 3 groups',
        '  alpha/internal: 2 callers — Start (alpha/internal/run/run.go:L5), Again (alpha/internal/run/run.go:L7)',
        '  alpha/cmd: 1 caller — main (alpha/cmd/app/main.go:L5)',
        '  beta/pkg: 1 caller — Use (beta/pkg/use/use.go:L5)',
      ]);
    });

    test('json groups use flat root/package keys (schema unchanged)', () => {
      const doc = JSON.parse(run(['impact', 'Hello', '--graph', g2, '--format', 'json'], work).stdout);
      expect(doc.groups).toEqual([
        { name: 'alpha/internal', count: 2, byDepth: { 1: 2 } },
        { name: 'alpha/cmd', count: 1, byDepth: { 1: 1 } },
        { name: 'beta/pkg', count: 1, byDepth: { 1: 1 } },
      ]);
      expect(doc.counts.groups).toBe(3);
    });

    test('brief lists one line per root/package group', () => {
      const lines = run(['impact', 'Hello', '--graph', g2, '--format', 'brief'], work).stdout.trimEnd().split('\n');
      expect(lines.slice(1, 4).map(l => l.split(':')[0].trim())).toEqual(['alpha/internal', 'alpha/cmd', 'beta/pkg']);
      expect(lines.join('\n').length).toBeLessThanOrEqual(BRIEF_MAX_CHARS);
    });
  });

  describe('hook-facing behaviour', () => {
    // No FORCE_COLOR / NO_COLOR: colour decided by isTTY alone (stdout is a pipe here).
    function runPiped(args: string[], cwd = dir) {
      const env: NodeJS.ProcessEnv = { ...process.env, XRAY_NO_TELEMETRY: '1', XDG_CONFIG_HOME: path.join(dir, 'xdg') };
      delete env.FORCE_COLOR;
      delete env.NO_COLOR;
      return spawnSync(process.execPath, [BIN, '--no-telemetry', ...args], { cwd, encoding: 'utf-8', env, timeout: 90_000 });
    }

    test.each([
      ['before the subcommand', ['--quiet', 'impact', 'T']],
      ['after the subcommand', ['impact', 'T', '--quiet']],
    ])('--quiet %s with --graph: empty stderr', (_w, args) => {
      const r = run([...args, '--graph', graphFile]);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('3 callers across 2 groups');
    });

    test.each([
      ['before the subcommand', ['--quiet', 'impact', 'target']],
      ['after the subcommand', ['impact', 'target', '--quiet']],
    ])('--quiet %s with a live root: no coverage/cache line', (_w, args) => {
      const r = run([...args, '-p', repo], repo);
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain('coverage:');
      expect(r.stderr).not.toContain('cache:');
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('useIt (lib/use.ts:L2)');
    });

    test.each([['text'], ['brief'], ['tree']])('no ANSI on piped stdout (--format %s)', (f) => {
      const r = runPiped(['impact', 'T', '--graph', graphFile, '--format', f]);
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(r.stdout).not.toMatch(/\x1b\[/);
    });

    test('no match: exit 0, message on stdout', () => {
      const r = run(['impact', 'Nope', '--graph', graphFile]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Nope: no matching symbol in the graph');
    });

    test('--format brief prints the brief', () => {
      const r = run(['--quiet', 'impact', 'T', '--graph', graphFile, '--format', 'brief']);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toBe([
        'T (function, pkg/t.go:L11) — 3 callers across 2 groups',
        '  pkg: 2 callers — A (pkg/a.go:L21), B (pkg/b.go:L31)',
        '  cmd: 1 caller — C (cmd/c.go:L41)',
        'edges: EXTRACTED 3 · INFERRED 0',
        '',
      ].join('\n'));
    });

    test('--format brief prints nothing (exit 0) on no match and on zero callers', () => {
      const none = run(['--quiet', 'impact', 'Nope', '--graph', graphFile, '--format', 'brief']);
      expect(none.status).toBe(0);
      expect(none.stdout).toBe('');
      expect(none.stderr).toBe('');
      const zero = run(['--quiet', 'impact', 'C', '--graph', graphFile, '--format', 'brief']);
      expect(zero.status).toBe(0);
      expect(zero.stdout).toBe('');
    });

    test('--help lists brief among formats', () => {
      expect(run(['impact', '--help']).stdout).toMatch(/text, brief, tree/);
    });
  });

  test('impact sits in the ANALYZE help group', () => {
    const r = run(['--help']);
    const analyze = r.stdout.split(/\n(?=\S)/).find(s => /analy/i.test(s.split('\n')[0])) ?? '';
    expect(analyze).toMatch(/\bimpact\b/);
  });
});
