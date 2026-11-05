import { cfgCheck, dfgCheck, flowOf, cfgShape, sorted } from './helpers';

/**
 * JavaScript shares the TypeScript builder; these fixtures cover what is
 * different on the JS side: untyped parameters (defaults, destructuring,
 * rest), `catch` without a binding, `for await`, generators, classes, JSX,
 * and labelled loops through the JS grammar. Graphs are written by hand
 * from what the code means.
 */
const cfg = cfgCheck('js');
const dfg = dfgCheck('js');

describe('JavaScript CFG', () => {
  it('straight line and an arrow function expression body', () => {
    cfg(`function f(a) {
  const b = a + 1;
  return b;
}`, ['stmt const b = a + 1', 'return return b'], [
      'entry entry -> stmt const b = a + 1',
      'stmt const b = a + 1 -> return return b',
      'return return b -> exit exit',
    ]);
    cfg(`const f = (a) => a * 2;`, ['return return a * 2'], [
      'entry entry -> return return a * 2',
      'return return a * 2 -> exit exit',
    ]);
  });

  it('if / else with && and a ternary in the return', () => {
    cfg(`function f(a, b, c) {
  if (a && b) { yes(); } else { no(); }
  return c ? 1 : 2;
}`, [
      'cond a', 'cond b', 'stmt yes()', 'stmt no()', 'cond c', 'expr 1', 'expr 2', 'return return c ? 1 : 2',
    ], [
      'entry entry -> cond a',
      'cond a -> cond b [true]',
      'cond a -> stmt no() [false]',
      'cond b -> stmt yes() [true]',
      'cond b -> stmt no() [false]',
      'stmt yes() -> cond c',
      'stmt no() -> cond c',
      'cond c -> expr 1 [true]',
      'cond c -> expr 2 [false]',
      'expr 1 -> return return c ? 1 : 2',
      'expr 2 -> return return c ? 1 : 2',
      'return return c ? 1 : 2 -> exit exit',
    ]);
  });

  it('catch without a binding', () => {
    cfg(`function f() {
  try { a(); } catch { b(); }
}`, ['stmt a()', 'catch catch', 'stmt b()'], [
      'entry entry -> stmt a()',
      'stmt a() -> catch catch [throw]',
      'stmt a() -> exit exit',
      'catch catch -> stmt b()',
      'stmt b() -> exit exit',
    ]);
  });

  it('for await is a loop head with a true and a false exit', () => {
    cfg(`async function f(ys) {
  for await (const y of ys) { use(y); }
}`, ['loop for await (const y of ys)', 'stmt use(y)'], [
      'entry entry -> loop for await (const y of ys)',
      'loop for await (const y of ys) -> stmt use(y) [true]',
      'loop for await (const y of ys) -> exit exit [false]',
      'stmt use(y) -> loop for await (const y of ys)',
    ]);
  });

  it('yield inside try/finally may throw into the finally; the exception copy rethrows', () => {
    cfg(`function* f() {
  try { yield 1; } finally { done(); }
}`, [
      'stmt yield 1', 'stmt done() <- stmt yield 1', 'stmt done() <- stmt yield 1 /throw', 'rethrow rethrow',
    ], [
      'entry entry -> stmt yield 1',
      'stmt yield 1 -> stmt done() <- stmt yield 1',
      'stmt yield 1 -> stmt done() <- stmt yield 1 /throw [throw]',
      'stmt done() <- stmt yield 1 -> exit exit',
      'stmt done() <- stmt yield 1 /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });

  it('labelled break out of the outer of two for-of loops', () => {
    cfg(`function f(xs) {
  outer: for (const x of xs) {
    for (const y of x) { if (y) break outer; }
  }
  done();
}`, [
      'loop for (const x of xs)', 'loop for (const y of x)', 'cond y', 'break break outer', 'stmt done()',
    ], [
      'entry entry -> loop for (const x of xs)',
      'loop for (const x of xs) -> loop for (const y of x) [true]',
      'loop for (const x of xs) -> stmt done() [false]',
      'loop for (const y of x) -> cond y [true]',
      'loop for (const y of x) -> loop for (const x of xs) [false]',
      'cond y -> break break outer [true]',
      'cond y -> loop for (const y of x) [false]',
      'break break outer -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });

  it('a class method is a closure with its own graph', () => {
    const { cfg: c } = flowOf(`function f() {
  class A { m(p = 2) { return p; } }
  return A;
}`, 'f', { cfg: true, dfg: true }, undefined, 'js');
    expect(cfgShape(c!).nodes).toEqual(sorted(['entry entry', 'exit exit', 'stmt class A { m(p = 2) { return p; } }', 'return return A']));
    expect(c!.closures!.map(x => x.name)).toEqual(['m']);
    expect(cfgShape(c!.closures![0])).toEqual({
      nodes: sorted(['entry entry', 'exit exit', 'return return p']),
      edges: sorted(['entry entry -> return return p', 'return return p -> exit exit']),
    });
  });
});

describe('JavaScript DFG', () => {
  it('untyped parameters: defaults read earlier parameters, destructuring and rest define', () => {
    dfg(`function f(a, {b, c = a}, ...r) {
  return a + b + c + r.length;
}`, ['a:param@1', 'b:param@1', 'c:param@1', 'r:param@1'], [
      'a:param@1 -> entry entry',
      'a:param@1 -> return return a + b + c + r.length',
      'b:param@1 -> return return a + b + c + r.length',
      'c:param@1 -> return return a + b + c + r.length',
      'r:param@1 -> return return a + b + c + r.length',
    ]);
  });

  it('a variable read inside JSX', () => {
    dfg(`function f(a) {
  return <div>{a}</div>;
}`, ['a:param@1'], ['a:param@1 -> return return <div>{a}</div>']);
  });

  it('a catch without a binding defines nothing; the try body write may or may not have happened', () => {
    dfg(`function f(x) {
  try { x = g(); } catch { use(x); }
  return x;
}`, ['x:param@1', 'x:assign@2'], [
      'x:param@1 -> stmt use(x)',
      'x:assign@2 -> return return x',
      'x:param@1 -> return return x',
    ]);
  });
});
