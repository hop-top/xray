import { Command } from 'commander';
import { registerAliasCommand } from '../../src/commands/alias';
import { registerCoreCommands } from '../../src/commands/registration/core';
import { loadConfig, saveConfig } from '../../src/lib/config';
import { NotFoundError, UsageError } from '../../src/lib/error/types';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../src/lib/config');

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>;

/** Stub strategy commands, so alias targets resolve like in the real tree. */
const withStrategies = (root: Command): Command => {
  for (const [strategy, commands] of [['react', ['components', 'hooks']], ['vue', ['components']]] as const) {
    const s = root.command(strategy);
    for (const c of commands) s.command(c);
  }
  return root;
};

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

      const program = withStrategies(registerAliasCommand());
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

      const program = withStrategies(registerAliasCommand());
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

    // Full root tree: reserved names derive from registered commands.
    const rootWithCore = () => {
      const root = new Command('xray');
      root.exitOverride();
      registerCoreCommands(root);
      withStrategies(root);
      return root;
    };

    it.each(['map', 'cache', 'paths', 'describe', 'mcp', 'completion', 'clear-cache', 'help'])(
      'rejects alias named after existing command "%s" (ConflictError, exit 4)',
      async (name) => {
        mockLoadConfig.mockReturnValue({ paths: ['./src'] });
        await expect(
          rootWithCore().parseAsync(['node', 'test', 'alias', 'set', name, 'react components'])
        ).rejects.toMatchObject({ exitCode: 4, code: 'CONFLICT' });
        expect(mockSaveConfig).not.toHaveBeenCalled();
      }
    );

    it('hints accurately after set', async () => {
      mockLoadConfig.mockReturnValue({ paths: ['./src'] });
      const err = jest.spyOn(console, 'error').mockImplementation();
      await rootWithCore().parseAsync(['node', 'test', 'alias', 'set', 'comp', 'react components']);
      const out = err.mock.calls.map(c => String(c[0])).join('\n');
      expect(out).not.toContain('Restart');
      expect(out).toContain('next xray run');
      err.mockRestore();
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

describe('alias set target and paths', () => {
  const unknown = (target: string) => withStrategies(registerAliasCommand()).exitOverride();

  it.each([
    ['nosuch thing', /Unknown strategy "nosuch"/],
    ['react nosuchcmd', /Unknown command "nosuchcmd" in strategy "react"/],
  ])('refuses unknown target %s (NotFoundError, exit 3)', async (target, msg) => {
    mockLoadConfig.mockReturnValue({ paths: ['./src'] });
    await expect(
      unknown(target).parseAsync(['node', 'test', 'set', 'zz', target])
    ).rejects.toMatchObject({ exitCode: 3, message: expect.stringMatching(msg) });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('new config gets a project-relative path, not the absolute cwd', async () => {
    mockLoadConfig.mockReturnValue(undefined as any);
    const err = jest.spyOn(console, 'error').mockImplementation();
    await withStrategies(registerAliasCommand()).parseAsync(['node', 'test', 'set', 'comp', 'react components']);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      { paths: ['.'], aliases: { comp: 'react components' } }
    );
    err.mockRestore();
  });
});
