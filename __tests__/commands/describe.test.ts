/**
 * `xray describe` emits a machine-readable capability surface per
 * 12-Factor AI-CLI Apps spec Factor 1. Agents must be able to discover
 * commands, options, side-effect class, idempotency, and exit codes
 * without parsing free-text `--help` output.
 */
import { Command } from 'commander';
import { buildDescribeDoc } from '../../src/commands/describe';

function makeProgram(): Command {
  // Synthetic program that mirrors xray's surface enough to exercise
  // each branch of the walker without dragging in command registrations
  // (which would require tree-sitter / telemetry init).
  const root = new Command('xray');
  root
    .command('map')
    .description('Generate visual map')
    .option('-l, --limit <number>', 'Token limit', '4000')
    .option('-o, --output <file>', 'Output path')
    .action(() => {});
  root
    .command('scan')
    .description('Scan and discover')
    .argument('[path]', 'Path to scan')
    .option('--list-strategies', 'List strategies')
    .action(() => {});
  const cache = root.command('cache').description('Cache management');
  cache.command('clear').description('Clear cache').action(() => {});
  root
    .command('alias')
    .description('Alias management')
    .command('remove')
    .description('Remove an alias')
    .argument('<name>', 'Alias name')
    .action(() => {});
  root
    .command('describe')
    .description('Capability surface')
    .option('--format <fmt>', 'Output format', 'json')
    .action(() => {});
  return root;
}

describe('xray describe', () => {
  const doc = buildDescribeDoc(makeProgram(), 'xray', '0.1.0');

  it('emits a top-level document with required fields', () => {
    expect(doc.$schema).toBe('https://hop-top.dev/schemas/cli-capabilities/v1.json');
    expect(doc.tool).toBe('xray');
    expect(doc.version).toBe('0.1.0');
    expect(doc.spec).toBe('12fc/v1');
    expect(doc.commands).toBeInstanceOf(Array);
    expect(doc.commands.length).toBeGreaterThan(0);
  });

  it('publishes the telemetry policy (forced-off runs, env, flag)', () => {
    expect(doc.telemetry).toEqual({
      defaultOff: ['non-tty', 'machine-format', 'ci', 'mcp'],
      env: ['XRAY_NO_TELEMETRY', 'DO_NOT_TRACK'],
      flag: '--no-telemetry',
    });
  });

  it('serializes to valid JSON', () => {
    const serialized = JSON.stringify(doc);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it('declares the full exit-code taxonomy (0/1/2/3/4/5)', () => {
    expect(doc.exitCodes).toMatchObject({
      '0': expect.any(String),
      '1': expect.any(String),
      '2': expect.any(String),
      '3': expect.any(String),
      '4': expect.any(String),
      '5': expect.any(String),
    });
    // 12fc Factor 11: 4=auth, 5=conflict.
    expect(doc.exitCodes['4']).toMatch(/unauthorized|permission|auth/i);
    expect(doc.exitCodes['5']).toMatch(/conflict/i);
  });

  it('classifies scan as read / idempotent yes', () => {
    const scan = doc.commands.find((c) => c.name === 'scan')!;
    expect(scan).toBeDefined();
    expect(scan.sideEffect).toBe('read');
    expect(scan.idempotent).toBe('yes');
    expect(scan.exitCodes).toEqual([0, 1, 2]);
  });

  it('classifies map as write-local / conditional', () => {
    const map = doc.commands.find((c) => c.name === 'map')!;
    expect(map.sideEffect).toBe('write-local');
    expect(map.idempotent).toBe('conditional');
  });

  it('classifies cache.clear as destructive-local', () => {
    const cache = doc.commands.find((c) => c.name === 'cache')!;
    const clear = cache.subcommands.find((c) => c.name === 'clear')!;
    expect(clear).toBeDefined();
    expect(clear.qualifiedName).toBe('cache.clear');
    expect(clear.sideEffect).toBe('destructive-local');
  });

  it('parses option metadata (flags, short, type, default, required)', () => {
    const map = doc.commands.find((c) => c.name === 'map')!;
    const limit = map.options.find((o) => o.name === '--limit')!;
    expect(limit).toBeDefined();
    expect(limit.short).toBe('-l');
    expect(limit.type).toBe('number');
    expect(limit.default).toBe('4000');

    const scan = doc.commands.find((c) => c.name === 'scan')!;
    const listFlag = scan.options.find((o) => o.name === '--list-strategies')!;
    expect(listFlag.type).toBe('boolean');
  });

  it('parses positional arguments with required/variadic', () => {
    const scan = doc.commands.find((c) => c.name === 'scan')!;
    expect(scan.arguments.length).toBe(1);
    expect(scan.arguments[0]).toMatchObject({
      name: 'path',
      required: false,
      variadic: false,
    });
  });

  it('walks nested subcommands and qualifies names', () => {
    const cache = doc.commands.find((c) => c.name === 'cache')!;
    expect(cache.subcommands.length).toBe(1);
    expect(cache.subcommands[0].name).toBe('clear');
    expect(cache.subcommands[0].qualifiedName).toBe('cache.clear');
  });

  it('adds exit code 3 for alias.remove (not-found path)', () => {
    const alias = doc.commands.find((c) => c.name === 'alias')!;
    const remove = alias.subcommands.find((c) => c.name === 'remove')!;
    expect(remove.exitCodes).toContain(3);
  });

  it('exposes the describe command itself', () => {
    const desc = doc.commands.find((c) => c.name === 'describe')!;
    expect(desc).toBeDefined();
    expect(desc.sideEffect).toBe('read');
    const fmt = desc.options.find((o) => o.name === '--format')!;
    expect(fmt.default).toBe('json');
  });
});
