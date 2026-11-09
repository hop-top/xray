/**
 * MCP tool shaping: selection of read-only leaves, schema derived from
 * the commander tree (positionals, repeatable options, per-tool option
 * allowlist, root), argv building, path containment and the
 * server-root config rule.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildArgv, findCommand, isExposedPath, isUrlLike, policyFor, shapeLeaf, ToolArgumentError,
  type PathScope,
} from '../../src/lib/mcp/tools';
import {
  assertConfigPinned, containPath, isWithin, pinnedConfigArgs, resolveCallRoot, resolveServerConfig,
} from '../../src/lib/mcp/runner';
import { setCommandGroup } from '../../src/commands/kit-cli';
import { declareEffect } from '../../src/commands/side-effect';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const kit = require('@hop-top/kit/mcp') as typeof import('@hop-top/kit/dist/mcp');

const repeat = (v: string, p: string[]) => p.concat([v]);

function tree(): Command {
  const root = new Command('xray');
  root.command('explore')
    .option('-p, --path <path>', 'Root directory (repeatable)', repeat, [])
    .option('--stats', 'Show statistics')
    .option('-o, --output <path>', 'Output file')
    .action(() => undefined);
  root.command('map')
    .option('-p, --path <path>', 'Root directory (repeatable)', repeat, [])
    .option('-o, --output <path>', 'Output file')
    .option('-a, --anchor <path>', 'Focus file')
    .option('-q, --query <item>', 'Override query (repeatable)', repeat, [])
    .option('--share [path]', 'Share summary')
    .option('--detect', 'Detect')
    .option('--skip-detect', 'Skip detect')
    .option('--no-chunk', 'Single file');
  const strategy = root.command('strategy');
  setCommandGroup(strategy, 'strategy');
  strategy.command('list');
  strategy.command('remove').argument('<name>');
  const cache = root.command('cache');
  cache.command('clear');
  const react = root.command('react');
  setCommandGroup(react, 'strategy');
  declareEffect(react.command('hooks').option('-p, --path <path>', 'Project path').option('--exec-binary', 'run code'), 'read', 'yes');
  const build = root.command('build');
  setCommandGroup(build, 'strategy');
  declareEffect(build.command('run').option('-p, --path <path>', 'Project path').option('--target <t>', 'Target'), 'read', 'yes');
  declareEffect(build.command('exec').argument('<target>', 'Target').option('-p, --path <path>', 'Project path'), 'destructive-local', 'no');
  build.command('undeclared').option('-p, --path <path>', 'Project path');
  const config = root.command('config-files');
  setCommandGroup(config, 'strategy');
  declareEffect(config.command('keys').option('-p, --path <path>', 'Project path').option('--file <file>', 'Config file'), 'read', 'yes');
  declareEffect(config.command('values').option('-p, --path <path>', 'Project path').option('--show-secrets', 'Secrets'), 'read', 'yes');
  root.command('impact')
    .description('Show transitive callers of a symbol, by area')
    .argument('<symbol>', 'Symbol name or glob')
    .option('--depth <n>', 'Caller levels')
    .option('--strict', 'EXTRACTED only')
    .option('--graph <file>', 'Saved graph')
    .option('-p, --path <path>', 'Root directory (repeatable)', repeat, [])
    .option('--lens <name>', 'Lens')
    .option('--scope <name>', 'Scope')
    .option('--lang <list>', 'Languages', repeat, [])
    .option('--format <fmt>', 'Format');
  root.command('imports')
    .argument('[paths...]', 'Files or directories inside the root')
    .option('-p, --path <root>', 'Root directory')
    .option('--lang <list>', 'Languages', repeat, [])
    .option('-o, --output <path>', 'Output file')
    .option('--no-ignore', 'List git-ignored files too')
    .option('--format <fmt>', 'Format');
  root.command('alias').command('set');
  return root;
}

function shaped(root: Command, p: string[]) {
  return shapeLeaf(kitLeaf(root, p), findCommand(root, p)!, policyFor(root, p)!);
}

function kitLeaf(root: Command, p: string[]) {
  const bridge = kit.commanderBridge(root, { run: () => ({ stdout: '', exitCode: 0 }) });
  const leaf = bridge.leaves().find((l) => l.path.join(' ') === p.join(' '));
  if (!leaf) throw new Error(`no leaf ${p.join(' ')}`);
  return leaf;
}

describe('isExposedPath', () => {
  const root = tree();
  it.each([['explore'], ['map'], ['impact'], ['strategy list'], ['react hooks']])('exposes %s', (p) => {
    expect(isExposedPath(root, p.split(' '))).toBe(true);
  });
  it.each([['cache clear'], ['alias set'], ['strategy remove']])('hides %s', (p) => {
    expect(isExposedPath(root, p.split(' '))).toBe(false);
  });
  it('exposes a strategy command declared read', () => {
    expect(isExposedPath(root, ['build', 'run'])).toBe(true);
  });
  it('hides a strategy command declared above read (build exec)', () => {
    expect(isExposedPath(root, ['build', 'exec'])).toBe(false);
    expect(policyFor(root, ['build', 'exec'])).toBeUndefined();
  });
  it('hides a strategy command that declares no tier', () => {
    expect(isExposedPath(root, ['build', 'undeclared'])).toBe(false);
  });
});

describe('shapeLeaf', () => {
  const root = tree();

  it('adds root, widens repeatable options, adds root, keeps only allowlisted options', () => {
    const { leaf, def } = shaped(root, ['explore']);
    expect(leaf.path).toEqual(['explore']);
    expect(leaf.properties.query).toBeUndefined();
    expect(leaf.properties.path).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(leaf.properties.stats.type).toBe('boolean');
    expect(leaf.properties.root.type).toBe('string');
    expect(leaf.properties.output).toBeUndefined();
    expect(def).toMatchObject({ name: 'explore', path: ['explore'], positionals: [], fileOutput: false });
  });

  it('names nested tools with _', () => {
    expect(shaped(root, ['config-files', 'keys']).leaf.path).toEqual(['config-files_keys']);
  });

  it('omits options not on the allowlist (writers, code runners, secrets)', () => {
    const hooks = shaped(root, ['react', 'hooks']);
    expect(hooks.leaf.properties['exec-binary']).toBeUndefined();
    expect(hooks.leaf.properties.path.type).toBe('string');
    expect(shaped(root, ['config-files', 'values']).leaf.properties['show-secrets']).toBeUndefined();
    const map = shaped(root, ['map']);
    expect(map.def.fileOutput).toBe(true);
    expect(map.leaf.properties['no-chunk'].type).toBe('boolean');
    expect(map.leaf.properties.query.type).toBe('array');
    expect(map.leaf.properties.output).toBeUndefined();
    expect(map.leaf.properties.share).toBeUndefined();
  });

  it('exposes impact: symbol positional, depth/strict/format/lens/scope, root; no graph or path', () => {
    const { leaf, def } = shaped(root, ['impact']);
    expect(Object.keys(leaf.properties).sort()).toEqual(['depth', 'format', 'lens', 'root', 'scope', 'strict', 'symbol']);
    expect(leaf.properties.symbol.type).toBe('string');
    expect(leaf.required).toEqual(['symbol']);
    expect(leaf.properties.strict.type).toBe('boolean');
    expect(leaf.properties.depth.type).toBe('string');
    expect(leaf.description).toMatch(/what breaks/i);
    expect(def).toMatchObject({ name: 'impact', path: ['impact'], positionals: ['symbol'], fileOutput: false });
    expect(def.policy).toMatchObject({ root: 'path', configFromPath: true, detectOnRoot: false });
  });

  it('exposes imports: paths positional (array), path/lang/format/no-ignore, root; no output', () => {
    const { leaf, def } = shaped(root, ['imports']);
    expect(Object.keys(leaf.properties).sort()).toEqual(['format', 'lang', 'no-ignore', 'path', 'paths', 'root']);
    expect(leaf.properties['no-ignore'].type).toBe('boolean');
    expect(leaf.properties.paths).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(leaf.properties.lang.type).toBe('array');
    expect(leaf.required).toBeUndefined();
    expect(leaf.description).toMatch(/xray\.imports\/v1/);
    expect(def).toMatchObject({ name: 'imports', positionals: ['paths'], fileOutput: false });
    expect(def.policy).toMatchObject({ root: 'path', configFromPath: false, positionals: { paths: 'path' } });
  });

  it('offers root only on tools with a project scope', () => {
    expect(shaped(root, ['strategy', 'list']).leaf.properties.root).toBeUndefined();
    expect(shaped(root, ['map']).leaf.properties.root.type).toBe('string');
  });
});

describe('buildArgv', () => {
  const root = tree();
  const cmd = findCommand(root, ['explore'])!;
  const def = shaped(root, ['explore']).def;
  const id: PathScope = { dir: '/srv', explicit: false, contain: (v) => `<${v}>` };
  const argv = (d = def, c = cmd, args: Record<string, unknown>, scope = id) => buildArgv(d, c, args, scope).argv;

  it('does not expose or forward a positional its policy does not list', () => {
    const r = tree();
    const m = findCommand(r, ['map'])!;
    m.argument('[paths...]', 'Roots');
    const d = shaped(r, ['map']);
    expect(d.leaf.properties.paths).toBeUndefined();
    expect(d.def.positionals).toEqual([]);
    expect(() => argv(d.def, m, { paths: ['/etc', '../..'] })).toThrow(/unknown argument "paths"/);
  });

  it('maps options, booleans, arrays and positionals after --', () => {
    expect(argv(def, cmd, { stats: true, path: ['a', 'b'] })).toEqual([
      'explore', '--path=<a>', '--path=<b>', '--stats',
    ]);
    const ic = findCommand(root, ['impact'])!;
    expect(argv(shaped(root, ['impact']).def, ic, { symbol: '-x' })).toEqual(['impact', '--', '-x']);
  });

  it('explore path is directory-only: a file is a tool error', () => {
    const scope: PathScope = { dir: '/srv', explicit: false, contain: (v) => `<${v}>`, isDirectory: (abs) => abs === '<d>' };
    expect(argv(def, cmd, { path: ['d'] }, scope)).toEqual(['explore', '--path=<d>']);
    expect(() => argv(def, cmd, { path: ['f.ts'] }, scope)).toThrow(/must be an existing directory/);
  });

  it('omits false booleans and absent positionals', () => {
    expect(argv(def, cmd, { stats: false })).toEqual(['explore']);
  });

  it.each([
    [{ bogus: 1 }, /unknown argument "bogus"/],
    [{ output: 'x' }, /unknown argument "output"/],
    [{ stats: 'yes' }, /must be a boolean/],
    [{ query: 'foo' }, /unknown argument "query"/],
    [{ path: ['http://169.254.169.254/latest'] }, /not a URL/],
  ])('rejects %j', (args, msg) => {
    expect(() => argv(def, cmd, args as Record<string, unknown>)).toThrow(ToolArgumentError);
    expect(() => argv(def, cmd, args as Record<string, unknown>)).toThrow(msg);
  });

  it('rejects options a command has but the allowlist does not', () => {
    const c = findCommand(root, ['react', 'hooks'])!;
    const d = shaped(root, ['react', 'hooks']).def;
    expect(() => argv(d, c, { 'exec-binary': true })).toThrow(/unknown argument "exec-binary"/);
    const v = findCommand(root, ['config-files', 'values'])!;
    expect(() => argv(shaped(root, ['config-files', 'values']).def, v, { 'show-secrets': true })).toThrow(/unknown argument/);
    const m = findCommand(root, ['map'])!;
    expect(() => argv(shaped(root, ['map']).def, m, { share: 'x.md' })).toThrow(/unknown argument "share"/);
  });

  it('contains every map --query path, including .ext:path and comma lists', () => {
    const m = findCommand(root, ['map'])!;
    const d = shaped(root, ['map']).def;
    expect(argv(d, m, { query: ['q/ts.scm', '.go:q/go.scm,.rs:q/rs.scm'] })).toEqual([
      'map', '--query=<q/ts.scm>', '--query=.go:<q/go.scm>,.rs:<q/rs.scm>',
    ]);
    for (const q of ['https://evil.test/typescript.scm', '.ts:http://127.0.0.1/x.scm', 'a.scm,.ts:file:///etc/x.scm']) {
      expect(() => argv(d, m, { query: [q] })).toThrow(/not a URL/);
    }
  });

  it('passes an explicit root as --path, never as cwd, and keeps map auto-detect', () => {
    const scope: PathScope = { dir: '/srv/sub', explicit: true, contain: (v, base) => path.resolve(base, v) };
    const m = findCommand(root, ['map'])!;
    const d = shaped(root, ['map']).def;
    expect(buildArgv(d, m, { root: 'sub' }, scope)).toEqual({
      argv: ['map', '--path=/srv/sub', '--detect'], projectDirs: ['/srv/sub'],
    });
    expect(argv(d, m, { 'skip-detect': true }, scope)).toEqual(['map', '--path=/srv/sub', '--skip-detect']);
    expect(buildArgv(d, m, { path: ['x'], anchor: 'x/a.ts' }, scope)).toEqual({
      argv: ['map', '--path=/srv/sub/x', '--anchor=/srv/sub/x/a.ts'], projectDirs: ['/srv/sub/x'],
    });
    expect(argv(def, cmd, { stats: true }, scope)).toEqual(['explore', '--path=/srv/sub', '--stats']);
    const h = findCommand(root, ['react', 'hooks'])!;
    expect(argv(shaped(root, ['react', 'hooks']).def, h, {}, scope)).toEqual(['react', 'hooks', '--path=/srv/sub']);
  });

  it('builds impact argv; root becomes --path (no --detect); graph and path are rejected', () => {
    const c = findCommand(root, ['impact'])!;
    const d = shaped(root, ['impact']).def;
    expect(argv(d, c, { symbol: 'Run*', depth: '2', strict: true, format: 'json' })).toEqual([
      'impact', '--depth=2', '--strict', '--format=json', '--', 'Run*',
    ]);
    const scope: PathScope = { dir: '/srv/sub', explicit: true, contain: (v, base) => path.resolve(base, v) };
    expect(buildArgv(d, c, { symbol: 'alpha', root: 'sub' }, scope)).toEqual({
      argv: ['impact', '--path=/srv/sub', '--', 'alpha'], projectDirs: ['/srv/sub'],
    });
    expect(() => argv(d, c, { symbol: 'x', graph: 'g.json' })).toThrow(/unknown argument "graph"/);
    expect(() => argv(d, c, { symbol: 'x', path: ['a'] })).toThrow(/unknown argument "path"/);
    expect(() => argv(d, c, { symbol: 'x', lang: ['go'] })).toThrow(/unknown argument "lang"/);
  });

  it('rejects root on tools without a project scope', () => {
    const c = findCommand(root, ['strategy', 'list'])!;
    expect(() => argv(shaped(root, ['strategy', 'list']).def, c, { root: 'sub' })).toThrow(/unknown argument "root"/);
  });

  it('passes config --file project-relative after containment', () => {
    const scope: PathScope = { dir: '/srv', explicit: false, contain: (v, base) => path.resolve(base, v) };
    const c = findCommand(root, ['config-files', 'keys'])!;
    const d = shaped(root, ['config-files', 'keys']).def;
    expect(argv(d, c, { file: 'cfg/app.json', path: 'pkg' }, scope)).toEqual([
      'config-files', 'keys', '--path=/srv/pkg', '--file=cfg/app.json',
    ]);
  });
});

describe('isUrlLike', () => {
  it.each(['http://x', 'https://x/y.scm', 'file:///etc/passwd', ' ftp://x', 'git+ssh://h/r'])('url: %s', (v) => {
    expect(isUrlLike(v)).toBe(true);
  });
  it.each(['a/b.scm', '/abs/x', 'C:\\x', './http://x', '.ts'])('not url: %s', (v) => {
    expect(isUrlLike(v)).toBe(false);
  });
});

describe('root containment', () => {
  let base: string;
  let serverRoot: string;
  let outside: string;

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-mcp-unit-')));
    serverRoot = path.join(base, 'proj');
    outside = path.join(base, 'other');
    fs.mkdirSync(path.join(serverRoot, 'sub'), { recursive: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(serverRoot, 'escape'));
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it('defaults to the server root and accepts subdirectories', () => {
    expect(resolveCallRoot(serverRoot, undefined)).toBe(serverRoot);
    expect(resolveCallRoot(serverRoot, 'sub')).toBe(path.join(serverRoot, 'sub'));
    expect(resolveCallRoot(serverRoot, path.join(serverRoot, 'sub'))).toBe(path.join(serverRoot, 'sub'));
  });

  it.each([['../other'], ['/'], ['escape']])('rejects %s', (r) => {
    expect(() => resolveCallRoot(serverRoot, r)).toThrow(/outside the server root/);
  });

  it('rejects missing roots and non-strings', () => {
    expect(() => resolveCallRoot(serverRoot, 'nope')).toThrow(/does not exist/);
    expect(() => resolveCallRoot(serverRoot, 3)).toThrow(/must be a string/);
  });

  it('contains map --query paths through the real resolver (outside, .ext:.., symlink)', () => {
    const r = tree();
    const m = findCommand(r, ['map'])!;
    const d = shaped(r, ['map']).def;
    const scope: PathScope = {
      dir: serverRoot, explicit: false, contain: (v, b, l) => containPath(serverRoot, b, v, l),
    };
    for (const q of [path.join(outside, 'typescript.scm'), '.ts:../other/x.scm', 'escape/typescript.scm', 'a.scm,.go:../../x.scm']) {
      expect(() => buildArgv(d, m, { query: [q] }, scope)).toThrow(/outside the server root/);
    }
    expect(buildArgv(d, m, { query: ['.ts:sub/q.scm'] }, scope).argv).toEqual([
      'map', `--query=.ts:${path.join(serverRoot, 'sub/q.scm')}`,
    ]);
  });

  it('contains imports positional paths (outside, absolute, symlink escape); value positionals pass through', () => {
    const r = tree();
    const c = findCommand(r, ['imports'])!;
    const d = shaped(r, ['imports']).def;
    const scope: PathScope = {
      dir: serverRoot, explicit: false, contain: (v, b, l) => containPath(serverRoot, b, v, l),
    };
    for (const p of ['../other', outside, '/', 'escape/x.py', 'sub/../../other']) {
      expect(() => buildArgv(d, c, { paths: ['sub', p] }, scope)).toThrow(/paths "[^"]*" is outside the server root/);
    }
    expect(() => buildArgv(d, c, { paths: ['https://example.com/x'] }, scope)).toThrow(/not a URL/);
    expect(buildArgv(d, c, { paths: ['sub', 'sub/x.py'], lang: ['go'] }, scope).argv).toEqual([
      'imports', '--lang=go', '--', path.join(serverRoot, 'sub'), path.join(serverRoot, 'sub/x.py'),
    ]);
    expect(buildArgv(d, c, { 'no-ignore': true }, scope).argv).toEqual(['imports', '--no-ignore']);
    expect(buildArgv(d, c, { 'no-ignore': false }, scope).argv).toEqual(['imports']);
    // impact's <symbol> is a value: never resolved as a path.
    const e = findCommand(r, ['impact'])!;
    expect(buildArgv(shaped(r, ['impact']).def, e, { symbol: '../other' }, scope).argv).toEqual(['impact', '--', '../other']);
  });

  it('contains config --file against the project path', () => {
    const r = tree();
    const c = findCommand(r, ['config-files', 'keys'])!;
    const scope: PathScope = {
      dir: serverRoot, explicit: false, contain: (v, b, l) => containPath(serverRoot, b, v, l),
    };
    expect(() => buildArgv(shaped(r, ['config-files', 'keys']).def, c, { file: '../other/x.json' }, scope)).toThrow(/outside/);
  });

  it('without a server config, refuses sub-roots with their own config; with one, accepts all', () => {
    fs.mkdirSync(path.join(serverRoot, 'plain'), { recursive: true });
    fs.mkdirSync(path.join(serverRoot, 'own'), { recursive: true });
    fs.writeFileSync(path.join(serverRoot, 'own', '.xrayrc.json'), '{}');
    expect(resolveServerConfig(serverRoot)).toBeNull();
    expect(() => assertConfigPinned(null, path.join(serverRoot, 'plain'))).not.toThrow();
    expect(() => assertConfigPinned(null, path.join(serverRoot, 'own'))).toThrow(/has its own xray config/);
    fs.writeFileSync(path.join(serverRoot, '.xrayrc.json'), '{}');
    const pinned = resolveServerConfig(serverRoot);
    expect(pinned).toBe(fs.realpathSync(path.join(serverRoot, '.xrayrc.json')));
    expect(() => assertConfigPinned(pinned, path.join(serverRoot, 'plain'))).not.toThrow();
    expect(() => assertConfigPinned(pinned, path.join(serverRoot, 'own'))).not.toThrow();
    fs.rmSync(path.join(serverRoot, '.xrayrc.json'));
  });

  it('refuses a JS server config without running it', () => {
    const marker = path.join(serverRoot, 'RAN');
    fs.writeFileSync(path.join(serverRoot, 'cfg.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`);
    expect(() => resolveServerConfig(serverRoot, 'cfg.js')).toThrow(/JavaScript.*\.xrayrc\.json/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('resolves an explicit server config against the server root; missing is a usage error', () => {
    fs.writeFileSync(path.join(serverRoot, 'pinned.json'), '{}');
    expect(resolveServerConfig(serverRoot, 'pinned.json')).toBe(fs.realpathSync(path.join(serverRoot, 'pinned.json')));
    expect(() => resolveServerConfig(serverRoot, 'nope.json')).toThrow(/not found/);
    fs.rmSync(path.join(serverRoot, 'pinned.json'));
  });

  it('pins -C and --config on children only when there is a server config', () => {
    expect(pinnedConfigArgs('/r', null)).toEqual([]);
    expect(pinnedConfigArgs('/r', '/r/.xrayrc.json')).toEqual(['-C', '/r', '--config', '/r/.xrayrc.json']);
  });

  it('contains path values, including not-yet-existing ones', () => {
    expect(containPath(serverRoot, serverRoot, 'sub/new.json', 'path')).toBe(path.join(serverRoot, 'sub/new.json'));
    expect(() => containPath(serverRoot, serverRoot, 'escape/x', 'path')).toThrow(/outside/);
    expect(isWithin('/a/b', '/a/bc')).toBe(false);
  });
});

describe('parseMcpRequest', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseMcpRequest } = require('../../src/commands/mcp') as typeof import('../../src/commands/mcp');
  const argv = (...a: string[]) => ['node', 'xray', ...a];

  it.each([
    [['mcp'], {}],
    [['--quiet', 'mcp', '--timeout', '5'], {}],
    [['--log-level', 'warn', 'mcp'], {}],
    [['-C', 'proj', 'mcp'], { chdir: 'proj', chdirIndex: 3 }],
    [['--chdir=proj', 'mcp'], { chdir: 'proj', chdirIndex: 2 }],
  ])('detects %j', (a, want) => {
    expect(parseMcpRequest(argv(...a))).toEqual(want);
  });

  it.each([[[]], [['explore', 'mcp']], [['-C', 'mcp', 'map']], [['--', 'mcp']], [['--config', 'mcp']]])(
    'ignores %j',
    (a) => {
      expect(parseMcpRequest(argv(...a))).toBeNull();
    }
  );
});
