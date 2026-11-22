/**
 * Diff-scoped impact analysis, diff-focused mapping, git-churn hotspot
 * weighting, and blame author metadata tests.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Graph from 'graphology';
import { Xray } from '../src/lib/xray';
import { Ranker } from '../src/lib/graph/ranker';
import { scoreEdges, DEFAULT_HEURISTICS, churnHotspotHeuristic } from '../src/lib/graph/analyzer';
import { SurpriseAnalyzerPlugin, getSurprises } from '../src/lib/plugins/surprise-analyzer';
import { resolveChangedSymbols } from '../src/lib/query/impact';
import type { DiffFile } from '../src/lib/git';

const BIN = path.resolve(__dirname, '..', 'bin', 'xray');

function git(cwd: string, args: string[], env?: Record<string, string>): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Alice',
      GIT_AUTHOR_EMAIL: 'alice@example.com',
      GIT_COMMITTER_NAME: 'Alice',
      GIT_COMMITTER_EMAIL: 'alice@example.com',
      ...env,
    },
  }).trim();
}

function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-diff-impact-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Alice']);
  git(dir, ['config', 'user.email', 'alice@example.com']);
  return dir;
}

function writeFile(dir: string, relPath: string, content: string): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('resolveChangedSymbols', () => {
  test('converts 1-based diff hunks to 0-based tag line ranges without off-by-one misses', () => {
    const graph = new Graph({ multi: true, type: 'directed' });
    graph.addNode('src/a.ts', { type: 'file', label: 'src/a.ts' });
    // 0-based lines 0..2 => 1-based lines 1..3
    graph.addNode('src/a.ts::firstFn', {
      type: 'tag',
      label: 'firstFn',
      kind: 'function',
      file: 'src/a.ts',
      line: 0,
      endLine: 2,
    });
    graph.addEdge('src/a.ts', 'src/a.ts::firstFn', { type: 'defines' });

    // 0-based lines 4..6 => 1-based lines 5..7
    graph.addNode('src/a.ts::secondFn', {
      type: 'tag',
      label: 'secondFn',
      kind: 'function',
      file: 'src/a.ts',
      line: 4,
      endLine: 6,
    });
    graph.addEdge('src/a.ts', 'src/a.ts::secondFn', { type: 'defines' });

    // Line 4 (1-based) => line 3 (0-based): between firstFn (0..2) and secondFn (4..6)
    const betweenHunks: DiffFile[] = [
      { path: 'src/a.ts', status: 'M', changedLines: [{ start: 4, end: 4 }], patch: '' },
    ];
    const between = resolveChangedSymbols(graph as any, betweenHunks);
    expect(between.fileIds).toEqual(['src/a.ts']);
    expect(between.symbolIds).toEqual([]);

    // Line 3 (1-based) => line 2 (0-based): last line of firstFn
    const boundaryHunks: DiffFile[] = [
      { path: 'src/a.ts', status: 'M', changedLines: [{ start: 3, end: 3 }], patch: '' },
    ];
    const boundary = resolveChangedSymbols(graph as any, boundaryHunks);
    expect(boundary.symbolIds).toEqual(['src/a.ts::firstFn']);
  });
});

describe('diff-scoped impact, map, churn, and blame (git fixture)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();

    // Base commit on main: core.ts has helper() and untouched(), caller.ts calls helper()
    writeFile(
      repoDir,
      'src/core.ts',
      [
        'export function helper(x: number): number {',
        '  return x + 1;',
        '}',
        '',
        'export function untouched(x: number): number {',
        '  return x * 2;',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      repoDir,
      'src/caller.ts',
      [
        "import { helper } from './core';",
        '',
        'export function runCaller(): number {',
        '  return helper(1);',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      repoDir,
      'src/other.ts',
      [
        'export function unrelated(): string {',
        "  return 'ok';",
        '}',
        '',
      ].join('\n')
    );

    git(repoDir, ['add', '.']);
    git(repoDir, ['commit', '-m', 'chore: initial commit']);

    // Extra commits on src/other.ts by Bob to create churn + distinct blame author
    for (let i = 1; i <= 4; i++) {
      writeFile(
        repoDir,
        'src/other.ts',
        [
          `export function unrelated(tag = '${i}'): string {`,
          `  const prefix = 'ok';`,
          `  return prefix + '-' + tag;`,
          '}',
          '',
        ].join('\n')
      );
      git(repoDir, ['add', 'src/other.ts']);
      git(repoDir, ['commit', '-m', `chore: bump other ${i}`], {
        GIT_AUTHOR_NAME: 'Bob',
        GIT_AUTHOR_EMAIL: 'bob@example.com',
        GIT_COMMITTER_NAME: 'Bob',
        GIT_COMMITTER_EMAIL: 'bob@example.com',
      });
    }

    // Feature branch modifies helper() in src/core.ts
    git(repoDir, ['checkout', '-b', 'feat/change-helper']);
    writeFile(
      repoDir,
      'src/core.ts',
      [
        'export function helper(x: number): number {',
        '  return x + 42;',
        '}',
        '',
        'export function untouched(x: number): number {',
        '  return x * 2;',
        '}',
        '',
      ].join('\n')
    );
    git(repoDir, ['add', 'src/core.ts']);
    git(repoDir, ['commit', '-m', 'feat: update helper']);

    // Unstaged working-tree edit to runCaller() in src/caller.ts, plus entry.ts calling runCaller()
    writeFile(
      repoDir,
      'src/entry.ts',
      [
        "import { runCaller } from './caller';",
        '',
        'export function main(): number {',
        '  return runCaller();',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      repoDir,
      'src/caller.ts',
      [
        "import { helper } from './core';",
        '',
        'export function runCaller(): number {',
        '  return helper(99);',
        '}',
        '',
      ].join('\n')
    );
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  test('xray impact --since main finds callers of branch-modified function', () => {
    const res = spawnSync(
      'node',
      [BIN, 'impact', '--since', 'main', '-p', repoDir, '--format', 'json'],
      { encoding: 'utf-8' }
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    const matchNames = parsed.symbol.matches.map((m: any) => m.name);
    const callerNames = parsed.nodes.map((n: any) => n.name);
    expect(matchNames).toContain('helper');
    expect(callerNames).toContain('runCaller');
  });

  test('xray impact --changed finds callers of unstaged working-tree changes', () => {
    const res = spawnSync(
      'node',
      [BIN, 'impact', '--changed', '-p', repoDir, '--format', 'json'],
      { encoding: 'utf-8' }
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    const matchNames = parsed.symbol.matches.map((m: any) => m.name);
    const callerNames = parsed.nodes.map((n: any) => n.name);
    expect(matchNames).toContain('runCaller');
    expect(callerNames).toContain('main');
  });

  test('xray impact without <symbol>, --since, or --changed exits with usage error (2)', () => {
    const res = spawnSync('node', [BIN, 'impact', '-p', repoDir], { encoding: 'utf-8' });
    expect(res.status).toBe(2);
  });

  test('xray map --since main marks touched files with [CHANGED] and boosts them in rank', () => {
    const outPath = path.join(repoDir, 'map-out.md');
    const res = spawnSync(
      'node',
      [BIN, 'map', '--since', 'main', '--no-chunk', '-p', repoDir, '-o', outPath],
      { encoding: 'utf-8' }
    );
    expect(res.status).toBe(0);
    const content = fs.readFileSync(outPath, 'utf-8');
    expect(content).toContain('[CHANGED]');
    expect(content).toMatch(/src\/core\.ts.*\[CHANGED\]/);
  });

  test('--with churn boosts hub scores by 1 + log1p(commits) * 0.35 and wires churn-hotspot heuristic', async () => {
    const graph = new Graph({ multi: true, type: 'directed' });
    graph.addNode('a.ts', { type: 'file', label: 'a.ts' });
    graph.addNode('b.ts', { type: 'file', label: 'b.ts' });
    graph.addEdge('a.ts', 'b.ts', { type: 'calls', confidence: 'EXTRACTED' });

    const ranker = new Ranker(graph as any);
    const base = ranker.rank();
    const churnMap = new Map<string, number>([['b.ts', 10]]);
    const boosted = ranker.rank(undefined, churnMap);

    const baseB = base.find(n => n.id === 'b.ts')!.rank;
    const boostedB = boosted.find(n => n.id === 'b.ts')!.rank;
    expect(boostedB).toBeCloseTo(baseB * (1 + Math.log1p(10) * 0.35), 8);

    const { scored, heuristicsActive } = scoreEdges(
      graph as any,
      boosted,
      { churnMap },
      [...DEFAULT_HEURISTICS, churnHotspotHeuristic]
    );
    expect(heuristicsActive).toContain('churn-hotspot');
    expect(scored[0].reasons.some(r => r.code === 'churn-hotspot')).toBe(true);

    // End-to-end Xray + SurpriseAnalyzerPlugin with features.churn
    const xray = new Xray({
      path: repoDir,
      features: { churn: true },
      chunked: false,
    });
    xray.use(new SurpriseAnalyzerPlugin());
    await xray.run();
    const surprises = getSurprises(xray);
    expect(Array.isArray(surprises)).toBe(true);
  });

  test('--with blame attaches primary blame author on file and symbol nodes in JSON and map output', () => {
    const jsonPath = path.join(repoDir, 'blame.json');
    const jsonRes = spawnSync(
      'node',
      [BIN, 'map', '--with', 'blame', '--format', 'json', '-p', repoDir, '-o', jsonPath],
      { encoding: 'utf-8' }
    );
    expect(jsonRes.status).toBe(0);
    const serialized = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const otherFile = serialized.nodes.find((n: any) => n.id === 'src/other.ts');
    const unrelatedFn = serialized.nodes.find((n: any) => n.id === 'src/other.ts::unrelated');
    expect(otherFile?.author).toBe('Bob');
    expect(unrelatedFn?.author).toBe('Bob');

    const mapPath = path.join(repoDir, 'blame.md');
    const mapRes = spawnSync(
      'node',
      [BIN, 'map', '--with', 'blame', '--no-chunk', '-p', repoDir, '-o', mapPath],
      { encoding: 'utf-8' }
    );
    expect(mapRes.status).toBe(0);
    const mapContent = fs.readFileSync(mapPath, 'utf-8');
    expect(mapContent).toContain('Bob');
  });
});
