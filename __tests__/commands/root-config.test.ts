/**
 * Root `--config <file>` selects the run's config: every config load
 * (map/scan/graph, languages, lang, paths, aliases, telemetry consent)
 * reads that file, never one discovered by walking up from `--path` or
 * the working directory. Spawns the built CLI (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

let tmp: string;
let home: string;
let root: string;
let explicit: string;
let subJson: string;
let subJs: string;
let marker: string;

function env(telemetry = false): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    NO_COLOR: '1',
  };
  if (!telemetry) e.XRAY_NO_TELEMETRY = '1';
  return e;
}

function run(args: string[], o: { cwd?: string; telemetry?: boolean } = {}): Result {
  const flags = o.telemetry ? ['--offline'] : ['--no-telemetry', '--offline'];
  const r = spawnSync(process.execPath, [ENTRY, ...flags, ...args], {
    cwd: o.cwd ?? root,
    env: env(o.telemetry),
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function write(file: string, content: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-rootcfg-')));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  // No `languages`: a run falls back to loading config for the language
  // selection, which must come from this file too.
  explicit = write(path.join(tmp, 'cfg', 'explicit.json'), {
    aliases: { picked: 'markdown toc' },
  });
  // Discovered config at the project root: must lose to --config too.
  write(path.join(root, '.xrayrc.json'), { aliases: { discovered: 'markdown toc' } });
  subJson = path.join(root, 'pkg-json');
  write(path.join(subJson, 'a.py'), 'def a():\n    return 1\n');
  // Unknown language: loading this file fails the run with a usage error.
  write(path.join(subJson, '.xrayrc.json'), { languages: ['cobol'] });
  subJs = path.join(root, 'pkg-js');
  write(path.join(subJs, 'a.py'), 'def a():\n    return 1\n');
  marker = path.join(tmp, 'JS_CONFIG_RAN');
  write(
    path.join(subJs, '.xrayrc.js'),
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = { languages: ['cobol'] };\n`
  );
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('root --config with --path into a sub-project', () => {
  it.each(['map', 'scan', 'graph'])('%s: sub .xrayrc.json does not load', (cmd) => {
    const out = path.join(tmp, 'out', cmd);
    const r = run(['--config', explicit, cmd, '--path', subJson, '-o', out]);
    expect(r.stderr).not.toContain('cobol');
    expect(r.status).toBe(0);
  });

  it.each(['map', 'scan', 'graph'])('%s: sub .xrayrc.js does not run', (cmd) => {
    const out = path.join(tmp, 'out', cmd);
    const r = run(['--config', explicit, cmd, '--path', subJs, '-o', out]);
    expect(fs.existsSync(marker)).toBe(false);
    expect(r.status).toBe(0);
  });

  it('without --config the sub config still applies (discovery unchanged)', () => {
    const r = run(['map', '--path', subJson, '-o', path.join(tmp, 'out', 'm')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cobol');
  });

  it('relative --config resolves against -C', () => {
    const r = run(
      ['-C', path.join(tmp, 'cfg'), '--config', 'explicit.json', 'map', '--path', subJs, '-o', path.join(tmp, 'out', 'm')],
      { cwd: tmp }
    );
    expect(fs.existsSync(marker)).toBe(false);
    expect(r.status).toBe(0);
  });
});

describe('root --config in other commands', () => {
  it('lang list: selection comes from --config, not the --path config', () => {
    write(explicit, { languages: ['python'] });
    write(path.join(subJson, '.xrayrc.json'), { languages: ['go'] });
    const r = run(['--config', explicit, 'lang', 'list', '--path', subJson, '--format', 'json']);
    expect(r.status).toBe(0);
    const rows: Array<{ language: string; selected: boolean }> = JSON.parse(r.stdout).languages;
    const selected = rows.filter((x) => x.selected).map((x) => x.language);
    expect(selected).toEqual(['python']);
  });

  it('paths reports the explicit config as project-config', () => {
    const r = run(['--config', explicit, 'paths', '--path', subJson, '--format', 'json']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).projectConfig).toBe(explicit);
  });

  it('aliases register from --config, not the discovered config', () => {
    const r = run(['--config', explicit, '--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('picked');
    expect(r.stdout).not.toContain('discovered');
  });

  it('alias list reads --config', () => {
    const r = run(['--config', explicit, 'alias', 'list', '--format', 'json']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([{ alias: 'picked', target: 'markdown toc' }]);
  });

  it('alias set writes to --config', () => {
    const r = run(['--config', explicit, 'alias', 'set', 'added', 'markdown refs']);
    expect(r.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(explicit, 'utf-8')).aliases.added).toBe('markdown refs');
    expect(JSON.parse(fs.readFileSync(path.join(root, '.xrayrc.json'), 'utf-8')).aliases.added).toBeUndefined();
  });

  it('alias set refuses a JS --config (not writable as data)', () => {
    const js = write(path.join(tmp, 'cfg', 'x.js'), 'module.exports = {};\n');
    const r = run(['--config', js, 'alias', 'set', 'added', 'markdown refs']);
    expect(r.status).toBe(2);
    expect(fs.readFileSync(js, 'utf-8')).toBe('module.exports = {};\n');
  });

  it('telemetry consent never writes into --config or cwd (non-interactive: nothing persisted)', () => {
    const cwd = path.join(tmp, 'empty');
    fs.mkdirSync(cwd);
    const before = fs.readFileSync(explicit, 'utf-8');
    const r = run(['--config', explicit, 'paths'], { cwd, telemetry: true });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(cwd, '.xrayrc.json'))).toBe(false);
    expect(fs.readFileSync(explicit, 'utf-8')).toBe(before);
    expect(fs.existsSync(path.join(home, '.config', 'xray', 'config.json'))).toBe(false);
  });
});

describe('rootConfigFromArgv', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { rootConfigFromArgv } = require('../../src/commands/root-options') as typeof import('../../src/commands/root-options');
  const argv = (...a: string[]) => ['node', 'xray', ...a];

  it('absent -> undefined; empty -> undefined', () => {
    expect(rootConfigFromArgv(argv('map'), '/w')).toBeUndefined();
    expect(rootConfigFromArgv(argv('--config=', 'map'), '/w')).toBeUndefined();
  });

  it('both forms, before or after the subcommand; last wins', () => {
    expect(rootConfigFromArgv(argv('--config', 'a.json', 'map'), '/w')).toBe('/w/a.json');
    expect(rootConfigFromArgv(argv('map', '--config=/abs/b.json'), '/w')).toBe('/abs/b.json');
    expect(rootConfigFromArgv(argv('--config', 'a.json', 'map', '--config', 'b.json'), '/w')).toBe('/w/b.json');
  });

  it('relative value resolves against -C/--chdir', () => {
    expect(rootConfigFromArgv(argv('-C', 'proj', '--config', 'x.json', 'map'), '/w')).toBe('/w/proj/x.json');
    expect(rootConfigFromArgv(argv('--config', 'x.json', '--chdir=/p', 'map'), '/w')).toBe('/p/x.json');
  });

  it('stops at --', () => {
    expect(rootConfigFromArgv(argv('explore', '--', '--config', 'x.json'), '/w')).toBeUndefined();
  });
});
