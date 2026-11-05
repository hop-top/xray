import { flowOf, dfgShape, sorted } from './helpers';

/**
 * Exact def-use edges, written by hand from what each function means.
 * A def is `name:kind@line`; an edge goes from a definition to the CFG node
 * (`<kind> <label>`) that reads a value it supplies.
 */
const check = (code: string, defs: string[], edges: string[], name = 'f') => {
  const { cfg, dfg } = flowOf(code, name);
  const shape = dfgShape(dfg!, cfg!);
  expect(shape.defs).toEqual(sorted(defs));
  expect(shape.edges).toEqual(sorted(edges));
};

describe('DFG: reaching definitions', () => {
  it('straight line: each use sees the definition before it', () => {
    check(`function f(a) {
  const b = a + 1;
  const c = b * 2;
  return c;
}`, ['a:param@1', 'b:decl@2', 'c:decl@3'], [
      'a:param@1 -> stmt const b = a + 1',
      'b:decl@2 -> stmt const c = b * 2',
      'c:decl@3 -> return return c',
    ]);
  });

  it('reassignment kills the earlier definition (dead store has no edge)', () => {
    check(`function f() {
  let x = 1;
  x = 2;
  return x;
}`, ['x:decl@2', 'x:assign@3'], ['x:assign@3 -> return return x']);
  });

  it('reassignment in one branch only: both definitions reach the use', () => {
    check(`function f(c) {
  let x = 1;
  if (c) { x = 2; }
  return x;
}`, ['c:param@1', 'x:decl@2', 'x:assign@3'], [
      'c:param@1 -> cond c',
      'x:decl@2 -> return return x',
      'x:assign@3 -> return return x',
    ]);
  });

  it('reassignment in both branches: neither earlier definition survives', () => {
    check(`function f(c) {
  let x = 0;
  if (c) { x = 1; } else { x = 2; }
  return x;
}`, ['c:param@1', 'x:decl@2', 'x:assign@3', 'x:assign@3'], [
      'c:param@1 -> cond c',
      'x:assign@3 -> return return x',
      'x:assign@3 -> return return x',
    ]);
  });

  it('loop-carried definitions reach the loop head and the next iteration', () => {
    check(`function f(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s = s + i;
  }
  return s;
}`, ['n:param@1', 's:decl@2', 'i:decl@3', 's:assign@4', 'i:update@3'], [
      'n:param@1 -> loop i < n',
      's:decl@2 -> stmt s = s + i',
      's:decl@2 -> return return s',
      's:assign@4 -> stmt s = s + i',
      's:assign@4 -> return return s',
      'i:decl@3 -> loop i < n',
      'i:decl@3 -> stmt s = s + i',
      'i:decl@3 -> stmt i++',
      'i:update@3 -> loop i < n',
      'i:update@3 -> stmt s = s + i',
      'i:update@3 -> stmt i++',
    ]);
  });

  it('a block-scoped declaration shadows the outer name only inside its block', () => {
    check(`function f(x) {
  let y = x;
  {
    let x = 5;
    y = x;
  }
  return x + y;
}`, ['x:param@1', 'y:decl@2', 'x:decl@4', 'y:assign@5'], [
      'x:param@1 -> stmt let y = x',
      'x:decl@4 -> stmt y = x',
      'x:param@1 -> return return x + y',
      'y:assign@5 -> return return x + y',
    ]);
  });

  it('var is function scoped: a use outside the block still sees it', () => {
    check(`function f(c) {
  if (c) { var v = 1; }
  return v;
}`, ['c:param@1', 'v:decl@2'], ['c:param@1 -> cond c', 'v:decl@2 -> return return v']);
  });

  it('a param of a nested function shadows the outer one and is not a capture', () => {
    const { cfg, dfg } = flowOf(`function f(x) {
  const g = (x) => x + 1;
  return g(x);
}`);
    const shape = dfgShape(dfg!, cfg!);
    expect(shape.defs).toEqual(sorted(['x:param@1', 'g:decl@2']));
    expect(shape.edges).toEqual(sorted(['g:decl@2 -> return return g(x)', 'x:param@1 -> return return g(x)']));
    const inner = dfgShape(dfg!.closures![0], cfg!.closures![0]);
    expect(inner.defs).toEqual(['x:param@2']);
    expect(inner.edges).toEqual(['x:param@2 -> return return x + 1']);
  });
});

describe('DFG: destructuring, parameters, compound writes', () => {
  it('object and array patterns define every name they bind', () => {
    check(`function f(o) {
  const { a, b: [c, d = 1], ...r } = o;
  return a + c + d + r;
}`, ['o:param@1', 'a:decl@2', 'c:decl@2', 'd:decl@2', 'r:decl@2'], [
      'o:param@1 -> stmt const { a, b: [c, d = 1], ...r } = o',
      'a:decl@2 -> return return a + c + d + r',
      'c:decl@2 -> return return a + c + d + r',
      'd:decl@2 -> return return a + c + d + r',
      'r:decl@2 -> return return a + c + d + r',
    ]);
  });

  it('parameters are definitions at entry; a default reads earlier parameters', () => {
    check(`function f(a, { b, c = a }, ...rest) {
  return a + b + c + rest.length;
}`, ['a:param@1', 'b:param@1', 'c:param@1', 'rest:param@1'], [
      'a:param@1 -> entry entry',
      'a:param@1 -> return return a + b + c + rest.length',
      'b:param@1 -> return return a + b + c + rest.length',
      'c:param@1 -> return return a + b + c + rest.length',
      'rest:param@1 -> return return a + b + c + rest.length',
    ]);
  });

  it('destructuring assignment reads the right side first (swap)', () => {
    check(`function f(a, b) {
  [a, b] = [b, a];
  return a;
}`, ['a:param@1', 'b:param@1', 'a:assign@2', 'b:assign@2'], [
      'a:param@1 -> stmt [a, b] = [b, a]',
      'b:param@1 -> stmt [a, b] = [b, a]',
      'a:assign@2 -> return return a',
    ]);
  });

  it('`||=` may leave the value alone: weak, the earlier definition still reaches', () => {
    check(`function f(x) {
  let y = x;
  y ||= 5;
  return y;
}`, ['x:param@1', 'y:decl@2', 'y:maybe@3 weak'], [
      'x:param@1 -> stmt let y = x',
      'y:decl@2 -> stmt y ||= 5',
      'y:decl@2 -> return return y',
      'y:maybe@3 weak -> return return y',
    ]);
  });

  it('property writes define the root weakly; calls define nothing', () => {
    check(`function f() {
  const o = {};
  o.p = 1;
  o.q = 2;
  o.run();
  return o;
}`, ['o:decl@2', 'o:member@3 weak', 'o:member@4 weak'], [
      'o:decl@2 -> stmt o.p = 1',
      'o:decl@2 -> stmt o.q = 2',
      'o:member@3 weak -> stmt o.q = 2',
      'o:decl@2 -> stmt o.run()',
      'o:member@3 weak -> stmt o.run()',
      'o:member@4 weak -> stmt o.run()',
      'o:decl@2 -> return return o',
      'o:member@3 weak -> return return o',
      'o:member@4 weak -> return return o',
    ]);
  });
});

describe('DFG: exceptions and closures', () => {
  it('a throwing statement does not complete its own definition: the catch sees the state before it', () => {
    check(`function f() {
  let r = 0;
  try { r = g(); }
  catch (e) { r = e; }
  return r;
}`, ['r:decl@2', 'r:assign@3', 'e:catch@4', 'r:assign@4'], [
      'e:catch@4 -> stmt r = e',
      'r:assign@3 -> return return r',
      'r:assign@4 -> return return r',
    ]);
  });

  it('a catch with no assignment still sees the earlier value', () => {
    check(`function f() {
  let r = 0;
  try { r = g(); }
  catch (e) { log(r); }
  return r;
}`, ['r:decl@2', 'r:assign@3', 'e:catch@4'], [
      'r:decl@2 -> stmt log(r)',
      'r:decl@2 -> return return r',
      'r:assign@3 -> return return r',
    ]);
  });

  it('captured variables are marked, read at the closure, and not tracked inside it', () => {
    const { cfg, dfg } = flowOf(`function f(x) {
  let n = 0;
  const inc = () => { n++; };
  inc();
  return n + x;
}`);
    const shape = dfgShape(dfg!, cfg!);
    expect(shape.defs).toEqual(sorted(['x:param@1', 'n:decl@2 captured', 'inc:decl@3']));
    expect(shape.edges).toEqual(sorted([
      'n:decl@2 captured -> stmt const inc = () => { n++; }',
      'inc:decl@3 -> stmt inc()',
      'n:decl@2 captured -> return return n + x',
      'x:param@1 -> return return n + x',
    ]));
    expect(dfg!.closures![0].nodes).toEqual([]);
    expect(dfg!.closures![0].edges).toEqual([]);
    expect(dfg!.closures![0].name).toBe('inc');
  });

  it('an assignment inside a closure marks the outer variable captured too', () => {
    const { dfg } = flowOf(`function f() {
  let n = 0;
  const set = () => { n = 5; };
  set();
  return n;
}`);
    expect(dfg!.nodes.find(d => d.name === 'n')!.captured).toBe(true);
  });

  it('only df: sites carry what the edges point at', () => {
    const { cfg, dfg } = flowOf('function f(a) { return a; }', 'f', { cfg: false, dfg: true });
    expect(cfg).toBeUndefined();
    expect(dfg!.sites).toEqual([{ id: 'n2', line: 0, label: 'return a' }]);
    expect(dfg!.edges).toEqual([{ from: 'd0', to: 'n2' }]);
  });
});

describe('DFG: finally runs once per way in, each copy reads its operands', () => {
  it('every copy of a finally body reads the variables it names', () => {
    const { cfg, dfg } = flowOf(`function f(x, p) {
  try {
    if (p) return 1;
    work();
  } finally {
    release(x);
  }
}`);
    const copies = cfg!.nodes.filter(n => n.label === 'release(x)');
    expect(copies).toHaveLength(3);
    for (const c of copies) expect(c.calls).toEqual(['release']);
    const x = dfg!.nodes.find(d => d.name === 'x')!;
    expect(dfg!.edges.filter(e => e.from === x.id).map(e => e.to).sort())
      .toEqual(copies.map(c => c.id).sort());
  });
});

describe('DFG: a catch kept for a try body that cannot throw by itself', () => {
  it('the catch parameter and its reads are in the graph; the body\'s writes do not complete before the catch sees them', () => {
    const { cfg, dfg } = flowOf(`function f(last) {
  try { last = 1; } catch (e) {
    last = String(e);
  }
  return last;
}`);
    const shape = dfgShape(dfg!, cfg!);
    expect(shape.defs).toEqual(sorted([
      'last:param@1', 'last:assign@2', 'e:catch@2', 'last:assign@3',
    ]));
    expect(shape.edges).toEqual(sorted([
      'e:catch@2 -> stmt last = String(e)',
      'last:assign@2 -> return return last',
      'last:assign@3 -> return return last',
    ]));
  });
});
