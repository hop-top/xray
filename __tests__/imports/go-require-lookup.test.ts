/**
 * Go `require` lookup: the longest require module path that is the import
 * path or a `/`-prefix of it, found by probing the path's prefixes
 * (longest first) instead of scanning every require per record. Work is
 * O(records x path depth), independent of the number of requires.
 */
import { goResolver, type GoResolveStats } from '../../src/lib/imports/resolve/go';
import { FileSet } from '../../src/lib/imports/resolve/context';
import type { ImportRecord } from '../../src/lib/imports';

const rec = (module: string): ImportRecord => ({
  line: 1, column: 1, endLine: 1, endColumn: 2, kind: 'static', form: 'import',
  module, normalized: module, locality: 'unknown', confidence: 'syntactic', evidence: module,
});

function setup(requires: string[]) {
  const mod = `module ex.com/app\n\nrequire (\n${requires.map(r => `\t${r} v1.0.0\n`).join('')})\n`;
  const stats: GoResolveStats = { requireProbes: 0 };
  const resolve = goResolver(new FileSet([{ path: 'go.mod', content: mod }, { path: 'main.go', content: '' }]), stats);
  return { stats, resolve: (m: string) => resolve(rec(m), 'main.go') };
}

describe('go require lookup', () => {
  it('longest require wins, by whole path segments', () => {
    const { resolve } = setup(['github.com/x/y', 'github.com/x/y/v2', 'github.com/x/yz', 'example.com/a']);
    expect(resolve('github.com/x/y/v2/pkg')).toEqual({ package: 'github.com/x/y/v2', locality: 'external' });
    expect(resolve('github.com/x/y/v3')).toEqual({ package: 'github.com/x/y', locality: 'external' });
    expect(resolve('github.com/x/y')).toEqual({ package: 'github.com/x/y', locality: 'external' });
    expect(resolve('github.com/x/yz/q')).toEqual({ package: 'github.com/x/yz', locality: 'external' });
    expect(resolve('github.com/x/yy')).toBeUndefined();
    expect(resolve('example.com/ab')).toBeUndefined();
    expect(resolve('example.com/a//b')).toEqual({ package: 'example.com/a', locality: 'external' });
    expect(resolve('fmt')).toEqual({ package: 'fmt', locality: 'stdlib' });
  });

  it('work linear in records x requires scaled together (n and 4n)', () => {
    const probes = (n: number) => {
      const { stats, resolve } = setup(Array.from({ length: n }, (_, i) => `example.com/r${i}/m`));
      // Worst case for a scan: no record matches any require.
      for (let i = 0; i < n; i++) resolve(`example.com/x/p${i}/q`);
      return stats.requireProbes;
    };
    const small = probes(500);
    const large = probes(2000);
    expect(small).toBeGreaterThan(0);
    // Linear: ~4x; a per-record scan of the requires is ~16x.
    expect(large / small).toBeLessThanOrEqual(5);
  });
});
