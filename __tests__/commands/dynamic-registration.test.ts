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
      const coreCommands = ['map', 'scan', 'graph', 'query', 'clear-cache', 'completion'];

      for (const cmdName of coreCommands) {
        const cmd = program.commands.find(c => c.name() === cmdName);
        expect(cmd).toBeDefined();
      }
    });

    it('should register strategy and alias management commands', () => {
      const managementCommands = ['strategy', 'alias'];

      for (const cmdName of managementCommands) {
        const cmd = program.commands.find(c => c.name() === cmdName);
        expect(cmd).toBeDefined();
      }
    });

    it('should NOT register an upgrade subcommand', () => {
      // Self-update dropped: package manager is the canonical upgrade path.
      expect(program.commands.find(c => c.name() === 'upgrade')).toBeUndefined();
    });

    it('should have analysis commands with descriptions', () => {
      const mapCmd = program.commands.find(c => c.name() === 'map');
      expect(mapCmd?.description()).toBe('Generate visual map of codebase');

      const scanCmd = program.commands.find(c => c.name() === 'scan');
      expect(scanCmd?.description()).toBe('Scan and discover files in codebase');

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
});
