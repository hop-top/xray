/**
 * Go package-qualified calls (`pkg.Func()`) resolve to calls edges when the
 * package is module-local (go.mod), honouring aliases; nothing else links.
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

function graph(root = repo) {
  const out = path.join(outDir, `g-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [BIN, 'map', '--skip-detect', '-p', root, '--format', 'json', '-o', out], {
    cwd: outDir,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 120_000,
  });
  expect(r.status).toBe(0);
  const g = JSON.parse(fs.readFileSync(out, 'utf-8'));
  const calls = g.edges.filter((e: any) => e.type === 'calls');
  const from = (src: string) =>
    calls.filter((e: any) => e.source === src).map((e: any) => e.target).sort();
  return { calls, from };
}

describe('Go package-qualified call edges', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gocalls-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gocalls-out-'));
    write('go.mod', 'module example.com/demo\n\ngo 1.21\n');
    write(
      'main.go',
      [
        'package main',
        '',
        'import (',
        '\t"fmt"',
        '',
        '\t"example.com/demo/cmd"',
        '\tu "example.com/demo/util"',
        '\t_ "example.com/demo/blank"',
        '\t"github.com/spf13/cobra"',
        ')',
        '',
        'func main() {',
        '\tcmd.Execute()',
        '\tu.Run()',
        '\tfmt.Println()',
        '\tcobra.Execute()',
        '\tr := u.NewRunner()',
        '\tr.Execute()',
        '}',
        '',
      ].join('\n')
    );
    write('cmd/root.go', 'package cmd\n\nfunc Execute() {}\n\nfunc hidden() {}\n');
    write('util/util.go', 'package util\n\ntype Runner struct{}\n\nfunc NewRunner() *Runner { return &Runner{} }\n\nfunc (r *Runner) Execute() {}\n\nfunc Run() {}\n\nfunc Execute() {}\n');
    write('other/other.go', 'package other\n\nfunc Execute() {}\n\nfunc Run() {}\n');
    // "util" here is a third-party package, not example.com/demo/util
    write(
      'ext/ext.go',
      'package ext\n\nimport "github.com/vendor/util"\n\nfunc Use() { util.Run() }\n'
    );
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test('main -> cmd.Execute resolves; aliased import resolves', () => {
    const { from } = graph();
    const t = from('main.go::main');
    expect(t).toContain('cmd/root.go::Execute');
    expect(t).toContain('util/util.go::Run');
    expect(t).toContain('util/util.go::NewRunner');
  });

  test('same-named functions in other packages are not cross-linked', () => {
    const { from } = graph();
    const t = from('main.go::main');
    expect(t).not.toContain('util/util.go::Execute');
    expect(t).not.toContain('other/other.go::Execute');
    expect(t).not.toContain('other/other.go::Run');
    expect(t.filter((x: string) => x.endsWith('::Execute'))).toEqual(['cmd/root.go::Execute']);
  });

  test('external, blank-imported and value-method calls stay unresolved', () => {
    const { from, calls } = graph();
    // cobra.Execute() / fmt.Println() / r.Execute(): no module-local target
    expect(from('main.go::main')).toEqual([
      'cmd/root.go::Execute',
      'util/util.go::NewRunner',
      'util/util.go::Run',
    ]);
    // third-party `util` must not link to the module's util package
    expect(from('ext/ext.go::Use')).toEqual([]);
    expect(calls.every((e: any) => e.target !== 'cmd/root.go::hidden')).toBe(true);
  });

  test('edges carry INFERRED confidence', () => {
    const { calls } = graph();
    const e = calls.find((c: any) => c.source === 'main.go::main' && c.target === 'cmd/root.go::Execute');
    expect(e.confidence).toBe('INFERRED');
  });

  test('scanning a sub-directory of the module still resolves inside it', () => {
    const { from } = graph(repo);
    expect(from('main.go::main').length).toBe(3);
    write('cmd/sub.go', 'package cmd\n\nimport "example.com/demo/util"\n\nfunc Sub() { util.Run() }\n');
    const sub = graph(path.join(repo, 'cmd'));
    // util is outside the scanned root: nothing to link to
    expect(sub.from('sub.go::Sub')).toEqual([]);
    fs.rmSync(path.join(repo, 'cmd/sub.go'));
  });

  test('nested go.mod disables qualified resolution (unsupported layout)', () => {
    write('tools/go.mod', 'module example.com/demo/tools\n\ngo 1.21\n');
    try {
      expect(graph().from('main.go::main')).toEqual([]);
    } finally {
      fs.rmSync(path.join(repo, 'tools'), { recursive: true, force: true });
    }
  });
});
