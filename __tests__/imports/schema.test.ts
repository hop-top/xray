import * as fs from 'fs';
import * as path from 'path';
import { validate } from '../support/json-schema';
import {
  CONFIDENCES,
  FILE_STATUSES,
  IMPORT_KINDS,
  IMPORTS_SCHEMA_ID,
  LOCALITIES,
  PARSE_ERROR_KINDS,
  POSITIONS,
  UNSUPPORTED_CONSTRUCTS,
  type FileImports,
  type ImportRecord,
  type ImportsDoc,
  type ParseError,
  type UnsupportedRecord,
} from '../../src/lib/imports/types';

// types.ts and the shipped schema are one contract: every closed enum and
// every declared field must match exactly, both ways.

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'xray.imports.v1.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const defs = schema.$defs;

// `Required<>` makes the compiler (typecheck:tests) demand every field of the
// interface; the runtime test then pins the key set to the schema.
const fullRecord: Required<ImportRecord> = {
  line: 2, column: 1, endLine: 2, endColumn: 32,
  kind: 'static', form: 'from', module: '..pkg.mod', normalized: 'app.pkg.mod',
  package: 'app', locality: 'local', relative: { level: 2, module: 'pkg.mod' },
  alias: 'm', names: [{ name: 'a', alias: 'b' }], wildcard: false, typeOnly: false,
  resolved: { file: 'src/app/pkg/mod.py' }, confidence: 'syntactic', occurrences: 1,
  evidence: 'from ..pkg.mod import a as b',
};
const fullUnsupported: Required<UnsupportedRecord> = {
  line: 5, column: 1, construct: 'dynamic-import',
  detail: '__import__ with non-literal argument', evidence: '__import__(name)',
};
const fullParseError: Required<ParseError> = {
  kind: 'error', start: { line: 3, column: 1 }, end: { line: 3, column: 13 },
};
const fullFile: Required<FileImports> = {
  path: 'pkg/mod.py', language: 'python', sha256: 'a'.repeat(64), status: 'parse-error',
  complete: false, parseErrors: [fullParseError], imports: [fullRecord], unsupported: [fullUnsupported],
};
const fullDoc: Required<ImportsDoc> = {
  schema: IMPORTS_SCHEMA_ID,
  xray: { version: '0.1.0', extractor: '0.1.0' },
  grammars: { python: { module: 'tree-sitter-python', version: '0.25.0', source: 'xray' } },
  root: '.',
  positions: POSITIONS,
  files: [fullFile],
  summary: { files: 1, complete: 0, imports: 1, unsupported: 1, parseErrors: 1 },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const errs = (doc: unknown) => validate(schema, doc, { noUndeclared: true });

describe('xray.imports/v1 schema', () => {
  it('is a 2020-12 schema whose payload id is pinned by const', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.properties.schema.const).toBe(IMPORTS_SCHEMA_ID);
    expect(IMPORTS_SCHEMA_ID).toBe('xray.imports/v1');
  });

  it.each([
    ['importKind', IMPORT_KINDS],
    ['locality', LOCALITIES],
    ['confidence', CONFIDENCES],
    ['fileStatus', FILE_STATUSES],
    ['construct', UNSUPPORTED_CONSTRUCTS],
    ['parseErrorKind', PARSE_ERROR_KINDS],
  ] as const)('enum %s equals types.ts', (name, values) => {
    expect(defs[name].enum).toEqual([...values]);
  });

  it('positions constants equal types.ts', () => {
    expect(defs.positions.properties.line.const).toBe(POSITIONS.line);
    expect(defs.positions.properties.column.const).toBe(POSITIONS.column);
  });

  it.each([
    ['importsDoc (root)', schema, fullDoc],
    ['fileImports', defs.fileImports, fullFile],
    ['importRecord', defs.importRecord, fullRecord],
    ['unsupportedRecord', defs.unsupportedRecord, fullUnsupported],
    ['parseError', defs.parseError, fullParseError],
  ])('%s declares exactly the fields of its TS type', (_n, s, sample) => {
    expect(Object.keys(s.properties).sort()).toEqual(Object.keys(sample).sort());
  });

  it('a fully populated document is valid', () => {
    expect(errs(fullDoc)).toEqual([]);
  });

  it('optional record fields may be omitted; normalized may be null', () => {
    const doc = clone(fullDoc);
    const r = doc.files[0].imports[0] as Partial<ImportRecord>;
    for (const k of ['package', 'relative', 'alias', 'names', 'wildcard', 'typeOnly', 'resolved', 'occurrences'] as const) {
      delete r[k];
    }
    r.normalized = null;
    delete (doc.files[0].unsupported[0] as Partial<UnsupportedRecord>).detail;
    expect(errs(doc)).toEqual([]);
  });

  it('resolved is exactly one of {file} or {dir}', () => {
    const doc = clone(fullDoc);
    doc.files[0].imports[0].resolved = { dir: 'internal/pkg' };
    expect(errs(doc)).toEqual([]);
    (doc.files[0].imports[0] as { resolved: unknown }).resolved = { file: 'a', dir: 'b' };
    expect(errs(doc)).not.toEqual([]);
  });

  const breaks: Array<[string, (d: any) => void]> = [
    ['wrong schema id', d => { d.schema = 'xray.imports/v2'; }],
    ['unknown kind', d => { d.files[0].imports[0].kind = 'heuristic'; }],
    ['unknown locality', d => { d.files[0].imports[0].locality = 'vendor'; }],
    ['unknown confidence', d => { d.files[0].imports[0].confidence = 'heuristic'; }],
    ['unknown status', d => { d.files[0].status = 'skipped'; }],
    ['unknown construct', d => { d.files[0].unsupported[0].construct = 'magic'; }],
    ['line 0', d => { d.files[0].imports[0].line = 0; }],
    ['fractional column', d => { d.files[0].imports[0].column = 1.5; }],
    ['missing module', d => { delete d.files[0].imports[0].module; }],
    ['missing normalized', d => { delete d.files[0].imports[0].normalized; }],
    ['missing complete', d => { delete d.files[0].complete; }],
    ['missing summary', d => { delete d.summary; }],
    ['bad sha256', d => { d.files[0].sha256 = 'XYZ'; }],
    ['evidence over 240 chars', d => { d.files[0].imports[0].evidence = 'x'.repeat(241); }],
    ['position convention changed', d => { d.positions.column = '0-based'; }],
    ['undeclared field (xray output must be declared)', d => { d.files[0].imports[0].bogus = 1; }],
    ['relative level 0', d => { d.files[0].imports[0].relative.level = 0; }],
  ];
  it.each(breaks)('rejects: %s', (_n, mutate) => {
    const doc = clone(fullDoc);
    mutate(doc);
    expect(errs(doc)).not.toEqual([]);
  });

  it('consumer view: unknown fields are tolerated without noUndeclared (additive-only v1)', () => {
    const doc = clone(fullDoc) as any;
    doc.files[0].imports[0].futureField = true;
    doc.futureTop = {};
    expect(validate(schema, doc)).toEqual([]);
  });
});

describe('imports contract doc', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'user', 'imports-contract.md'), 'utf8');

  it.each([
    ...IMPORT_KINDS, ...LOCALITIES, ...CONFIDENCES, ...FILE_STATUSES, ...UNSUPPORTED_CONSTRUCTS,
  ])('documents enum value `%s`', value => {
    expect(doc).toContain('`' + value + '`');
  });

  it('documents every field of the schema', () => {
    const fields = new Set<string>([
      ...Object.keys(schema.properties),
      ...Object.keys(defs.fileImports.properties),
      ...Object.keys(defs.importRecord.properties),
      ...Object.keys(defs.unsupportedRecord.properties),
      ...Object.keys(defs.parseError.properties),
    ]);
    for (const f of fields) expect(doc).toContain('`' + f + '`');
  });

  it('names the schema file shipped in the package', () => {
    expect(doc).toContain('schemas/xray.imports.v1.json');
  });
});
