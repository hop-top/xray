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

interface DescribedCommand { name: string; sideEffect: string; exitCodes: number[]; subcommands: DescribedCommand[] }

describe('failing commands exit with the code describe advertises', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let advertised: Map<string, number[]>;
  let leaves: Array<{ command: string; argv: string[]; doc: DescribedCommand & { sideEffect: string; options: Array<{ name: string }>; arguments: Array<{ name: string; required: boolean }> } }>;
  /** `command:code` pairs a real run produced; the last test checks describe against it. */
  const produced = new Set<string>();

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...({ detached: true } as object),
    });

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
    const doc = JSON.parse(run('spec').stdout) as { commands: DescribedCommand[] };
    advertised = new Map();
    leaves = [];
    const walk = (c: any, prefix: string) => {
      const name = prefix + c.name;
      advertised.set(name, c.exitCodes);
      if ((c.subcommands ?? []).length === 0) leaves.push({ command: name, argv: name.split('.'), doc: c });
      (c.subcommands ?? []).forEach((s: DescribedCommand) => walk(s, name + '.'));
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
    { name: 'strategy show <unknown>', command: 'strategy.show', args: ['strategy', 'show', 'nope-strategy'], code: 3, stderr: /not found/ },
    { name: 'strategy validate <unknown>', command: 'strategy.validate', args: ['strategy', 'validate', 'nope-strategy'], code: 3, stderr: /not found/ },
    { name: 'alias set <reserved name>', command: 'alias.set', args: ['alias', 'set', 'strategy', 'build targets'], code: 4, stderr: /conflicts/ },
    { name: 'build show <unknown>', command: 'build.show', args: ['build', 'show', 'nope'], code: 3, stderr: /not found/ },
    { name: 'strategy delete --confirm=no', command: 'strategy.delete', args: ['--confirm=no', 'strategy', 'delete', 'anything'], code: 5, stderr: /refused/ },
    { name: 'strategy delete <unknown> --confirm=yes', command: 'strategy.delete', args: ['--confirm=yes', 'strategy', 'delete', 'nope-strategy'], code: 3, stderr: /not found/ },
    { name: 'cache clear --confirm=no', command: 'cache.clear', args: ['--confirm=no', 'cache', 'clear'], code: 5, stderr: /refused/ },
    { name: 'map <missing path>', command: 'map', args: ['map', '/nonexistent/xray-dir'], code: 3, stderr: /does not exist/ },
    { name: 'diagram <missing path>', command: 'diagram', args: ['diagram', '/nonexistent/xray-dir'], code: 3, stderr: /does not exist/ },
    { name: 'impact <symbol> --path <missing>', command: 'impact', args: ['impact', 'x', '--path', '/nonexistent/xray-dir'], code: 3, stderr: /does not exist/ },
    { name: 'query --graph <missing file>', command: 'query', args: ['query', 'x', '--graph', '/nonexistent/g.json'], code: 3, stderr: /not found/ },
    { name: 'alias delete <no config>', command: 'alias.delete', args: ['alias', 'delete', 'nope'], code: 3, stderr: /No configuration file|not found/ },
    { name: 'skill show <unknown>', command: 'skill.show', args: ['skill', 'show', 'nope-skill'], code: 3, stderr: /not found/ },
    { name: 'build exec <target> without confirmation', command: 'build.exec', args: ['--confirm=no', 'build', 'exec', 'all'], code: 5, stderr: /refused/ },
    { name: 'build exec <unknown> --confirm=yes', command: 'build.exec', args: ['--confirm=yes', 'build', 'exec', 'nope'], code: 3, stderr: /not found/ },
    { name: 'upgrade check --offline', command: 'upgrade.check', args: ['--offline', 'upgrade', 'check'], code: 6, stderr: /offline/ },
    { name: 'build show (no <target>)', command: 'build.show', args: ['build', 'show'], code: 2, stderr: /missing required argument/ },
  ];

  it.each(cases)('$name', ({ command, args, code, stderr }) => {
    const r = run(...args);
    expect(r.status).toBe(code);
    expect(r.stderr).toMatch(stderr);
    expect(advertised.get(command)).toContain(code);
    produced.add(`${command}:${code}`);
  });

  it('build show failure prints no error object on stdout', () => {
    const r = run('build', 'show', 'nope', '--format', 'json');
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
    produced.add('strategy.create:4');
  });

  it('alias set: re-setting a name updates (0); 4 is for reserved names only', () => {
    expect(run('alias', 'set', 'zz', 'react hooks').status).toBe(0);
    expect(run('alias', 'set', 'zz', 'react hooks').status).toBe(0);
    expect(run('alias', 'set', 'zz', 'react components').status).toBe(0);
    expect(run('alias', 'set', 'map', 'react hooks').status).toBe(4);
    expect(advertised.get('alias.set')).toContain(4);
    produced.add('alias.set:4');
  });

  /** Every leaf a run can start with a bogus operand set. */
  const operands = (l: { doc: { arguments: Array<{ name: string; required: boolean }> } }) =>
    l.doc.arguments.filter((a) => a.required).map(() => 'x');

  it('every leaf: an unknown flag is a usage error (2), advertised', () => {
    for (const l of leaves) {
      const r = run(...l.argv, ...operands(l), '--no-such-flag-xyz');
      expect({ command: l.command, status: r.status }).toEqual({ command: l.command, status: 2 });
      expect(advertised.get(l.command)).toContain(2);
    }
  });

  it('every leaf with --path: a missing path exits with a code describe advertises', () => {
    const missing = '/nonexistent/xray-dir';
    for (const l of leaves.filter((x) => x.doc.options.some((o) => o.name === '--path'))) {
      const confirm = String(l.doc.sideEffect).startsWith('destructive') ? ['--confirm=yes'] : [];
      const format = l.doc.options.some((o) => o.name === '--format') ? ['--format', 'json'] : [];
      const r = run(...confirm, ...l.argv, ...operands(l), '--path', missing, ...format);
      const status = r.status as number;
      expect({ command: l.command, status, advertised: advertised.get(l.command)!.includes(status) })
        .toEqual({ command: l.command, status, advertised: true });
      produced.add(`${l.command}:${status}`);
    }
  });

  it('strategy leaves: a missing --path is not found (3) with the envelope, not an empty result', () => {
    const builtin = new Set(['help', 'map', 'query', 'impact', 'imports', 'handbook', 'diagram', 'ask', 'review',
      'tui', 'serve', 'watch', 'strategy', 'alias', 'language', 'skill', 'cache', 'config', 'spec',
      'completion', 'explore', 'upgrade']);
    const strategyLeaves = leaves.filter((l) => !builtin.has(l.argv[0]));
    expect(strategyLeaves.length).toBeGreaterThan(20);
    for (const l of strategyLeaves) {
      // A destructive command needs confirming and a required positional a value to reach the path check.
      const confirm = String(l.doc.sideEffect).startsWith('destructive') ? ['--confirm=yes'] : [];
      const r = run(...confirm, ...l.argv, ...operands(l), '--path', '/nonexistent/xray-dir', '--format', 'json');
      expect({ command: l.command, status: r.status, stdout: r.stdout }).toEqual({ command: l.command, status: 3, stdout: '' });
      expect(JSON.parse(r.stderr)).toMatchObject({ code: 'NOT_FOUND', exit_code: 3 });
      expect(advertised.get(l.command)).toContain(3);
    }
  });

  it('config paths reports a missing root instead of failing: 0, advertised as [0,1,2]', () => {
    expect(advertised.get('config.paths')).toEqual([0, 1, 2]);
    expect(run('config', 'paths', '--path', '/nonexistent/xray-dir').status).toBe(0);
  });

  it('every advertised code beyond 0/1/2 is one a real run produced', () => {
    const unproduced: string[] = [];
    for (const [command, codes] of advertised) {
      for (const code of codes.filter((c) => c > 2)) {
        if (!produced.has(`${command}:${code}`)) unproduced.push(`${command}:${code}`);
      }
    }
    expect(unproduced).toEqual([]);
  });
});
