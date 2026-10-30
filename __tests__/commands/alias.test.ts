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

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No aliases configured.'));
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
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const program = registerAliasCommand();
      await program.parseAsync(['node', 'test', 'list']);

      const output = writeSpy.mock.calls.map(call => String(call[0])).join('');
      expect(output).toContain('comp');
      expect(output).toContain('react components');
      expect(output).toContain('routes');
      expect(output).toContain('express routes');
      expect(output).toContain('Total: 2');
      writeSpy.mockRestore();
    });

    it('should emit alias records as json / csv', async () => {
      mockLoadConfig.mockReturnValue({
        paths: ['./src'],
        aliases: { comp: 'react components' }
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const out = () => writeSpy.mock.calls.map(call => String(call[0])).join('');

      await registerAliasCommand().parseAsync(['node', 'test', 'list', '--format', 'json']);
      expect(JSON.parse(out())).toEqual([{ alias: 'comp', target: 'react components' }]);

      writeSpy.mockClear();
      await registerAliasCommand().parseAsync(['node', 'test', 'list', '--format', 'csv']);
      expect(out()).toBe('alias,target\ncomp,react components\n');
      writeSpy.mockRestore();
    });

    it('should emit an empty json array when no aliases configured', async () => {
      mockLoadConfig.mockReturnValue(null as any);
      const errSpy = jest.spyOn(console, 'error').mockImplementation();
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await registerAliasCommand().parseAsync(['node', 'test', 'list', '--format', 'json']);
      expect(writeSpy.mock.calls.map(call => String(call[0])).join('')).toBe('[]\n');
      writeSpy.mockRestore();
      errSpy.mockRestore();
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

    it('should reject alias name containing whitespace (UsageError, exit 2)', async () => {
      mockLoadConfig.mockReturnValue({ paths: ['./src'] });

      const program = registerAliasCommand();
      program.exitOverride();
      await expect(
        program.parseAsync(['node', 'test', 'set', 'my comp', 'react components'])
      ).rejects.toMatchObject({ exitCode: 2, code: 'USAGE' });

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
