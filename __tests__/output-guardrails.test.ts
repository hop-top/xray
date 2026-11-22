import { truncateLine, windowSlice, capOutputBytes } from '../src/lib/output-guardrails';

describe('output-guardrails', () => {
  describe('truncateLine', () => {
    it('returns line unchanged when within maxChars', () => {
      const res = truncateLine('hello world', 500);
      expect(res).toEqual({ text: 'hello world', truncated: false });
    });

    it('returns line unchanged when length equals maxChars', () => {
      const line = 'a'.repeat(500);
      const res = truncateLine(line);
      expect(res).toEqual({ text: line, truncated: false });
    });

    it('truncates lines exceeding maxChars and appends omitted count', () => {
      const line = 'x'.repeat(550);
      const res = truncateLine(line);
      expect(res.truncated).toBe(true);
      expect(res.text).toBe(`${'x'.repeat(500)}… [truncated 50 chars]`);
    });

    it('respects custom maxChars', () => {
      const res = truncateLine('abcdefghij', 4);
      expect(res).toEqual({ text: 'abcd… [truncated 6 chars]', truncated: true });
    });
  });

  describe('windowSlice', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);

    it('uses default limit=100 and offset=0', () => {
      const res = windowSlice(items, {});
      expect(res.items).toHaveLength(100);
      expect(res.items[0]).toBe(0);
      expect(res.items[99]).toBe(99);
      expect(res.total).toBe(250);
      expect(res.offset).toBe(0);
      expect(res.limit).toBe(100);
      expect(res.hasMore).toBe(true);
    });

    it('slices with custom offset and limit', () => {
      const res = windowSlice(items, { offset: 200, limit: 100 });
      expect(res.items).toHaveLength(50);
      expect(res.items[0]).toBe(200);
      expect(res.items[49]).toBe(249);
      expect(res.total).toBe(250);
      expect(res.offset).toBe(200);
      expect(res.limit).toBe(100);
      expect(res.hasMore).toBe(false);
    });

    it('clamps limit to maxLimit (default 500)', () => {
      const large = Array.from({ length: 600 }, (_, i) => i);
      const res = windowSlice(large, { limit: 1000 });
      expect(res.limit).toBe(500);
      expect(res.items).toHaveLength(500);
      expect(res.hasMore).toBe(true);
    });

    it('clamps limit to custom maxLimit and handles negative offset', () => {
      const res = windowSlice(items, { offset: -5, limit: 50, maxLimit: 20 });
      expect(res.offset).toBe(0);
      expect(res.limit).toBe(20);
      expect(res.items).toHaveLength(20);
      expect(res.hasMore).toBe(true);
    });
  });

  describe('capOutputBytes', () => {
    it('returns text unchanged when within maxBytes', () => {
      const res = capOutputBytes('short text', 128_000);
      expect(res).toEqual({ text: 'short text', truncated: false });
    });

    it('caps output to maxBytes without splitting multi-byte UTF-8 characters', () => {
      // Each emoji is 4 bytes in UTF-8
      const text = '🚀'.repeat(10); // 40 bytes
      const res = capOutputBytes(text, 10);
      expect(res.truncated).toBe(true);
      expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThanOrEqual(10);
      expect(res.text).toBe('🚀🚀'); // 8 bytes, no broken replacement char
      expect(res.text).not.toContain('\uFFFD');
    });

    it('defaults maxBytes to 128_000', () => {
      const text = 'a'.repeat(130_000);
      const res = capOutputBytes(text);
      expect(res.truncated).toBe(true);
      expect(Buffer.byteLength(res.text, 'utf8')).toBe(128_000);
    });
  });
});
