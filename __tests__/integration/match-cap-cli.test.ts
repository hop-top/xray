/**
 * End-to-end: over-long --match / config match patterns are a usage error
 * (exit 2, JSON envelope under --format json). Requires `npm run build`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_PATH = path.join(__dirname, '../../bin/cli.js');
const over = 'a'.repeat(1025);

describe('match pattern cap through the built CLI', () => {
  let proj: string;
  let home: string;

  beforeAll(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'match-cap-proj-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'match-cap-home-'));
    fs.mkdirSync(path.join(proj, 'src'));
    fs.writeFileSync(path.join(proj, 'src/a.ts'), 'export const a = 1;\n');
  });
  afterAll(() => {
    fs.rmSync(proj, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const run = (...args: string[]) =>
    spawnSync('node', [CLI_PATH, ...args], {
      cwd: proj,
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        NO_COLOR: '1',
      },
    });

  it('--match: exit 2, source named', () => {
    const r = run('explore', '--match', over);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--match: pattern is 1025 characters');
  });

  it('--match under --format json: envelope on stderr, empty stdout', () => {
    const r = run('explore', '--match', over, '--format', 'json');
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    const env = JSON.parse(r.stderr.slice(r.stderr.indexOf('{')));
    expect(env.code).toBe('USAGE');
    expect(env.exit_code).toBe(2);
    expect(env.message).toContain('--match');
  });

  it('config match: exit 2, config file named', () => {
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify({ match: [over] }));
    try {
      const r = run('map', '--output', path.join(home, 'o.md'));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('.xrayrc.json');
      expect(r.stderr).toContain('1025 characters');
    } finally {
      fs.rmSync(path.join(proj, '.xrayrc.json'), { force: true });
    }
  });

  const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}/*.ts`);

  it('--match: 256 patterns run, 257 are a usage error', () => {
    const args = (n: number) => ['explore', ...many(n).flatMap((p) => ['--match', p])];
    expect(run(...args(256)).status).toBe(0);
    const r = run(...args(257));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--match: 257 patterns, over the 256 limit');
  });

  it('total length over 4096: usage error from --match and from config', () => {
    const pats = ['a'.repeat(1024), 'b'.repeat(1024), 'c'.repeat(1024), 'd'.repeat(1024), 'e'];
    const r = run('explore', ...pats.flatMap((p) => ['--match', p]));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--match: patterns total 4097 characters');
    const rc = path.join(proj, '.xrayrc.json');
    try {
      fs.writeFileSync(rc, JSON.stringify({ match: pats }));
      const c = run('map', '--output', path.join(home, 'o.md'));
      expect(c.status).toBe(2);
      expect(c.stderr).toContain('.xrayrc.json');
      expect(c.stderr).toContain('patterns total 4097');
    } finally {
      fs.rmSync(rc, { force: true });
    }
  });

  it('config match: 256 run, 257 are a usage error naming the file', () => {
    const rc = path.join(proj, '.xrayrc.json');
    try {
      fs.writeFileSync(rc, JSON.stringify({ match: many(256) }));
      expect(run('map', '--output', path.join(home, 'o.md')).status).toBe(0);
      fs.writeFileSync(rc, JSON.stringify({ match: many(257) }));
      const r = run('map', '--output', path.join(home, 'o.md'));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('.xrayrc.json');
      expect(r.stderr).toContain('257 patterns');
    } finally {
      fs.rmSync(rc, { force: true });
    }
  });

  it.each([
    ['a bare string', '*.ts'],
    ['a number', 5],
    ['an array holding a number', ['*.ts', 1]],
  ])('config match as %s: usage error, JSON envelope under --format json', (_n, value) => {
    const rc = path.join(proj, '.xrayrc.json');
    try {
      fs.writeFileSync(rc, JSON.stringify({ match: value }));
      const r = run('map', '--format', 'json', '--output', path.join(home, 'o.md'));
      expect(r.status).toBe(2);
      const env = JSON.parse(r.stderr.slice(r.stderr.indexOf('{')));
      expect(env.code).toBe('USAGE');
      expect(env.message).toContain('.xrayrc.json');
      expect(env.message).toContain('must be an array of strings');
    } finally {
      fs.rmSync(rc, { force: true });
    }
  });

  it('an over-long config pattern with ESC/newline is not echoed raw', () => {
    const rc = path.join(proj, '.xrayrc.json');
    try {
      fs.writeFileSync(rc, JSON.stringify({ match: ['\u001b[2J\nforged: ' + 'a'.repeat(1100)] }));
      const r = run('map', '--output', path.join(home, 'o.md'));
      expect(r.status).toBe(2);
      expect(r.stderr).not.toContain('\u001b[2J');
      expect(r.stderr).not.toContain('\nforged');
    } finally {
      fs.rmSync(rc, { force: true });
    }
  });
});
