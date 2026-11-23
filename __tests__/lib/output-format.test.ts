import { resolveFormatFlags } from '../../src/lib/output-format';
import { UsageError, EXIT_USAGE } from '../../src/lib/error/types';

describe('resolveFormatFlags', () => {
  test('nothing selected -> undefined', () => {
    expect(resolveFormatFlags({})).toEqual({});
  });

  test('--format selects data format, case-insensitive', () => {
    expect(resolveFormatFlags({ format: 'JSON' })).toEqual({ format: 'json' });
    expect(resolveFormatFlags({ format: 'CSV' })).toEqual({ format: 'csv' });
    expect(resolveFormatFlags({ format: 'XML' })).toEqual({ format: 'xml' });
    expect(resolveFormatFlags({ format: 'TXT' })).toEqual({ format: 'txt' });
  });

  test('--format dot or mermaid is a usage error listing valid formats', () => {
    for (const bad of ['dot', 'mermaid', 'yaml']) {
      let err: any;
      try { resolveFormatFlags({ format: bad }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(UsageError);
      expect(err.exitCode).toBe(EXIT_USAGE);
      expect(err.message).toBe(`invalid --format '${bad}' (expected one of: txt, csv, xml, json)`);
    }
  });
});
