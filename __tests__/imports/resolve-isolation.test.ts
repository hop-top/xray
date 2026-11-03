/**
 * Resolution pass isolation: a resolver exception on one file leaves that
 * file's records as extracted (no `resolved`, no resolution-derived
 * locality), marks it `complete: false` and lets the run continue. Nothing
 * of the failure reaches the document.
 */
import { extractImports, type ImportsSourceFile } from '../../src/lib/imports';
import { Logger } from '../../src/lib/logger';

type Fault = { file?: string; nth?: number; value: unknown; factory?: boolean } | undefined;
let fault: Fault;

jest.mock('../../src/lib/imports/resolve/python', () => {
  const actual = jest.requireActual('../../src/lib/imports/resolve/python');
  return {
    ...actual,
    pythonResolver: (files: unknown) => {
      if (fault?.factory) throw fault.value;
      const real = actual.pythonResolver(files);
      let calls = 0;
      return (r: unknown, file: string) => {
        if (fault && fault.file === file && ++calls >= (fault.nth ?? 1)) throw fault.value;
        return real(r, file);
      };
    },
  };
});

const SECRET = new Error('boom at /abs/secret/bad.py\n    at Object.<anonymous> (/abs/x.ts:1:1)');

const FILES: ImportsSourceFile[] = [
  { path: 'a.py', content: 'import os\nimport pkg.n\n' },
  { path: 'bad.py', content: 'import os\nimport pkg.n\n' },
  { path: 'c.ts', content: "import './d';\n" },
  { path: 'd.ts', content: '' },
  { path: 'pkg/__init__.py', content: '' },
  { path: 'pkg/n.py', content: '' },
];

const run = () => extractImports(FILES, { root: '.', xrayVersion: 'test' });
const view = (d: ReturnType<typeof run>, p: string) => {
  const f = d.files.find(x => x.path === p)!;
  return { complete: f.complete, status: f.status, unsupported: f.unsupported, imports: f.imports.map(r => [r.module, r.locality, r.resolved ?? null]) };
};

afterEach(() => { fault = undefined; jest.restoreAllMocks(); });

describe('resolution isolation', () => {
  it('baseline: every file resolves', () => {
    const d = run();
    expect(view(d, 'bad.py')).toEqual({
      complete: true, status: 'ok', unsupported: [],
      imports: [['os', 'stdlib', null], ['pkg.n', 'local', { file: 'pkg/n.py' }]],
    });
  });

  it('a throwing resolver leaves only that file unresolved and incomplete; the run continues', () => {
    // Second record throws: the first one, already resolved, is rolled back too.
    fault = { file: 'bad.py', nth: 2, value: SECRET };
    const debug = jest.spyOn(Logger, 'debug').mockImplementation(() => undefined);
    const d = run();
    expect(view(d, 'bad.py')).toEqual({
      complete: false, status: 'ok', unsupported: [],
      imports: [['os', 'unknown', null], ['pkg.n', 'unknown', null]],
    });
    expect(d.files.find(f => f.path === 'bad.py')!.imports.every(r => !('resolved' in r))).toBe(true);
    expect(view(d, 'a.py').imports).toEqual([['os', 'stdlib', null], ['pkg.n', 'local', { file: 'pkg/n.py' }]]);
    expect(view(d, 'c.ts').imports).toEqual([['./d', 'local', { file: 'd.ts' }]]);
    expect(d.summary.complete).toBe(d.files.filter(f => f.complete).length);
    expect(d.files.filter(f => !f.complete).map(f => f.path)).toEqual(['bad.py']);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/boom|\/abs\/|Object\.<anonymous>/);
    const logged = debug.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('bad.py');
    expect(logged).not.toMatch(/boom|\/abs\//);
  });

  it('a non-Error throw is isolated too', () => {
    fault = { file: 'bad.py', value: 'nope' };
    const d = run();
    expect(view(d, 'bad.py').complete).toBe(false);
    expect(view(d, 'a.py').complete).toBe(true);
  });

  it('a throwing resolver factory marks that language only', () => {
    fault = { factory: true, value: SECRET };
    const d = run();
    expect(d.files.filter(f => !f.complete).map(f => f.path)).toEqual(['a.py', 'bad.py']);
    expect(view(d, 'a.py').imports).toEqual([['os', 'unknown', null], ['pkg.n', 'unknown', null]]);
    expect(view(d, 'c.ts').imports).toEqual([['./d', 'local', { file: 'd.ts' }]]);
    expect(JSON.stringify(d)).not.toMatch(/boom|\/abs\//);
  });
});
