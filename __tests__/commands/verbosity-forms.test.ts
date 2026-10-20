/**
 * Every spelling of "verbose" resolves identically: a bare leading `-v`
 * must not swallow the subcommand name as its optional [level] value.
 * Marker: `Generate action started` is debug-only and emitted by the map
 * command handler itself, so it proves both the level AND the dispatch.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { normalizeVerboseArgv } from '../../src/commands/root-options';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');
const MARKER = 'Generate action started';
const CONFIG_MARKER = 'Using config file';

let repo: string;

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 90_000,
  });
}

describe('verbosity: all forms resolve identically', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-verb-'));
    fs.writeFileSync(path.join(repo, '.xrayrc.json'), '{}');
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export function a() { return 1; }\n');
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  const rest = () => ['-p', repo, '--skip-detect', '--no-chunk', '-o', path.join(repo, 'out.txt')];

  const forms: Array<[string, () => string[]]> = [
    ['leading bare -v', () => ['-v', 'map', ...rest()]],
    ['leading bare --verbose', () => ['--verbose', 'map', ...rest()]],
    ['-v after subcommand', () => ['map', '-v', ...rest()]],
    ['trailing -v', () => ['map', ...rest(), '-v']],
    ['leading -v debug', () => ['-v', 'debug', 'map', ...rest()]],
    ['leading --verbose debug', () => ['--verbose', 'debug', 'map', ...rest()]],
    ['--verbose=debug', () => ['--verbose=debug', 'map', ...rest()]],
  ];

  test.each(forms)('%s: runs map and emits debug output', (_name, args) => {
    const r = run(args());
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(CONFIG_MARKER); // startup (pre-parse) debug
    expect(r.stderr).toContain(MARKER); // command-time debug: survives commander parse
    expect(fs.existsSync(path.join(repo, 'out.txt'))).toBe(true); // map really ran
    fs.rmSync(path.join(repo, 'out.txt'), { force: true });
  });

  test('default: no debug output', () => {
    const r = run(['map', ...rest()]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain(MARKER);
    expect(r.stderr).not.toContain(CONFIG_MARKER);
  });

  test('--verbose info: no debug output', () => {
    const r = run(['--verbose', 'info', 'map', ...rest()]);
    expect(r.stderr).not.toContain(MARKER);
  });

  test('--quiet beats a leading -v', () => {
    const r = run(['-v', '--quiet', 'map', ...rest()]);
    expect(r.stderr).not.toContain(MARKER);
  });
});

describe('normalizeVerboseArgv', () => {
  const n = (...a: string[]) => normalizeVerboseArgv(['node', 'xray', ...a]).slice(2);
  test('bare flag before a subcommand is pinned to debug', () => {
    expect(n('-v', 'map')).toEqual(['--verbose=debug', 'map']);
    expect(n('--verbose', 'map', '.')).toEqual(['--verbose=debug', 'map', '.']);
  });
  test('bare flag at end or before another flag is pinned to debug', () => {
    expect(n('map', '-v')).toEqual(['map', '--verbose=debug']);
    expect(n('map', '-v', '-p', 'x')).toEqual(['map', '--verbose=debug', '-p', 'x']);
  });
  test('explicit levels are kept and lowercased', () => {
    expect(n('-v', 'WARN', 'map')).toEqual(['--verbose=warn', 'map']);
    expect(n('--verbose=info', 'map')).toEqual(['--verbose=info', 'map']);
  });
  test('stops at --', () => {
    expect(n('explore', '--', '-v', 'x')).toEqual(['explore', '--', '-v', 'x']);
  });
});
