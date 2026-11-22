import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphBuilder } from '../src/lib/graph/builder';
import { GraphSerializer } from '../src/lib/graph/serializer';
import { ParserManager } from '../src/lib/parser/manager';
import { Xray } from '../src/lib/xray';
import { SqliteCache } from '../src/lib/cache/sqlite-cache';
import { GraphCache, computeRootManifest, diffFileManifest, optionsDigest } from '../src/lib/cache/graph-cache';
import { buildGraphForRoots } from '../src/commands/generate';
import { openCacheDbPath } from '../src/lib/storage';

const writeFile = (root: string, rel: string, content: string, mtime?: Date) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  if (mtime) fs.utimesSync(abs, mtime, mtime);
};

const normalizeGraph = (g: ReturnType<GraphSerializer['serialize']>) => ({
  nodes: g.nodes
    .map(n => ({ id: n.id, type: n.type, label: n.label, file: n.file, kind: n.kind }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  edges: g.edges
    .map(e => `${e.type}|${e.source}|${e.target}|${e.confidence}`)
    .sort(),
});

describe('incremental GraphCache and preset-scoped SqliteCache', () => {
  let repo: string;
  let cacheDir: string;
  let origCwd: string;
  let origXdgCache: string | undefined;

  beforeEach(() => {
    origCwd = process.cwd();
    origXdgCache = process.env.XDG_CACHE_HOME;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-inc-cache-repo-'));
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-inc-cache-dir-'));
    process.env.XDG_CACHE_HOME = cacheDir;

    // 5-file TypeScript fixture repo
    const t0 = new Date('2025-01-01T00:00:00Z');
    writeFile(repo, 'package.json', '{"name":"inc-fixture"}', t0);
    writeFile(repo, 'a.ts', "import { targetFn } from './b';\nexport function callerA() { return targetFn(); }\n", t0);
    writeFile(repo, 'b.ts', "import { helperC } from './c';\nexport function targetFn() { return helperC(); }\n", t0);
    writeFile(repo, 'c.ts', 'export function helperC() { return 42; }\n', t0);
    writeFile(repo, 'd.ts', "import { helperC } from './c';\nexport function callerD() { return helperC(); }\n", t0);
    writeFile(repo, 'e.ts', 'export function standaloneE() { return 1; }\n', t0);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = origXdgCache;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  test('GraphBuilder.patchFiles matches a fresh cold build when an exported function is renamed and restored', async () => {
    const dbPath = path.join(cacheDir, 'unit.db');
    const xray1 = new Xray({ path: repo, cachePath: dbPath, chunked: false, format: 'json' });
    const initial = await xray1.buildGraph();
    const serializer = new GraphSerializer();
    const serialized = serializer.serialize(initial.graph, repo, { references: true });
    const cachedGraph = serializer.deserialize(serialized);

    // Edit b.ts: rename targetFn -> renamedFn
    const bEdited = "import { helperC } from './c';\nexport function renamedFn() { return helperC(); }\n";
    writeFile(repo, 'b.ts', bEdited, new Date('2025-02-01T00:00:00Z'));

    const parser = new ParserManager(repo);
    const parsedB = await parser.parse('b.ts', bEdited, false, 'none', false, false);

    const builder = new GraphBuilder();
    const patched = await builder.patchFiles(cachedGraph, {
      parsedChanged: [{ file: 'b.ts', tags: parsedB.tags, imports: parsedB.imports, records: parsedB.records }],
      removedFiles: [],
    });

    // Fresh cold build on the edited repo
    const xrayCold = new Xray({ path: repo, cachePath: path.join(cacheDir, 'cold.db'), chunked: false, format: 'json' });
    const cold = await xrayCold.buildGraph();

    expect(normalizeGraph(serializer.serialize(patched.graph, repo))).toEqual(
      normalizeGraph(serializer.serialize(cold.graph, repo))
    );

    // Now restore b.ts back to targetFn and patch again using retained references on a.ts::callerA
    const serializedAfterRename = serializer.serialize(patched.graph, repo, { references: true });
    const cachedAfterRename = serializer.deserialize(serializedAfterRename);
    const bRestored = "import { helperC } from './c';\nexport function targetFn() { return helperC(); }\n";
    writeFile(repo, 'b.ts', bRestored, new Date('2025-03-01T00:00:00Z'));
    const parsedBRestored = await parser.parse('b.ts', bRestored, false, 'none', false, false);

    const builder2 = new GraphBuilder();
    const patchedRestored = await builder2.patchFiles(cachedAfterRename, {
      parsedChanged: [{ file: 'b.ts', tags: parsedBRestored.tags, imports: parsedBRestored.imports, records: parsedBRestored.records }],
      removedFiles: [],
    });

    const xrayCold2 = new Xray({ path: repo, cachePath: path.join(cacheDir, 'cold2.db'), chunked: false, format: 'json' });
    const cold2 = await xrayCold2.buildGraph();

    expect(normalizeGraph(serializer.serialize(patchedRestored.graph, repo))).toEqual(
      normalizeGraph(serializer.serialize(cold2.graph, repo))
    );
  });

  test('manifestHash and >25% file change threshold trigger full rebuild fallback', () => {
    const m1 = computeRootManifest(repo);
    expect(Object.keys(m1.fileManifest).sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);

    // 1 of 5 files changed (20% <= 25%) -> incremental diff
    writeFile(repo, 'b.ts', 'export function renamedFn() { return 1; }\n', new Date('2025-02-01T00:00:00Z'));
    const m2 = computeRootManifest(repo);
    const diff1 = diffFileManifest(m1.fileManifest, m2.fileManifest, m1.manifestHash, m2.manifestHash);
    expect(diff1).toEqual({ fallback: false, changedFiles: ['b.ts'], removedFiles: [] });

    // 2 of 5 files changed (40% > 25%) -> fallback to full rebuild
    writeFile(repo, 'e.ts', 'export function standaloneE() { return 2; }\n', new Date('2025-02-01T00:00:00Z'));
    const m3 = computeRootManifest(repo);
    const diff2 = diffFileManifest(m1.fileManifest, m3.fileManifest, m1.manifestHash, m3.manifestHash);
    expect(diff2.fallback).toBe(true);

    // manifestHash change (tsconfig.json added) -> fallback to full rebuild
    writeFile(repo, 'tsconfig.json', '{"compilerOptions":{}}');
    const m4 = computeRootManifest(repo);
    expect(m4.manifestHash).not.toBe(m1.manifestHash);
    const diff3 = diffFileManifest(m1.fileManifest, m4.fileManifest, m1.manifestHash, m4.manifestHash);
    expect(diff3.fallback).toBe(true);
  });

  test('single-root buildGraphForRoots uses GraphCache and incremental patchFiles matches cold build', async () => {
    process.chdir(repo);
    const opts = { path: [repo], limit: '4096', with: [], query: [], match: [], catch: [] };

    const first = await buildGraphForRoots(opts, undefined, { format: 'json', quiet: true, cache: true });
    expect(first.cache).toHaveLength(1);
    expect(first.cache![0].hit).toBe(false);

    // Second run: full cache hit
    const second = await buildGraphForRoots(opts, undefined, { format: 'json', quiet: true, cache: true });
    expect(second.cache![0].hit).toBe(true);
    expect(normalizeGraph(second.graph)).toEqual(normalizeGraph(first.graph));

    // Edit 1 file (20% <= 25%): incremental patch
    writeFile(repo, 'b.ts', "import { helperC } from './c';\nexport function renamedFn() { return helperC(); }\n", new Date('2025-02-01T00:00:00Z'));
    const patched = await buildGraphForRoots(opts, undefined, { format: 'json', quiet: true, cache: true });
    expect(patched.coverage.parsed).toBe(1);

    // Compare against uncached cold build
    const cold = await buildGraphForRoots(opts, undefined, { format: 'json', quiet: true, cache: false });
    expect(normalizeGraph(patched.graph)).toEqual(normalizeGraph(cold.graph));
  });

  test('presetDigest isolates SqliteCache and optionsDigest so preset runs never poison non-preset cache', () => {
    const dbPath = openCacheDbPath(repo);
    const cache = new SqliteCache(dbPath);
    const absA = path.join(repo, 'a.ts');

    cache.set(absA, 100, [{ file: 'a.ts', name: 'callerA', kind: 'function', line: 1, col: 0 }], [], 'none', false, undefined, '', 'none');
    cache.set(absA, 100, [{ file: 'a.ts', name: 'presetCallerA', kind: 'function', line: 1, col: 0 }], [], 'none', false, undefined, '', 'preset-abc');

    const nonPresetHit = cache.get(absA, 100, 'none', false, '', 'none');
    const presetHit = cache.get(absA, 100, 'none', false, '', 'preset-abc');
    const otherPresetMiss = cache.get(absA, 100, 'none', false, '', 'preset-xyz');

    expect(nonPresetHit?.tags[0].name).toBe('callerA');
    expect(presetHit?.tags[0].name).toBe('presetCallerA');
    expect(otherPresetMiss).toBeNull();

    // Verify key layout: tags:<absPath> for 'none', tags:<presetDigest>:<absPath> when active
    expect(cache.getRecord(`tags:${absA}`)).not.toBeNull();
    expect(cache.getRecord(`tags:preset-abc:${absA}`)).not.toBeNull();
    cache.close();

    expect(optionsDigest({ presetDigest: 'none' })).not.toBe(optionsDigest({ presetDigest: 'preset-abc' }));
  });
});
