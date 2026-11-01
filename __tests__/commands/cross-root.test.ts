/**
 * Cross-root resolution in merged multi-root graphs: a reference that found
 * no candidate in its own root is resolved once, after the merge, against
 * the other roots. An import that maps to another root (Go module path from
 * its go.mod, npm package name from its package.json) scopes the match
 * (EXTRACTED); otherwise a same-language name match is INFERRED. Every such
 * edge carries `crossRoot: true`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let work: string;

const write = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
  fs.writeFileSync(path.join(work, rel), body);
};

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, '--no-telemetry', ...args], {
    cwd: work,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0', XDG_CONFIG_HOME: path.join(work, '.xdg') },
    timeout: 120_000,
  });
}

function mapGraph(...roots: string[]) {
  const out = path.join(work, `g-${Math.random().toString(36).slice(2)}.json`);
  const r = run(['map', '--skip-detect', ...roots.flatMap(p => ['-p', p]), '--format', 'json', '-o', out]);
  expect(r.status).toBe(0);
  return JSON.parse(fs.readFileSync(out, 'utf-8'));
}

const crossEdges = (g: any) =>
  g.edges
    .filter((e: any) => e.crossRoot === true)
    .map((e: any) => `${e.source} -> ${e.target} ${e.type} ${e.confidence}`)
    .sort();

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cross-root-'));
  // Go: beta imports alpha's module path and calls its exported function.
  write('alpha/go.mod', 'module example.com/alpha\n\ngo 1.22\n');
  write('alpha/greet/greet.go', 'package greet\n\nfunc Hello() string { return "hi" }\n\nfunc Bye() string { return "bye" }\n');
  // same exported name in another package of alpha: not the imported one
  write('alpha/other/other.go', 'package other\n\nfunc Hello() string { return "other" }\n');
  write('beta/go.mod', 'module example.com/beta\n\ngo 1.22\n');
  write(
    'beta/main.go',
    'package main\n\nimport (\n\t"fmt"\n\t"example.com/alpha/greet"\n)\n\nfunc Run() {\n\tfmt.Println(greet.Hello())\n}\n'
  );
  // npm: app imports lib by package name; lib also holds a same-named
  // function in another file and a Go method (neither a TS method).
  write('lib/package.json', JSON.stringify({ name: '@acme/lib', version: '1.0.0' }));
  write(
    'lib/src/index.ts',
    'export function add(a: number, b: number) { return a + b; }\nexport class Runner {\n  start() { return 1; }\n}\n'
  );
  write('lib/src/fns.ts', 'export function start() { return 2; }\nexport function orphan() { return 3; }\n');
  write('lib/tool/tool.go', 'package tool\n\ntype T struct{}\n\nfunc (T) start() {}\n');
  write('app/package.json', JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { '@acme/lib': '1.0.0' } }));
  write(
    'app/main.ts',
    "import { add, Runner } from '@acme/lib';\nexport function main() {\n  add(1, 2);\n  const r = new Runner();\n  r.start();\n  orphan();\n}\n"
  );
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('cross-root resolution (map --format json)', () => {
  test('Go: import of another root\'s module path -> one EXTRACTED crossRoot edge', () => {
    const g = mapGraph('alpha', 'beta');
    expect(crossEdges(g)).toEqual(['beta/main.go::Run -> alpha/greet/greet.go::Hello calls EXTRACTED']);
    expect(g.metadata.edgeCount).toBe(g.edges.length);
    // raw references are an input of the pass, not part of the output
    expect(g.nodes.some((n: any) => 'references' in n)).toBe(false);
  });

  test('npm: package name import scopes the match; member call hits methods only, same language', () => {
    const g = mapGraph('lib', 'app');
    expect(crossEdges(g)).toEqual([
      'app/main.ts::main -> lib/src/fns.ts::orphan calls INFERRED',
      'app/main.ts::main -> lib/src/index.ts::add calls EXTRACTED',
      'app/main.ts::main -> lib/src/index.ts::start calls EXTRACTED',
    ]);
  });

  test('no import mapping and no name match -> no cross-root edge', () => {
    const g = mapGraph('alpha', 'app');
    expect(crossEdges(g)).toEqual([]);
  });

  test('single root output carries no references and no crossRoot edges', () => {
    const g = mapGraph('beta');
    expect(g.nodes.some((n: any) => 'references' in n)).toBe(false);
    expect(crossEdges(g)).toEqual([]);
  });
});

describe('cross-root resolution (impact)', () => {
  test('caller in beta of alpha\'s Hello is grouped under beta, EXTRACTED', () => {
    const r = run(['impact', 'Hello', '-p', 'alpha', '-p', 'beta', '--format', 'json']);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.nodes.map((n: any) => `${n.name} ${n.group} ${n.confidence}`)).toEqual(['Run beta EXTRACTED']);
  });
});
