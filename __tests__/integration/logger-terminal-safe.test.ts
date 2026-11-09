/**
 * Every Logger line is escaped before styling, so warnings and errors that
 * carry repo-controlled text (paths, package messages) cannot drive the
 * terminal. Requires `npm run build`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../src/lib/logger';
import { terminalSafe, terminalSafeBlock } from '../../src/lib/terminal-safe';

const CLI = path.join(__dirname, '../../bin/cli.js');
// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[[0-9;]*m/g;
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

describe('Logger escapes the message, not its own styling', () => {
  const lines: string[] = [];
  let err: jest.SpyInstance;
  let warn: jest.SpyInstance;
  const saved = { FORCE_COLOR: process.env.FORCE_COLOR, NO_COLOR: process.env.NO_COLOR };

  beforeEach(() => {
    lines.length = 0;
    err = jest.spyOn(console, 'error').mockImplementation((l: string) => { lines.push(String(l)); });
    warn = jest.spyOn(console, 'warn').mockImplementation((l: string) => { lines.push(String(l)); });
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    Logger.setLevel('debug');
  });
  afterEach(() => {
    err.mockRestore();
    warn.mockRestore();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it.each(['info', 'warn', 'success', 'debug', 'log'] as const)('%s', (m) => {
    Logger[m]('a \u001b[2J b\u0007 c\u009b d');
    const out = lines.join('\n');
    expect(out.replace(SGR, '')).not.toMatch(BAD);
    expect(out).toContain('\\x1b[2J');
  });

  it('error, with a detail line', () => {
    Logger.error('bad \u001b]0;pwned\u0007', new Error('inner \u001b[31m'));
    const out = lines.join('\n');
    expect(out.replace(SGR, '')).not.toMatch(BAD);
  });

  it('keeps newlines of a multi-line message, escapes CR', () => {
    Logger.warn('one\ntwo\rthree');
    expect(lines.join('\n')).toContain('one\ntwo\\rthree');
  });

  it('xray\'s own color survives', () => {
    Logger.warn('plain');
    expect(lines.join('\n')).toMatch(SGR);
  });
});

describe('the helper is idempotent: escaped text stays as it is', () => {
  it.each([
    ['\u001b[2J'], ['a\nb'], ['\\x1b[2J already text'], ['tab\there'],
  ])('%j', (s) => {
    expect(terminalSafe(terminalSafe(s))).toBe(terminalSafe(s));
    expect(terminalSafeBlock(terminalSafeBlock(s))).toBe(terminalSafeBlock(s));
    expect(terminalSafe('\\x1b[2J')).toBe('\\x1b[2J');
  });
});

describe('errors through the CLI', () => {
  let home: string;
  beforeAll(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-logsafe-')); });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, '--no-telemetry', ...args], {
      cwd: home, encoding: 'utf-8',
      env: { ...process.env, HOME: home, NO_COLOR: '1', XDG_CONFIG_HOME: path.join(home, 'c'), XDG_CACHE_HOME: path.join(home, 'k'), XDG_DATA_HOME: path.join(home, 'd'), XDG_STATE_HOME: path.join(home, 's') },
    });

  it('a fatal error naming a hostile path is escaped on stderr', () => {
    const r = run('map', '--path', 'nope\u001b[2Jx', '--output', path.join(home, 'o.md'));
    expect(r.status).toBe(3);
    expect(r.stderr).not.toMatch(BAD);
    expect(r.stderr).toContain('nope\\x1b[2Jx');
  });

  it('under --format json the envelope is JSON-escaped once, not double-escaped', () => {
    const r = run('map', '--path', 'nope\u001b[2Jx', '--output', path.join(home, 'o.md'), '--format', 'json');
    expect(r.status).toBe(3);
    const env = JSON.parse(r.stderr.slice(r.stderr.indexOf('{')));
    expect(env.message).toContain('nope\u001b[2Jx'); // the real ESC, as JSON carries it
    expect(r.stderr).toContain('\\u001b[2J');
    expect(r.stderr).not.toContain('\\\\u001b');
    expect(r.stderr).not.toContain('\\x1b');
  });
});
