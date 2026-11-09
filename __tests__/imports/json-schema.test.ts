import { SUPPORTED_KEYWORDS, validate } from '../support/json-schema';

// The dev-only validator covers exactly the keywords the shipped schemas use
// and refuses any other keyword, so a schema edit cannot be silently ignored.

const ok = (schema: object, data: unknown, opts = {}) =>
  expect(validate(schema, data, opts)).toEqual([]);
const bad = (schema: object, data: unknown, opts = {}) =>
  expect(validate(schema, data, opts).length).toBeGreaterThan(0);

describe('json-schema validator', () => {
  it('rejects unknown keywords instead of ignoring them', () => {
    expect(() => validate({ type: 'object', patternProperties: {} }, {})).toThrow(/patternProperties/);
    expect(() => validate({ properties: { a: { format: 'email' } } }, {})).toThrow(/format/);
  });

  it('rejects non-local $ref', () => {
    expect(() => validate({ $ref: 'other.json#/x' }, 1)).toThrow(/\$ref/);
    expect(() => validate({ $ref: '#/$defs/missing' }, 1)).toThrow(/missing/);
  });

  it('type: single, union, integer vs number, null, array', () => {
    ok({ type: 'integer' }, 3);
    bad({ type: 'integer' }, 3.5);
    ok({ type: 'number' }, 3.5);
    ok({ type: ['string', 'null'] }, null);
    bad({ type: ['string', 'null'] }, 1);
    bad({ type: 'object' }, []);
    ok({ type: 'array' }, []);
    bad({ type: 'array' }, {});
    ok({ type: 'boolean' }, false);
    bad({ type: 'string' }, null);
  });

  it('enum and const (deep equality)', () => {
    ok({ enum: ['a', 'b'] }, 'b');
    bad({ enum: ['a', 'b'] }, 'c');
    ok({ const: 'x' }, 'x');
    bad({ const: 'x' }, 'y');
    ok({ const: { a: [1] } }, { a: [1] });
    bad({ const: { a: [1] } }, { a: [2] });
  });

  it('minimum, minLength, maxLength (code points), pattern', () => {
    ok({ minimum: 1 }, 1);
    bad({ minimum: 1 }, 0);
    ok({ minLength: 1 }, 'a');
    bad({ minLength: 1 }, '');
    ok({ maxLength: 2 }, '\u{1F600}\u{1F600}'); // 2 code points, 4 UTF-16 units
    bad({ maxLength: 2 }, 'abc');
    ok({ pattern: '^[0-9a-f]{4}$' }, 'beef');
    bad({ pattern: '^[0-9a-f]{4}$' }, 'BEEF');
  });

  it('properties, required, additionalProperties (false / schema)', () => {
    const s = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
    ok(s, { a: 'x' });
    bad(s, {});
    bad(s, { a: 1 });
    ok(s, { a: 'x', extra: 1 }); // open by default (JSON Schema semantics)
    bad({ ...s, additionalProperties: false }, { a: 'x', extra: 1 });
    ok({ type: 'object', additionalProperties: { type: 'integer' } }, { x: 1, y: 2 });
    bad({ type: 'object', additionalProperties: { type: 'integer' } }, { x: 'no' });
  });

  it('noUndeclared: extra keys fail where properties are declared and additionalProperties is absent', () => {
    const s = { type: 'object', properties: { a: { type: 'string' } } };
    bad(s, { a: 'x', extra: 1 }, { noUndeclared: true });
    ok({ type: 'object', additionalProperties: { type: 'integer' } }, { x: 1 }, { noUndeclared: true });
  });

  it('items applies to every element', () => {
    ok({ type: 'array', items: { type: 'integer' } }, [1, 2]);
    bad({ type: 'array', items: { type: 'integer' } }, [1, 'x']);
  });

  it('oneOf requires exactly one match', () => {
    const s = {
      oneOf: [
        { type: 'object', required: ['file'] },
        { type: 'object', required: ['dir'] },
      ],
    };
    ok(s, { file: 'a' });
    ok(s, { dir: 'a' });
    bad(s, {});
    bad(s, { file: 'a', dir: 'b' });
  });

  it('$ref resolves local $defs', () => {
    const s = { $defs: { n: { type: 'integer' } }, type: 'array', items: { $ref: '#/$defs/n' } };
    ok(s, [1]);
    bad(s, ['x']);
  });

  it('reports the instance path of each error', () => {
    const s = { type: 'object', properties: { a: { type: 'array', items: { type: 'integer' } } } };
    expect(validate(s, { a: [1, 'x'] })[0].path).toBe('/a/1');
  });

  it('keyword list is the documented closed set', () => {
    expect([...SUPPORTED_KEYWORDS].sort()).toEqual(
      [
        '$defs', '$id', '$ref', '$schema', 'additionalProperties', 'const', 'description',
        'enum', 'items', 'maxLength', 'minLength', 'minimum', 'oneOf', 'pattern',
        'properties', 'required', 'title', 'type',
      ].sort()
    );
  });
});
