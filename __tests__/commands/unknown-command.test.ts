/**
 * Pre-parse guard for unknown subcommands.
 *
 * explore is registered with isDefault:true so bare `xray <query>` works
 * as a shortcut. But that means commander silently routes UNKNOWN
 * command names into explore as the query, hiding typos. The guard in
 * src/index.ts intercepts command-shaped tokens that aren't registered
 * and throws UsageError (exit 2). So does every other word that is not a
 * command or an existing path (see unknown-input.test.ts).
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

const CLI = path.join(__dirname, '..', '..', 'dist', 'index.js');

// execFileSync (no shell) keeps test inputs out of any shell-metachar
// interpretation path even though all args here are hard-coded.
function run(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      status: err.status ?? 1,
    };
  }
}

describe('unknown-subcommand guard', () => {
  it('rejects hyphenated unknown command with exit 2', () => {
    const r = run(['totally-not-a-command']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown command 'totally-not-a-command'/);
  });

  it('rejects near-miss typo with did-you-mean hint (exit 2)', () => {
    const r = run(['scna']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/scna/);
    expect(r.stderr).toMatch(/did you mean 'scan'/);
  });

  it('rejects unknown flags on registered subcommand (exit 2)', () => {
    const r = run(['scan', '--bogus-flag']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown option '--bogus-flag'/);
  });

  it('rejects an unrelated bare word too (exit 2)', () => {
    const r = run(['helloquery']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown command 'helloquery'/);
  });

  it('preserves explicit explore subcommand', () => {
    const r = run(['explore', 'foobar']);
    expect(r.status).toBe(0);
  });

  it('preserves registered subcommands', () => {
    const r = run(['scan', '--help']);
    expect(r.status).toBe(0);
  });
});
