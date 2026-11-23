import { parseDurationMs } from '../../src/lib/duration';
import { UsageError } from '../../src/lib/error/types';

describe('parseDurationMs', () => {
  it.each([
    ['150ms', 150],
    ['5s', 5000],
    ['1.5s', 1500],
    ['2m', 120_000],
    ['1h30m', 5_400_000],
    ['1m30s500ms', 90_500],
  ])('parses Go-style duration %s -> %d ms', (input, expected) => {
    expect(parseDurationMs(input, '--timeout')).toBe(expected);
  });

  it('interprets bare numbers using defaultUnit (ms by default, s when requested)', () => {
    expect(parseDurationMs('150', '--debounce')).toBe(150);
    expect(parseDurationMs('30', '--timeout', { defaultUnit: 's' })).toBe(30_000);
  });

  it('rejects zero, negative, empty, or malformed durations with UsageError', () => {
    for (const bad of ['', '   ', '0', '0s', '-5s', 'abc', '5d', '10x']) {
      expect(() => parseDurationMs(bad, '--timeout')).toThrow(UsageError);
    }
  });

  it('respects allowZero', () => {
    expect(parseDurationMs('0', '--debounce', { allowZero: true })).toBe(0);
    expect(parseDurationMs('0ms', '--debounce', { allowZero: true })).toBe(0);
  });
});
