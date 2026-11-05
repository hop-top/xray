import { assertPatternLengths, compileMatchers, MAX_PATTERN_LENGTH, MAX_PATTERNS, quotePattern } from '../../src/lib/path-match';
import { mergeConfig } from '../../src/lib/config';
import { UsageError } from '../../src/lib/error/types';

const ok = 'a'.repeat(MAX_PATTERN_LENGTH);
const over = 'a'.repeat(MAX_PATTERN_LENGTH + 1);

describe('match pattern length cap', () => {
  it('accepts exactly the limit', () => {
    expect(() => compileMatchers([ok])).not.toThrow();
  });

  it('compileMatchers rejects over the limit, negations included', () => {
    expect(() => compileMatchers([over])).toThrow(UsageError);
    expect(() => compileMatchers(['!' + over])).toThrow(UsageError);
  });

  it('names the source and the length', () => {
    expect(() => assertPatternLengths([over], '--match')).toThrow(/--match: pattern is 1025 characters/);
  });

  it('mergeConfig names --match for CLI patterns', () => {
    expect(() => mergeConfig(null, { match: [over] })).toThrow(/^--match:/);
  });

  it('mergeConfig names the config for config patterns', () => {
    expect(() => mergeConfig({ match: [over] } as any, {})).toThrow(/"match" in .*: pattern is 1025/);
  });

  it('a CLI --match replaces an over-long config pattern', () => {
    expect(() => mergeConfig({ match: [over] } as any, { match: ['src/**'] })).not.toThrow();
  });
});

describe('match pattern count cap', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}/*.ts`);

  it('accepts MAX_PATTERNS, rejects one more (compileMatchers)', () => {
    expect(MAX_PATTERNS).toBe(256);
    expect(() => compileMatchers(many(256))).not.toThrow();
    expect(() => compileMatchers(many(257))).toThrow(UsageError);
    expect(() => compileMatchers(many(257))).toThrow(/257 patterns, over the 256 limit/);
  });

  it('mergeConfig: 256 ok / 257 rejected, from the CLI and from config', () => {
    expect(() => mergeConfig(null, { match: many(256) })).not.toThrow();
    expect(() => mergeConfig(null, { match: many(257) })).toThrow(/^--match: 257 patterns/);
    expect(() => mergeConfig({ match: many(256) } as any, {})).not.toThrow();
    expect(() => mergeConfig({ match: many(257) } as any, {})).toThrow(/"match" in .*: 257 patterns/);
  });

  it('worst case within the limits stays fast: 256 x 1024-char patterns, 4096-char path', () => {
    const pats = Array.from({ length: 256 }, () => '*a'.repeat(511) + '*');
    const path = 'a'.repeat(4096);
    const t = Date.now();
    expect(compileMatchers(pats)(path)).toBe(true);
    const nope = compileMatchers(pats.map((p) => p + 'b'));
    expect(nope(path)).toBe(false);
    const ms = Date.now() - t;
    // eslint-disable-next-line no-console
    console.log(`worst case 256x1024 vs 4096: ${ms}ms`);
    expect(ms).toBeLessThan(30_000);
  }, 60_000);
});

describe('config match shape', () => {
  const bad: Array<[string, unknown, RegExp]> = [
    ['a bare string', '*.ts', /got string/],
    ['a number', 7, /got number/],
    ['null', null, /got null/],
    ['an object', { a: 1 }, /got object/],
    ['an array with a number', ['*.ts', 3], /array holding number/],
    ['an array with null', [null], /array holding null/],
  ];

  it.each(bad)('top level: %s is a usage error naming the file', (_n, v, msg) => {
    expect(() => mergeConfig({ match: v } as any, {})).toThrow(UsageError);
    expect(() => mergeConfig({ match: v } as any, {})).toThrow(msg);
    expect(() => mergeConfig({ match: v } as any, {})).toThrow(/"match" in .*must be an array of strings/);
  });

  it.each(bad)('lens: %s', (_n, v, msg) => {
    const cfg = { lenses: { l: { match: v } } } as any;
    expect(() => mergeConfig(cfg, {}, 'l')).toThrow(msg);
    expect(() => mergeConfig(cfg, {}, 'l')).toThrow(/lenses\.l\.match/);
  });

  it.each(bad)('scope: %s', (_n, v, msg) => {
    const cfg = { scopes: { s: { match: v } } } as any;
    expect(() => mergeConfig(cfg, {})).toThrow(msg);
    expect(() => mergeConfig(cfg, {})).toThrow(/scopes\.s\.match/);
  });

  it('absent and valid arrays pass', () => {
    expect(() => mergeConfig({} as any, {})).not.toThrow();
    expect(() => mergeConfig({ match: [] } as any, {})).not.toThrow();
  });
});

describe('quotePattern', () => {
  it('escapes ESC, newline, DEL and C1 controls; truncates', () => {
    const q = quotePattern('\u001b[2J\nx\u007f\u009b' + 'z'.repeat(100));
    // eslint-disable-next-line no-control-regex
    expect(q).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(q).toContain('\\u001b[2J');
    expect(q).toContain('\\n');
    expect(q.length).toBeLessThan(80);
  });

  it('the over-length error does not echo the pattern raw', () => {
    const p = '\u001b[2J\n' + 'a'.repeat(1100);
    try {
      assertPatternLengths([p], '--match');
      throw new Error('should throw');
    } catch (e: any) {
      // eslint-disable-next-line no-control-regex
      expect(e.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(e.message.length).toBeLessThan(200);
    }
  });
});
