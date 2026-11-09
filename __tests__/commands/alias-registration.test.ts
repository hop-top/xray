import { Command } from 'commander';
import { registerAliases } from '../../src/commands/registration/aliases';
import { loadConfig } from '../../src/lib/config';
import { StrategyLoader } from '../../src/lib/strategy/loader';
import { Logger } from '../../src/lib/logger';

jest.mock('../../src/lib/config');

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;

describe('registerAliases (dispatch)', () => {
  let handler: jest.Mock;
  let outSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = jest.fn().mockResolvedValue([{ name: 'Button', file: 'Button.tsx' }]);
    jest.spyOn(StrategyLoader.prototype, 'discoverStrategies').mockResolvedValue([
      {
        name: 'react',
        commands: {
          components: { description: 'list components', handler },
        },
      } as any,
    ]);
    outSpy = jest.spyOn(Logger, 'output').mockImplementation();
    warnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const build = async () => {
    const program = new Command();
    program.exitOverride();
    program.command('map'); // real command: reserved name
    // Stand-in for the registered strategy command the alias dispatches to.
    program
      .command('react')
      .command('components')
      .option('-p, --path <path>', 'Project path', process.cwd())
      .action(async (opts: { path: string }) => {
        const result = await handler({ root: opts.path }, opts);
        Logger.output(`react components: ${result.map((r: any) => r.name).join(',')}`);
      });
    await registerAliases(program);
    return program;
  };

  const aliasNames = (program: Command) =>
    program.commands.map(c => c.name()).filter(n => n !== 'react' && n !== 'map');

  it('skips alias named like an existing command (config already holds it) with a warning', async () => {
    mockLoadConfig.mockReturnValue({
      paths: ['.'],
      aliases: { cache: 'react components', comp: 'react components' },
    });
    const program = new Command();
    program.exitOverride();
    program.command('cache');
    program.command('react').command('components').action(() => undefined);
    await expect(registerAliases(program)).resolves.toBeUndefined();
    expect(program.commands.filter(c => c.name() === 'cache')).toHaveLength(1);
    expect(program.commands.map(c => c.name())).toContain('comp');
    expect(warnSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain('Alias "cache" conflicts');
  });

  it('registers nothing when no aliases configured', async () => {
    mockLoadConfig.mockReturnValue({ paths: ['.'] });
    const program = await build();
    expect(aliasNames(program)).toHaveLength(0);
  });

  it('registers visible command described as alias target', async () => {
    mockLoadConfig.mockReturnValue({ aliases: { comp: 'react components' } });
    const program = await build();
    const cmd = program.commands.find(c => c.name() === 'comp');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toBe('Alias for: react components');
    expect((cmd as any)._hidden).toBeFalsy();
  });

  it('dispatches through the registered target command', async () => {
    mockLoadConfig.mockReturnValue({ aliases: { comp: 'react components' } });
    const program = await build();
    await program.parseAsync(['node', 'xray', 'comp', '-p', '/tmp']);

    expect(handler).toHaveBeenCalledTimes(1);
    const [ctx, opts] = handler.mock.calls[0];
    expect(ctx.root).toBe('/tmp');
    expect(opts.path).toBe('/tmp');
    const out = outSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('react components: Button');
  });

  // Pins current behavior: allowUnknownOption alone does not pass unknown
  // flags through under commander 14 (excess-arguments check rejects them).
  it('rejects unknown options as excess arguments', async () => {
    mockLoadConfig.mockReturnValue({ aliases: { comp: 'react components' } });
    const program = await build();
    program.commands.forEach(c => c.exitOverride());
    await expect(
      program.parseAsync(['node', 'xray', 'comp', '--whatever'])
    ).rejects.toMatchObject({ code: 'commander.excessArguments' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips aliases whose target strategy/command is unknown, with warning', async () => {
    mockLoadConfig.mockReturnValue({
      aliases: { comp: 'react components', bad: 'vue widgets' },
    });
    const program = await build();
    expect(aliasNames(program)).toEqual(['comp']);
    const warned = warnSpy.mock.calls.map(c => c[0]).join('\n');
    expect(warned).toContain('unknown strategy "vue"');
  });

  it('skips built-in names and malformed targets', async () => {
    mockLoadConfig.mockReturnValue({
      aliases: { map: 'react components', one: 'single', comp: 'react components' },
    });
    const program = await build();
    expect(aliasNames(program)).toEqual(['comp']);
  });

  it('registers no aliases when a cycle is detected', async () => {
    mockLoadConfig.mockReturnValue({
      aliases: { comp: 'react components', a: 'b components', b: 'a components' },
    });
    const program = await build();
    expect(aliasNames(program)).toHaveLength(0);
    const warned = warnSpy.mock.calls.map(c => c[0]).join('\n');
    expect(warned).toContain('Circular alias references detected');
  });
});
