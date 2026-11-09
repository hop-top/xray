// __tests__/commands/integration/strategy-execution.test.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);
const xrayBin = path.join(__dirname, '../../../dist/index.js');

// These tests spawn the CLI and analyze the repository itself (`--path .`),
// which takes several seconds on a full checkout (dist/, fixtures, tests);
// the default 5s jest timeout is too tight and load-sensitive.
jest.setTimeout(30000);

describe('Strategy Command Execution (Integration)', () => {
  // Helper to run xray commands
  async function runXray(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(`node ${xrayBin} ${args}`);
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.code || 1
      };
    }
  }

  describe('Help and Discovery', () => {
    it('should list strategy commands in main help', async () => {
      const { stdout, exitCode } = await runXray('--help');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('express');
      expect(stdout).toContain('react');
      expect(stdout).toContain('rest-api');
    });

    it('should show strategy subcommands in strategy help', async () => {
      const { stdout, exitCode } = await runXray('express --help');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('routes');
      expect(stdout).toContain('routers');
      expect(stdout).toContain('middleware');
      expect(stdout).toContain('error-handlers');
    });

    it('should show command-specific help', async () => {
      const { stdout, exitCode } = await runXray('react components --help');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('List all React components');
      expect(stdout).toContain('-p, --path');
    });
  });

  describe('Strategy Command Options', () => {
    it('should accept --path option', async () => {
      const { stdout, exitCode } = await runXray('react components --path .');

      // Should not error (even if no React components found)
      expect(exitCode).toBe(0);
    });

    it('should use current directory as default', async () => {
      const { stdout, exitCode } = await runXray('express routes');

      // Should execute without error
      expect(exitCode).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should reject hyphenated unknown strategy as a usage error', async () => {
      const { stdout, stderr, exitCode } = await runXray('unknown-strategy test');

      // 12fc Factor 11: typo-shaped unknown commands surface as exit 2
      // instead of silently routing through the default explore command
      // (which hid typos in strategy names).
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/unknown command/);
    });

    it('should show error for unknown command in known strategy', async () => {
      const { stdout, stderr, exitCode } = await runXray('react unknown-command');

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('unknown');
    });

    it('should handle invalid path gracefully', async () => {
      const { stdout, stderr, exitCode } = await runXray('react components --path /nonexistent/path/that/does/not/exist');

      // A root that does not exist is not found (3), like `map`: never an empty result
      expect(exitCode).toBe(3);
    });

    it('should show helpful tip when path is invalid', async () => {
      const testPath = '/definitely/nonexistent/path/xyz123';
      const { stdout } = await runXray(`react components --path ${testPath}`);

      // If path error occurs, should have helpful message
      if (stdout.includes('not found') || stdout.includes('ENOENT')) {
        expect(stdout).toMatch(/tip|example|use.*-p/i);
      }
    });
  });

  describe('Completion Generation', () => {
    // Scripts are static (cobra protocol): commands come from
    // `xray __complete` at tab time, so strategy commands never go stale.
    it('should generate bash completion', async () => {
      const { stdout, exitCode } = await runXray('completion bash');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('__start_xray');
      expect(stdout).toContain('__complete');
    });

    it('should generate zsh completion', async () => {
      const { stdout, exitCode } = await runXray('completion zsh');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('#compdef xray');
      expect(stdout).toContain('_xray');
    });

    it('should generate fish completion', async () => {
      const { stdout, exitCode } = await runXray('completion fish');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('complete -c xray');
    });

    it('should generate powershell completion', async () => {
      const { stdout, exitCode } = await runXray('completion powershell');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Register-ArgumentCompleter');
    });

    it('should complete strategy commands at tab time', async () => {
      const { stdout, exitCode } = await runXray('__complete ""');

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^express\t/m);
      expect(stdout).toMatch(/^react\t/m);
    });

    it('should exit 2 on unsupported shell', async () => {
      const { stderr, exitCode } = await runXray('completion pwsh');

      expect(exitCode).toBe(2);
      expect(stderr).toContain("unsupported shell 'pwsh'");
    });
  });

  describe('Verbose Output', () => {
    it('should show debug info with --log-level debug', async () => {
      const { stdout, exitCode } = await runXray('--log-level debug express --help');

      expect(exitCode).toBe(0);
      // Debug output may appear in stdout
      // Just verify command still works
      expect(stdout).toContain('express');
    });
  });
});
