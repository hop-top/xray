/**
 * `xray describe` emits a machine-readable capability surface per
 * 12-Factor AI-CLI Apps spec Factor 1. Agents must be able to discover
 * commands, options, side-effect class, idempotency, and exit codes
 * without parsing free-text `--help` output.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { buildDescribeDoc } from '../../src/commands/describe';
import { declareEffect } from '../../src/commands/side-effect';
import { IMPORTS_SCHEMA_ID } from '../../src/lib/imports/types';

function makeProgram(): Command {
  // Synthetic program that mirrors xray's surface enough to exercise
  // each branch of the walker without dragging in command registrations
  // (which would require tree-sitter / telemetry init).
  const root = new Command('xray');
  declareEffect(root
    .command('map')
    .description('Generate visual map')
    .option('-l, --limit <number>', 'Token limit', '4000')
    .option('-o, --output <file>', 'Output path')
    .action(() => {}), 'write-local', 'conditional');
  declareEffect(root
    .command('explore')
    .description('Explore and discover')
    .argument('[path]', 'Path to explore')
    .option('--list-strategies', 'List strategies')
    .action(() => {}), 'read', 'yes');
  const cache = root.command('cache').description('Cache management');
  declareEffect(cache.command('clear').description('Clear cache').action(() => {}), 'destructive-local', 'yes');
  declareEffect(root
    .command('alias')
    .description('Alias management')
    .command('remove')
    .description('Remove an alias')
    .argument('<name>', 'Alias name')
    .action(() => {}), 'write-local', 'no');
  declareEffect(root
    .command('imports')
    .description('Imports contract')
    .argument('[paths...]', 'Paths')
    .option('--format <fmt>', 'Output format', 'json')
    .action(() => {}), 'read', 'yes');
  declareEffect(root
    .command('describe')
    .description('Capability surface')
    .option('--format <fmt>', 'Output format', 'json')
    .action(() => {}), 'read', 'yes');
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

  it('declares the full exit-code taxonomy (0-7, kit)', () => {
    expect(doc.exitCodes).toMatchObject({
      '0': expect.any(String),
      '1': expect.any(String),
      '2': expect.any(String),
      '3': expect.any(String),
      '4': expect.any(String),
      '5': expect.any(String),
      '6': expect.any(String),
      '7': expect.any(String),
    });
    // kit: 4=conflict, 5=unauthorized, 6=transient, 7=consent refused.
    expect(doc.exitCodes['4']).toMatch(/conflict/i);
    expect(doc.exitCodes['5']).toMatch(/unauthorized|permission|auth/i);
    expect(doc.exitCodes['6']).toMatch(/transient|retry/i);
    expect(doc.exitCodes['7']).toMatch(/consent/i);
  });

  it('classifies a leaf by what it declares', () => {
    const explore = doc.commands.find((c) => c.name === 'explore')!;
    expect(explore).toBeDefined();
    expect(explore.sideEffect).toBe('read');
    expect(explore.idempotent).toBe('yes');
    expect(explore.exitCodes).toEqual([0, 1, 2, 3]);
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

    const explore = doc.commands.find((c) => c.name === 'explore')!;
    const listFlag = explore.options.find((o) => o.name === '--list-strategies')!;
    expect(listFlag.type).toBe('boolean');
  });

  it('parses positional arguments with required/variadic', () => {
    const explore = doc.commands.find((c) => c.name === 'explore')!;
    expect(explore.arguments.length).toBe(1);
    expect(explore.arguments[0]).toMatchObject({
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

  it('reports the tier a command declares to kit, whatever its name', () => {
    const root = new Command('xray');
    declareEffect(root.command('purge').action(() => {}), 'write-local', 'conditional');
    declareEffect(root.command('list').action(() => {}), 'destructive-local', 'no');
    const doc2 = buildDescribeDoc(root, 'xray', '0.1.0');
    expect(doc2.commands.find((c) => c.name === 'purge')).toMatchObject({ sideEffect: 'write-local', idempotent: 'conditional' });
    expect(doc2.commands.find((c) => c.name === 'list')).toMatchObject({ sideEffect: 'destructive-local', idempotent: 'no' });
  });

  it('fails on a leaf that declares nothing, never guessing a tier', () => {
    const root = new Command('xray');
    root.command('map').action(() => {});
    expect(() => buildDescribeDoc(root, 'xray', '0.1.0')).toThrow(/"map" declares no valid kit\/side-effect tier/);
    const half = new Command('xray');
    (half.command('map').action(() => {}) as any).annotations = { 'kit/side-effect': 'read' };
    expect(() => buildDescribeDoc(half, 'xray', '0.1.0')).toThrow(/kit\/idempotent/);
  });

  it('reports a group that only holds subcommands as read / yes', () => {
    const cacheDoc = doc.commands.find((c) => c.name === 'cache')!;
    expect(cacheDoc).toMatchObject({ sideEffect: 'read', idempotent: 'yes' });
  });

  it('adds exit code 3 for alias.remove (not-found path)', () => {
    const alias = doc.commands.find((c) => c.name === 'alias')!;
    const remove = alias.subcommands.find((c) => c.name === 'remove')!;
    expect(remove.exitCodes).toContain(3);
  });

  it('classifies imports as read / yes, exit 3, with its output schema id and shipped path', () => {
    const imports = doc.commands.find((c) => c.name === 'imports')!;
    expect(imports).toMatchObject({ sideEffect: 'read', idempotent: 'yes', exitCodes: [0, 1, 2, 3] });
    expect(imports.output).toEqual({ schema: IMPORTS_SCHEMA_ID, path: 'schemas/xray.imports.v1.json', formats: ['json', 'yaml'] });
    const root = path.resolve(__dirname, '../..');
    const schema = JSON.parse(fs.readFileSync(path.join(root, imports.output!.path), 'utf8'));
    expect(schema.properties.schema.const).toBe(IMPORTS_SCHEMA_ID);
    expect(require('../../package.json').files).toContain(imports.output!.path.split('/')[0]);
    // Only commands with a versioned document carry `output`.
    expect(doc.commands.find((c) => c.name === 'explore')!.output).toBeUndefined();
  });

  it('exposes the describe command itself', () => {
    const desc = doc.commands.find((c) => c.name === 'describe')!;
    expect(desc).toBeDefined();
    expect(desc.sideEffect).toBe('read');
    const fmt = desc.options.find((o) => o.name === '--format')!;
    expect(fmt.default).toBe('json');
  });
});
