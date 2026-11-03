import { ParserManager } from '../../src/lib/parser/manager';

/**
 * Map/graph imports for contract languages come from the imports contract
 * extractor (one reader): legacy `{file, source, text}` entries plus the
 * additive `line` (0-based, graph convention) and `kind`.
 */
describe('ParserManager imports from the contract extractor', () => {
  const manager = new ParserManager('/root');
  const imports = async (file: string, code: string) => (await manager.parse(file, code)).imports;

  it('Python: aliased imports are listed, alias kept', async () => {
    const got = await imports('a.py', 'import os.path as osp, sys\nfrom .b import x as y\n');
    expect(got).toEqual([
      { file: 'a.py', source: 'os.path', text: 'import os.path as osp, sys', alias: 'osp', line: 0, kind: 'static' },
      { file: 'a.py', source: 'sys', text: 'import os.path as osp, sys', line: 0, kind: 'static' },
      { file: 'a.py', source: '.b', text: 'from .b import x as y', line: 1, kind: 'static' },
    ]);
  });

  it('PHP: grouped use, double-quoted and parenthesised require/include', async () => {
    const got = await imports('t.php', '<?php\nuse App\\{A, B as C};\nrequire "a.php";\ninclude_once("u.php");\n');
    expect(got.map(i => [i.source, i.kind, i.line])).toEqual([
      ['App\\A', 'static', 1],
      ['App\\B', 'static', 1],
      ['a.php', 'require', 2],
      ['u.php', 'include', 3],
    ]);
  });

  it('Go: raw-string import paths are unquoted, aliases kept', async () => {
    const got = await imports('g.go', 'package main\nimport (\n  x `example.com/raw`\n  . "fmt"\n)\n');
    expect(got.map(i => [i.source, i.alias])).toEqual([['example.com/raw', 'x'], ['fmt', '.']]);
  });

  it('TS/JS: require, export-from and import() are listed', async () => {
    const got = await imports('t.ts', "import fs from 'fs';\nexport * from './e';\nconst u = require('util');\nimport('./d');\n");
    expect(got.map(i => [i.source, i.kind])).toEqual([
      ['fs', 'static'], ['./e', 'static'], ['util', 'require'], ['./d', 'dynamic'],
    ]);
  });

  it('Rust: one entry per use-tree leaf, `mod` declarations, no path-root references', async () => {
    const got = await imports('m.rs', 'use std::{fmt, io::Read as R};\nmod foo;\nfn f() { serde_json::to_string(&1); }\n');
    expect(got.map(i => [i.source, i.kind, i.alias])).toEqual([
      ['std::fmt', 'static', undefined],
      ['std::io::Read', 'static', 'R'],
      ['foo', 'include', undefined],
    ]);
  });

  it('text is the collapsed statement evidence', async () => {
    const got = await imports('m.py', 'from pkg import (\n    a,\n    b,\n)\n');
    expect(got[0].text).toBe('from pkg import ( a, b, )');
  });

  it('returns the contract records for the graph resolution pass', async () => {
    const { records } = await manager.parse('m.rs', 'mod foo;\nfn f() { serde_json::to_string(&1); }\n');
    expect(records?.map(r => [r.kind, r.form, r.module])).toEqual([
      ['include', 'mod', 'foo'],
      ['reference', 'path-root', 'serde_json'],
    ]);
  });

  it('Python calls: an aliased stdlib module is a builtin receiver', async () => {
    const { tags } = await manager.parse('a.py', 'import os.path as osp\n\ndef run():\n    return osp.join("a")\n');
    expect(tags.find(t => t.name === 'run')?.references).toEqual([]);
  });

  it('Python calls: __import__ binds no module name', async () => {
    const { tags } = await manager.parse('a.py', 'm = __import__("helpers")\n\ndef run():\n    return helpers.go()\n');
    expect(tags.find(t => t.name === 'run')?.references).toEqual(['.go']);
  });

  it('non-contract languages keep the query captures', async () => {
    const { imports: got, records } = await manager.parse('T.java', 'package p;\nimport java.util.List;\n');
    expect(got.map(i => i.source)).toEqual(['java.util.List']);
    expect(records).toBeUndefined();
  });
});
