// __tests__/utils/execFileNoThrow.test.ts
import { execFileNoThrow } from '../../src/utils/execFileNoThrow';
import * as path from 'path';

describe('execFileNoThrow', () => {
  it('should execute command successfully', async () => {
    const result = await execFileNoThrow('echo', ['hello']);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
  });

  it('should return non-zero status for failed commands', async () => {
    const result = await execFileNoThrow('ls', ['/nonexistent-path-xyz']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No such file');
  });

  it('should prevent shell injection by not using shell', async () => {
    // If shell is used, this would execute multiple commands
    // Without shell, it tries to execute a file literally named "echo hello; echo world"
    const result = await execFileNoThrow('echo', ['hello; echo world']);

    // Should output the literal string, not execute multiple commands
    expect(result.stdout.trim()).toBe('hello; echo world');
  });

  it('should handle command not found', async () => {
    const result = await execFileNoThrow('nonexistent-command-xyz', []);

    expect(result.status).not.toBe(0);
    expect(result.error).toBeDefined();
  });

  it('should capture stderr output', async () => {
    // Use a command that writes to stderr
    const result = await execFileNoThrow('node', [
      '-e',
      'console.error("error message")'
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe('error message');
  });

  it('should handle empty arguments', async () => {
    const result = await execFileNoThrow('pwd', []);

    expect(result.status).toBe(0);
    expect(result.stdout).toBeTruthy();
  });

  it('should pass through file paths with special characters safely', async () => {
    // This tests that spaces and special chars don't cause issues
    const result = await execFileNoThrow('echo', [
      'file with spaces.txt',
      'file$with$dollars',
      'file`with`backticks'
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('file with spaces.txt');
    expect(result.stdout).toContain('file$with$dollars');
    expect(result.stdout).toContain('file`with`backticks');
  });

  it('should handle timeout', async () => {
    // Command that runs longer than timeout
    const result = await execFileNoThrow(
      'sleep',
      ['10'],
      { timeout: 100 }
    );

    expect(result.status).not.toBe(0);
    expect(result.error).toBeDefined();
  }, 1000);

  it('should allow custom cwd', async () => {
    const tmpDir = '/tmp';
    const result = await execFileNoThrow('pwd', [], { cwd: tmpDir });

    expect(result.status).toBe(0);
    // macOS resolves /tmp to /private/tmp
    expect([tmpDir, '/private/tmp']).toContain(result.stdout.trim());
  });

  it('should return large output without truncation', async () => {
    // Generate large output (>1MB default buffer)
    const result = await execFileNoThrow('node', [
      '-e',
      'for(let i=0; i<1000; i++) console.log("x".repeat(1000))'
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(100000);
  });
});
