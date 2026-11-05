/**
 * Failures under `--format json` are one machine-readable object, in kit's
 * error shape (`@hop-top/kit` output/error: code, message, exit_code,
 * transience), on stderr; stdout stays empty and the exit code does not
 * change. Text mode and the other formats keep their `✖ <message>` line.
 * Spawns the built CLI (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { ConflictError, CodedError, UsageError } from '../../src/lib/error/types';
import { jsonRequested, toCliError, valueOptionNames } from '../../src/lib/error/report';

const ROOT = path.resolve(__dirname, '../..');
const ENTRY = path.join(ROOT, 'dist', 'index.js');

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

let tmp: string;
let home: string;
let proj: string;

function run(args: string[], input?: string): Result {
  const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', '--quiet', ...args], {
    cwd: proj,
    input,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      XRAY_NO_TELEMETRY: '1',
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface Envelope {
  code: string;
  message: string;
  exit_code: number;
  transience: string;
  [k: string]: unknown;
}

/** Exit code, empty stdout, and stderr that is exactly one kit envelope. */
function expectEnvelope(r: Result, exit: number, code: string, transience: string): Envelope {
  expect(r.status).toBe(exit);
  expect(r.stdout).toBe('');
  const env = JSON.parse(r.stderr) as Envelope;
  expect(Object.keys(env)).toEqual(['code', 'message', 'exit_code', 'transience']);
  expect(env.code).toBe(code);
  expect(env.exit_code).toBe(exit);
  expect(env.transience).toBe(transience);
  expect(typeof env.message).toBe('string');
  expect(env.message.length).toBeGreaterThan(0);
  return env;
}

beforeAll(() => {
  if (!fs.existsSync(ENTRY)) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}${r.stderr}`);
  }
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-json-errors-')));
  home = path.join(tmp, 'home');
  proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.py'), 'def a():\n    return 1\n');
}, 300_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('coded errors', () => {
  it('strategy command: build run --target nope is NOT_FOUND (3)', () => {
    const env = expectEnvelope(run(['build', 'run', '--target', 'nope', '--format', 'json']), 3, 'NOT_FOUND', 'permanent');
    expect(env.message).toBe('Target "nope" not found in any build file');
  });

  it('--format=json is the same request', () => {
    expectEnvelope(run(['build', 'run', '--target', 'nope', '--format=json']), 3, 'NOT_FOUND', 'permanent');
  });

  it('command: query --graph missing is NOT_FOUND (3)', () => {
    const env = expectEnvelope(run(['query', 'Foo', '--graph', path.join(tmp, 'nope.json'), '--format', 'json']), 3, 'NOT_FOUND', 'permanent');
    expect(env.message).toContain('Graph file not found');
  });

  it('command: map --path missing is NOT_FOUND (3)', () => {
    expectEnvelope(run(['map', '--path', path.join(tmp, 'nope'), '--format', 'json']), 3, 'NOT_FOUND', 'permanent');
  });

  it('--json alias (map)', () => {
    expectEnvelope(run(['map', '--path', path.join(tmp, 'nope'), '--json']), 3, 'NOT_FOUND', 'permanent');
  });

  it('usage error thrown by a command: conflicting output flags (2)', () => {
    expectEnvelope(run(['map', '--json', '--txt']), 2, 'USAGE', 'permanent');
  });

  it('without --quiet, logs stay on stderr but stdout is still empty', () => {
    const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', 'build', 'run', '--target', 'nope', '--format', 'json'], {
      cwd: proj,
      env: { PATH: process.env.PATH, HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), XDG_STATE_HOME: path.join(home, '.state'), NO_COLOR: '1' },
      encoding: 'utf-8',
    });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    const start = r.stderr.indexOf('{\n');
    expect(JSON.parse(r.stderr.slice(start)).code).toBe('NOT_FOUND');
  });
});

describe('generic failures (exit 1)', () => {
  it('a thrown Error keeps its message only: no stack, no cause', () => {
    const inner = new Error('inner detail');
    const err = Object.assign(new Error('boom'), { cause: inner });
    const env = toCliError(err);
    expect(env).toMatchObject({ code: 'GENERIC', message: 'boom', exit_code: 1, transience: 'unknown' });
    expect(JSON.stringify(env)).not.toContain(' at ');
    expect(JSON.stringify(env)).not.toContain('inner detail');
  });

  it('a thrown non-Error value is stringified', () => {
    expect(toCliError('plain')).toMatchObject({ code: 'GENERIC', message: 'plain', exit_code: 1 });
  });
});

describe('coded error mapping', () => {
  it('ConflictError keeps exit 4', () => {
    expect(toCliError(new ConflictError('exists'))).toMatchObject({
      code: 'CONFLICT', message: 'exists', exit_code: 4, transience: 'permanent',
    });
  });

  it('a transient code is classed transient', () => {
    expect(toCliError(new CodedError('later', 6, 'TRANSIENT'))).toMatchObject({
      code: 'TRANSIENT', exit_code: 6, transience: 'transient',
    });
  });

  it('a tool-specific code is classed unknown', () => {
    expect(toCliError(new CodedError('x', 9, 'CUSTOM'))).toMatchObject({ code: 'CUSTOM', exit_code: 9, transience: 'unknown' });
  });
});

describe('usage errors', () => {
  it('commander: unknown option, no help text', () => {
    const env = expectEnvelope(run(['map', '--bogus', '--format', 'json']), 2, 'USAGE', 'permanent');
    expect(env.message).toBe("unknown option '--bogus'");
  });

  it('commander: surplus argument', () => {
    const env = expectEnvelope(run(['alias', 'list', '--format', 'json', 'extra']), 2, 'USAGE', 'permanent');
    expect(env.message).toContain("too many arguments for 'list'");
  });

  it('commander: option the subcommand lacks', () => {
    const env = expectEnvelope(run(['alias', 'list', '--bogus', '--format', 'json']), 2, 'USAGE', 'permanent');
    expect(env.message).toBe("unknown option '--bogus'");
  });

  it('unknown-input guard: unknown command', () => {
    const env = expectEnvelope(run(['mapp', '--format', 'json']), 2, 'USAGE', 'permanent');
    expect(env.message).toContain("unknown command 'mapp'");
  });

  it('unknown-input guard: --format before the command', () => {
    const env = expectEnvelope(run(['--format', 'json', 'alias', 'list']), 2, 'USAGE', 'permanent');
    expect(env.message).toContain("option '--format' belongs after the command");
  });

  it('--help and --version still exit 0 with their text', () => {
    const help = run(['map', '--help', '--format', 'json']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: xray map');
    expect(run(['--version']).status).toBe(0);
  });
});

describe("kit's refusals", () => {
  it('render as kit envelopes too (policy refusal)', () => {
    const r = run(['--policy', 'nope', 'map', '--format', 'json']);
    expectEnvelope(r, 2, 'USAGE', 'permanent');
  });

  it('keep kit text form without --format json', () => {
    const r = run(['--policy', 'nope', 'map']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^USAGE: --policy is set/);
  });
});

describe('xray.imports/v1', () => {
  it('failures: envelope on stderr, stdout empty, same exit codes', () => {
    expectEnvelope(run(['imports', '-p', path.join(tmp, 'nope'), '--format', 'json']), 3, 'NOT_FOUND', 'permanent');
    expectEnvelope(run(['imports', 'src', '--lang', 'bogus', '--format', 'json']), 2, 'USAGE', 'permanent');
  });

  it('success: the document is untouched', () => {
    const r = run(['imports', 'src', '--format', 'json']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout).schema).toBe('xray.imports/v1');
  });
});

describe('text mode and other formats are unchanged', () => {
  it.each([
    [['build', 'run', '--target', 'nope'], 3, '✖ Target "nope" not found in any build file'],
    [['map', '--format', 'csv', '--path', '/nonexistent-xray-dir'], 3, '✖ Path does not exist or is not a directory: /nonexistent-xray-dir'],
    [['map', '--format', 'xml', '--path', '/nonexistent-xray-dir'], 3, '✖ Path does not exist or is not a directory: /nonexistent-xray-dir'],
    [['map', '--format', 'txt', '--path', '/nonexistent-xray-dir'], 3, '✖ Path does not exist or is not a directory: /nonexistent-xray-dir'],
    [['explore', '--format', 'yaml', '--path', '/nonexistent-xray-dir'], 3, '✖ Path does not exist: /nonexistent-xray-dir'],
  ])('%j', (args, exit, line) => {
    const r = run(args);
    expect(r.status).toBe(exit);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(`${line}\n`);
  });

  it('commander usage error keeps its line and help', () => {
    const r = run(['map', '--bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^✖ unknown option '--bogus'\n\nUsage: xray map/);
  });

  it('a value that spells json is not a request: --path json', () => {
    const r = run(['map', '--path', 'json']);
    expect(r.status).toBe(3);
    expect(r.stderr).toBe(`✖ Path does not exist or is not a directory: ${path.join(proj, 'json')}\n`);
  });
});

describe('jsonRequested', () => {
  const program = new Command();
  program.option('-C, --chdir <path>');
  program
    .command('map')
    .option('--path <path>')
    .option('--query <q>')
    .option('--format <fmt>')
    .option('--json');
  const values = valueOptionNames(program);
  const req = (...a: string[]) => jsonRequested(['node', 'xray', ...a], values);

  it.each([
    [['map', '--format', 'json'], true],
    [['map', '--format=json'], true],
    [['--quiet', 'map', '--format', 'json', '--path', 'x'], true],
    [['map', '--json'], true],
    [['map', '--bogus', '--format', 'json'], true],
    [['map'], false],
    [['map', '--format', 'csv'], false],
    [['map', '--format', 'xml'], false],
    [['map', '--format', 'txt'], false],
    [['map', '--format=csv'], false],
    [['map', '--path', 'json'], false],
    [['map', '--path', '--json'], false],
    [['map', '--query', '--format=json'], false],
    [['-C', 'json', 'map'], false],
    [['map', '--format', 'json', '--format', 'csv'], false],
    [['map', '--format', 'csv', '--format', 'json'], true],
    [['map', '--format'], false],
    [['map', '--', '--format', 'json'], false],
    [['map', 'json'], false],
    [['map', '-f', 'json'], false],
    [['imports'], true],
    [['imports', '--format=json'], true],
    [['imports', '--format', 'text'], false],
    [['imports', '--format=table'], false],
    [['imports', '--format', 'yaml'], false],
    [['imports', '--format', 'csv', '--format', 'json'], true],
    [['-C', 'json', 'imports'], true],
    [['--quiet', 'imports', '-p', 'json'], true],
    [['map', 'imports'], false],
  ] as Array<[string[], boolean]>)('%j -> %s', (args, want) => {
    expect(req(...args)).toBe(want);
  });

  it('UsageError is a CodedError mapped to USAGE', () => {
    expect(toCliError(new UsageError('bad'))).toMatchObject({ code: 'USAGE', exit_code: 2 });
  });
});

describe('describe', () => {
  it('declares the error shape', () => {
    const r = run(['describe']);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.errors).toEqual({
      format: 'json',
      stream: 'stderr',
      enabledBy: ['--format json', '--format=json', '--json'],
      defaultFor: ['imports'],
      required: ['code', 'message', 'exit_code', 'transience'],
      optional: ['cause', 'suggested_fix', 'alternatives'],
      transience: ['transient', 'permanent', 'unknown'],
      codes: { GENERIC: 1, USAGE: 2, NOT_FOUND: 3, CONFLICT: 4, UNAUTHORIZED: 5, TRANSIENT: 6, CONSENT_REFUSED: 7 },
    });
  });
});

describe('mcp', () => {
  it('build_run with a bad target is an isError tool result with a readable message', () => {
    const msgs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'build_run', arguments: { target: 'nope' } } },
    ];
    const r = run(['mcp'], msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
    const reply = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((m) => m.id === 2);
    expect(reply.result.isError).toBe(true);
    const text = reply.result.content.map((c: { text: string }) => c.text).join('\n');
    expect(text).toContain('Target "nope" not found in any build file');
  });
});
