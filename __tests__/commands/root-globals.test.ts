/**
 * Root program global flags: kit contract (`-v/--version`, `-V/--verbose`,
 * `--quiet`, `--no-color`, help groups) plus xray's own globals
 * (`--log-level`, `--config`, `--no-telemetry`, `-C/--chdir`).
 *
 * Uses `createRootProgram` so the test stays at the commander layer and
 * does not load tree-sitter or any subcommand registrations.
 */
import type { Command } from 'commander';
import { createRootProgram } from '../../src/commands/root-options';
import { colorForcedOff, disableColor, getTheme } from '../../src/lib/tui';

function buildRoot(): Command {
  return createRootProgram('0.0.0-test').program;
}

describe('root program global flags', () => {
  const collect = () =>
    buildRoot().options.map((opt) => ({
      long: (opt as { long?: string }).long,
      short: (opt as { short?: string }).short,
      attr: opt.attributeName(),
    }));

  it.each([
    ['--version', '-v', 'version'],
    ['--verbose', '-V', 'verbose'],
    ['--log-level', undefined, 'logLevel'],
    ['--config', undefined, 'config'],
    ['--no-telemetry', undefined, 'telemetry'],
    ['--quiet', undefined, 'quiet'],
    ['--no-color', undefined, 'color'],
    ['--chdir', '-C', 'chdir'],
  ])('declares %s on root', (long, short, attr) => {
    const match: Record<string, unknown> = { long, attr };
    if (short) match.short = short;
    expect(collect()).toContainEqual(expect.objectContaining(match));
  });

  it('leaves --format / -o to subcommands', () => {
    const longs = collect().map((o) => o.long);
    expect(longs).not.toContain('--format');
    expect(longs).not.toContain('--output');
  });

  it('exposes a theme', () => {
    const { theme } = createRootProgram('0.0.0-test');
    expect(theme.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('installs its theme as the shared TUI theme', () => {
    const { theme } = createRootProgram('0.0.0-test');
    expect(getTheme()).toBe(theme);
  });

  it('renders the globals and help groups in --help', () => {
    const program = buildRoot();
    const help = program.helpInformation();
    for (const s of ['--log-level', '--config', '--no-telemetry', '--quiet', '--no-color', '--chdir', '--verbose', '--version']) {
      expect(help).toContain(s);
    }
  });
});

describe('root --no-color', () => {
  afterEach(() => {
    disableColor(false);
  });

  function parse(args: string[]): { color: unknown } {
    const program = buildRoot();
    program.exitOverride();
    let seen: { color: unknown } = { color: undefined };
    program.command('noop').action((opts) => {
      seen = opts;
    });
    program.parse(args, { from: 'user' });
    return seen;
  }

  it('keeps color on when the flag is absent (TTY-like run)', () => {
    const opts = parse(['noop']);
    expect(colorForcedOff()).toBe(false);
    expect(opts.color).toBe(true);
  });

  it('turns color off when --no-color is passed', () => {
    const opts = parse(['--no-color', 'noop']);
    expect(colorForcedOff()).toBe(true);
    expect(opts.color).toBe(false);
  });
});
