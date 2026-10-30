/**
 * MCP tool shaping: selection of read-only leaves, schema derived from
 * the commander tree (positionals, repeatable options, denied flags,
 * root), argv building and root containment.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildArgv, DENIED_FLAGS, findCommand, isExposedPath, shapeLeaf, ToolArgumentError,
} from '../../src/lib/mcp/tools';
import { containPath, isWithin, resolveCallRoot } from '../../src/lib/mcp/runner';
import { setCommandGroup } from '../../src/commands/kit-cli';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const kit = require('@hop-top/kit/mcp') as typeof import('@hop-top/kit/dist/mcp');

const repeat = (v: string, p: string[]) => p.concat([v]);

function tree(): Command {
  const root = new Command('xray');
  root.command('explore')
    .argument('[query]', 'Search query')
    .option('-p, --path <path>', 'Root directory (repeatable)', repeat, [])
    .option('--stats', 'Show statistics')
    .option('-o, --output <path>', 'Output file')
    .action(() => undefined);
  root.command('map').option('-o, --output <path>', 'Output file').option('--no-chunk', 'Single file');
  const strategy = root.command('strategy');
  setCommandGroup(strategy, 'strategy');
  strategy.command('list');
  strategy.command('remove').argument('<name>');
  const cache = root.command('cache');
  cache.command('clear');
  const react = root.command('react');
  setCommandGroup(react, 'strategy');
  react.command('hooks').option('--exec-binary', 'run code');
  root.command('alias').command('set');
  return root;
}

function kitLeaf(root: Command, p: string[]) {
  const bridge = kit.commanderBridge(root, { run: () => ({ stdout: '', exitCode: 0 }) });
  const leaf = bridge.leaves().find((l) => l.path.join(' ') === p.join(' '));
  if (!leaf) throw new Error(`no leaf ${p.join(' ')}`);
  return leaf;
}

describe('isExposedPath', () => {
  const root = tree();
  it.each([['explore'], ['map'], ['strategy list'], ['react hooks']])('exposes %s', (p) => {
    expect(isExposedPath(root, p.split(' '))).toBe(true);
  });
  it.each([['cache clear'], ['alias set'], ['strategy remove']])('hides %s', (p) => {
    expect(isExposedPath(root, p.split(' '))).toBe(false);
  });
});

describe('shapeLeaf', () => {
  const root = tree();

  it('adds positionals, widens repeatable options, adds root, drops denied flags', () => {
    const cmd = findCommand(root, ['explore'])!;
    const { leaf, def } = shapeLeaf(kitLeaf(root, ['explore']), cmd);
    expect(leaf.path).toEqual(['explore']);
    expect(leaf.properties.query).toEqual({ type: 'string', description: 'Search query' });
    expect(leaf.properties.path).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(leaf.properties.stats.type).toBe('boolean');
    expect(leaf.properties.root.type).toBe('string');
    expect(leaf.properties.output).toBeUndefined();
    expect(def).toEqual({ name: 'explore', path: ['explore'], positionals: ['query'], fileOutput: false });
  });

  it('names nested tools with _ and marks required positionals', () => {
    const cmd = findCommand(root, ['strategy', 'remove'])!;
    const { leaf } = shapeLeaf(kitLeaf(root, ['strategy', 'remove']), cmd);
    expect(leaf.path).toEqual(['strategy_remove']);
    expect(leaf.required).toEqual(['name']);
  });

  it('drops code-running strategy flags and flags file-output tools', () => {
    const hooks = shapeLeaf(kitLeaf(root, ['react', 'hooks']), findCommand(root, ['react', 'hooks'])!);
    expect(hooks.leaf.properties['exec-binary']).toBeUndefined();
    const map = shapeLeaf(kitLeaf(root, ['map']), findCommand(root, ['map'])!);
    expect(map.def.fileOutput).toBe(true);
    expect(map.leaf.properties['no-chunk'].type).toBe('boolean');
  });

  it('denies writers and code loaders', () => {
    for (const f of ['output', 'share', 'template', 'preset', 'exec-binary', 'unsafe-no-sandbox']) {
      expect(DENIED_FLAGS.has(f)).toBe(true);
    }
  });
});

describe('buildArgv', () => {
  const root = tree();
  const cmd = findCommand(root, ['explore'])!;
  const def = shapeLeaf(kitLeaf(root, ['explore']), cmd).def;
  const id = (v: string) => `<${v}>`;

  it('maps options, booleans, arrays and positionals after --', () => {
    expect(buildArgv(def, cmd, { query: '-x', stats: true, path: ['a', 'b'], root: '/r' }, id)).toEqual([
      'explore', '--stats', '--path=<a>', '--path=<b>', '--', '-x',
    ]);
  });

  it('omits false booleans and absent positionals', () => {
    expect(buildArgv(def, cmd, { stats: false }, id)).toEqual(['explore']);
  });

  it.each([
    [{ bogus: 1 }, /unknown argument "bogus"/],
    [{ output: 'x' }, /unknown argument "output"/],
    [{ stats: 'yes' }, /must be a boolean/],
    [{ query: { a: 1 } }, /must be a string/],
  ])('rejects %j', (args, msg) => {
    expect(() => buildArgv(def, cmd, args as Record<string, unknown>, id)).toThrow(ToolArgumentError);
    expect(() => buildArgv(def, cmd, args as Record<string, unknown>, id)).toThrow(msg);
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
