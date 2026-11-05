/**
 * Real exit codes of failing commands must be codes `xray describe`
 * advertises for them, and kit's taxonomy must be the one in force.
 * Drives the built CLI (bin/cli.js) in a throwaway project with its own
 * config/cache/state dirs.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EXIT_CONFLICT, EXIT_NOT_FOUND, EXIT_UNAUTHORIZED } from '../../src/lib/error/types';

const CLI = path.join(__dirname, '../../bin/cli.js');

interface DescribedCommand { name: string; exitCodes: number[]; subcommands: DescribedCommand[] }

describe('failing commands exit with the code describe advertises', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let advertised: Map<string, number[]>;

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' });

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-contract-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', scripts: { a: 'echo' } }));
    fs.writeFileSync(path.join(root, 'Makefile'), 'all:\n\techo hi\n');
    const sub = (d: string) => {
      const p = path.join(root, '.env', d);
      fs.mkdirSync(p, { recursive: true });
      return p;
    };
    env = {
      ...process.env,
      HOME: sub('home'),
      XDG_CONFIG_HOME: sub('config'),
      XDG_CACHE_HOME: sub('cache'),
      XDG_STATE_HOME: sub('state'),
      XDG_DATA_HOME: sub('data'),
      NO_COLOR: '1',
      XRAY_NO_TELEMETRY: '1',
    };
    const doc = JSON.parse(run('describe').stdout) as { commands: DescribedCommand[] };
    advertised = new Map();
    const walk = (c: DescribedCommand, prefix: string) => {
      const name = prefix + c.name;
      advertised.set(name, c.exitCodes);
      (c.subcommands ?? []).forEach((s) => walk(s, name + '.'));
    };
    doc.commands.forEach((c) => walk(c, ''));
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('uses the kit taxonomy: 4 conflict, 5 unauthorized', () => {
    expect(EXIT_CONFLICT).toBe(4);
    expect(EXIT_UNAUTHORIZED).toBe(5);
    expect(EXIT_NOT_FOUND).toBe(3);
  });

  const cases: Array<{ name: string; command: string; args: string[]; code: number; stderr: RegExp }> = [
    { name: 'strategy install <missing path>', command: 'strategy.install', args: ['strategy', 'install', '/nonexistent/xray-strategy'], code: 3, stderr: /does not exist/ },
    { name: 'strategy detect --path <missing>', command: 'strategy.detect', args: ['strategy', 'detect', '--path', '/nonexistent/xray-dir'], code: 3, stderr: /does not exist/ },
    { name: 'strategy info <unknown>', command: 'strategy.info', args: ['strategy', 'info', 'nope-strategy'], code: 3, stderr: /not found/ },
    { name: 'strategy validate <unknown>', command: 'strategy.validate', args: ['strategy', 'validate', 'nope-strategy'], code: 3, stderr: /not found/ },
    { name: 'alias set <reserved name>', command: 'alias.set', args: ['alias', 'set', 'strategy', 'build targets'], code: 4, stderr: /conflicts/ },
    { name: 'build run --target <unknown>', command: 'build.run', args: ['build', 'run', '--target', 'nope'], code: 3, stderr: /not found/ },
    { name: 'strategy remove --confirm=no', command: 'strategy.remove', args: ['--confirm=no', 'strategy', 'remove', 'anything'], code: 5, stderr: /refused/ },
    { name: 'cache clear --confirm=no', command: 'cache.clear', args: ['--confirm=no', 'cache', 'clear'], code: 5, stderr: /refused/ },
    { name: 'build run (no --target)', command: 'build.run', args: ['build', 'run'], code: 2, stderr: /No target specified/ },
  ];

  it.each(cases)('$name', ({ command, args, code, stderr }) => {
    const r = run(...args);
    expect(r.status).toBe(code);
    expect(r.stderr).toMatch(stderr);
    expect(advertised.get(command)).toContain(code);
  });

  it('build run failure prints no error object on stdout', () => {
    const r = run('build', 'run', '--target', 'nope', '--format', 'json');
    expect(r.status).toBe(3);
    expect(r.stdout.trim()).toBe('');
  });

  it('strategy create over an existing file exits 4 and advertises it', () => {
    const dir = path.join(root, 'out');
    expect(run('strategy', 'create', 'dup', '--dir', dir, '--ts').status).toBe(0);
    const r = run('strategy', 'create', 'dup', '--dir', dir, '--ts');
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/already exists/);
    expect(advertised.get('strategy.create')).toContain(4);
  });

  it('every advertised code beyond 0/1/2 is one the command can produce', () => {
    expect(advertised.get('paths')).toEqual([0, 1, 2]);
    expect(run('paths', '--path', '/nonexistent/xray-dir').status).toBe(0);
  });
});
