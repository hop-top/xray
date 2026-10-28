/**
 * Every spelling of "verbose" resolves identically: `-V` (stackable
 * count), `--verbose`, and `--log-level debug`, before or after the
 * subcommand. `-v` is the version flag.
 * Marker: `Generate action started` is debug-only and emitted by the map
 * command handler itself, so it proves both the level AND the dispatch.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { levelForVerboseCount, resolveLogLevel } from '../../src/commands/root-options';

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
    ['leading -V', () => ['-V', 'map', ...rest()]],
    ['leading --verbose', () => ['--verbose', 'map', ...rest()]],
    ['-V after subcommand', () => ['map', '-V', ...rest()]],
    ['trailing -V', () => ['map', ...rest(), '-V']],
    ['stacked -VV', () => ['-VV', 'map', ...rest()]],
    ['leading --log-level debug', () => ['--log-level', 'debug', 'map', ...rest()]],
    ['--log-level=debug', () => ['--log-level=debug', 'map', ...rest()]],
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

  test('--log-level info: no debug output', () => {
    const r = run(['--log-level', 'info', 'map', ...rest()]);
    expect(r.stderr).not.toContain(MARKER);
  });

  test('--log-level beats -V', () => {
    const r = run(['-V', '--log-level', 'warn', 'map', ...rest()]);
    expect(r.stderr).not.toContain(MARKER);
  });

  test('--quiet beats a leading -V', () => {
    const r = run(['-V', '--quiet', 'map', ...rest()]);
    expect(r.stderr).not.toContain(MARKER);
  });

  test('invalid --log-level is a usage error', () => {
    const r = run(['--log-level', 'loud', 'map', ...rest()]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("invalid --log-level 'loud'");
  });

  test('-v prints the version, not verbosity', () => {
    const r = run(['-v']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^xray v\d+\.\d+\.\d+/);
  });
});

describe('resolveLogLevel', () => {
  test('-V count maps 0 -> unchanged, >=1 -> debug', () => {
    expect(resolveLogLevel({ verbose: 0 })).toBeUndefined();
    expect(resolveLogLevel({ verbose: 1 })).toBe('debug');
    expect(resolveLogLevel({ verbose: 3 })).toBe('debug');
    expect(levelForVerboseCount(0)).toBe('info');
  });
  test('--log-level overrides -V and is case-insensitive', () => {
    expect(resolveLogLevel({ verbose: 2, logLevel: 'WARN' })).toBe('warn');
    expect(resolveLogLevel({ logLevel: 'silent' })).toBe('silent');
  });
  test('--quiet beats everything', () => {
    expect(resolveLogLevel({ quiet: true, verbose: 2, logLevel: 'debug' })).toBe('error');
  });
  test('unknown level throws a usage error', () => {
    expect(() => resolveLogLevel({ logLevel: 'loud' })).toThrow(/invalid --log-level/);
  });
});
