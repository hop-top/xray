/**
 * Multi-module Go layouts (go.work and/or nested go.mod): every file belongs
 * to its nearest go.mod, an import maps to the module with the longest
 * matching module path, and go.work (when present) narrows the module set.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let repo: string;
let outDir: string;

const write = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), body);
};

function graph() {
  const out = path.join(outDir, `g-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [BIN, 'map', '--skip-detect', '-p', repo, '--format', 'json', '-o', out], {
    cwd: outDir,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 120_000,
  });
  expect(r.status).toBe(0);
  const g = JSON.parse(fs.readFileSync(out, 'utf-8'));
  const calls = g.edges.filter((e: any) => e.type === 'calls');
  const from = (src: string) =>
    calls
      .filter((e: any) => e.source === src)
      .map((e: any) => `${e.target} ${e.confidence}`)
      .sort();
  return { from };
}

describe('Go multi-module resolution', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gomulti-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gomulti-out-'));
    write('go.mod', 'module example.com/m\n\ngo 1.22\n');
    write('go.work', 'go 1.22\n\nuse (\n\t.\n\t./sdk/go\n)\n');
    write('sdk/go/go.mod', 'module example.com/m/sdk/go\n\ngo 1.22\n');
    // not listed in go.work: outside the workspace
    write('tools/go.mod', 'module example.com/m/tools\n\ngo 1.22\n');
    write('tools/tools.go', 'package tools\n\nfunc Tool() {}\n');
    write(
      'internal/pkg/pkg.go',
      'package pkg\n\ntype R struct{}\n\nfunc New() *R { return &R{} }\n\nfunc (r *R) Run() {}\n'
    );
    write(
      'sdk/go/client/client.go',
      'package client\n\ntype C struct{}\n\nfunc New() *C { return &C{} }\n\nfunc (c *C) Do() {}\n'
    );
    write(
      'cmd/x.go',
      [
        'package main',
        '',
        'import (',
        '\t"example.com/m/internal/pkg"',
        '\t"example.com/m/tools"',
        ')',
        '',
        'func main() {',
        '\tr := pkg.New()',
        '\tr.Run()',
        '\ttools.Tool()',
        '}',
        '',
      ].join('\n')
    );
    write(
      'sdk/go/use.go',
      [
        'package sdk',
        '',
        'import (',
        '\t"example.com/m/internal/pkg"',
        '\t"example.com/m/sdk/go/client"',
        ')',
        '',
        'func Use() {',
        '\tc := client.New()',
        '\tc.Do()',
        '\tpkg.New()',
        '}',
        '',
      ].join('\n')
    );
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test('root-module file: import and member call resolve EXTRACTED; module outside go.work does not', () => {
    expect(graph().from('cmd/x.go::main')).toEqual([
      'internal/pkg/pkg.go::New EXTRACTED',
      'internal/pkg/pkg.go::Run EXTRACTED',
    ]);
  });

  test('nested-module file resolves inside its module and across to the root module', () => {
    expect(graph().from('sdk/go/use.go::Use')).toEqual([
      'internal/pkg/pkg.go::New EXTRACTED',
      'sdk/go/client/client.go::Do EXTRACTED',
      'sdk/go/client/client.go::New EXTRACTED',
    ]);
  });

  test('without go.work every discovered go.mod is a module', () => {
    fs.renameSync(path.join(repo, 'go.work'), path.join(repo, 'go.work.off'));
    try {
      expect(graph().from('cmd/x.go::main')).toEqual([
        'internal/pkg/pkg.go::New EXTRACTED',
        'internal/pkg/pkg.go::Run EXTRACTED',
        'tools/tools.go::Tool EXTRACTED',
      ]);
    } finally {
      fs.renameSync(path.join(repo, 'go.work.off'), path.join(repo, 'go.work'));
    }
  });
});
