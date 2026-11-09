#!/usr/bin/env ts-node
/**
 * benchmark-clustering.ts — T-0039
 *
 * Runs Louvain community detection over the xray repo itself and writes a
 * deterministic baseline JSON to `benchmarks/clustering.json`. A fixed
 * Mulberry32 seed is passed to `cluster()` via the `rng` option so the
 * committed JSON is byte-identical across runs (spec R5).
 *
 * Usage
 * -----
 *   pnpm ts-node scripts/benchmark-clustering.ts
 *   pnpm ts-node scripts/benchmark-clustering.ts --path <repoPath>
 *
 * This is a reference point for future performance work — NOT an arbitrary
 * threshold. CI should not fail on changes here; humans should interpret
 * the delta before committing an updated JSON.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Xray } from '../src/lib/xray';
import { cluster } from '../src/lib/graph/cluster';
import { openCacheDbPath } from '../src/lib/storage';

const RNG_SEED = 0x5eed_c001;

function mulberry32(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BaselineRecord {
  repo: string;
  rngSeed: number;
  graphNodes: number;
  graphEdges: number;
  communityCount: number;
  modularity: number;
  wallclockMs: number;
  timestamp: null;
}

async function main() {
  const cwd = process.cwd();
  const repoPathArgIdx = process.argv.indexOf('--path');
  const repoPath =
    repoPathArgIdx >= 0 && process.argv[repoPathArgIdx + 1]
      ? path.resolve(process.argv[repoPathArgIdx + 1])
      : cwd;

  process.stdout.write(`[benchmark-clustering] target=${repoPath}\n`);

  const xray = new Xray({
    path: repoPath,
    chunked: false,
    cachePath: openCacheDbPath(cwd),
  });

  const { graph } = await xray.buildGraph();

  const t0 = Date.now();
  const result = cluster(graph, { rng: mulberry32(RNG_SEED) });
  const wallclockMs = Date.now() - t0;

  const record: BaselineRecord = {
    repo: path.basename(repoPath),
    rngSeed: RNG_SEED,
    graphNodes: graph.order,
    graphEdges: graph.size,
    communityCount: result.count,
    modularity: Number(result.modularity.toFixed(6)),
    wallclockMs,
    // Kept null so the committed JSON is byte-identical across runs.
    timestamp: null,
  };

  const outPath = path.resolve(cwd, 'benchmarks', 'clustering.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n', 'utf8');

  process.stdout.write(
    `[benchmark-clustering] nodes=${record.graphNodes} edges=${record.graphEdges} ` +
      `communities=${record.communityCount} modularity=${record.modularity} ` +
      `wallclockMs=${record.wallclockMs}\n`
  );
  process.stdout.write(`[benchmark-clustering] wrote ${outPath}\n`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[benchmark-clustering] failed:', err);
  process.exit(1);
});
