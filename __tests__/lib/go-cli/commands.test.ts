import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import GoCliStrategy from '../../../strategies/go-cli';
import { StrategyContextImpl } from '../../../src/lib/strategy/context';
import { parseToolspec, ToolspecParseError } from '../../../src/lib/strategy/go-cli/toolspec';
import { renderJson, renderText } from '../../../src/lib/strategy/go-cli/model';
import { RunResult, RunOptions } from '../../../src/lib/strategy/go-cli/binary';

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'go-cli');
const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-testcache-'));
const specJson = fs.readFileSync(path.join(FIX, 'kit', 'spec.json'), 'utf-8');

function ctxFor(dir: string) {
  return new StrategyContextImpl(dir);
}
async function run(strategy: GoCliStrategy, dir: string, opts: any = {}): Promise<string> {
  return strategy.commands.commands.handler(ctxFor(dir), opts);
}
const paths = (j: any) => j.commands.map((c: any) => c.path.join(' '));

describe('go-cli detection', () => {
  it('detects hop.top/kit in go.mod', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-kit-'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n\ngo 1.26\n\nrequire hop.top/kit v0.5.0\n');
    expect(await new GoCliStrategy().detect(ctxFor(dir))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('toolspec parsing (recorded kit `spec --format json`)', () => {
  it('builds the tree, drops the spec built-in, keeps safety metadata', () => {
    const r = parseToolspec(specJson);
    expect(r.source).toBe('toolspec');
    expect(r.tool).toBe('demo');
    expect(r.schemaVersion).toBe('1.0');
    expect(r.commands.map(c => c.path.join(' '))).toEqual([
      'demo', 'demo item', 'demo item add', 'demo item purge', 'demo list', 'demo status',
    ]);
    const purge = r.commands.find(c => c.path.join(' ') === 'demo item purge')!;
    expect(purge.safety).toMatchObject({ sideEffect: 'destructive', level: 'dangerous', idempotent: 'no' });
    const list = r.commands.find(c => c.path.join(' ') === 'demo list')!;
    expect(list.safety).toMatchObject({ sideEffect: 'read', level: 'safe', dryRunSupported: false });
    expect(list.flags).toEqual([
      { name: 'filter', shorthand: 'f', type: 'string', description: 'filter expression', default: undefined },
    ]);
    // synthesized group node has no safety
    expect(r.commands.find(c => c.path.join(' ') === 'demo item')!.safety).toBeUndefined();
  });

  it('accepts the nested ToolSpec tree shape', () => {
    const r = parseToolspec(JSON.stringify({
      name: 't',
      commands: [{ name: 'a', children: [{ name: 'b', safety: { level: 'caution' } }] }],
    }));
    expect(r.commands.map(c => c.path.join(' '))).toEqual(['t', 't a', 't a b']);
    expect(r.commands[2].safety?.level).toBe('caution');
  });

  it.each([['not json'], ['{}'], ['{"commands":[]}'], ['{"tool":"x","commands":[{"path":[]}]}'], ['{"code":"USAGE","message":"x"}']])(
    'rejects %s',
    raw => {
      expect(() => parseToolspec(raw)).toThrow(ToolspecParseError);
    }
  );

  it('renders stable JSON and a text tree', () => {
    const r = parseToolspec(specJson);
    const j = JSON.parse(renderJson(r));
    expect(j.source).toBe('toolspec');
    expect(paths(j)).toEqual([...paths(j)].sort((a: string, b: string) => (a < b ? -1 : 1)));
    expect(renderJson(r)).toBe(renderJson(parseToolspec(specJson)));
    const text = renderText(r);
    expect(text).toContain('demo commands [source: kit toolspec');
    expect(text).toContain('└─ purge');
    expect(text).toContain('[destructive]');
  });
});

describe('AST extraction', () => {
  it('cobra: hierarchy across files, consts, flag forms, aliases/hidden', async () => {
    const out = JSON.parse(await run(new GoCliStrategy(), path.join(FIX, 'cobra'), { format: 'json' }));
    expect(out.source).toBe('ast');
    expect(out.tool).toBe('cobrademo');
    expect(paths(out)).toEqual([
      'cobrademo', 'cobrademo deploy', 'cobrademo deploy rollback', 'cobrademo serve', 'cobrademo version',
    ]);
    const byPath = (p: string) => out.commands.find((c: any) => c.path.join(' ') === p);
    expect(byPath('cobrademo').flags).toEqual([
      { name: 'config', shorthand: 'c', type: 'string', description: 'config file', default: 'app.yaml' },
      { name: 'verbose', shorthand: 'v', type: 'bool', description: 'verbose output', persistent: true },
    ]);
    expect(byPath('cobrademo').long).toBe('Long description\nfor the demo.');
    expect(byPath('cobrademo deploy').aliases).toEqual(['ship']);
    expect(byPath('cobrademo deploy').flags.map((f: any) => f.name)).toEqual(['replicas', 'target']);
    expect(byPath('cobrademo deploy rollback').hidden).toBe(true);
    expect(byPath('cobrademo serve').flags.map((f: any) => f.name)).toEqual(['port', 'timeout']);
    expect(byPath('cobrademo serve').file).toBe('internal/serve/serve.go');
    expect(byPath('cobrademo').safety).toBeUndefined();
    expect(out.warnings).toEqual([]);
  });

  it('urfave: App, nested Subcommands, identifier refs, flags', async () => {
    const out = JSON.parse(await run(new GoCliStrategy(), path.join(FIX, 'urfave'), { format: 'json' }));
    expect(out.source).toBe('ast');
    expect(paths(out)).toEqual([
      'urfavedemo', 'urfavedemo db', 'urfavedemo db migrate', 'urfavedemo db reset', 'urfavedemo sync',
    ]);
    const sync = out.commands.find((c: any) => c.path.join(' ') === 'urfavedemo sync');
    expect(sync.flags).toEqual([{ name: 'dry-run', shorthand: 'n', type: 'bool', description: 'do not apply' }]);
    const root = out.commands[0];
    expect(root.flags[0]).toMatchObject({ name: 'config', shorthand: 'c', default: 'app.toml' });
  });

  it('text format by default', async () => {
    const text = await run(new GoCliStrategy(), path.join(FIX, 'cobra'));
    expect(text).toContain('cobrademo commands [source: AST (tree-sitter-go)]');
    expect(text).toContain('├─ deploy');
  });

  it('analyze() reports per-file commands, flags, hierarchy tags', async () => {
    const s = new GoCliStrategy();
    const ctx = ctxFor(path.join(FIX, 'cobra'));
    const m = await s.analyze('cmd/deploy.go', ctx);
    expect(m.tags).toEqual(expect.arrayContaining(['go-cli:command', 'go-cli:flags', 'go-cli:hierarchy']));
    expect(m.metadata!.commands.map((c: any) => c.name)).toEqual(['deploy', 'rollback']);
    const u = await s.analyze('main.go', ctxFor(path.join(FIX, 'urfave')));
    expect(u.tags).toContain('go-cli:urfave-app');
    expect(u.metadata!.appName).toBe('urfavedemo');
    const none = await s.analyze('main.go', ctxFor(path.join(FIX, 'stdspec')));
    expect(none.tags).toEqual([]);
  });

  it('missing tree-sitter-go: skips AST with a warning, does not throw', async () => {
    const s = new GoCliStrategy();
    s.grammarLoader = () => null;
    const out = JSON.parse(await run(s, path.join(FIX, 'cobra'), { format: 'json' }));
    expect(out.commands).toEqual([]);
    expect(out.warnings.join(' ')).toContain('tree-sitter-go');
    const m = await s.analyze('cmd/deploy.go', ctxFor(path.join(FIX, 'cobra')));
    expect(m.tags).toEqual([]);
    expect(m.metadata!.astSkipped).toBeDefined();
  });
});

describe('execution is opt-in (trust model)', () => {
  let calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }>;
  const mkRunner = (specOut: string, buildCode = 0, buildErr = 'boom: cannot build') => async (cmd: string, args: string[], ro: RunOptions): Promise<RunResult> => {
    calls.push({ cmd, args, env: ro.env });
    const o = args.indexOf('-o');
    if (o >= 0) {
      if (buildCode === 0) fs.writeFileSync(args[o + 1], '#!/bin/sh\n');
      return { code: buildCode, stdout: '', stderr: buildCode ? buildErr : '', timedOut: false };
    }
    return { code: 0, stdout: specOut, stderr: '', timedOut: false };
  };
  beforeEach(() => {
    calls = [];
    delete process.env.XRAY_GO_CLI_EXEC;
  });

  it('default run never builds or executes anything, even with a hostile repo-local config', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-hostile-'));
    fs.cpSync(path.join(FIX, 'stdspec'), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.xrayrc.json'), JSON.stringify({ goCli: { exec: true, execBinary: true } }));
    fs.writeFileSync(path.join(dir, '.xray.yml'), 'goCli:\n  exec: true\n');
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: 'sandbox-exec', cacheDir: CACHE };
    const out = JSON.parse(await run(s, dir, { format: 'json' }));
    expect(calls).toEqual([]);
    expect(out.source).toBe('ast');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('--exec-binary builds then runs, both wrapped in the sandbox', async () => {
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: 'sandbox-exec', cacheDir: CACHE };
    const out = JSON.parse(await run(s, path.join(FIX, 'stdspec'), { format: 'json', execBinary: true }));
    expect(out.source).toBe('toolspec');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.cmd).toBe('/usr/bin/sandbox-exec');
    expect(calls[0].args.join(' ')).toContain('go build');
    expect(calls[0].args.join(' ')).toContain('(deny network*)');
    expect(calls[1].args).toEqual(expect.arrayContaining(['spec', '--format', 'json']));
    expect(calls[1].args.join(' ')).toContain('(deny file-read* (subpath');
  });

  it('cgo is off by default and only on with --allow-cgo / XRAY_GO_CLI_CGO=1', async () => {
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: 'sandbox-exec', cacheDir: CACHE };
    await run(s, path.join(FIX, 'stdspec'), { format: 'json', execBinary: true });
    expect(calls[0].env.CGO_ENABLED).toBe('0');
    calls = [];
    await run(s, path.join(FIX, 'stdspec'), { format: 'json', execBinary: true, allowCgo: true });
    expect(calls[0].env.CGO_ENABLED).toBe('1');
    calls = [];
    process.env.XRAY_GO_CLI_CGO = '1';
    await run(s, path.join(FIX, 'stdspec'), { format: 'json', execBinary: true });
    delete process.env.XRAY_GO_CLI_CGO;
    expect(calls[0].env.CGO_ENABLED).toBe('1');
    // build env is scrubbed of inherited secrets
    process.env.XRAY_TEST_SECRET = 'hunter2';
    calls = [];
    await run(s, path.join(FIX, 'stdspec'), { format: 'json', execBinary: true });
    delete process.env.XRAY_TEST_SECRET;
    expect(calls[0].env.XRAY_TEST_SECRET).toBeUndefined();
  });

  it('repo config cannot enable cgo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocli-cgocfg-'));
    fs.cpSync(path.join(FIX, 'stdspec'), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.xrayrc.json'), JSON.stringify({ goCli: { allowCgo: true } }));
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: 'sandbox-exec', cacheDir: CACHE };
    await run(s, dir, { format: 'json', execBinary: true });
    expect(calls[0].env.CGO_ENABLED).toBe('0');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cgo-only build failure (undefined symbol) gives the --allow-cgo hint and falls back to AST', async () => {
    const s = new GoCliStrategy();
    s.toolspecOverrides = {
      runner: mkRunner(specJson, 1, './x.go:42:12: undefined: handle.ErrUnsupported'),
      sandbox: 'sandbox-exec',
      cacheDir: CACHE,
    };
    const out = JSON.parse(await run(s, path.join(FIX, 'cobra'), { format: 'json', execBinary: true }));
    expect(out.source).toBe('ast');
    expect(out.warnings.join(' ')).toContain('build needs cgo; rerun with --allow-cgo');
    // with cgo already allowed the hint is not repeated
    s.toolspecOverrides = { ...s.toolspecOverrides, runner: mkRunner(specJson, 1, 'undefined: x') };
    const out2 = JSON.parse(await run(s, path.join(FIX, 'cobra'), { format: 'json', execBinary: true, allowCgo: true }));
    expect(out2.warnings.join(' ')).not.toContain('rerun with --allow-cgo');
  });

  it('XRAY_GO_CLI_EXEC=1 (user-level env) enables exec', async () => {
    process.env.XRAY_GO_CLI_EXEC = '1';
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: 'sandbox-exec', cacheDir: CACHE };
    const out = JSON.parse(await run(s, path.join(FIX, 'stdspec'), { format: 'json' }));
    expect(out.source).toBe('toolspec');
    expect(calls.length).toBe(2);
  });

  it('--binary runs only the supplied binary (no build)', async () => {
    const bin = path.join(os.tmpdir(), `gocli-bin-${process.pid}`);
    fs.writeFileSync(bin, '#!/bin/sh\n');
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: 'sandbox-exec', cacheDir: CACHE };
    const out = JSON.parse(await run(s, path.join(FIX, 'cobra'), { format: 'json', binary: bin }));
    fs.rmSync(bin);
    expect(out.source).toBe('toolspec');
    expect(calls).toHaveLength(1);
  });

  it('no sandbox tool: refuses and falls back to AST', async () => {
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: null, cacheDir: CACHE };
    const out = JSON.parse(await run(s, path.join(FIX, 'cobra'), { format: 'json', execBinary: true }));
    expect(calls).toEqual([]);
    expect(out.source).toBe('ast');
    expect(out.warnings.join(' ')).toMatch(/no OS sandbox.*unsafe-no-sandbox/);
  });

  it('--unsafe-no-sandbox allows unconfined exec with a warning', async () => {
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson), sandbox: null, cacheDir: CACHE };
    const out = JSON.parse(await run(s, path.join(FIX, 'stdspec'), { format: 'json', execBinary: true, unsafeNoSandbox: true }));
    expect(out.source).toBe('toolspec');
    expect(calls[0].cmd).toBe('go');
    expect(out.warnings.join(' ')).toContain('UNSANDBOXED');
  });

  it('build failure fails closed to the AST path', async () => {
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(specJson, 1), sandbox: 'sandbox-exec', cacheDir: CACHE };
    const out = JSON.parse(await run(s, path.join(FIX, 'cobra'), { format: 'json', execBinary: true }));
    expect(out.source).toBe('ast');
    expect(out.warnings.join(' ')).toContain('go build failed');
    expect(paths(out)).toContain('cobrademo deploy');
  });

  it.each([
    ['non-JSON stdout', 'hello'],
    ['JSON without commands', '{"code":"GENERIC"}'],
  ])('bad spec output (%s) falls back to AST', async (_n, stdout) => {
    const s = new GoCliStrategy();
    s.toolspecOverrides = { runner: mkRunner(stdout), sandbox: 'sandbox-exec', cacheDir: CACHE };
    const out = JSON.parse(await run(s, path.join(FIX, 'cobra'), { format: 'json', execBinary: true }));
    expect(out.source).toBe('ast');
    expect(out.warnings.join(' ')).toContain('falling back to AST');
  });
});
