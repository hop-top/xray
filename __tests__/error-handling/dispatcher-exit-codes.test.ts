import { Command } from 'commander';
import {
  CodedError,
  ConflictError,
  NotFoundError,
  UsageError,
  EXIT_USAGE,
  EXIT_NOT_FOUND,
  EXIT_CONFLICT,
} from '../../src/lib/error/types';

/**
 * Dispatcher exit-code integration tests
 *
 * Mirrors the top-level dispatcher in src/index.ts: commander's exitOverride
 * surfaces parse failures as exceptions; action handlers throw CodedError;
 * the dispatcher maps each to a known exit code.
 *
 * These tests exercise the contract without spawning a child process — they
 * verify the same control flow the production dispatcher executes.
 */

/**
 * Helper that mirrors src/index.ts dispatch logic:
 *   - commander.* error → EXIT_USAGE
 *   - CodedError thrown by an action → err.exitCode
 *   - anything else → exit 1
 */
function applyExitOverride(cmd: Command) {
  cmd.exitOverride();
  for (const sub of cmd.commands) {
    applyExitOverride(sub);
  }
}

async function dispatch(program: Command, argv: string[]): Promise<number> {
  applyExitOverride(program);
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err: any) {
    if (err && typeof err.code === 'string' && err.code.startsWith('commander.')) {
      if (err.exitCode === 0 || err.code === 'commander.help' || err.code === 'commander.version' || err.code === 'commander.helpDisplayed') {
        return 0;
      }
      return EXIT_USAGE;
    }
    if (err instanceof CodedError) {
      return err.exitCode;
    }
    return 1;
  }
}

describe('CLI dispatcher exit codes', () => {
  it('returns 0 on successful action', async () => {
    const program = new Command();
    program.command('ok').action(async () => {});
    expect(await dispatch(program, ['node', 'cli', 'ok'])).toBe(0);
  });

  it('maps UsageError thrown from action to exit 2', async () => {
    const program = new Command();
    program.command('go').action(async () => {
      throw new UsageError('bad flag');
    });
    expect(await dispatch(program, ['node', 'cli', 'go'])).toBe(EXIT_USAGE);
  });

  it('maps NotFoundError thrown from action to exit 3', async () => {
    const program = new Command();
    program.command('lookup').action(async () => {
      throw new NotFoundError('alias not found');
    });
    expect(await dispatch(program, ['node', 'cli', 'lookup'])).toBe(EXIT_NOT_FOUND);
  });

  it('maps ConflictError thrown from action to exit 4', async () => {
    const program = new Command();
    program.command('clash').action(async () => {
      throw new ConflictError('collides with built-in');
    });
    expect(await dispatch(program, ['node', 'cli', 'clash'])).toBe(EXIT_CONFLICT);
  });

  it('maps unknown-option (commander parse failure) to exit 2', async () => {
    const program = new Command();
    program.command('do').action(async () => {});
    const code = await dispatch(program, ['node', 'cli', 'do', '--bogus']);
    expect(code).toBe(EXIT_USAGE);
  });

  it('maps unknown-command (commander parse failure) to exit 2', async () => {
    const program = new Command();
    program.command('do').action(async () => {});
    const code = await dispatch(program, ['node', 'cli', 'unknown']);
    expect(code).toBe(EXIT_USAGE);
  });

  it('falls back to exit 1 for arbitrary thrown errors', async () => {
    const program = new Command();
    program.command('boom').action(async () => {
      throw new Error('something broke');
    });
    expect(await dispatch(program, ['node', 'cli', 'boom'])).toBe(1);
  });
});
