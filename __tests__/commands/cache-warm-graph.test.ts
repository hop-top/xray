/**
 * A warm parse cache (the project's cache db from a previous run in the same cwd) must
 * yield exactly the graph a cold run yields: same nodes, same edges.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { projectCacheDbPath } from '../../src/lib/storage';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let work: string;
let outDir: string;

function map(out: string, ...roots: string[]) {
  const r = spawnSync(
    process.execPath,
    [BIN, 'map', '--skip-detect', ...roots.flatMap(p => ['-p', p]), '--format', 'json', '-o', out],
    {
      cwd: work,
      encoding: 'utf-8',
      env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
      timeout: 120_000,
    }
  );
  expect(r.status).toBe(0);
  const g = JSON.parse(fs.readFileSync(out, 'utf-8'));
  const nodes = g.nodes.map((n: any) => n.id).sort();
  const edges = g.edges.map((e: any) => `${e.type}|${e.source}|${e.target}|${e.confidence}`).sort();
  return { nodes, edges };
}

describe('warm cache == cold cache', () => {
  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-warm-'));
    const w = (f: string, s: string) => {
      fs.mkdirSync(path.dirname(path.join(work, 'proj', f)), { recursive: true });
      fs.writeFileSync(path.join(work, 'proj', f), s);
    };
    w('a.ts', "import { helper } from './b';\nimport { x } from './c';\nexport function main() { helper(); x(); }\n");
    w('b.ts', "import { x } from './c';\nexport function helper() { x(); }\n");
    w('c.ts', 'export function x() { return 1; }\n');
    w('lib/util.js', "const { x } = require('./other');\nexport function util() { return 1; }\n");
    w('app.py', 'import os\nfrom pkg import mod\n\ndef run():\n    helper()\n\ndef helper():\n    pass\n');
    w('go.mod', 'module example.com/demo\n\ngo 1.21\n');
    w('main.go', 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println(); helper() }\n\nfunc helper() {}\n');
  });
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-warm-out-'));
    fs.rmSync(projectCacheDbPath(work)!, { force: true });
  });
  afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));
  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  test('second run with a warm cache reproduces the cold graph', () => {
    const cold = map(path.join(outDir, 'cold.json'), 'proj');
    expect(cold.edges.filter((e: string) => e.startsWith('imports|'))).toHaveLength(3);
    expect(fs.existsSync(projectCacheDbPath(work)!)).toBe(true);
    expect(fs.existsSync(path.join(work, '.xray_cache.db'))).toBe(false);
    const warm = map(path.join(outDir, 'warm.json'), 'proj');
    expect(warm.nodes).toEqual(cold.nodes);
    expect(warm.edges).toEqual(cold.edges);
    const warm2 = map(path.join(outDir, 'warm2.json'), 'proj');
    expect(warm2).toEqual(cold);
  });

  test('warm multi-root merged graph equals cold', () => {
    fs.cpSync(path.join(work, 'proj'), path.join(work, 'proj2'), { recursive: true });
    try {
      const cold = map(path.join(outDir, 'cold.json'), 'proj', 'proj2');
      const warm = map(path.join(outDir, 'warm.json'), 'proj', 'proj2');
      expect(warm).toEqual(cold);
    } finally {
      fs.rmSync(path.join(work, 'proj2'), { recursive: true, force: true });
    }
  });
});
