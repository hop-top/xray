/**
 * Verifies the root program exposes the standard global flags
 * (`--config`, `--no-telemetry`, `--quiet`, `--no-color`, `-C/--chdir`)
 * plus the existing `-v/--verbose` as persistent options that
 * subcommands inherit.
 *
 * Uses the extracted `configureRootProgram` helper so the test stays
 * at the commander layer and does not load tree-sitter or any
 * subcommand registrations.
 */
import { Command } from 'commander';
import { configureRootProgram } from '../../src/commands/root-options';

function buildRoot(): Command {
  return configureRootProgram(new Command(), '0.0.0-test');
}

describe('root program global flags', () => {
  const collect = () => {
    const program = buildRoot();
    return program.options.map((opt) => ({
      long: (opt as { long?: string }).long,
      short: (opt as { short?: string }).short,
      attr: opt.attributeName(),
    }));
  };

  it('declares -v/--verbose on root', () => {
    expect(collect()).toContainEqual(
      expect.objectContaining({ long: '--verbose', short: '-v' })
    );
  });

  it('declares --config on root', () => {
    expect(collect()).toContainEqual(
      expect.objectContaining({ long: '--config', attr: 'config' })
    );
  });

  it('declares --no-telemetry on root', () => {
    expect(collect()).toContainEqual(
      expect.objectContaining({
        long: '--no-telemetry',
        attr: 'telemetry',
      })
    );
  });

  it('declares --quiet on root', () => {
    expect(collect()).toContainEqual(
      expect.objectContaining({ long: '--quiet', attr: 'quiet' })
    );
  });

  it('declares --no-color on root', () => {
    expect(collect()).toContainEqual(
      expect.objectContaining({
        long: '--no-color',
        attr: 'color',
      })
    );
  });

  it('declares -C/--chdir on root', () => {
    expect(collect()).toContainEqual(
      expect.objectContaining({
        long: '--chdir',
        short: '-C',
        attr: 'chdir',
      })
    );
  });

  it('renders all five new globals in --help', () => {
    const program = buildRoot();
    const help = program.helpInformation();
    expect(help).toContain('--config');
    expect(help).toContain('--no-telemetry');
    expect(help).toContain('--quiet');
    expect(help).toContain('--no-color');
    expect(help).toContain('--chdir');
  });
});
