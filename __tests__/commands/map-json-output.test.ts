/**
 * `--json` / `--format json` must write the documented raw JSON graph (the
 * canonical SerializedGraph that `xray query --graph` consumes), as ONE
 * valid JSON file, in both chunked (default) and --no-chunk modes.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { handleQueryAction } from '../../src/commands/query';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let repo: string;
let outDir: string;

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 90_000,
  });
}

function jsonFilesIn(dir: string): string[] {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
}

describe('map JSON output is valid JSON', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-json-'));
    fs.mkdirSync(path.join(repo, 'sub'));
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export function a() { return 1; }\n');
    fs.writeFileSync(
      path.join(repo, 'sub', 'b.ts'),
      "import { a } from '../a';\nexport function b() { return a(); }\n"
    );
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  });
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-json-out-'));
  });
  afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  const base = () => ['map', '-p', repo, '--skip-detect'];

  const variants: Array<[string, string[]]> = [
    ['--json (chunked default)', ['--json']],
    ['--json --no-chunk', ['--json', '--no-chunk']],
    ['--format json (chunked default)', ['--format', 'json']],
    ['--format json --no-chunk', ['--format', 'json', '--no-chunk']],
  ];

  test.each(variants)('%s: every produced .json file parses and is a graph', (_n, extra) => {
    const out = path.join(outDir, 'graph.json');
    const r = run([...base(), ...extra, '-o', out]);
    expect(r.status).toBe(0);

    const files = jsonFilesIn(outDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
      expect(Array.isArray(parsed.nodes)).toBe(true);
      expect(Array.isArray(parsed.edges)).toBe(true);
      expect(parsed.metadata.nodeCount).toBe(parsed.nodes.length);
    }
    // No stray non-JSON (markdown/text) chunk siblings.
    expect(fs.readdirSync(outDir)).toEqual(['graph.json']);

    const graph = JSON.parse(fs.readFileSync(out, 'utf-8'));
    const labels = graph.nodes.map((n: any) => n.label);
    expect(labels).toEqual(expect.arrayContaining(['a', 'b']));
  });

  test('output without extension gets .json appended', () => {
    const r = run([...base(), '--json', '-o', path.join(outDir, 'g')]);
    expect(r.status).toBe(0);
    expect(() => JSON.parse(fs.readFileSync(path.join(outDir, 'g.json'), 'utf-8'))).not.toThrow();
  });

  test('graph file loads through the query command handler', async () => {
    const out = path.join(outDir, 'graph.json');
    expect(run([...base(), '--json', '-o', out]).status).toBe(0);
    const res = await handleQueryAction('hotspots(limit=3)', { graph: out, format: 'json' });
    expect(res).toBeDefined();
  });

  test('text output is unchanged (not JSON)', () => {
    const out = path.join(outDir, 'out.txt');
    expect(run([...base(), '--no-chunk', '-o', out]).status).toBe(0);
    expect(() => JSON.parse(fs.readFileSync(out, 'utf-8'))).toThrow();
  });
});
