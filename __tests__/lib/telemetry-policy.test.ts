import type { Command } from 'commander';
import { registerCommands } from '../../src/commands';
import { isMachineFormat } from '../../src/lib/output-format';
import { MACHINE_DEFAULT_COMMANDS, telemetryOffReason } from '../../src/lib/telemetry-policy';

const tty = (...args: string[]) => telemetryOffReason({ argv: ['node', 'xray', ...args], env: {}, stdoutIsTTY: true });

describe('telemetry policy: commands whose default format is machine-readable', () => {
  it.each([
    [['imports']],
    [['imports', '-p', 'repo']],
    [['describe']],
    [['-C', 'repo', 'imports']],
    [['--log-level', 'debug', 'describe']],
    [['imports', '--format', 'yaml']],
  ])('xray %j at a terminal is a machine run', (args) => {
    expect(tty(...args)).toBe('machine-format');
  });

  it.each([
    [['imports', '--format', 'text']],
    [['imports', '--format=table']],
    [['imports', '--format', 'TXT']],
  ])('xray %j (explicit human format) leaves it to consent', (args) => {
    expect(tty(...args)).toBeNull();
  });

  it.each([
    [['map']],
    [['map', 'imports']],
    [['--', 'imports']],
    [[]],
  ])('xray %j is not a machine-default command', (args) => {
    expect(tty(...args)).toBeNull();
  });

  it('the list matches the registered commands whose --format defaults to a machine format', async () => {
    const program = await registerCommands({ projectCode: false });
    const found: string[] = [];
    const visit = (cmd: Command, prefix: string[]) => {
      for (const sub of cmd.commands) {
        const name = [...prefix, sub.name()];
        const format = sub.options.find(o => o.attributeName() === 'format');
        if (format && typeof format.defaultValue === 'string' && isMachineFormat(format.defaultValue)) found.push(name.join(' '));
        visit(sub, name);
      }
    };
    visit(program, []);
    expect(found.sort()).toEqual([...MACHINE_DEFAULT_COMMANDS].sort());
  });
});
