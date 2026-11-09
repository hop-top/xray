/**
 * Color + progress policy of the kit/tui adapter.
 *
 * Color off under NO_COLOR, --no-color, non-TTY; progress off under
 * quiet and non-TTY.
 */
// kit/tui's CJS bundle requires an ESM-only prompt lib (confirm/list),
// which Jest cannot load; these tests never prompt.
jest.mock('@clack/prompts', () => ({}));

import {
  colorEnabled,
  disableColor,
  fileProgress,
  statusLine,
  styles,
} from '../../src/lib/tui';
import { Logger, LogLevel } from '../../src/lib/logger';

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;]*m/;

function fakeStream(isTTY: boolean) {
  const writes: string[] = [];
  const stream = {
    isTTY,
    write: (s: string) => {
      writes.push(s);
      return true;
    },
  } as unknown as NodeJS.WritableStream & { isTTY: boolean };
  return { stream, writes };
}

describe('tui color policy', () => {
  const env = { ...process.env };
  const argv = process.argv;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.argv = ['node', 'xray'];
    disableColor(false);
  });

  afterEach(() => {
    process.env = { ...env };
    process.argv = argv;
    disableColor(false);
  });

  it('styles a TTY stream by default', () => {
    const { stream } = fakeStream(true);
    expect(colorEnabled(stream)).toBe(true);
    expect(styles(stream).accent('x')).toMatch(SGR);
    expect(statusLine('ok', 'success', stream)).toMatch(SGR);
  });

  it('is plain on a non-TTY stream', () => {
    const { stream } = fakeStream(false);
    expect(colorEnabled(stream)).toBe(false);
    expect(styles(stream).accent('x')).toBe('x');
    expect(statusLine('ok', 'success', stream)).toBe('✓ ok');
  });

  it('is plain under NO_COLOR, even on a TTY', () => {
    process.env.NO_COLOR = '1';
    const { stream } = fakeStream(true);
    expect(colorEnabled(stream)).toBe(false);
    for (const paint of Object.values(styles(stream))) {
      expect(paint('x')).toBe('x');
    }
  });

  it('is plain when --no-color is on argv', () => {
    process.argv = ['node', 'xray', '--no-color', 'explore'];
    expect(colorEnabled(fakeStream(true).stream)).toBe(false);
  });

  it('is plain after disableColor() (root --no-color hook)', () => {
    disableColor();
    expect(colorEnabled(fakeStream(true).stream)).toBe(false);
  });

  it('FORCE_COLOR styles a non-TTY stream, but never beats NO_COLOR / --no-color', () => {
    process.env.FORCE_COLOR = '1';
    const { stream } = fakeStream(false);
    expect(colorEnabled(stream)).toBe(true);
    process.env.NO_COLOR = '1';
    expect(colorEnabled(stream)).toBe(false);
    delete process.env.NO_COLOR;
    disableColor();
    expect(colorEnabled(stream)).toBe(false);
  });

  it('FORCE_COLOR=0 does not force', () => {
    process.env.FORCE_COLOR = '0';
    expect(colorEnabled(fakeStream(false).stream)).toBe(false);
  });

  describe('Logger', () => {
    let spy: jest.SpyInstance;
    const isTTY = process.stderr.isTTY;

    beforeEach(() => {
      Logger.setLevel(LogLevel.DEBUG);
      spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (process.stderr as { isTTY?: boolean }).isTTY = true;
    });

    afterEach(() => {
      spy.mockRestore();
      (process.stderr as { isTTY?: boolean }).isTTY = isTTY;
      Logger.setLevel(LogLevel.INFO);
    });

    it('colors its symbol on a TTY stderr', () => {
      Logger.success('done');
      expect(spy.mock.calls[0][0]).toMatch(SGR);
      expect(spy.mock.calls[0][0]).toContain('✔');
    });

    it.each([
      ['NO_COLOR', () => { process.env.NO_COLOR = '1'; }],
      ['--no-color', () => { disableColor(); }],
      ['non-TTY stderr', () => { (process.stderr as { isTTY?: boolean }).isTTY = false; }],
    ])('emits no ANSI under %s', (_name, setup) => {
      setup();
      Logger.info('a');
      Logger.success('b');
      Logger.debug('c');
      Logger.error('d', new Error('boom'));
      const out = spy.mock.calls.map((c) => String(c[0]));
      expect(out).toEqual(['ℹ a', '✔ b', '◆ c', '✖ d', 'Error: boom']);
    });
  });
});

describe('tui fileProgress', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    disableColor(false);
  });

  afterEach(() => {
    process.env = { ...env };
    disableColor(false);
  });

  it('writes nothing under quiet, even on a TTY', () => {
    const { stream, writes } = fakeStream(true);
    const p = fileProgress({ label: 'Parsing', quiet: true, stream });
    p.update(1, 2, 'a.ts');
    p.update(2, 2, 'b.ts');
    p.stop();
    expect(writes).toEqual([]);
  });

  it('writes nothing on a non-TTY stream', () => {
    const { stream, writes } = fakeStream(false);
    const p = fileProgress({ label: 'Parsing', stream });
    p.update(1, 2, 'a.ts');
    p.update(2, 2, 'b.ts');
    expect(writes).toEqual([]);
  });

  it('draws a plain bar on a TTY with color off, then clears the line', () => {
    process.env.NO_COLOR = '1';
    const { stream, writes } = fakeStream(true);
    const p = fileProgress({ label: 'Parsing', stream });
    p.update(1, 2, 'a.ts');
    p.update(2, 2, 'b.ts');
    p.stop(); // already stopped at total; no extra write
    expect(writes.join('')).not.toMatch(SGR);
    expect(writes[0]).toContain('50% Parsing 1/2 a.ts');
    expect(writes[1]).toContain('100% Parsing 2/2 b.ts');
    expect(writes[writes.length - 1]).toBe('\r\x1b[K');
    expect(writes).toHaveLength(3);
  });

  it('draws the kit bar on a color TTY stderr', () => {
    const isTTY = process.stderr.isTTY;
    (process.stderr as { isTTY?: boolean }).isTTY = true;
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const p = fileProgress({ label: 'Parsing' });
      p.update(1, 2, 'a.ts');
      p.update(2, 2, 'b.ts');
      const out = spy.mock.calls.map((c) => String(c[0])).join('');
      expect(out).toMatch(SGR);
      expect(out).toContain('Parsing 2/2 b.ts');
      expect(out.endsWith('\r\x1b[K')).toBe(true);
    } finally {
      spy.mockRestore();
      (process.stderr as { isTTY?: boolean }).isTTY = isTTY;
    }
  });
});
