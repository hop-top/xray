/**
 * `xray query` must print its result to stdout (human table by default,
 * `--format json` for machines) and map failures onto exit codes.
 * Spawns the real bin against a graph written by `map --format json`.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let repo: string;
let outDir: string;
let graphFile: string;

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 90_000,
  });
}

describe('xray query prints results', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-qout-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-qout-g-'));
    fs.writeFileSync(
      path.join(repo, 'a.ts'),
      'export function main() { helper(); }\nexport function helper() { return 1; }\n'
    );
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
    graphFile = path.join(outDir, 'graph.json');
    const r = run(['map', '-p', repo, '--skip-detect', '--format', 'json', '-o', graphFile]);
    expect(r.status).toBe(0);
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test('default (table) prints result rows on stdout', () => {
    const r = run(['query', '--graph', graphFile, 'calls(main)']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^name\s+kind\s+file\s+line/);
    expect(r.stdout).toContain('helper');
  });

  test('--format json prints one parseable JSON document on stdout', () => {
    const r = run(['query', '--graph', graphFile, '--format', 'json', 'calls(main)']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.nodes.map((n: any) => n.name)).toEqual(['helper']);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.metadata.queryType).toBe('calls');
  });

  test('--format tree prints the call tree', () => {
    const r = run(['query', '--graph', graphFile, '--format', 'tree', 'calls(main)']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('helper');
  });

  test('--list-adapters prints adapters', () => {
    const r = run(['query', '--list-adapters']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Available Query Adapters');
  });

  test('missing graph file exits 3 (not found), nothing on stdout', () => {
    const r = run(['query', '--graph', path.join(outDir, 'nope.json'), 'calls(main)']);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Graph file not found');
  });

  test('without --graph the graph is built in memory for the roots (same result as --graph)', () => {
    const built = run(['query', '-p', repo, '--format', 'json', 'calls(main)']);
    expect(built.status).toBe(0);
    const saved = run(['query', '--graph', graphFile, '--format', 'json', 'calls(main)']);
    const strip = (doc: any) => ({ nodes: doc.nodes, edges: doc.edges });
    expect(strip(JSON.parse(built.stdout))).toEqual(strip(JSON.parse(saved.stdout)));
    expect(built.stderr).toContain('coverage:');
  });

  test('--graph cannot be combined with --path, --lens or --scope (exit 2)', () => {
    const r = run(['query', '--graph', graphFile, '-p', repo, 'calls(main)']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot be combined');
    expect(r.stdout).toBe('');
  });

  test('--help lists the build options', () => {
    const r = run(['query', '--help']);
    expect(r.stdout).toMatch(/--lens/);
    expect(r.stdout).toMatch(/--scope/);
    expect(r.stdout).toMatch(/--path/);
  });

  test('empty query is a usage error (exit 2)', () => {
    const r = run(['query', '--graph', graphFile]);
    expect(r.status).toBe(2);
  });
});
