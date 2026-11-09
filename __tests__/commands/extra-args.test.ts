/**
 * A surplus positional is a usage error (`✖ too many arguments ...`, exit 2)
 * on every command that declares fewer operands. It used to be swallowed:
 * `cache clear zzz` and `paths zzz` exited 0 and ignored the word. Only the
 * default command (explore) takes extra operands, as a free-form query.
 * Each case spawns the built CLI (`npm run build` first) in a throwaway
 * dir with its own config, cache and data dirs.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { projectKey } from '../../src/lib/storage';

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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-extra-args-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'd1'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'd2'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'd1', 'a.py'), 'def a():\n    return 1\n');
  fs.writeFileSync(path.join(repo, 'd2', 'b.py'), 'def b():\n    return 2\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('surplus positionals are a usage error', () => {
  it.each([
    // commands that take no operands
    ['cache clear'],
    ['clear-cache'],
    ['paths'],
    ['describe'],
    ['mcp'],
    ['strategy list'],
    ['strategy detect'],
    ['strategy path'],
    ['alias list'],
    ['lang list'],
    ['completion bash'],
    ['completion zsh'],
    ['completion fish'],
    ['completion powershell'],
    // strategy nouns
    ['build targets'],
    ['react components'],
    ['markdown toc'],
  ])('%s + one extra word: exit 2, "too many arguments"', (cmd) => {
    const r = run([...cmd.split(' '), 'zzz']);
    expect(r.status).toBe(2);
    expect(r.stderr.split('\n')[0]).toMatch(/^✖ too many arguments for /);
    expect(r.stderr).not.toMatch(/^error: /m);
  });

  it.each([
    // commands with a fixed arity: one word too many
    ['query', ['query', 'a', 'b']],
    ['impact', ['impact', 'a', 'b']],
    ['strategy info', ['strategy', 'info', 'a', 'b']],
    ['strategy create', ['strategy', 'create', 'a', 'b']],
    ['strategy remove', ['strategy', 'remove', 'a', 'b']],
    ['strategy validate', ['strategy', 'validate', 'a', 'b']],
    ['strategy install', ['strategy', 'install', 'a', 'b']],
    ['alias set', ['alias', 'set', 'a', 'b', 'c']],
    ['alias remove', ['alias', 'remove', 'a', 'b']],
  ])('%s with one operand too many: exit 2', (_n, args) => {
    const r = run(args);
    expect(r.status).toBe(2);
    expect(r.stderr.split('\n')[0]).toMatch(/^✖ too many arguments for /);
  });

  it('cache clear zzz removes nothing', () => {
    const db = path.join(tmp, 'home', 'k', 'xray', 'projects', projectKey(repo), 'xray_cache.db');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.writeFileSync(db, 'cache');
    expect(run(['cache', 'clear', 'zzz']).status).toBe(2);
    expect(fs.existsSync(db)).toBe(true);
    expect(run(['--confirm=yes', 'cache', 'clear']).status).toBe(0);
    expect(fs.existsSync(db)).toBe(false);
  });

  it('an alias rejects an extra word', () => {
    fs.writeFileSync(path.join(repo, '.xrayrc.json'), JSON.stringify({ aliases: { bt: 'build targets' } }));
    expect(run(['bt']).status).toBe(0);
    const r = run(['bt', 'zzz']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/too many arguments for 'bt'/);
  });
});

describe('explore takes no query', () => {
  it.each([
    ['one word', ['explore', 'foo']],
    ['two words', ['explore', 'foo', 'bar']],
    ['after --', ['explore', '--', 'foo', 'bar']],
    ['an existing path', ['explore', 'd1']],
  ])('%s: usage error pointing at --match/--search', (_n, args) => {
    const r = run(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--match');
    expect(r.stderr).toContain('--search');
  });
});

describe('xray <path>', () => {
  it('scans that path, not the whole project', () => {
    const r = run(['d1']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain('a.py');
    expect(r.stdout + r.stderr).not.toContain('b.py');
  });

  it('an existing file is scanned as that one file', () => {
    const r = run(['d1/a.py']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain('a.py');
    expect(r.stdout + r.stderr).not.toContain('b.py');
    expect(r.stdout + r.stderr).toContain('Found 1 file');
  });

  it('explore --path <file>: same, with --search and --match by name', () => {
    const s = run(['explore', '--path', 'd1/a.py', '--search', 'return']);
    expect(s.stdout).toContain('a.py');
    expect(s.stdout).toContain('return 1');
    expect(s.stdout).not.toContain('b.py');
    const m = run(['explore', '--path', 'd1/a.py', '--match', 'a.*']);
    expect(m.stdout).toContain('a.py');
    expect(run(['explore', '--path', 'd1/a.py', '--match', 'b.*']).stdout).not.toContain('a.py');
  });

  it('combines with --match relative to that path', () => {
    const r = run(['d2', '--match', '*.py']);
    expect(r.stdout + r.stderr).toContain('b.py');
    expect(r.stdout + r.stderr).not.toContain('a.py');
  });
});

describe('what keeps working', () => {
  it.each([
    ['an existing path', ['d1']],
    ['an option, then a path', ['--stats', 'd1']],
  ])('default route: %s exits 0', (_n, args) => {
    const r = run(args);
    expect(r.stderr).not.toMatch(/too many arguments/);
    expect(r.status).toBe(0);
  });

  it.each([
    ['map', ['map', 'd1', 'd2', '-o', 'out']],
    ['graph', ['graph', 'd1', 'd2', '-o', 'out']],
    ['imports', ['imports', 'd1', 'd2']],
    ['map after --', ['map', '-o', 'out', '--', 'd1', 'd2']],
  ])('variadic paths: %s takes several', (_n, args) => {
    const r = run(args);
    expect(r.stderr).not.toMatch(/too many arguments/);
    expect(r.status).toBe(0);
  });

  it('strategy nouns run', () => {
    expect(run(['build', 'targets']).status).toBe(0);
  });

  it('an unknown noun is still "unknown command"', () => {
    const r = run(['build', 'nosuchnoun']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown command 'nosuchnoun'/);
  });

  it('the removed generate command is an unknown command', () => {
    const r = run(['generate', 'd1']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown command 'generate'/);
  });

  it('unknown options fail as before', () => {
    for (const args of [['paths', '--bogus'], ['--bogus'], ['cache', 'clear', '--bogus']]) {
      const r = run(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/unknown option '--bogus'/);
    }
  });

  it('an alias runs, with its own option', () => {
    fs.writeFileSync(path.join(repo, '.xrayrc.json'), JSON.stringify({ aliases: { bt: 'build targets' } }));
    expect(run(['bt', '-p', repo]).status).toBe(0);
    expect(run(['bt', '--bogus']).status).toBe(2);
  });

  it('help <command> works, for nested commands too', () => {
    const a = run(['help', 'cache']);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain('Usage: xray cache');
    const b = run(['help', 'cache', 'clear']);
    expect(b.status).toBe(0);
    expect(b.stdout).toContain('Usage: xray cache clear');
    expect(run(['help']).status).toBe(0);
  });

  it('completion and __complete run', () => {
    expect(run(['completion', 'bash']).status).toBe(0);
    const c = run(['__complete', 'cache', ''], { bare: true });
    expect(c.status).toBe(0);
    expect(c.stdout).toContain('clear');
    const d = run(['__completeNoDesc', 'strategy', ''], { bare: true });
    expect(d.status).toBe(0);
    expect(d.stdout).toContain('list');
  });

  it('the skipped-strategy notice shows for a strategy noun', () => {
    fs.mkdirSync(path.join(repo, '.xray', 'strategies'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.xray', 'strategies', 'vecs.js'),
      "module.exports = { name: 'vecs', version: '1.0.0', detect: () => false, analyze: async () => ({ tags: [] }), commands: { go: { description: 'go', handler: async () => ({}) } } };\n"
    );
    for (const args of [['vecs', 'go'], ['vecs', 'go', 'more']]) {
      const r = run(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("unknown command 'vecs'");
      expect(r.stderr).toContain('not loaded');
    }
  });
});
