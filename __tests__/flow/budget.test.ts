import { buildFlow, flowTableFor, MAX_FLOW_NODES, MAX_FILE_FLOW_NODES } from '../../src/lib/flow';
import { parserFor, Lang } from './helpers';

/**
 * Input from a freshly cloned repo must not decide the cost of a run: the
 * work per function is bounded by a budget checked while building, whatever
 * the shape of the function. Each case below is one way code can multiply
 * (copies of exits, depth, breadth); each must finish fast, never throw, and
 * come back truncated or skipped.
 */
const LIMIT_MS = 2500;

const firstFunction = (code: string, lang: Lang) => {
  const table = flowTableFor(`x.${lang}`)!;
  const root = parserFor(lang).parse(code).rootNode;
  // Iterative: deep inputs must not overflow the test's own search.
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (table.functions.includes(n.type)) return { fn: n, table };
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i)!);
  }
  throw new Error('no function');
};

const run = (code: string, lang: Lang, budget?: { left: number }) => {
  const { fn, table } = firstFunction(code, lang);
  const t0 = Date.now();
  const res = buildFlow(fn, table, { cfg: true, dfg: true }, undefined, budget);
  return { res, ms: Date.now() - t0 };
};

const bounded = (r: ReturnType<typeof run>) => {
  expect(r.ms).toBeLessThan(LIMIT_MS);
  expect(r.res.skipped !== undefined || r.res.cfg?.truncated !== undefined).toBe(true);
  if (r.res.cfg) {
    expect(r.res.cfg.nodes.length).toBeLessThanOrEqual(MAX_FLOW_NODES);
    // Kept edges only join kept nodes.
    const ids = new Set(r.res.cfg.nodes.map(n => n.id));
    for (const e of r.res.cfg.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  }
};

const lines = (n: number, f: (i: number) => string): string => Array.from({ length: n }, (_, i) => f(i)).join('\n');

describe('flow work is bounded by a budget, not by the input', () => {
  it('Go: 2000 defers x 2000 returns', () => {
    const code = `package p\nfunc f(c int) {\n${lines(2000, i => `defer d${i}()\nif c == ${i} { return }`)}\n}\n`;
    const r = run(code, 'go');
    bounded(r);
    expect(r.res.cfg!.truncated!.partial).toBe(true);
  });

  it('nested try/finally depth 30 with a return in the innermost', () => {
    const d = 30;
    const code = `function f(){\n${'try {\n'.repeat(d)}return 1;\n${lines(d, i => `} finally { c${i}(); }`)}\n}\n`;
    const { res, ms } = run(code, 'ts');
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(res.cfg).toBeDefined();
  });

  it('try/finally nested inside finally bodies, depth 30 (copies of copies)', () => {
    const d = 30;
    const code = `function f(){ try { a(); } finally {\n${'try { b(); } finally {\n'.repeat(d)}z();\n${'}}\n'.repeat(d)}}}\n`;
    bounded(run(code, 'ts'));
  });

  it('Python: with and finally nested to depth 30', () => {
    const d = 30;
    let s = 'def f():\n';
    let ind = '    ';
    for (let i = 0; i < d; i++) { s += `${ind}try:\n`; ind += '    '; s += `${ind}with c${i}():\n`; ind += '        '; }
    s += `${ind}return 1\n`;
    for (let i = d - 1; i >= 0; i--) { ind = ind.slice(0, -12); s += `${ind}finally:\n${ind}    f${i}()\n`; }
    const { res, ms } = run(s, 'py');
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(res.cfg).toBeDefined();
  });

  it('a generated function with 5k statements is cut at the work cap, in each language', () => {
    bounded(run(`function f(a){\n${lines(5000, i => `a = g(a, ${i});`)}\n}\n`, 'ts'));
    bounded(run(`def f(a):\n${lines(5000, i => `    a = g(a, ${i})`)}\n`, 'py'));
    bounded(run(`package p\nfunc f(a int) {\n${lines(5000, i => `a = g(a, ${i})`)}\n}\n`, 'go'));
  });

  it('a generated function with 50k statements is too large to read at all: skipped at once', () => {
    for (const [code, lang] of [
      [`function f(a){\n${lines(50000, i => `a = g(a, ${i});`)}\n}\n`, 'ts'],
      [`def f(a):\n${lines(50000, i => `    a = g(a, ${i})`)}\n`, 'py'],
      [`package p\nfunc f(a int) {\n${lines(50000, i => `a = g(a, ${i})`)}\n}\n`, 'go'],
    ] as Array<[string, Lang]>) {
      const r = run(code, lang);
      expect(r.res.skipped).toBe('size');
      expect(r.ms).toBeLessThan(50);
    }
  });

  it('nesting 10k deep (blocks, ifs, parentheses, && chains) neither crashes nor hangs', () => {
    const n = 10000;
    for (const code of [
      `function f(){${'{'.repeat(n)}a();${'}'.repeat(n)}}`,
      `function f(){${'if(a){'.repeat(n)}b();${'}'.repeat(n)}}`,
      `function f(){ return ${'('.repeat(n)}a${')'.repeat(n)}; }`,
      `function f(){ if (${Array.from({ length: n }, (_, i) => `a${i}`).join(' && ')}) { b(); } }`,
    ]) {
      const { res, ms } = run(code, 'ts');
      expect(ms).toBeLessThan(LIMIT_MS);
      expect(res.skipped !== undefined || res.cfg !== undefined).toBe(true);
    }
    const py = `def f(a):\n    return ${'('.repeat(n)}a${')'.repeat(n)}\n`;
    const r = run(py, 'py');
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.res.skipped !== undefined || r.res.cfg !== undefined).toBe(true);
  });

  it('data flow: thousands of variables redefined in a loop, one huge expression, 20k destructured names', () => {
    const vars = 5000;
    const loop = `function f(){\n${lines(vars, i => `let v${i} = ${i};`)}\nfor (let i = 0; i < 9; i++) {\n${lines(vars, i => `v${i} = v${(i + 1) % vars} + i;`)}\n}}\n`;
    const a = run(loop, 'ts');
    expect(a.ms).toBeLessThan(LIMIT_MS);
    expect(a.res.dfg!.nodes.length).toBeLessThanOrEqual(2000);
    const huge = `function f(){ return ${Array.from({ length: 50000 }, (_, i) => `a${i}`).join(' + ')}; }`;
    expect(run(huge, 'ts').ms).toBeLessThan(LIMIT_MS);
    const destructure = `function f(o){ const {${Array.from({ length: 20000 }, (_, i) => `a${i}`).join(',')}} = o; return a0; }`;
    const d = run(destructure, 'ts');
    expect(d.ms).toBeLessThan(LIMIT_MS);
    expect(d.res.dfg!.nodes.length).toBe(2000);
    expect(d.res.dfg!.truncated).toBeDefined();
  });

  it('a file of many such functions: total work is capped by the file budget, the rest are skipped', () => {
    const one = `package p\nfunc f(c int) {\n${lines(300, i => `defer d${i}()\nif c == ${i} { return }`)}\n}\n`;
    const table = flowTableFor('x.go')!;
    const root = parserFor('go').parse(one.repeat(1).replace('package p\n', '')).rootNode;
    const fn = root.namedChildren.find(c => table.functions.includes(c.type))!;
    const budget = { left: MAX_FILE_FLOW_NODES };
    let skipped = 0;
    const t0 = Date.now();
    for (let i = 0; i < 400; i++) if (buildFlow(fn, table, { cfg: true, dfg: true }, undefined, budget).skipped === 'budget') skipped++;
    expect(Date.now() - t0).toBeLessThan(10 * LIMIT_MS);
    // 400 functions x up to 1000 nodes would be 400k nodes: the file budget (50k) stops it.
    expect(budget.left).toBeLessThanOrEqual(0);
    expect(skipped).toBeGreaterThan(0);
  });
});
