import { registerAliasCommand } from '../../src/commands/alias';
import { loadConfig, saveConfig } from '../../src/lib/config';
import { ConflictError, NotFoundError, UsageError } from '../../src/lib/error/types';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../src/lib/config');

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>;

describe('Alias Commands', () => {
  const testDir = path.join(__dirname, '../fixtures/alias-test');
  const testConfigPath = path.join(testDir, '.xrayrc.json');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('alias list', () => {
    it('should show message when no aliases configured', async () => {
      mockLoadConfig.mockReturnValue({ paths: ['./src'] });
      const consoleLogSpy = jest.spyOn(console, 'error').mockImplementation();

      const program = registerAliasCommand();
      await program.parseAsync(['node', 'test', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith('No aliases configured.');
      consoleLogSpy.mockRestore();
    });

    it('should list all configured aliases', async () => {
      mockLoadConfig.mockReturnValue({
        paths: ['./src'],
        aliases: {
          comp: 'react components',
          routes: 'express routes'
        }
      });
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const program = registerAliasCommand();
      await program.parseAsync(['node', 'test', 'list']);

      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('comp');
      expect(output).toContain('react components');
      expect(output).toContain('routes');
      expect(output).toContain('express routes');
      expect(output).toContain('Total: 2');
      consoleLogSpy.mockRestore();
    });
  });

  describe('alias set', () => {
    it('should create new alias', async () => {
      mockLoadConfig.mockReturnValue({ paths: ['./src'] });
      const consoleLogSpy = jest.spyOn(console, 'error').mockImplementation();

      const program = registerAliasCommand();
      await program.parseAsync(['node', 'test', 'set', 'comp', 'react components']);

      expect(mockSaveConfig).toHaveBeenCalledWith({
        paths: ['./src'],
        aliases: {
          comp: 'react components'
        }
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created alias'));
      consoleLogSpy.mockRestore();
    });

    it('should update existing alias', async () => {
      mockLoadConfig.mockReturnValue({
        paths: ['./src'],
        aliases: {
          comp: 'react components'
        }
      });
      const consoleLogSpy = jest.spyOn(console, 'error').mockImplementation();

      const program = registerAliasCommand();
      await program.parseAsync(['node', 'test', 'set', 'comp', 'vue components']);

      expect(mockSaveConfig).toHaveBeenCalledWith({
        paths: ['./src'],
        aliases: {
          comp: 'vue components'
        }
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated alias'));
      consoleLogSpy.mockRestore();
    });

    it('should reject alias with invalid format (UsageError, exit 2)', async () => {
      mockLoadConfig.mockReturnValue({ paths: ['./src'] });

      const program = registerAliasCommand();
      program.exitOverride();
      await expect(
        program.parseAsync(['node', 'test', 'set', 'bad', 'invalidformat'])
      ).rejects.toMatchObject({ exitCode: 2, code: 'USAGE' });

      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('should reject alias that conflicts with built-in command (ConflictError, exit 5)', async () => {
      mockLoadConfig.mockReturnValue({ paths: ['./src'] });

      const program = registerAliasCommand();
      program.exitOverride();
      await expect(
        program.parseAsync(['node', 'test', 'set', 'map', 'react components'])
      ).rejects.toBeInstanceOf(ConflictError);

      expect(mockSaveConfig).not.toHaveBeenCalled();
    });
  });

  describe('alias remove', () => {
    it('should remove existing alias', async () => {
      mockLoadConfig.mockReturnValue({
        paths: ['./src'],
        aliases: {
          comp: 'react components',
          routes: 'express routes'
        }
      });
      const consoleLogSpy = jest.spyOn(console, 'error').mockImplementation();

      const program = registerAliasCommand();
      await program.parseAsync(['node', 'test', 'remove', 'comp']);

      expect(mockSaveConfig).toHaveBeenCalledWith({
        paths: ['./src'],
        aliases: {
          routes: 'express routes'
        }
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Removed alias'));
      consoleLogSpy.mockRestore();
    });

    it('should error when alias not found (NotFoundError, exit 3)', async () => {
      mockLoadConfig.mockReturnValue({ paths: ['./src'] });

      const program = registerAliasCommand();
      program.exitOverride();
      await expect(
        program.parseAsync(['node', 'test', 'remove', 'nonexistent'])
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockSaveConfig).not.toHaveBeenCalled();
    });
  });
});
