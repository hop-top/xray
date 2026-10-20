import { resolveFormatFlags } from '../../src/lib/output-format';
import { UsageError, EXIT_USAGE } from '../../src/lib/error/types';

describe('resolveFormatFlags', () => {
  test('nothing selected -> both axes undefined', () => {
    expect(resolveFormatFlags({})).toEqual({ format: undefined, diagram: undefined });
  });

  test.each(['txt', 'csv', 'xml', 'json'] as const)('legacy --%s alias', f => {
    expect(resolveFormatFlags({ [f]: true }).format).toBe(f);
  });

  test.each(['mermaid', 'dot'] as const)('legacy --%s alias', d => {
    expect(resolveFormatFlags({ [d]: true }).diagram).toBe(d);
  });

  test('--format selects data format or diagram, case-insensitive', () => {
    expect(resolveFormatFlags({ format: 'JSON' })).toEqual({ format: 'json', diagram: undefined });
    expect(resolveFormatFlags({ format: 'dot' })).toEqual({ format: undefined, diagram: 'dot' });
  });

  test('axes combine (--csv --dot)', () => {
    expect(resolveFormatFlags({ csv: true, dot: true })).toEqual({ format: 'csv', diagram: 'dot' });
  });

  test('--format wins over a legacy flag on the same axis', () => {
    expect(resolveFormatFlags({ format: 'csv', json: true }).format).toBe('csv');
    expect(resolveFormatFlags({ format: 'dot', mermaid: true }).diagram).toBe('dot');
  });

  test('two legacy flags on one axis -> UsageError (exit 2)', () => {
    for (const opts of [{ json: true, csv: true }, { xml: true, txt: true }, { mermaid: true, dot: true }]) {
      let err: any;
      try { resolveFormatFlags(opts); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(UsageError);
      expect(err.exitCode).toBe(EXIT_USAGE);
    }
  });

  test('unknown --format value -> UsageError naming the choices', () => {
    expect(() => resolveFormatFlags({ format: 'yaml' })).toThrow(/invalid --format 'yaml'.*json/);
  });
});
