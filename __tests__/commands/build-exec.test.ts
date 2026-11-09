/**
 * `build run --target <t>` only prints the command. `build exec <t>` runs it
 * for real: destructive-local, so kit refuses it without `--confirm=yes`
 * (exit 5) and a root `--dry-run` prints the plan. Argv array (no shell),
 * project root as cwd, inherited stdio, the child's exit code propagated.
 * Drives the built CLI against throwaway Makefile / package.json projects.
 * Skips tools missing on this machine.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../bin/cli.js');
const has = (bin: string) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = (ok: boolean) => (ok ? describe : describe.skip);

let tmp: string;
let env: NodeJS.ProcessEnv;
const mk = (name: string, files: Record<string, string>) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
  return dir;
};
const cli = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmp, env: { ...env, ...extraEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
const run = (dir: string, target: string, extraEnv: NodeJS.ProcessEnv = {}) =>
  cli(['build', 'run', '-p', dir, '--target', target], extraEnv);
const exec = (dir: string, target: string, extraEnv: NodeJS.ProcessEnv = {}, pre: string[] = ['--confirm=yes']) =>
  cli([...pre, 'build', 'exec', target, '-p', dir], extraEnv);

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-exec-'));
  const sub = (d: string) => {
    const p = path.join(tmp, '.env', d);
    fs.mkdirSync(p, { recursive: true });
    return p;
  };
  env = {
    ...process.env, HOME: sub('home'), XDG_CONFIG_HOME: sub('config'),
    XDG_CACHE_HOME: sub('cache'), XDG_STATE_HOME: sub('state'),
    XRAY_NO_TELEMETRY: '1', NO_COLOR: '1',
  };
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

maybe(has('make'))('build exec (make)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mk('mk', {
      Makefile: [
        '.PHONY: hello where fail sig',
        'hello:', '\t@echo hello-from-make; touch ran.marker',
        'where:', '\t@pwd > cwd.marker',
        'fail:', '\t@exit 7',
        'sig:', '\t@kill -KILL $$PPID',
        '',
      ].join('\n'),
    });
  });
  beforeEach(() => fs.rmSync(path.join(dir, 'ran.marker'), { force: true }));

  test('build run only prints the command, runs nothing', () => {
    const r = run(dir, 'hello');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('make hello');
    expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(false);
  });

  test('build run has no --exec flag', () => {
    const r = cli(['build', 'run', '-p', dir, '--target', 'hello', '--exec']);
    expect(r.status).toBe(2);
    expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(false);
  });

  test.each([['no confirmation', []], ['--confirm=no', ['--confirm=no']]])(
    'kit refuses %s (exit 5); nothing runs', (_n, pre) => {
      const r = exec(dir, 'hello', {}, pre as string[]);
      expect(r.status).toBe(5);
      expect(r.stdout + r.stderr).toContain('refused');
      expect(r.stdout).not.toContain('hello-from-make');
      expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(false);
    });

  test('root --dry-run prints the plan (the command), runs nothing', () => {
    const r = exec(dir, 'hello', {}, ['--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('make hello');
    expect(r.stdout).not.toContain('hello-from-make');
    expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(false);
  });

  test('root --dry-run --format json is a plan document', () => {
    const r = cli(['--dry-run', 'build', 'exec', 'hello', '-p', dir, '--format', 'json']);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(JSON.stringify(doc)).toContain('make hello');
    expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(false);
  });

  test('runs the target with inherited stdio', () => {
    const r = exec(dir, 'hello');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('hello-from-make');
    expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(true);
  });

  test('--format json adds nothing to the child output on stdout', () => {
    const r = cli(['--confirm=yes', 'build', 'exec', 'hello', '-p', dir, '--format', 'json']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('hello-from-make\n');
  });

  test('uses the project root as cwd', () => {
    exec(dir, 'where');
    expect(fs.realpathSync(fs.readFileSync(path.join(dir, 'cwd.marker'), 'utf8').trim()))
      .toBe(fs.realpathSync(dir));
  });

  test('propagates the child exit code (make fails with 2)', () => {
    expect(exec(dir, 'fail').status).toBe(2);
  });

  test('child killed by a signal exits 1 with a message', () => {
    const r = exec(dir, 'sig');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/signal/i);
  });

  test('refuses an unknown target (exit 3) and runs nothing', () => {
    const r = exec(dir, 'nope');
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/not found/);
  });

  test('with the build tool missing from PATH exits 3', () => {
    const empty = path.join(tmp, 'empty-path');
    fs.mkdirSync(empty, { recursive: true });
    const r = exec(dir, 'hello', { PATH: empty });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/make/);
  });
});

maybe(has('npm'))('build exec (npm scripts)', () => {
  test('passes the target as one argv entry, never through a shell', () => {
    const dir = mk('npm', {
      'package.json': JSON.stringify({
        name: 'p', version: '1.0.0',
        scripts: { ok: 'echo ran-ok', seven: 'exit 7', 'a;touch PWNED': 'echo hi' },
      }),
    });
    const ok = exec(dir, 'ok');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('ran-ok');
    expect(exec(dir, 'seven').status).toBe(7);
    exec(dir, 'a;touch PWNED');
    expect(fs.existsSync(path.join(dir, 'PWNED'))).toBe(false);
  });
});

test('leading-dash target is refused (usage) and nothing runs', () => {
  const dir = mk('dash', { Makefile: '.PHONY: x\nx:\n\t@touch ran.marker\n' });
  const r = cli(['--confirm=yes', 'build', 'exec', '-p', dir, '--', '--version']);
  expect([2, 3]).toContain(r.status);
  expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(false);
});

describe('describe advertises build exec', () => {
  test('destructive-local, not idempotent, exit codes 3 and 5; build run stays read', () => {
    const r = cli(['describe', '--format', 'json']);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    const build = doc.commands.find((c: any) => c.name === 'build');
    const sub = (n: string) => build.subcommands.find((c: any) => c.name === n);
    expect(sub('exec')).toMatchObject({ sideEffect: 'destructive-local', idempotent: 'no' });
    expect(sub('exec').exitCodes).toEqual(expect.arrayContaining([0, 1, 2, 3, 5]));
    expect(sub('exec').arguments.map((a: any) => a.name)).toEqual(['target']);
    expect(sub('run')).toMatchObject({ sideEffect: 'read', idempotent: 'yes' });
  });
});
