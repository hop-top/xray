/**
 * `xray impact <symbol>`: BFS over inbound `calls` edges from every tag
 * matching <symbol>, shortest depth per caller, per-edge confidence,
 * grouped by root label (multi-root) or first path segment (one root).
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
import { computeImpact, groupKey, renderImpactText, impactToQueryResult } from '../../src/lib/query/impact';
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

  test('multi-root: the root label from metadata.roots', () => {
    const roots = [{ label: 'api', path: '/r/api' }, { label: 'web', path: '/r/web' }];
    expect(groupKey('api/internal/x.go', roots)).toBe('api');
    expect(groupKey('web/src/a.ts', roots)).toBe('web');
  });

  test('multi-root fixture groups callers by root label', () => {
    const roots = [{ label: 'api', path: '/r/api' }, { label: 'web', path: '/r/web' }];
    const t = tag('api/pkg/t.go', 'T', 1);
    const a = tag('api/internal/a.go', 'A', 2);
    const b = tag('api/cmd/b.go', 'B', 3);
    const w = tag('web/src/w.ts', 'W', 4);
    const g = graphOf([t, a, b, w], [calls(a, t), calls(b, t), calls(w, t, 'INFERRED')], roots);
    const r = computeImpact(load(g), 'T', { roots });
    expect(r.groups.map(x => [x.name, x.count])).toEqual([['api', 2], ['web', 1]]);
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
    // Record formats carry the graph's 0-based line; text shows editor lines.
    expect(doc.symbol.matches[0].line).toBe(10);
  });

  test('--format tree prints the call tree', () => {
    const r = run(['impact', 'T', '--graph', graphFile, '--format', 'tree']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Call Tree:');
    expect(r.stdout).toMatch(/└─→ T|├─→ T/);
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
    const after = fs.readdirSync(repo).filter(f => !f.startsWith('.xray_cache')).sort();
    expect(after).toEqual(before);
    expect(fs.existsSync(path.join(repo, '.xray'))).toBe(false);
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

  test('impact sits in the ANALYZE help group', () => {
    const r = run(['--help']);
    const analyze = r.stdout.split(/\n(?=\S)/).find(s => /analy/i.test(s.split('\n')[0])) ?? '';
    expect(analyze).toMatch(/\bimpact\b/);
  });
});
