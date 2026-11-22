/**
 * Pure output guardrail utilities for bounding line length, pagination windows,
 * and total UTF-8 byte size.
 */

export interface TruncatedText {
  text: string;
  truncated: boolean;
}

export interface WindowSliceOptions {
  offset?: number;
  limit?: number;
  maxLimit?: number;
}

export interface WindowSliceResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Truncate a single line to at most `maxChars` characters, appending
 * `… [truncated N chars]` when exceeded.
 */
export function truncateLine(line: string, maxChars = 500): TruncatedText {
  const cap = Math.max(0, maxChars);
  if (line.length <= cap) {
    return { text: line, truncated: false };
  }
  const omitted = line.length - cap;
  return {
    text: `${line.slice(0, cap)}… [truncated ${omitted} chars]`,
    truncated: true,
  };
}

/**
 * Slice an array into a bounded window with offset/limit clamping.
 */
export function windowSlice<T>(
  items: readonly T[],
  opts: WindowSliceOptions = {}
): WindowSliceResult<T> {
  const offset = Math.max(0, opts.offset ?? 0);
  const maxLimit = Math.max(1, opts.maxLimit ?? 500);
  const limit = Math.min(Math.max(0, opts.limit ?? 100), maxLimit);
  const sliced = items.slice(offset, offset + limit);
  const hasMore = offset + sliced.length < items.length;

  return {
    items: sliced,
    total: items.length,
    offset,
    limit,
    hasMore,
  };
}

/**
 * Cap a string to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte UTF-8 character.
 */
export function capOutputBytes(text: string, maxBytes = 128_000): TruncatedText {
  const cap = Math.max(0, maxBytes);
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= cap) {
    return { text, truncated: false };
  }

  let end = cap;
  // Walk back past any UTF-8 continuation bytes (10xxxxxx) and the leading
  // byte of an incomplete multi-byte sequence so we never emit U+FFFD.
  if (end > 0 && (buf[end] & 0xc0) === 0x80) {
    while (end > 0 && (buf[end] & 0xc0) === 0x80) {
      end--;
    }
  }

  return {
    text: buf.subarray(0, end).toString('utf8'),
    truncated: true,
  };
}
