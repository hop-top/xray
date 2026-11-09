// Minimal JSON Schema (2020-12) validator for the schemas this repo ships.
//
// Implements exactly SUPPORTED_KEYWORDS with 2020-12 semantics and throws on
// any other keyword, so a schema that grows a keyword this validator does not
// understand fails loudly instead of validating less. Dev-only; replace with
// ajv (ajv/dist/2020) once it is a vetted devDependency.
//
// `noUndeclared` is a stricter-than-spec mode for xray's own output: an
// object schema with `properties` and no `additionalProperties` rejects
// undeclared keys. Consumers validate without it (unknown fields allowed).

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type SchemaObject = Record<string, any>;
type Schema = SchemaObject | boolean;

export interface SchemaError { path: string; message: string }
export interface ValidateOptions { noUndeclared?: boolean }

export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  // annotations / structure
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  // assertions / applicators
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties',
  'items', 'minimum', 'minLength', 'maxLength', 'pattern', 'oneOf',
]);

const SCHEMA_MAPS = new Set(['properties', '$defs']);
const SCHEMA_VALUES = new Set(['items', 'additionalProperties']);

function check(schema: Schema, root: SchemaObject, at: string): void {
  if (typeof schema === 'boolean') return;
  for (const [k, v] of Object.entries(schema)) {
    if (!SUPPORTED_KEYWORDS.has(k)) throw new Error(`unsupported schema keyword "${k}" at ${at || '/'}`);
    if (k === '$ref') resolveRef(root, v);
    if (SCHEMA_MAPS.has(k)) for (const [n, s] of Object.entries(v)) check(s as Schema, root, `${at}/${k}/${n}`);
    if (SCHEMA_VALUES.has(k) && typeof v === 'object') check(v, root, `${at}/${k}`);
    if (k === 'oneOf') (v as Schema[]).forEach((s, i) => check(s, root, `${at}/oneOf/${i}`));
  }
}

function resolveRef(root: SchemaObject, ref: string): Schema {
  const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref "${ref}" (only #/$defs/<name>)`);
  const target = root.$defs?.[m[1]];
  if (target === undefined) throw new Error(`$ref "${ref}": missing definition`);
  return target;
}

function typeOf(v: Json): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function hasType(v: Json, t: string): boolean {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  return typeOf(v) === t;
}

function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b) || typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    const bb = b as Json[];
    return a.length === bb.length && a.every((x, i) => equal(x, bb[i]));
  }
  const ao = a as Record<string, Json>, bo = b as Record<string, Json>;
  const ak = Object.keys(ao), bk = Object.keys(bo);
  return ak.length === bk.length && ak.every(k => k in bo && equal(ao[k], bo[k]));
}

function run(s: Schema, v: Json, root: SchemaObject, at: string, opts: ValidateOptions, out: SchemaError[]): void {
  if (s === true) return;
  if (s === false) { out.push({ path: at, message: 'not allowed' }); return; }
  const err = (message: string) => out.push({ path: at || '/', message });

  if (s.$ref !== undefined) run(resolveRef(root, s.$ref), v, root, at, opts, out);

  if (s.type !== undefined) {
    const ts: string[] = Array.isArray(s.type) ? s.type : [s.type];
    if (!ts.some(t => hasType(v, t))) err(`expected type ${ts.join('|')}, got ${typeOf(v)}`);
  }
  if (s.enum !== undefined && !(s.enum as Json[]).some(e => equal(e, v))) {
    err(`must be one of ${JSON.stringify(s.enum)}`);
  }
  if (s.const !== undefined && !equal(s.const, v)) err(`must equal ${JSON.stringify(s.const)}`);

  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) err(`must be >= ${s.minimum}`);
  if (typeof v === 'string') {
    const len = [...v].length; // code points, per spec
    if (s.minLength !== undefined && len < s.minLength) err(`length must be >= ${s.minLength}`);
    if (s.maxLength !== undefined && len > s.maxLength) err(`length must be <= ${s.maxLength}`);
    if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(v)) err(`must match ${s.pattern}`);
  }

  if (Array.isArray(v) && s.items !== undefined) {
    v.forEach((x, i) => run(s.items, x, root, `${at}/${i}`, opts, out));
  }

  if (typeOf(v) === 'object') {
    const o = v as Record<string, Json>;
    for (const r of (s.required ?? []) as string[]) if (!(r in o)) err(`missing required property "${r}"`);
    const props: Record<string, Schema> = s.properties ?? {};
    for (const [k, x] of Object.entries(o)) {
      if (k in props) run(props[k], x, root, `${at}/${k}`, opts, out);
      else if (s.additionalProperties !== undefined) run(s.additionalProperties, x, root, `${at}/${k}`, opts, out);
      else if (opts.noUndeclared && s.properties !== undefined) {
        out.push({ path: `${at}/${k}`, message: 'undeclared property' });
      }
    }
  }

  if (s.oneOf !== undefined) {
    const n = (s.oneOf as Schema[]).filter(b => {
      const sub: SchemaError[] = [];
      run(b, v, root, at, opts, sub);
      return sub.length === 0;
    }).length;
    if (n !== 1) err(`must match exactly one oneOf branch (matched ${n})`);
  }
}

/** Validate `data` against `schema`; returns errors (empty = valid). Throws on unsupported schema. */
export function validate(schema: object, data: unknown, opts: ValidateOptions = {}): SchemaError[] {
  const root = schema as SchemaObject;
  check(root, root, '');
  const out: SchemaError[] = [];
  run(root, data as Json, root, '', opts, out);
  return out;
}
