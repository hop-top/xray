import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rootFingerprint } from '../src/lib/cache/graph-cache';
import { pythonImportBindings } from '../src/lib/parser/import-bindings';

const BIN = path.resolve(__dirname, '..', 'bin', 'xray');

let work: string;

const write = (rel: string, body: string) => {
  const full = path.join(work, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};

function mapGraph(...roots: string[]) {
  const out = path.join(work, `g-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(
    process.execPath,
    [BIN, '--no-telemetry', 'map', '--skip-detect', ...roots.flatMap(p => ['-p', p]), '--format', 'json', '-o', out],
    {
      cwd: work,
      encoding: 'utf-8',
      env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0', XDG_CONFIG_HOME: path.join(work, '.xdg') },
      timeout: 120_000,
    },
  );
  expect(r.status).toBe(0);
  return JSON.parse(fs.readFileSync(out, 'utf-8'));
}

const crossEdges = (g: any) =>
  g.edges
    .filter((e: any) => e.crossRoot === true)
    .map((e: any) => `${e.source} -> ${e.target} ${e.type} ${e.confidence}`)
    .sort();

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cross-poly-'));

  // TypeScript: tsconfig.json paths (with JSONC comments + trailing commas) & references
  write('ts_lib/package.json', JSON.stringify({ name: '@poly/ts-lib', version: '1.0.0' }));
  write('ts_lib/tsconfig.json', JSON.stringify({ compilerOptions: { composite: true } }));
  write('ts_lib/src/math.ts', 'export function multiply(a: number, b: number) { return a * b; }\n');
  write('ts_lib/src/extra.ts', 'export function unused() { return 0; }\n');

  write(
    'ts_app/tsconfig.json',
    `{
      // JSONC line comment
      "compilerOptions": {
        "baseUrl": ".",
        /* JSONC block comment */
        "paths": {
          "@lib/*": ["../ts_lib/src/*"],
        },
      },
      "references": [
        { "path": "../ts_lib" },
      ],
    }`,
  );
  write(
    'ts_app/src/main.ts',
    "import { multiply } from '@lib/math';\nexport function run() {\n  return multiply(3, 4);\n}\n",
  );

  // Rust: Cargo.toml package name normalization (- -> _) and [dependencies.<crate>].path
  write(
    'rs_lib/Cargo.toml',
    '[package]\nname = "my-core"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  write(
    'rs_lib/src/lib.rs',
    'pub fn compute(x: i32) -> i32 {\n    x + 1\n}\n',
  );
  write(
    'rs_app/Cargo.toml',
    '[package]\nname = "rs-app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies.my-core]\npath = "../rs_lib"\n',
  );
  write(
    'rs_app/src/main.rs',
    'use my_core::compute;\n\nfn main() {\n    compute(41);\n}\n',
  );

  // Python: pyproject.toml [project].name + src/ package layout
  write(
    'py_lib/pyproject.toml',
    '[project]\nname = "py-utils"\nversion = "0.1.0"\n',
  );
  write('py_lib/src/py_utils/__init__.py', '');
  write(
    'py_lib/src/py_utils/helpers.py',
    'def greet(name):\n    return f"hi {name}"\n',
  );
  write(
    'py_app/pyproject.toml',
    '[project]\nname = "py-app"\nversion = "0.1.0"\n',
  );
  write(
    'py_app/app.py',
    'from py_utils.helpers import greet\n\ndef run():\n    return greet("world")\n',
  );
});

afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('polyglot cross-root resolution', () => {
  test('TypeScript: tsconfig.json paths & references emit EXTRACTED crossRoot imports and calls', () => {
    const g = mapGraph('ts_lib', 'ts_app');
    expect(crossEdges(g)).toEqual([
      'ts_app/src/main.ts -> ts_lib/src/math.ts imports EXTRACTED',
      'ts_app/src/main.ts::run -> ts_lib/src/math.ts::multiply calls EXTRACTED',
    ]);
  });

  test('Rust: Cargo.toml path dep emits EXTRACTED crossRoot imports and calls', () => {
    const g = mapGraph('rs_lib', 'rs_app');
    expect(crossEdges(g)).toEqual([
      'rs_app/src/main.rs -> rs_lib/src/lib.rs imports EXTRACTED',
      'rs_app/src/main.rs::main -> rs_lib/src/lib.rs::compute calls EXTRACTED',
    ]);
  });

  test('Python: pyproject.toml package import emits EXTRACTED crossRoot imports and calls', () => {
    const g = mapGraph('py_lib', 'py_app');
    expect(crossEdges(g)).toEqual([
      'py_app/app.py -> py_lib/src/py_utils/helpers.py imports EXTRACTED',
      'py_app/app.py::run -> py_lib/src/py_utils/helpers.py::greet calls EXTRACTED',
    ]);
  });

  test('pythonImportBindings parses from-import and module import', () => {
    expect(pythonImportBindings('from pkg.mod import a, b as c')).toEqual(new Set(['a', 'c']));
    expect(pythonImportBindings('from pkg.mod import *')).toBeNull();
    expect(pythonImportBindings('import pkg.mod')).toBeNull();
    expect(pythonImportBindings(undefined)).toBeNull();
  });

  test('rootFingerprint invalidates when Cargo.toml or pyproject.toml changes', () => {
    const rsBefore = rootFingerprint(path.join(work, 'rs_lib'));
    write('rs_lib/Cargo.toml', '[package]\nname = "my-core"\nversion = "0.2.0"\nedition = "2021"\n');
    const rsAfter = rootFingerprint(path.join(work, 'rs_lib'));
    expect(rsAfter).not.toBe(rsBefore);

    const pyBefore = rootFingerprint(path.join(work, 'py_lib'));
    write('py_lib/pyproject.toml', '[project]\nname = "py-utils"\nversion = "0.2.0"\n');
    const pyAfter = rootFingerprint(path.join(work, 'py_lib'));
    expect(pyAfter).not.toBe(pyBefore);
  });
});
