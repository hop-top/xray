/**
 * Unknown input before or in place of a command is a usage error (exit 2),
 * never a silent fall-through to the default command (explore). Covers a
 * word that names no command, the same word after root flags, and an
 * option the root does not own (`--format`) placed before the subcommand.
 * Each case spawns the built CLI (`npm run build` first) in a throwaway
 * dir with its own config, cache and data dirs.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.join(__dirname, '..', '..', 'bin', 'xray');

let tmp: string;
let repo: string;

function run(args: string[], opts: { bare?: boolean } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...(opts.bare ? [] : ['--no-telemetry', '--offline']), ...args], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: path.join(tmp, 'home'),
      XDG_CONFIG_HOME: path.join(tmp, 'home', 'c'),
      XDG_CACHE_HOME: path.join(tmp, 'home', 'k'),
      XDG_DATA_HOME: path.join(tmp, 'home', 'd'),
      XRAY_LANG_DIR: path.join(tmp, 'home', 'l'),
      NO_COLOR: '1',
    },
    input: '',
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-unknown-input-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('a word that names no command', () => {
  it.each([
    [['version'], 'version'],
    [['spec'], 'spec'],
    [['zzzqqq'], 'zzzqqq'],
    [['add'], 'add'],
    [['foo', 'bar'], 'foo'],
    [['--stats', 'foo'], 'foo'],
    [['--', 'foo'], 'foo'],
    [['calls(main)'], 'calls(main)'],
    [['nope/x'], 'nope/x'],
  ])('%j exits 2 with the unknown-command message', (args, word) => {
    const r = run(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`unknown command '${word}'`);
    expect(r.stdout).toBe('');
  });

  it('keeps the did-you-mean suggestion, bare and after root flags', () => {
    for (const bare of [true, false]) {
      const r = run(['mapp'], { bare });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/unknown command 'mapp' \(did you mean 'map'\?\)/);
    }
  });

  it('is still caught after a value-taking root option', () => {
    const r = run(['--log-level', 'warn', '-C', '.', 'zzzqqq']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command 'zzzqqq'");
  });
});

describe('an option the root does not own, before the subcommand', () => {
  it('--format json alias list: exit 2, says to put it after the subcommand', () => {
    const r = run(['--format', 'json', 'alias', 'list']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("'--format'");
    expect(r.stderr).toMatch(/belongs after the command/);
    expect(r.stdout).toBe('');
  });

  it('--format=json form too', () => {
    const r = run(['--format=json', 'alias', 'list']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("'--format'");
  });

  it('the documented position keeps working', () => {
    const r = run(['alias', 'list', '--format', 'json']);
    expect(r.status).toBe(0);
  });

  it('an option nothing owns names the option', () => {
    for (const args of [['--bogus'], ['--bogus', 'map']]) {
      const r = run(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("'--bogus'");
    }
  });
});

describe('what keeps working', () => {
  it('bare xray lists files (default command)', () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('a.ts');
  });

  it('explore options with no command word', () => {
    expect(run(['--stats']).status).toBe(0);
    expect(run(['--format', 'json']).status).toBe(0);
    expect(run(['-p', 'src']).status).toBe(0);
  });

  it('an existing path is a query for the default command', () => {
    for (const p of ['src', './src', 'src/a.ts']) {
      const r = run([p]);
      expect(r.stderr).not.toContain('unknown command');
      expect(r.status).toBe(0);
    }
    expect(run(['--stats', 'src']).status).toBe(0);
  });

  it('a path relative to -C counts', () => {
    expect(run(['-C', 'src', 'a.ts']).status).toBe(0);
  });

  it('explore, with or without a leading option; its words are a usage error', () => {
    expect(run(['explore', 'foo', 'bar']).status).toBe(2);
    expect(run(['--format', 'json', 'explore']).status).toBe(0);
    expect(run(['--format', 'json', 'explore', 'foo']).status).toBe(2);
  });

  it('completion takes its shell word', () => {
    expect(run(['completion', 'bash']).status).toBe(0);
    expect(run(['completion', 'bash'], { bare: true }).status).toBe(0);
  });

  it('help and help <command>', () => {
    expect(run(['help']).status).toBe(0);
    expect(run(['help', 'map']).status).toBe(0);
    expect(run(['--help']).status).toBe(0);
  });

  it('a user alias runs, also after root flags', () => {
    fs.writeFileSync(path.join(repo, '.xrayrc.json'), JSON.stringify({ aliases: { bt: 'build targets' } }));
    expect(run(['bt']).status).toBe(0);
    expect(run(['bt'], { bare: true }).status).toBe(0);
  });

  it('a strategy command runs', () => {
    expect(run(['build', 'targets']).status).toBe(0);
  });
});
