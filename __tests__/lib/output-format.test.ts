import { resolveFormatFlags } from '../../src/lib/output-format';
import { UsageError, EXIT_USAGE } from '../../src/lib/error/types';

describe('resolveFormatFlags', () => {
  test('nothing selected -> both axes undefined', () => {
    expect(resolveFormatFlags({})).toEqual({ format: undefined });
  });

  test.each(['txt', 'csv', 'xml', 'json'] as const)('legacy --%s alias', f => {
    expect(resolveFormatFlags({ [f]: true }).format).toBe(f);
  });

  test('--format selects data format, case-insensitive', () => {
    expect(resolveFormatFlags({ format: 'JSON' })).toEqual({ format: 'json' });
  });

  test.each(['mermaid', 'dot'])('--format %s is a usage error listing valid formats', f => {
    let err: any;
    try { resolveFormatFlags({ format: f }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toBe(`invalid --format '${f}' (expected one of: txt, csv, xml, json)`);
  });

  test.each(['mermaid', 'dot'])('--%s legacy flag no longer selects anything', f => {
    expect(resolveFormatFlags({ [f]: true } as any)).toEqual({ format: undefined });
  });

  test('--format wins over a legacy flag on the same axis', () => {
    expect(resolveFormatFlags({ format: 'csv', json: true }).format).toBe('csv');
  });

  test('two legacy flags on one axis -> UsageError (exit 2)', () => {
    for (const opts of [{ json: true, csv: true }, { xml: true, txt: true }]) {
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
