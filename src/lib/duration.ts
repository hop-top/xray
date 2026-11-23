/**
 * Parse Go-style duration strings (e.g. `150ms`, `5s`, `5m`, `1h30m`) or bare numbers.
 */
import { UsageError } from './error/types';

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

const SEGMENT_RE = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;

/**
 * Parse `raw` into milliseconds.
 *
 * Accepts:
 * - Go-style durations: `150ms`, `2s`, `5m`, `1h`, `1m30s`
 * - Bare numbers, interpreted in `defaultUnit` (`ms` or `s`)
 *
 * Throws `UsageError` when the input is malformed, negative, or (when
 * `allowZero` is false) zero.
 */
export function parseDurationMs(
  raw: string,
  flagName: string,
  opts: { defaultUnit?: 'ms' | 's'; allowZero?: boolean } = {}
): number {
  const defaultUnit = opts.defaultUnit ?? 'ms';
  const allowZero = opts.allowZero ?? false;
  const trimmed = String(raw).trim();
  if (trimmed === '') {
    throw new UsageError(`invalid ${flagName} '${raw}' (expected a duration like 150ms, 5s, 5m)`);
  }

  let totalMs: number;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    totalMs = Number(trimmed) * UNIT_MS[defaultUnit];
  } else {
    let matched = 0;
    let sum = 0;
    SEGMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SEGMENT_RE.exec(trimmed)) !== null) {
      if (m.index !== matched) break;
      sum += Number(m[1]) * UNIT_MS[m[2]];
      matched = SEGMENT_RE.lastIndex;
    }
    if (matched === 0 || matched !== trimmed.length) {
      throw new UsageError(`invalid ${flagName} '${raw}' (expected a duration like 150ms, 5s, 5m)`);
    }
    totalMs = sum;
  }

  if (!Number.isFinite(totalMs) || totalMs < 0 || (!allowZero && totalMs <= 0)) {
    throw new UsageError(
      `invalid ${flagName} '${raw}' (expected a ${allowZero ? 'non-negative' : 'positive'} duration)`
    );
  }
  return Math.round(totalMs);
}
