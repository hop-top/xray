/**
 * Logger contract: `<glyph> <message>` lines on stderr only, level
 * threshold handed to kit log verbatim (no kit `quiet`), color gated by
 * the shared TUI policy, plain text (never JSON).
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

import { Logger, LogLevel } from '../../src/lib/logger';
import { disableColor } from '../../src/lib/tui';

type KitLog = typeof import('@hop-top/kit/dist/log');

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;]*m/;

type Stream = { isTTY?: boolean };

describe('Logger', () => {
  const env = { ...process.env };
  const isTTY = (process.stderr as Stream).isTTY;
  let err: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  const lines = (): Array<[string, string]> => {
    const all: Array<[number, string, string]> = [
      ...err.mock.calls.map((c, i) => [err.mock.invocationCallOrder[i], 'error', String(c[0])] as [number, string, string]),
      ...warn.mock.calls.map((c, i) => [warn.mock.invocationCallOrder[i], 'warn', String(c[0])] as [number, string, string]),
    ];
    return all.sort((a, b) => a[0] - b[0]).map(([, ch, s]) => [ch, s]);
  };

  const emitAll = (): void => {
    Logger.debug('dbg %s=%d', 'n', 3);
    Logger.info('inf');
    Logger.success('ok');
    Logger.log('plain');
    Logger.warn('wrn');
    Logger.error('bad', new Error('boom'));
  };

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    disableColor(false);
    (process.stderr as Stream).isTTY = false;
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...env };
    disableColor(false);
    (process.stderr as Stream).isTTY = isTTY;
    Logger.setLevel(LogLevel.INFO);
  });

  it('renders glyph lines; warn via console.warn, rest via console.error; stdout untouched', () => {
    emitAll();
    expect(lines()).toEqual([
      ['error', '◆ dbg n=3'],
      ['error', 'ℹ inf'],
      ['error', '✔ ok'],
      ['error', 'plain'],
      ['warn', '⚠ wrn'],
      ['error', '✖ bad'],
      ['error', 'Error: boom'],
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it('output() is the only stdout path and ignores the level', () => {
    Logger.setLevel(LogLevel.SILENT);
    Logger.output('data');
    expect(log).toHaveBeenCalledWith('data');
    expect(err).not.toHaveBeenCalled();
  });

  it('keeps a message\'s own trailing newline (blank line after it)', () => {
    Logger.info('list:\n');
    Logger.log('');
    expect(lines()).toEqual([['error', 'ℹ list:\n'], ['error', '']]);
  });

  it('skips the error detail line when no error is given', () => {
    Logger.error('bad');
    expect(lines()).toEqual([['error', '✖ bad']]);
  });

  it('never emits JSON', () => {
    emitAll();
    for (const [, s] of lines()) expect(s.trim().startsWith('{')).toBe(false);
  });

  describe('levels', () => {
    it.each([
      [LogLevel.SILENT, []],
      [LogLevel.ERROR, ['✖ bad', 'Error: boom']],
      [LogLevel.WARN, ['⚠ wrn', '✖ bad', 'Error: boom']],
      [LogLevel.INFO, ['ℹ inf', '✔ ok', 'plain', '⚠ wrn', '✖ bad', 'Error: boom']],
      [LogLevel.DEBUG, ['◆ dbg n=3', 'ℹ inf', '✔ ok', 'plain', '⚠ wrn', '✖ bad', 'Error: boom']],
    ])('level %s', (level, expected) => {
      Logger.setLevel(level);
      emitAll();
      expect(lines().map(([, s]) => s)).toEqual(expected);
    });

    it.each([
      ['silent', LogLevel.SILENT],
      ['ERROR', LogLevel.ERROR],
      ['warn', LogLevel.WARN],
      ['debug', LogLevel.DEBUG],
      ['bogus', LogLevel.INFO],
    ])('setLevel(%j)', (name, level) => {
      Logger.setLevel(name);
      expect(Logger.getLevel()).toBe(level);
    });

    it.each([
      [LogLevel.SILENT, 'silent'],
      [LogLevel.ERROR, 'error'],
      [LogLevel.WARN, 'warn'],
      [LogLevel.INFO, 'info'],
      [LogLevel.DEBUG, 'debug'],
    ])('hands kit log an explicit threshold for %s (no kit quiet)', (level, kitLevel) => {
      // Fresh registry so the spy and Logger's lazy require share one kit instance.
      let create!: jest.SpyInstance;
      jest.isolateModules(() => {
        const kit = require('@hop-top/kit/log') as KitLog;
        const { Logger: L } = require('../../src/lib/logger') as typeof import('../../src/lib/logger');
        create = jest.spyOn(kit, 'createLogger');
        L.setLevel(level);
        L.error('x');
      });
      expect(create).toHaveBeenCalledTimes(1);
      const opts = create.mock.calls[0][0] as import('@hop-top/kit/dist/log').LoggerOptions;
      expect(opts.level).toBe(kitLevel);
      expect(opts.quiet).toBeUndefined();
      expect(opts.format).toBeUndefined();
      expect(typeof opts.formatter).toBe('function');
    });
  });

  describe('color', () => {
    it('colors glyphs on a TTY stderr', () => {
      (process.stderr as Stream).isTTY = true;
      emitAll();
      const out = lines().map(([, s]) => s);
      for (const s of out.filter((s) => s !== 'plain')) expect(s).toMatch(SGR);
      expect(out).toContain('plain');
    });

    it('FORCE_COLOR colors a non-TTY stderr', () => {
      process.env.FORCE_COLOR = '1';
      Logger.success('ok');
      expect(lines()[0][1]).toMatch(SGR);
    });

    it.each([
      ['non-TTY stderr', () => {}],
      ['NO_COLOR on a TTY', () => { (process.stderr as Stream).isTTY = true; process.env.NO_COLOR = '1'; }],
      ['NO_COLOR beats FORCE_COLOR', () => { process.env.NO_COLOR = '1'; process.env.FORCE_COLOR = '1'; }],
      ['--no-color beats FORCE_COLOR on a TTY', () => {
        (process.stderr as Stream).isTTY = true;
        process.env.FORCE_COLOR = '1';
        disableColor();
      }],
      ['FORCE_COLOR=0 on non-TTY', () => { process.env.FORCE_COLOR = '0'; }],
    ])('no ANSI: %s', (_name, setup) => {
      setup();
      emitAll();
      for (const [, s] of lines()) expect(s).not.toMatch(SGR);
    });
  });
});

describe('Logger via the CLI', () => {
  const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');
  const run = (args: string[]) =>
    spawnSync(process.execPath, [BIN, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
      timeout: 60_000,
    });

  it('-V: diagnostics on stderr, stdout stays data-only', () => {
    const r = run(['-V', 'describe']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^◆ /m);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout).not.toMatch(/[◆ℹ✔⚠✖]/);
  });

  it('--quiet beats -V and --log-level', () => {
    const r = run(['--quiet', '-V', '--log-level', 'debug', 'describe']);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/[◆ℹ✔⚠]/);
  });

  it('--log-level silent beats -V', () => {
    const r = run(['-V', '--log-level', 'silent', 'describe']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});
