import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphSerializer } from '../src/lib/graph/serializer';
import { obtainGraph } from '../src/commands/graph-source';
import { FunctionAdapter } from '../src/lib/query/adapters/function';

const BIN = path.resolve(__dirname, '..', 'bin', 'xray');

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 90_000,
  });
}

describe('call-site line numbers on calls edges', () => {
  let repo: string;
  let graphFile: string;

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-callsites-'));
    // Line 1: import
    // Line 2: blank
    // Line 3: export function caller() {
    // Line 4:   const x = 1;
    // Line 5:   foo();
    // Line 6:   const y = 2;
    // Line 7:   foo();
    // Line 8:   return x + y;
    // Line 9: }
    fs.writeFileSync(
      path.join(repo, 'a.ts'),
      [
        "import { foo } from './b';",
        '',
        'export function caller() {',
        '  const x = 1;',
        '  foo();',
        '  const y = 2;',
        '  foo();',
        '  return x + y;',
        '}',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(repo, 'b.ts'),
      [
        'export function foo() {',
        '  return 42;',
        '}',
        '',
      ].join('\n')
    );
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
    graphFile = path.join(repo, 'graph.json');
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('obtainGraph preserves sorted 0-based callSites on deduplicated calls edge', async () => {
    const serialized = await obtainGraph({ path: [repo] });
    const callsEdges = serialized.edges.filter(
      e => e.type === 'calls' && e.source === 'a.ts::caller' && e.target === 'b.ts::foo'
    );
    expect(callsEdges).toHaveLength(1);
    expect(callsEdges[0].callSites).toEqual([
      { line: 4, col: 2 },
      { line: 6, col: 2 },
    ]);

    const graph = new GraphSerializer().deserialize(serialized);
    const edgeAttrs = graph.getEdgeAttributes(
      graph.edges('a.ts::caller', 'b.ts::foo')[0]
    );
    expect(edgeAttrs.callSites).toEqual([
      { line: 4, col: 2 },
      { line: 6, col: 2 },
    ]);

    // FunctionAdapter callers() exposes 0-based callSites in graph result
    const q = new FunctionAdapter().execute('callers(foo)', graph);
    expect(q.nodes).toHaveLength(1);
    expect((q.nodes[0] as any).callSites).toEqual([
      { line: 4, col: 2 },
      { line: 6, col: 2 },
    ]);
  });

  test('CLI impact and query render 1-based call-site lines across formats', () => {
    const mapRes = run(['map', '-p', repo, '--no-detect', '--format', 'json', '-o', graphFile], repo);
    expect(mapRes.status).toBe(0);

    // impact --format text
    const textRes = run(['impact', 'foo', '--graph', graphFile, '--format', 'text'], repo);
    expect(textRes.status).toBe(0);
    expect(textRes.stdout).toContain('called at L5, L7');

    // impact --format brief
    const briefRes = run(['impact', 'foo', '--graph', graphFile, '--format', 'brief'], repo);
    expect(briefRes.status).toBe(0);
    expect(briefRes.stdout).toContain('called at L5, L7');

    // impact --format json
    const jsonRes = run(['impact', 'foo', '--graph', graphFile, '--format', 'json'], repo);
    expect(jsonRes.status).toBe(0);
    const impactDoc = JSON.parse(jsonRes.stdout);
    expect(impactDoc.nodes[0].callSites).toEqual([
      { line: 5, col: 2 },
      { line: 7, col: 2 },
    ]);
    expect(impactDoc.edges[0].callSites).toEqual([
      { line: 5, col: 2 },
      { line: 7, col: 2 },
    ]);

    // impact --format table --cols name,file,line,callSites
    const tableRes = run(['impact', 'foo', '--graph', graphFile, '--format', 'table', '--cols', 'name,file,line,callSites'], repo);
    expect(tableRes.status).toBe(0);
    expect(tableRes.stdout).toContain('L5, L7');

    // query "callers(foo)" --format json
    const qJsonRes = run(['query', '--graph', graphFile, '--format', 'json', 'callers(foo)'], repo);
    expect(qJsonRes.status).toBe(0);
    const queryDoc = JSON.parse(qJsonRes.stdout);
    expect(queryDoc.nodes[0].callSites).toEqual([
      { line: 5, col: 2 },
      { line: 7, col: 2 },
    ]);
    expect(queryDoc.edges[0].callSites).toEqual([
      { line: 5, col: 2 },
      { line: 7, col: 2 },
    ]);

    // query "callers(foo)" --format table --cols name,file,line,callSites
    const qTableRes = run(['query', 'callers(foo)', '--graph', graphFile, '--format', 'table', '--cols', 'name,file,line,callSites'], repo);
    expect(qTableRes.status).toBe(0);
    expect(qTableRes.stdout).toContain('L5, L7');

    // query "callers(foo)" --format tree
    const qTreeRes = run(['query', '--graph', graphFile, '--format', 'tree', 'callers(foo)'], repo);
    expect(qTreeRes.status).toBe(0);
    expect(qTreeRes.stdout).toContain('called at L5, L7');
  });
});
