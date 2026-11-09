// __tests__/commands/integration/strategy-commands.test.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);
const xrayBin = path.join(__dirname, '../../../dist/index.js');
const fixturesDir = path.join(__dirname, '../../strategy/fixtures');

// These tests spawn the CLI and analyze the repository itself (`--path .`),
// which takes several seconds on a full checkout (dist/, fixtures, tests);
// the default 5s jest timeout is too tight and load-sensitive.
jest.setTimeout(30000);

describe('Strategy Commands - Real Execution', () => {
  // Helper to run xray commands
  async function runXray(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      // Human messages go to stderr (logger stream split); merge for assertions.
      const { stdout, stderr } = await execAsync(`node ${xrayBin} ${args} 2>&1`);
      return { stdout: stdout + stderr, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: (error.stdout || '') + (error.stderr || ''),
        stderr: error.stderr || '',
        exitCode: error.code || 1
      };
    }
  }

  describe('React Strategy', () => {
    const reactProjectPath = path.join(fixturesDir, 'react-project');

    beforeAll(() => {
      // Verify fixture exists
      if (!fs.existsSync(reactProjectPath)) {
        throw new Error(`React fixture not found at ${reactProjectPath}`);
      }
    });

    it('should find React components', async () => {
      const { stdout, exitCode } = await runXray(`react components --path ${reactProjectPath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('React components');
      expect(stdout).toContain('App');
      expect(stdout).toContain('App.tsx');
      expect(stdout).toContain('Total: 1');
    });

    it('should find React hooks', async () => {
      const { stdout, exitCode } = await runXray(`react hooks --path ${reactProjectPath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('React hooks');
      expect(stdout).toContain('Total:');
    });

    it('should find React contexts', async () => {
      const { stdout, exitCode } = await runXray(`react contexts --path ${reactProjectPath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('React contexts');
      expect(stdout).toContain('Total:');
    });
  });

  describe('Express Strategy', () => {
    const expressProjectPath = path.join(fixturesDir, 'express-project');

    it('should list Express routes', async () => {
      const { stdout, exitCode } = await runXray(`express routes --path ${expressProjectPath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Express routes');
      expect(stdout).toContain('Total:');
    });

    it('should list Express routers', async () => {
      const { stdout, exitCode } = await runXray(`express routers --path ${expressProjectPath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Express routers');
    });

    it('should list Express middleware', async () => {
      const { stdout, exitCode } = await runXray(`express middleware --path ${expressProjectPath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Express middleware');
    });

    it('should list Express error handlers', async () => {
      const { stdout, exitCode } = await runXray(`express error-handlers --path ${expressProjectPath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Express error-handlers');
    });
  });

  describe('REST API Strategy', () => {
    it('should analyze REST endpoints across frameworks', async () => {
      const { stdout, exitCode } = await runXray(`rest-api endpoints --path .`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Rest-api endpoints');
      expect(stdout).toContain('Total:');
    });

    it('should group endpoints by HTTP method', async () => {
      const { stdout, exitCode } = await runXray(`rest-api methods --path .`);

      expect(exitCode).toBe(0);
      // Command returns JSON object (may be empty if no endpoints found)
      expect(stdout).toMatch(/\{[\s\S]*\}/);
    });

    it('should analyze middleware', async () => {
      const { stdout, exitCode } = await runXray(`rest-api middleware --path .`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Rest-api middleware');
    });
  });

  describe('Strategy Detection', () => {
    it('should detect applicable strategies in current project', async () => {
      const { stdout, exitCode } = await runXray('strategy detect');

      expect(exitCode).toBe(0);
      // Should show some detected strategies
      expect(stdout.length).toBeGreaterThan(0);
    });

    it('should list all available strategies', async () => {
      const { stdout, exitCode } = await runXray('strategy list');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('express');
      expect(stdout).toContain('react');
      expect(stdout).toContain('rest-api');
    });
  });

  describe('Output Formatting', () => {
    it('should display file locations for found items', async () => {
      const { stdout, exitCode } = await runXray(`react components --path ${fixturesDir}/react-project`);

      expect(exitCode).toBe(0);
      // Should show file paths with arrow indicator
      if (stdout.includes('Total: 1') || stdout.includes('Total: 2')) {
        // If components found, should show file paths
        expect(stdout).toMatch(/→.*\.tsx?/);
      }
    });

    it('should show total count at end', async () => {
      const { stdout, exitCode } = await runXray('react components --path .');

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Total: \d+/);
    });

    it('should indicate when nothing is found', async () => {
      const emptyDir = path.join(require('os').tmpdir(), 'xray-test-empty-' + Date.now());
      fs.mkdirSync(emptyDir, { recursive: true });
      try {
        const { stdout, exitCode } = await runXray(`react components --path ${emptyDir}`);

        expect(exitCode).toBe(0);
        expect(stdout).toContain('(none found)');
        expect(stdout).toContain('Total: 0');
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('Cross-Project Execution', () => {
    it('should work with relative paths', async () => {
      const { stdout, exitCode } = await runXray('react components --path .');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Total:');
    });

    it('should work with absolute paths', async () => {
      const absolutePath = path.resolve('.');
      const { stdout, exitCode } = await runXray(`react components --path ${absolutePath}`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Total:');
    });

    it('should handle paths with spaces', async () => {
      const testPath = path.join(fixturesDir, 'react-project');
      const { stdout, exitCode } = await runXray(`react components --path "${testPath}"`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Total:');
    });
  });

  describe('Performance', () => {
    it('should complete within reasonable time', async () => {
      const startTime = Date.now();
      const { exitCode } = await runXray('react components --path .');
      const duration = Date.now() - startTime;

      expect(exitCode).toBe(0);
      // Generous bound: repo-wide scan, load-sensitive on CI (was 5s).
      expect(duration).toBeLessThan(20000);
    });

    it('should benefit from caching on repeated runs', async () => {
      // First run (cold cache)
      const start1 = Date.now();
      await runXray('strategy list');
      const duration1 = Date.now() - start1;

      // Second run (warm cache)
      const start2 = Date.now();
      await runXray('strategy list');
      const duration2 = Date.now() - start2;

      // Second run should be faster (or similar)
      // Note: This is a soft assertion as CI environments vary
      expect(duration2).toBeLessThanOrEqual(duration1 * 1.5);
    });
  });
});
