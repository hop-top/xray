/**
 * Config is data. `.xrayrc.js`, `xray.config.js` and the global `config.js`
 * are never discovered or loaded, and a JS path given to `--config` is
 * refused before anything reads it. Every case spawns the built CLI
 * (`npm run build` first) against a JS file that writes a marker when
 * executed; the marker must never appear.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

let tmp: string;
let home: string;
let repo: string;
let other: string;
let marker: string;

const code = () =>
  `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = { paths: ['.'] };\n`;

function write(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-nojs-')));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  other = path.join(tmp, 'other');
  marker = path.join(tmp, 'RAN');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  write(path.join(repo, 'a.py'), 'def a():\n    return 1\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe.each(['.xrayrc.js', 'xray.config.js'])('a project %s', (name) => {
  beforeEach(() => {
    write(path.join(repo, name), code());
  });

  it.each([
    ['imports', ['imports']],
    ['map', ['map', '-o', 'out']],
    ['describe', ['describe']],
    ['--version', ['--version']],
  ])('%s from inside the repo never runs it', (_label, args) => {
    const r = run(args, repo);
    expect(r.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it.each([
    ['imports', ['imports']],
    ['map', ['map', '-o', path.join('out', 'm')]],
  ])('%s with -p from another directory never runs it', (_label, args) => {
    const r = run([...args, '-p', repo], other);
    expect(r.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('is not discovered: `paths` reports no project config', () => {
    const r = run(['paths', '--format', 'json'], repo);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).projectConfig).toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('a .xrayrc.json beside it is the config that applies', () => {
    write(path.join(repo, '.xrayrc.json'), '{}');
    const r = run(['paths', '--format', 'json'], repo);
    expect(JSON.parse(r.stdout).projectConfig).toBe(path.join(repo, '.xrayrc.json'));
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('is noted at debug level, naming .xrayrc.json', () => {
    const r = run(['--log-level', 'debug', 'paths'], repo);
    expect(r.stderr).toContain(`Ignoring ${path.join(repo, name)}`);
    expect(r.stderr).toContain('.xrayrc.json');
  });

  it('is silent at the default level', () => {
    const r = run(['paths'], repo);
    expect(r.stderr).not.toContain('Ignoring');
  });
});

it('a global config.js is never run', () => {
  write(path.join(home, '.config', 'xray', 'config.js'), code());
  write(path.join(home, 'Library', 'Application Support', 'xray', 'config.js'), code());
  for (const args of [['--version'], ['paths'], ['map', '-o', 'out', '-p', repo]]) {
    expect(run(args, repo).status).toBe(0);
  }
  expect(fs.existsSync(marker)).toBe(false);
});

describe('--config pointing at JavaScript', () => {
  it.each(['evil.js', 'evil.cjs', 'evil.mjs'])('%s is refused with a pointer to .xrayrc.json, never run', (name) => {
    const file = write(path.join(tmp, name), code());
    for (const args of [
      ['--config', file, 'map', '-p', repo, '-o', 'out'],
      [`--config=${file}`, 'paths'],
      ['map', '--scope', `--config=${file}`],
      ['--config', `./${name}`, 'describe'],
    ]) {
      const r = run(args, tmp);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`config file ${file} is JavaScript, which xray does not load; use .xrayrc.json`);
      expect(fs.existsSync(marker)).toBe(false);
    }
  });

  it('is refused even when the file does not exist', () => {
    const r = run(['--config', 'missing.js', 'paths'], tmp);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('.xrayrc.json');
  });

  it('a JSON --config still works', () => {
    const file = write(path.join(tmp, 'ok.json'), '{}');
    const r = run(['--config', file, 'paths', '--format', 'json'], tmp);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).projectConfig).toBe(file);
  });
});
