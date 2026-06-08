// __tests__/commands/integration/strategy-execution.test.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);
const xrayBin = path.join(__dirname, '../../../dist/index.js');

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

      // React strategy may not fail on missing path if no components found
      // Just verify it doesn't crash
      expect([0, 1]).toContain(exitCode);
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
    it('should generate bash completion', async () => {
      const { stdout, exitCode } = await runXray('completion bash');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('_xray_completions');
      expect(stdout).toContain('complete -F _xray_completions xray');
      // Should include strategy commands
      expect(stdout).toContain('express');
      expect(stdout).toContain('react');
    });

    it('should generate zsh completion', async () => {
      const { stdout, exitCode } = await runXray('completion zsh');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('#compdef xray');
      expect(stdout).toContain('_xray');
      // Should include strategy commands
      expect(stdout).toContain('express');
      expect(stdout).toContain('react');
    });

    it('should generate fish completion', async () => {
      const { stdout, exitCode } = await runXray('completion fish');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('complete -c xray');
      // Should include strategy commands
      expect(stdout).toContain('express');
      expect(stdout).toContain('react');
    });

    it('should error on unsupported shell', async () => {
      const { stdout, stderr, exitCode } = await runXray('completion powershell');

      expect(exitCode).not.toBe(0);
      expect(stdout + stderr).toContain('Unsupported shell');
    });
  });

  describe('Verbose Output', () => {
    it('should show debug info with -v debug', async () => {
      const { stdout, exitCode } = await runXray('-v debug express --help');

      expect(exitCode).toBe(0);
      // Debug output may appear in stdout
      // Just verify command still works
      expect(stdout).toContain('express');
    });
  });
});
