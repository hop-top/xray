import ReactStrategy from '../../strategies/react';
import RestApiStrategy from '../../strategies/rest-api';

// Worst-case inputs for the regex fallbacks: many openers, never a closer.
// Linear work => 4x input costs ~4x; quadratic => ~16x. Best-of-N and a wide
// margin (limit 9x) keep this stable on a loaded machine.
const SMALL = 20_000;
const LARGE = 80_000;
const LIMIT = 9;

function bestOf(n: number, fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = process.hrtime.bigint();
    fn();
    best = Math.min(best, Number(process.hrtime.bigint() - t));
  }
  return best;
}

function ratio(build: (size: number) => string, run: (s: string) => void): number {
  const a = build(SMALL);
  const b = build(LARGE);
  run(a); // warm up
  return bestOf(3, () => run(b)) / Math.max(bestOf(3, () => run(a)), 1);
}

const fill = (unit: string) => (size: number) => unit.repeat(Math.ceil(size / unit.length));

describe('regex fallbacks scale linearly', () => {
  const react = new ReactStrategy() as any;
  const analyze = (s: string) => react.analyzeWithRegex('<div/>' + s, [], {});

  it.each([
    ['function component', 'function A('],
    ['function hook', 'function useA('],
    ['arrow component', 'const A = ('],
    ['arrow hook', 'const useA = ('],
  ])('react %s without closing paren', (_n, unit) => {
    expect(ratio(fill(unit), analyze)).toBeLessThan(LIMIT);
  });

  const rest = new RestApiStrategy() as any;
  const go = (s: string) => rest.detectGoHTTPHandlers(s);

  it('rest-api HandleFunc chain without closing paren', () => {
    expect(ratio(fill('r.HandleFunc("/p", h'), go)).toBeLessThan(LIMIT);
  });

  it('rest-api unterminated path string', () => {
    expect(ratio(fill('r.HandleFunc("/p'), go)).toBeLessThan(LIMIT);
  });

  it('still detects normal input', () => {
    const tags: string[] = [];
    const meta: Record<string, any> = {};
    react.analyzeWithRegex('<div/>\nexport function Foo(props) { return <div/>; }\nconst useX = (a) => a;', tags, meta);
    expect(meta.componentName).toBe('Foo');
    expect(meta.hookName).toBe('useX');
    expect(go('r.HandleFunc("/u", h).Methods("GET")\nr.HandleFunc("/v", h)')).toEqual([
      { method: 'GET', path: '/u' },
      { method: '', path: '/v' },
    ]);
  });
});
