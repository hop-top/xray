// __tests__/commands/dynamic-registration.test.ts
import { Command } from 'commander';
import { registerCoreCommands } from '../../src/commands/registration/core';
import { StrategyCacheManager } from '../../src/commands/registration/cache';
import {
  registerExtensionCommands,
  registerStrategyCommands,
} from '../../src/commands/registration/strategies';
import { StrategyLoader } from '../../src/lib/strategy/loader';

describe('Dynamic Command Registration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Core Commands', () => {
    let program: Command;

    beforeEach(() => {
      program = new Command();
      registerCoreCommands(program);
    });

    it('should register core static commands', () => {
      const coreCommands = ['map', 'graph', 'query', 'cache', 'completion'];

      for (const cmdName of coreCommands) {
        const cmd = program.commands.find(c => c.name() === cmdName);
        expect(cmd).toBeDefined();
      }
    });

    it('should expose `cache clear` subcommand', () => {
      const cacheCmd = program.commands.find(c => c.name() === 'cache');
      expect(cacheCmd).toBeDefined();
      const clearSub = cacheCmd?.commands.find(c => c.name() === 'clear');
      expect(clearSub).toBeDefined();
    });

    it('should keep `clear-cache` as a hidden alias', () => {
      const aliasCmd = program.commands.find(c => c.name() === 'clear-cache');
      expect(aliasCmd).toBeDefined();
      // Commander stores hidden flag on _hidden
      expect((aliasCmd as unknown as { _hidden?: boolean })._hidden).toBe(true);
    });

    it('should register strategy and alias management commands', () => {
      const managementCommands = ['strategy', 'alias'];

      for (const cmdName of managementCommands) {
        const cmd = program.commands.find(c => c.name() === cmdName);
        expect(cmd).toBeDefined();
      }
    });

    it('registers upgrade as a check only: no install action', () => {
      // The package manager is the canonical upgrade path; `upgrade` only reports.
      const upgrade = program.commands.find(c => c.name() === 'upgrade');
      expect(upgrade).toBeDefined();
      expect(upgrade!.commands).toHaveLength(0);
      expect(upgrade!.options.map(o => o.long)).toEqual(['--check', '--format']);
    });

    it('should have analysis commands with descriptions', () => {
      const mapCmd = program.commands.find(c => c.name() === 'map');
      expect(mapCmd?.description()).toBe('Generate visual map of codebase');

      expect(program.commands.find(c => c.name() === 'scan')).toBeUndefined();

      const graphCmd = program.commands.find(c => c.name() === 'graph');
      expect(graphCmd?.description()).toBe('Generate control flow (CFG) and data flow (DFG) graphs');
    });
  });

  describe('Strategy Command Registration', () => {
    it('should not throw when registering strategies', async () => {
      const program = new Command();
      await expect(registerStrategyCommands(program)).resolves.not.toThrow();
    });

    it('should gracefully handle strategy discovery failures', async () => {
      const program = new Command();

      // Even if strategy discovery fails, should not throw
      await registerStrategyCommands(program);

      // Core commands should still be registerable
      registerCoreCommands(program);
      expect(program.commands.length).toBeGreaterThan(0);
    });

    it('registers object-form extension command options', async () => {
      const strategy = {
        name: 'glossary',
        version: '0.1.0',
        detect: jest.fn().mockResolvedValue(true),
        analyze: jest.fn().mockResolvedValue({ tags: [] }),
        commands: {
          scan: {
            description: 'Scan glossary terms',
            options: {
              focus: {
                description: 'Limit scan to one term',
                placeholder: '<term>',
              },
              'dry-run': {
                description: 'Preview without writing files',
                alias: 'd',
                type: 'boolean',
              },
            },
            handler: jest.fn(),
          },
        },
      };

      jest
        .spyOn(StrategyLoader.prototype, 'discoverStrategies')
        .mockResolvedValue([strategy as any]);
      jest
        .spyOn(StrategyCacheManager.prototype, 'getCached')
        .mockResolvedValue(null);
      jest
        .spyOn(StrategyCacheManager.prototype, 'save')
        .mockResolvedValue();

      const program = new Command();
      await registerStrategyCommands(program);

      const glossaryCmd = program.commands.find(c => c.name() === 'glossary');
      const scanCmd = glossaryCmd?.commands.find(c => c.name() === 'scan');

      expect(scanCmd).toBeDefined();
      expect(scanCmd?.options.map(option => option.flags)).toEqual(
        expect.arrayContaining([
          '-p, --path <path>',
          '--enable-extension <name>',
          '--extension-threshold <name=value>',
          '--enable-surface <name:surface>',
          '--focus <term>',
          '-d, --dry-run',
        ])
      );
    });

    it('registers repeatable and number options correctly (regression PR #18)', async () => {
      const strategy = {
        name: 'glossary',
        version: '0.1.0',
        detect: jest.fn().mockResolvedValue(true),
        commands: {
          scan: {
            description: 'Scan glossary terms',
            options: {
              tags: {
                description: 'Filter by tags',
                repeatable: true,
              },
              limit: {
                description: 'Limit results',
                type: 'number',
              },
              scores: {
                description: 'Filter by scores',
                type: 'number',
                repeatable: true,
              },
            },
            handler: jest.fn(),
          },
        },
      };

      jest
        .spyOn(StrategyLoader.prototype, 'discoverStrategies')
        .mockResolvedValue([strategy as any]);
      jest
        .spyOn(StrategyCacheManager.prototype, 'getCached')
        .mockResolvedValue(null);
      jest
        .spyOn(StrategyCacheManager.prototype, 'save')
        .mockResolvedValue();

      const program = new Command();
      await registerStrategyCommands(program);

      const glossaryCmd = program.commands.find(c => c.name() === 'glossary');
      const scanCmd = glossaryCmd?.commands.find(c => c.name() === 'scan');

      expect(scanCmd).toBeDefined();

      // Find individual options and verify their processing functions
      const tagsOpt = scanCmd?.options.find(o => o.long === '--tags') as any;
      const limitOpt = scanCmd?.options.find(o => o.long === '--limit') as any;
      const scoresOpt = scanCmd?.options.find(o => o.long === '--scores') as any;

      expect(tagsOpt).toBeDefined();
      expect(limitOpt).toBeDefined();
      expect(scoresOpt).toBeDefined();

      // Test repeatable tag processing
      if (tagsOpt?.fn) {
        expect(tagsOpt.fn('a', [])).toEqual(['a']);
        expect(tagsOpt.fn('b', ['a'])).toEqual(['a', 'b']);
      }

      // Test number processing
      if (limitOpt?.fn) {
        expect(limitOpt.fn('42', undefined)).toBe(42);
      }

      // Test repeatable number processing
      if (scoresOpt?.fn) {
        expect(scoresOpt.fn('0.5', [])).toEqual([0.5]);
        expect(scoresOpt.fn('0.8', [0.5])).toEqual([0.5, 0.8]);
      }

      // Non-numeric input rejected with UsageError (exit 2), not silent NaN.
      const { UsageError } = require('../../src/lib/error/types');
      if (limitOpt?.fn) {
        expect(() => limitOpt.fn('foo', undefined)).toThrow(UsageError);
      }
      if (scoresOpt?.fn) {
        expect(() => scoresOpt.fn('not-a-number', [])).toThrow(UsageError);
      }
    });

    it('registers command-only extensions discovered outside the strategy list', async () => {
      const extension = {
        id: 'glossary',
        name: 'glossary',
        version: '0.1.0',
        surface: 'glossary',
        detect: jest.fn().mockResolvedValue(true),
        commands: {
          scan: {
            description: 'Scan glossary terms',
            handler: jest.fn(),
          },
        },
      };

      jest
        .spyOn(StrategyLoader.prototype, 'discoverStrategies')
        .mockResolvedValue([]);
      jest
        .spyOn(StrategyLoader.prototype, 'discoverExtensions')
        .mockResolvedValue([extension as any]);
      jest
        .spyOn(StrategyCacheManager.prototype, 'getCached')
        .mockResolvedValue(null);
      jest
        .spyOn(StrategyCacheManager.prototype, 'save')
        .mockResolvedValue();

      const program = new Command();
      await registerExtensionCommands(program);

      const glossaryCmd = program.commands.find(c => c.name() === 'glossary');
      const scanCmd = glossaryCmd?.commands.find(c => c.name() === 'scan');

      expect(glossaryCmd).toBeDefined();
      expect(scanCmd).toBeDefined();
    });
  });

  describe('Integration', () => {
    it('should export registerCommands function', () => {
      const { registerCommands } = require('../../src/commands/index');
      expect(registerCommands).toBeDefined();
      expect(typeof registerCommands).toBe('function');
    });

    it('should export program object', () => {
      const { program } = require('../../src/commands/index');
      expect(program).toBeDefined();
      expect(program.constructor.name).toBe('Command');
    });
  });

  describe('Strategy command output (kit dispatch)', () => {
    const rows = [
      { name: 'getUsers', file: 'src/a.ts', line: 3, meta: { verb: 'GET' } },
      { name: 'addUser', file: 'src/b.ts' },
    ];

    async function setup(options?: Record<string, unknown>, result: unknown = rows) {
      const handler = jest.fn().mockResolvedValue(result);
      const strategy = {
        name: 'glossary',
        version: '0.1.0',
        detect: jest.fn().mockResolvedValue(true),
        commands: { scan: { description: 'Scan', options, handler } },
      };
      jest.spyOn(StrategyLoader.prototype, 'discoverStrategies').mockResolvedValue([strategy as any]);
      jest.spyOn(StrategyCacheManager.prototype, 'getCached').mockResolvedValue(null);
      jest.spyOn(StrategyCacheManager.prototype, 'save').mockResolvedValue();
      jest.spyOn(console, 'error').mockImplementation();
      const program = new Command();
      program.exitOverride();
      await registerStrategyCommands(program);
      const run = (...args: string[]) =>
        program.parseAsync(['node', 'test', 'glossary', 'scan', '-p', process.cwd(), ...args]);
      return { program, handler, run };
    }

    let writeSpy: jest.SpyInstance;
    const captured = () => writeSpy.mock.calls.map(c => String(c[0])).join('');
    beforeEach(() => {
      writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    it('keeps the titled text view by default', async () => {
      const { run } = await setup();
      await run();
      expect(captured()).toBe(
        '\nGlossary scan:\n\n  getUsers\n    → src/a.ts:3\n  addUser\n    → src/b.ts\n\nTotal: 2\n\n'
      );
    });

    it('emits records as json; handler sees only an explicit --format', async () => {
      const { run, handler } = await setup();
      await run('--format', 'json');
      expect(JSON.parse(captured())).toEqual(rows);
      const handlerOpts = handler.mock.calls[0][1];
      expect(handlerOpts.format).toBe('json');
      expect(handlerOpts).not.toHaveProperty('cols');
      expect(handlerOpts).not.toHaveProperty('output');
      expect(handlerOpts).not.toHaveProperty('formatOpt');

      await run();
      expect(handler.mock.calls[1][1]).not.toHaveProperty('format');
    });

    it('dot prints a pre-rendered graph document, rejects anything else', async () => {
      const { run } = await setup(undefined, { format: 'dot', content: 'digraph g {\n}' });
      await run('--format', 'dot');
      expect(captured()).toBe('digraph g {\n}\n');

      const other = await setup();
      await expect(other.run('--format', 'dot')).rejects.toMatchObject({ exitCode: 2 });
    });

    it('renders csv with --cols, nested cells as JSON, missing cells empty', async () => {
      const { run } = await setup();
      await run('--format', 'csv', '--cols', 'name,line,meta');
      expect(captured()).toBe('name,line,meta\ngetUsers,3,"{""verb"":""GET""}"\naddUser,,\n');
    });

    it('keeps a csv column absent from the first row', async () => {
      const { run } = await setup(undefined, [...rows].reverse());
      await run('--format', 'csv', '--cols', 'name,line');
      expect(captured()).toBe('name,line\naddUser,\ngetUsers,3\n');
    });

    it('rejects an unknown format before running the handler', async () => {
      const { run, handler } = await setup();
      await expect(run('--format', 'xml')).rejects.toMatchObject({ exitCode: 2 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('leaves commands that declare their own --format untouched', async () => {
      const { program } = await setup({ format: { description: 'own format' } });
      const scan = program.commands.find(c => c.name() === 'glossary')!.commands[0];
      expect(scan.options.filter(o => o.long === '--format')).toHaveLength(1);
      expect(scan.options.find(o => o.long === '--cols')).toBeUndefined();
    });
  });
});
