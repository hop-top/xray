import { mergeConfig } from '../../src/lib/config';
import { withGraphFlow } from '../../src/commands/generate';

/**
 * `--with` on the command line decides cf/df: a config `features.cf/df`
 * never adds flow back (`graph --with cf` is cf only), while the other
 * features stay additive on top of config.
 */
const merged = (features: Record<string, boolean>, withFlags: string[]) =>
  [...mergeConfig({ features } as any, { with: withFlags }).with].sort();

describe('--with beats config for cf/df', () => {
  it('naming cf drops a config df, naming df drops a config cf', () => {
    expect(merged({ df: true }, ['cf'])).toEqual(['cf']);
    expect(merged({ cf: true }, ['df'])).toEqual(['df']);
    expect(merged({ cf: true, df: true }, ['cf'])).toEqual(['cf']);
  });

  it('naming both gives both', () => {
    expect(merged({}, ['cf', 'df'])).toEqual(['cf', 'df']);
  });

  it('without a cf/df in --with, config decides as before', () => {
    expect(merged({ cf: true, df: true }, [])).toEqual(['cf', 'df']);
    expect(merged({ cf: true }, ['docs'])).toEqual(['cf', 'docs']);
  });

  it('other features stay additive on top of config', () => {
    expect(merged({ vars: true, df: true }, ['cf', 'docs'])).toEqual(['cf', 'docs', 'vars']);
  });

  it('graph: with config df only, `graph --with cf` is cf only; bare `graph` is both', () => {
    const run = (w: string[]) => [...mergeConfig({ features: { df: true } } as any, withGraphFlow({ with: w })).with].sort();
    expect(run(['cf'])).toEqual(['cf']);
    expect(run([])).toEqual(['cf', 'df']);
    expect(run(['docs'])).toEqual(['cf', 'df', 'docs']);
  });
});
