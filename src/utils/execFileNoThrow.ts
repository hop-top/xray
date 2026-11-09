// src/utils/execFileNoThrow.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ExecFileResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface ExecFileOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Safely execute a file without shell injection vulnerabilities.
 *
 * Unlike exec() which spawns a shell, execFile() passes arguments directly
 * to the binary, preventing shell metacharacters from being interpreted.
 *
 * @param command - The command to execute (binary name or path)
 * @param args - Array of arguments to pass to the command
 * @param options - Execution options (cwd, timeout, maxBuffer, env)
 * @returns Promise resolving to { status, stdout, stderr, error }
 *
 * @example
 * ```typescript
 * // Safe - arguments are passed directly to mdq
 * const result = await execFileNoThrow('mdq', ['--output', 'json', filePath]);
 *
 * // Even with malicious filenames, no shell injection occurs
 * const result = await execFileNoThrow('mdq', ['$(rm -rf /)']);
 * // This tries to open a file literally named "$(rm -rf /)", not execute it
 * ```
 */
export async function execFileNoThrow(
  command: string,
  args: string[] = [],
  options: ExecFileOptions = {}
): Promise<ExecFileResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024, // 10MB default
      env: options.env || process.env
    });

    return {
      status: 0,
      stdout: stdout || '',
      stderr: stderr || ''
    };
  } catch (error: any) {
    // execFile throws on non-zero exit codes
    return {
      status: error.code || error.killed ? (error.signal ? 128 : 1) : 0,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      error
    };
  }
}
