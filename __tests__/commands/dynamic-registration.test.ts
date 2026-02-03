// __tests__/commands/dynamic-registration.test.ts
import { Command } from 'commander';
import { registerCoreCommands } from '../../src/commands/registration/core';
import { registerStrategyCommands } from '../../src/commands/registration/strategies';

describe('Dynamic Command Registration', () => {
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
