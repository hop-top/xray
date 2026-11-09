/**
 * Every runnable leaf of the real command tree declares its side-effect
 * tier and idempotency (kit's `kit/side-effect`, `kit/idempotent`): the
 * built-ins, kit's own `help`/`completion`, every strategy-provided command
 * and every user alias. `describe` reads these, kit's gates act on them.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerStrategyCommands } from '../../src/commands/registration/strategies';
import { StrategyCacheManager } from '../../src/commands/registration/cache';
import { StrategyLoader } from '../../src/lib/strategy/loader';
import { buildDescribeDoc } from '../../src/commands/describe';
import { declaredEffect } from '../../src/commands/side-effect';
import { resolveDryRunPolicy } from '../../src/commands/kit-cli';

const TIERS = new Set([
  'read', 'write', 'write-local', 'write-shared',
  'destructive', 'destructive-local', 'destructive-shared', 'interactive',
]);
const IDEMPOTENCY = new Set(['yes', 'no', 'conditional']);

const leaves = (cmd: Command, trail: string[] = []): Array<{ path: string; cmd: Command }> =>
  cmd.commands.length === 0
    ? [{ path: trail.join(' '), cmd }]
    : cmd.commands.flatMap(c => leaves(c, [...trail, c.name()]));

const undeclared = (root: Command): string[] =>
  leaves(root)
    .filter(({ path: p, cmd }) => p !== '' && (() => {
      const d = declaredEffect(cmd);
      return !(d.tier && TIERS.has(d.tier) && d.idempotent && IDEMPOTENCY.has(d.idempotent));
    })())
    .map(l => l.path);

describe('side-effect declarations', () => {
  let tmp: string;
  let cwd: string;
  let tree: Command;
  const savedEnv = { ...process.env };

  beforeAll(() => {
    cwd = process.cwd();
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-tags-')));
    for (const d of ['cache', 'data', 'state', 'config', 'lang']) fs.mkdirSync(path.join(tmp, d));
    Object.assign(process.env, {
      XDG_CACHE_HOME: path.join(tmp, 'cache'),
      XDG_DATA_HOME: path.join(tmp, 'data'),
      XDG_STATE_HOME: path.join(tmp, 'state'),
      XDG_CONFIG_HOME: path.join(tmp, 'config'),
      XRAY_LANG_DIR: path.join(tmp, 'lang'),
    });
    const proj = path.join(tmp, 'proj');
    fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify({
      paths: ['.'],
      aliases: { comps: 'react components', routes: 'express routes' },
    }));
    process.chdir(proj);
  });

  beforeAll(async () => {
    const { registerCommands } = require('../../src/commands');
    tree = await registerCommands({}, undefined);
  });

  afterAll(() => {
    process.chdir(cwd);
    process.env = savedEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('the real tree has no untagged leaf: built-ins, kit builtins, strategy commands, aliases', async () => {
    const program = tree;
    const all = leaves(program).map(l => l.path);

    // The walk sees what it must: strategy commands and aliases are in it.
    expect(all).toEqual(expect.arrayContaining([
      'map', 'strategy remove', 'cache clear', 'mcp', 'help', 'completion bash',
      'react components', 'express routes', 'comps', 'routes',
    ]));
    expect(undeclared(program)).toEqual([]);
  });

  it('--dry-run on any leaf is previewed or ignored, never refused for a missing or opted-out declaration', () => {
    const program = tree;
    const policies = new Map(leaves(program).map(({ path: p, cmd }) => [
      p,
      resolveDryRunPolicy(cmd.name(), (cmd as unknown as { annotations?: Record<string, string> }).annotations ?? {}),
    ]));
    // `mcp` is a live session: kit refuses it in plain words. Nothing else is refused.
    const refused = [...policies].filter(([, v]) => v !== 'allow' && v !== 'noop').map(([k, v]) => `${k}: ${v}`);
    console.log(policies.size, policies.get('mcp'));
    expect(refused).toEqual(['mcp: reject-interactive']);
  });

  it('describe reports the declared tiers, never a default', async () => {
    const program = tree;
    const doc = buildDescribeDoc(program, 'xray', '0.0.0');
    const byName = new Map<string, { sideEffect: string; idempotent: string }>();
    const walk = (cs: typeof doc.commands) => cs.forEach(c => {
      if (c.subcommands.length === 0) byName.set(c.qualifiedName, c);
      walk(c.subcommands);
    });
    walk(doc.commands);
    for (const [qn, c] of byName) {
      const cmd = leaves(program).find(l => l.path === qn.replace(/\./g, ' '))!.cmd;
      expect({ qn, ...c }).toMatchObject({ qn, sideEffect: declaredEffect(cmd).tier, idempotent: declaredEffect(cmd).idempotent });
    }
  });

  it('strategy-provided commands are declared read', async () => {
    const strategy = {
      name: 'glossary',
      version: '0.1.0',
      detect: jest.fn().mockResolvedValue(true),
      commands: { terms: { description: 'List terms', handler: jest.fn() } },
    };
    jest.spyOn(StrategyLoader.prototype, 'discoverStrategies').mockResolvedValue([strategy as any]);
    jest.spyOn(StrategyLoader.prototype, 'discoverExtensions').mockResolvedValue([strategy as any]);
    jest.spyOn(StrategyCacheManager.prototype, 'getCached').mockResolvedValue(null);
    jest.spyOn(StrategyCacheManager.prototype, 'save').mockResolvedValue();
    const program = new Command();
    await registerStrategyCommands(program);
    expect(leaves(program).map(l => l.path)).toEqual(['glossary terms']);
    expect(declaredEffect(program.commands[0].commands[0])).toEqual({ tier: 'read', idempotent: 'yes' });
    jest.restoreAllMocks();
  });

  it('the walk fails on an untagged leaf', () => {
    const root = new Command('xray');
    root.command('tagged').action(() => {});
    root.command('naked').action(() => {});
    (root.commands[0] as any).annotations = { 'kit/side-effect': 'read', 'kit/idempotent': 'yes' };
    expect(undeclared(root)).toEqual(['naked']);
  });
});
