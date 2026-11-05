import { flowOf, cfgShape, sorted } from './helpers';
import { MAX_FLOW_NODES } from '../../src/lib/flow';

/**
 * Exact graphs: nodes and edges below are what each function MEANS,
 * written by hand; equality is exact, so a missing node, an extra edge or a
 * mislabelled branch fails. `entry` / `exit` are the function's own.
 */
const check = (code: string, nodes: string[], edges: string[], name = 'f') => {
  const shape = cfgShape(flowOf(code, name).cfg!);
  expect(shape.nodes).toEqual(sorted(['entry entry', 'exit exit', ...nodes]));
  expect(shape.edges).toEqual(sorted(edges));
};

describe('CFG: straight line', () => {
  it('chains statements and ends at exit', () => {
    check(`function f(a) {
  const b = a + 1;
  log(b);
  return b;
}`, ['stmt const b = a + 1', 'stmt log(b)', 'return return b'], [
      'entry entry -> stmt const b = a + 1',
      'stmt const b = a + 1 -> stmt log(b)',
      'stmt log(b) -> return return b',
      'return return b -> exit exit',
    ]);
  });

  it('a function that falls off its end reaches exit', () => {
    check(`function f() { a(); }`, ['stmt a()'], ['entry entry -> stmt a()', 'stmt a() -> exit exit']);
  });

  it('no nodes and no edges after return', () => {
    check(`function f() {
  return 1;
  unreachable();
}`, ['return return 1'], ['entry entry -> return return 1', 'return return 1 -> exit exit']);
  });

  it('an arrow expression body is an implicit return', () => {
    check(`const f = (a) => a + 1;
function g() {}`, ['return return a + 1'], ['entry entry -> return return a + 1', 'return return a + 1 -> exit exit']);
  });
});

describe('CFG: if / else', () => {
  it('if / else if / else join at the next statement', () => {
    check(`function f(a) {
  if (a > 0) { pos(); } else if (a < 0) { neg(); } else { zero(); }
  done();
}`, ['cond a > 0', 'stmt pos()', 'cond a < 0', 'stmt neg()', 'stmt zero()', 'stmt done()'], [
      'entry entry -> cond a > 0',
      'cond a > 0 -> stmt pos() [true]',
      'cond a > 0 -> cond a < 0 [false]',
      'cond a < 0 -> stmt neg() [true]',
      'cond a < 0 -> stmt zero() [false]',
      'stmt pos() -> stmt done()',
      'stmt neg() -> stmt done()',
      'stmt zero() -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });

  it('early return leaves the false edge as the only way on', () => {
    check(`function f(a) {
  if (!a) return 0;
  work();
  return 1;
}`, ['cond !a', 'return return 0', 'stmt work()', 'return return 1'], [
      'entry entry -> cond !a',
      'cond !a -> return return 0 [true]',
      'cond !a -> stmt work() [false]',
      'return return 0 -> exit exit',
      'stmt work() -> return return 1',
      'return return 1 -> exit exit',
    ]);
  });

  it('an uncaught throw goes to exit as an exceptional edge', () => {
    check(`function f(a) {
  if (a) throw new Error('x');
  return 1;
}`, ['cond a', "throw throw new Error('x')", 'return return 1'], [
      'entry entry -> cond a',
      "cond a -> throw throw new Error('x') [true]",
      'cond a -> return return 1 [false]',
      "throw throw new Error('x') -> exit exit [throw]",
      'return return 1 -> exit exit',
    ]);
  });
});

describe('CFG: loops', () => {
  it('for: init, test, body, update with a back edge', () => {
    check(`function f(n) {
  let s = 0;
  for (let i = 0; i < n; i++) { s += i; }
  return s;
}`, ['stmt let s = 0', 'stmt let i = 0', 'loop i < n', 'stmt s += i', 'stmt i++', 'return return s'], [
      'entry entry -> stmt let s = 0',
      'stmt let s = 0 -> stmt let i = 0',
      'stmt let i = 0 -> loop i < n',
      'loop i < n -> stmt s += i [true]',
      'loop i < n -> return return s [false]',
      'stmt s += i -> stmt i++',
      'stmt i++ -> loop i < n',
      'return return s -> exit exit',
    ]);
  });

  it('while with break and continue', () => {
    check(`function f(xs) {
  let i = 0;
  while (i < xs.length) {
    i++;
    if (xs[i] === 1) continue;
    if (xs[i] === 2) break;
    use(i);
  }
  return i;
}`, [
      'stmt let i = 0', 'loop i < xs.length', 'stmt i++', 'cond xs[i] === 1', 'continue continue',
      'cond xs[i] === 2', 'break break', 'stmt use(i)', 'return return i',
    ], [
      'entry entry -> stmt let i = 0',
      'stmt let i = 0 -> loop i < xs.length',
      'loop i < xs.length -> stmt i++ [true]',
      'loop i < xs.length -> return return i [false]',
      'stmt i++ -> cond xs[i] === 1',
      'cond xs[i] === 1 -> continue continue [true]',
      'cond xs[i] === 1 -> cond xs[i] === 2 [false]',
      'continue continue -> loop i < xs.length',
      'cond xs[i] === 2 -> break break [true]',
      'cond xs[i] === 2 -> stmt use(i) [false]',
      'break break -> return return i',
      'stmt use(i) -> loop i < xs.length',
      'return return i -> exit exit',
    ]);
  });

  it('do-while runs the body first and loops on the test', () => {
    check(`function f(n) {
  do { n--; } while (n > 0);
  return n;
}`, ['stmt n--', 'loop n > 0', 'return return n'], [
      'entry entry -> stmt n--',
      'stmt n-- -> loop n > 0',
      'loop n > 0 -> stmt n-- [true]',
      'loop n > 0 -> return return n [false]',
      'return return n -> exit exit',
    ]);
  });

  it('for-of and for-in: head with true (next) and false (done)', () => {
    check(`function f(xs, o) {
  for (const x of xs) { if (x) break; }
  for (const k in o) { visit(k); }
}`, [
      'loop for (const x of xs)', 'cond x', 'break break', 'loop for (const k in o)', 'stmt visit(k)',
    ], [
      'entry entry -> loop for (const x of xs)',
      'loop for (const x of xs) -> cond x [true]',
      'loop for (const x of xs) -> loop for (const k in o) [false]',
      'cond x -> break break [true]',
      'cond x -> loop for (const x of xs) [false]',
      'break break -> loop for (const k in o)',
      'loop for (const k in o) -> stmt visit(k) [true]',
      'loop for (const k in o) -> exit exit [false]',
      'stmt visit(k) -> loop for (const k in o)',
    ]);
  });

  it('nested loops: labelled continue targets the outer update, plain break the inner exit', () => {
    check(`function f(n, m) {
  outer: for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (j === i) continue outer;
      if (j > 5) break;
      work(i, j);
    }
    after(i);
  }
  end();
}`, [
      'stmt let i = 0', 'loop i < n', 'stmt let j = 0', 'loop j < m', 'cond j === i', 'continue continue outer',
      'cond j > 5', 'break break', 'stmt work(i, j)', 'stmt j++', 'stmt after(i)', 'stmt i++', 'stmt end()',
    ], [
      'entry entry -> stmt let i = 0',
      'stmt let i = 0 -> loop i < n',
      'loop i < n -> stmt let j = 0 [true]',
      'loop i < n -> stmt end() [false]',
      'stmt let j = 0 -> loop j < m',
      'loop j < m -> cond j === i [true]',
      'loop j < m -> stmt after(i) [false]',
      'cond j === i -> continue continue outer [true]',
      'cond j === i -> cond j > 5 [false]',
      'continue continue outer -> stmt i++',
      'cond j > 5 -> break break [true]',
      'cond j > 5 -> stmt work(i, j) [false]',
      'break break -> stmt after(i)',
      'stmt work(i, j) -> stmt j++',
      'stmt j++ -> loop j < m',
      'stmt after(i) -> stmt i++',
      'stmt i++ -> loop i < n',
      'stmt end() -> exit exit',
    ]);
  });

  it('labelled break leaves both loops', () => {
    check(`function f(xs, ys) {
  out: for (const x of xs) {
    for (const y of ys) {
      if (x === y) break out;
    }
  }
  done();
}`, [
      'loop for (const x of xs)', 'loop for (const y of ys)', 'cond x === y', 'break break out', 'stmt done()',
    ], [
      'entry entry -> loop for (const x of xs)',
      'loop for (const x of xs) -> loop for (const y of ys) [true]',
      'loop for (const x of xs) -> stmt done() [false]',
      'loop for (const y of ys) -> cond x === y [true]',
      'loop for (const y of ys) -> loop for (const x of xs) [false]',
      'cond x === y -> break break out [true]',
      'cond x === y -> loop for (const y of ys) [false]',
      'break break out -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });
});

describe('CFG: switch', () => {
  it('fallthrough, shared bodies and default', () => {
    check(`function f(n) {
  switch (n) {
    case 1:
    case 2:
      a();
    case 3:
      b();
      break;
    default:
      c();
  }
  d();
}`, [
      'switch n', 'case 1', 'case 2', 'case 3', 'stmt a()', 'stmt b()', 'break break', 'stmt c()', 'stmt d()',
    ], [
      'entry entry -> switch n',
      'switch n -> case 1',
      'case 1 -> stmt a() [true]',
      'case 1 -> case 2 [false]',
      'case 2 -> stmt a() [true]',
      'case 2 -> case 3 [false]',
      'case 3 -> stmt b() [true]',
      'case 3 -> stmt c() [false]',
      'stmt a() -> stmt b()',
      'stmt b() -> break break',
      'break break -> stmt d()',
      'stmt c() -> stmt d()',
      'stmt d() -> exit exit',
    ]);
  });

  it('no default: the last failed test continues after the switch', () => {
    check(`function f(n) {
  switch (n) { case 1: a(); break; }
  b();
}`, ['switch n', 'case 1', 'stmt a()', 'break break', 'stmt b()'], [
      'entry entry -> switch n',
      'switch n -> case 1',
      'case 1 -> stmt a() [true]',
      'case 1 -> stmt b() [false]',
      'stmt a() -> break break',
      'break break -> stmt b()',
      'stmt b() -> exit exit',
    ]);
  });

  it('default in the middle is entered only when no case matches, and falls through', () => {
    check(`function f(n) {
  switch (n) {
    case 1: a(); break;
    default: d();
    case 2: b();
  }
}`, ['switch n', 'case 1', 'case 2', 'stmt a()', 'break break', 'stmt d()', 'stmt b()'], [
      'entry entry -> switch n',
      'switch n -> case 1',
      'case 1 -> stmt a() [true]',
      'case 1 -> case 2 [false]',
      'case 2 -> stmt b() [true]',
      'case 2 -> stmt d() [false]',
      'stmt a() -> break break',
      'break break -> exit exit',
      'stmt d() -> stmt b()',
      'stmt b() -> exit exit',
    ]);
  });
});

describe('CFG: try / catch / finally', () => {
  it('try/catch: every throwing statement reaches the catch', () => {
    check(`function f() {
  try { a(); b(); } catch (e) { c(e); }
  d();
}`, ['stmt a()', 'stmt b()', 'catch catch (e)', 'stmt c(e)', 'stmt d()'], [
      'entry entry -> stmt a()',
      'stmt a() -> stmt b()',
      'stmt a() -> catch catch (e) [throw]',
      'stmt b() -> catch catch (e) [throw]',
      'stmt b() -> stmt d()',
      'catch catch (e) -> stmt c(e)',
      'stmt c(e) -> stmt d()',
      'stmt d() -> exit exit',
    ]);
  });

  it('finally: one copy per way in (normal completion, exception raised in the catch)', () => {
    check(`function f() {
  try { a(); } catch (e) { b(); } finally { c(); }
  d();
}`, [
      'stmt a()', 'catch catch (e)', 'stmt b()',
      'stmt c() <- stmt a(), stmt b()',
      'stmt c() <- stmt b() /throw',
      'rethrow rethrow',
      'stmt d()',
    ], [
      'entry entry -> stmt a()',
      'stmt a() -> catch catch (e) [throw]',
      'stmt a() -> stmt c() <- stmt a(), stmt b()',
      'catch catch (e) -> stmt b()',
      'stmt b() -> stmt c() <- stmt a(), stmt b()',
      'stmt b() -> stmt c() <- stmt b() /throw [throw]',
      'stmt c() <- stmt b() /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
      'stmt c() <- stmt a(), stmt b() -> stmt d()',
      'stmt d() -> exit exit',
    ]);
  });

  it('return inside try runs finally, then leaves; normal path runs its own copy', () => {
    check(`function f(p) {
  try {
    if (p) return 1;
    work();
  } finally {
    cleanup();
  }
  return 2;
}`, [
      'cond p', 'return return 1', 'stmt work()',
      'stmt cleanup() <- return return 1',
      'stmt cleanup() <- stmt work()',
      'stmt cleanup() <- stmt work() /throw',
      'rethrow rethrow',
      'return return 2',
    ], [
      'entry entry -> cond p',
      'cond p -> return return 1 [true]',
      'cond p -> stmt work() [false]',
      'return return 1 -> stmt cleanup() <- return return 1',
      'stmt cleanup() <- return return 1 -> exit exit',
      'stmt work() -> stmt cleanup() <- stmt work()',
      'stmt work() -> stmt cleanup() <- stmt work() /throw [throw]',
      'stmt cleanup() <- stmt work() /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
      'stmt cleanup() <- stmt work() -> return return 2',
      'return return 2 -> exit exit',
    ]);
  });

  it('continue out of try/finally inside a loop runs finally, then the loop head', () => {
    check(`function f(xs) {
  for (const x of xs) {
    try {
      if (x) continue;
      use(x);
    } finally {
      tick();
    }
  }
}`, [
      'loop for (const x of xs)', 'cond x', 'continue continue', 'stmt use(x)',
      'stmt tick() <- continue continue',
      'stmt tick() <- stmt use(x)',
      'stmt tick() <- stmt use(x) /throw',
      'rethrow rethrow',
    ], [
      'entry entry -> loop for (const x of xs)',
      'loop for (const x of xs) -> cond x [true]',
      'loop for (const x of xs) -> exit exit [false]',
      'cond x -> continue continue [true]',
      'cond x -> stmt use(x) [false]',
      'continue continue -> stmt tick() <- continue continue',
      'stmt tick() <- continue continue -> loop for (const x of xs)',
      'stmt use(x) -> stmt tick() <- stmt use(x)',
      'stmt use(x) -> stmt tick() <- stmt use(x) /throw [throw]',
      'stmt tick() <- stmt use(x) /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
      'stmt tick() <- stmt use(x) -> loop for (const x of xs)',
    ]);
  });

  it('throw inside try with catch is caught; the catch body is not covered by it', () => {
    check(`function f(a) {
  try {
    if (a) throw err();
    ok();
  } catch (e) {
    handle(e);
  }
}`, ['cond a', 'throw throw err()', 'stmt ok()', 'catch catch (e)', 'stmt handle(e)'], [
      'entry entry -> cond a',
      'cond a -> throw throw err() [true]',
      'cond a -> stmt ok() [false]',
      'throw throw err() -> catch catch (e) [throw]',
      'stmt ok() -> catch catch (e) [throw]',
      'stmt ok() -> exit exit',
      'catch catch (e) -> stmt handle(e)',
      'stmt handle(e) -> exit exit',
    ]);
  });

  it('a try body with nothing that can throw still has its catch: conservatively reachable', () => {
    check(`function f() {
  try { x = 1; } catch (e) { never(); }
}`, ['stmt x = 1', 'catch catch (e)', 'stmt never()'], [
      'entry entry -> stmt x = 1',
      'stmt x = 1 -> catch catch (e) [throw]',
      'stmt x = 1 -> exit exit',
      'catch catch (e) -> stmt never()',
      'stmt never() -> exit exit',
    ]);
  });

  it('conservative catch: every evaluating node of the body may throw, jumps do not, nodes that throw already keep their edge', () => {
    check(`function f(p) {
  try {
    x = 1;
    if (p) { y = 2; }
    return y;
  } catch (e) { z = e; }
}`, [
      'stmt x = 1', 'cond p', 'stmt y = 2', 'return return y', 'catch catch (e)', 'stmt z = e',
    ], [
      'entry entry -> stmt x = 1',
      'stmt x = 1 -> cond p',
      'stmt x = 1 -> catch catch (e) [throw]',
      'cond p -> stmt y = 2 [true]',
      'cond p -> return return y [false]',
      'cond p -> catch catch (e) [throw]',
      'stmt y = 2 -> return return y',
      'stmt y = 2 -> catch catch (e) [throw]',
      'return return y -> exit exit',
      'catch catch (e) -> stmt z = e',
      'stmt z = e -> exit exit',
    ]);
  });

  it('a body with a throwing node keeps the precise edges only', () => {
    check(`function f() {
  try { x = 1; a(); } catch (e) { b(); }
}`, ['stmt x = 1', 'stmt a()', 'catch catch (e)', 'stmt b()'], [
      'entry entry -> stmt x = 1',
      'stmt x = 1 -> stmt a()',
      'stmt a() -> catch catch (e) [throw]',
      'stmt a() -> exit exit',
      'catch catch (e) -> stmt b()',
      'stmt b() -> exit exit',
    ]);
  });
});

describe('CFG: the exception path of a finally ends in an explicit rethrow', () => {
  it('a conditional at the end of the copy is not mistaken for a branch to a normal exit', () => {
    check(`function f() {
  try { a(); } finally { if (ok()) { x(); } }
}`, [
      'stmt a()',
      'cond ok() <- stmt a()',
      'stmt x() <- cond ok() <- stmt a() /true',
      'cond ok() <- stmt a() /throw',
      'stmt x() <- cond ok() <- stmt a() /throw /true',
      'rethrow rethrow',
    ], [
      'entry entry -> stmt a()',
      'stmt a() -> cond ok() <- stmt a()',
      'stmt a() -> cond ok() <- stmt a() /throw [throw]',
      'cond ok() <- stmt a() -> stmt x() <- cond ok() <- stmt a() /true [true]',
      'cond ok() <- stmt a() -> exit exit [false]',
      'stmt x() <- cond ok() <- stmt a() /true -> exit exit',
      'cond ok() <- stmt a() /throw -> stmt x() <- cond ok() <- stmt a() /throw /true [true]',
      'cond ok() <- stmt a() /throw -> rethrow rethrow [false]',
      'stmt x() <- cond ok() <- stmt a() /throw /true -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });

  it('a finally inside an outer try: the rethrow reaches the outer catch', () => {
    check(`function f() {
  try {
    try { a(); } finally { c(); }
  } catch (e) { h(e); }
}`, [
      'stmt a()', 'stmt c() <- stmt a()', 'stmt c() <- stmt a() /throw', 'rethrow rethrow',
      'catch catch (e)', 'stmt h(e)',
    ], [
      'entry entry -> stmt a()',
      'stmt a() -> stmt c() <- stmt a()',
      'stmt a() -> stmt c() <- stmt a() /throw [throw]',
      'stmt c() <- stmt a() -> exit exit',
      'stmt c() <- stmt a() -> catch catch (e) [throw]',
      'stmt c() <- stmt a() /throw -> catch catch (e) [throw]',
      'stmt c() <- stmt a() /throw -> rethrow rethrow',
      'rethrow rethrow -> catch catch (e) [throw]',
      'catch catch (e) -> stmt h(e)',
      'stmt h(e) -> exit exit',
    ]);
  });
});

describe('CFG: short-circuit and ternary are branches', () => {
  it('&& and ?: in value position', () => {
    check(`function f(p, q, r, s, t) {
  const x = p && q();
  return r ? s : t;
}`, [
      'cond p', 'expr q()', 'stmt const x = p && q()', 'cond r', 'expr s', 'expr t', 'return return r ? s : t',
    ], [
      'entry entry -> cond p',
      'cond p -> expr q() [true]',
      'cond p -> stmt const x = p && q() [false]',
      'expr q() -> stmt const x = p && q()',
      'stmt const x = p && q() -> cond r',
      'cond r -> expr s [true]',
      'cond r -> expr t [false]',
      'expr s -> return return r ? s : t',
      'expr t -> return return r ? s : t',
      'return return r ? s : t -> exit exit',
    ]);
  });

  it('&& || inside a condition are one node per operand; ?? tests for null', () => {
    check(`function f(a, b, c) {
  if (a && (b || c)) { yes(); }
  const d = a ?? b;
}`, [
      'cond a', 'cond b', 'cond c', 'stmt yes()', 'cond a == null', 'expr b', 'stmt const d = a ?? b',
    ], [
      'entry entry -> cond a',
      'cond a -> cond b [true]',
      'cond a -> cond a == null [false]',
      'cond b -> stmt yes() [true]',
      'cond b -> cond c [false]',
      'cond c -> stmt yes() [true]',
      'cond c -> cond a == null [false]',
      'stmt yes() -> cond a == null',
      'cond a == null -> expr b [true]',
      'cond a == null -> stmt const d = a ?? b [false]',
      'expr b -> stmt const d = a ?? b',
      'stmt const d = a ?? b -> exit exit',
    ]);
  });

  it('negated disjunction swaps the exits', () => {
    check(`function f(a, b) {
  while (!(a || b)) { step(); }
}`, ['loop a', 'loop b', 'stmt step()'], [
      'entry entry -> loop a',
      'loop a -> exit exit [true]',
      'loop a -> loop b [false]',
      'loop b -> exit exit [true]',
      'loop b -> stmt step() [false]',
      'stmt step() -> loop a',
    ]);
  });
});

describe('CFG: calls, closures, limits', () => {
  it('lists the callees a node evaluates, constructors as `new X`', () => {
    const { cfg } = flowOf(`function f(url, opts) {
  const r = await fetch(url, opts.get());
  return new Thing(r);
}`);
    expect(cfg!.nodes.filter(n => n.calls).map(n => [n.label, n.calls])).toEqual([
      ['const r = await fetch(url, opts.get())', ['fetch', 'opts.get']],
      ['return new Thing(r)', ['new Thing']],
    ]);
  });

  it('nested functions get their own graphs, in source order; hoisted declarations add no node', () => {
    const { cfg } = flowOf(`function f(a) {
  const inner = (x) => { if (x) return a; return 0; };
  function hoisted(y) { return y; }
  return inner(1);
}`);
    expect(cfgShape(cfg!)).toEqual({
      nodes: sorted(['entry entry', 'exit exit', 'stmt const inner = (x) => { if (x) return a; return 0; }', 'return return inner(1)']),
      edges: sorted([
        'entry entry -> stmt const inner = (x) => { if (x) return a; return 0; }',
        'stmt const inner = (x) => { if (x) return a; return 0; } -> return return inner(1)',
        'return return inner(1) -> exit exit',
      ]),
    });
    expect(cfg!.closures!.map(c => [c.name, c.line])).toEqual([['inner', 1], ['hoisted', 2]]);
    expect(cfgShape(cfg!.closures![0])).toEqual({
      nodes: sorted(['entry entry', 'exit exit', 'cond x', 'return return a', 'return return 0']),
      edges: sorted([
        'entry entry -> cond x',
        'cond x -> return return a [true]',
        'cond x -> return return 0 [false]',
        'return return a -> exit exit',
        'return return 0 -> exit exit',
      ]),
    });
    expect(cfgShape(cfg!.closures![1])).toEqual({
      nodes: sorted(['entry entry', 'exit exit', 'return return y']),
      edges: sorted(['entry entry -> return return y', 'return return y -> exit exit']),
    });
  });

  it('caps a huge function at the node limit with an explicit marker', () => {
    const body = Array.from({ length: 600 }, (_, i) => `  s${i}();`).join('\n');
    const { cfg } = flowOf(`function f() {\n${body}\n}`);
    expect(cfg!.truncated).toEqual({ nodes: 602, limit: MAX_FLOW_NODES });
    expect(cfg!.nodes).toHaveLength(MAX_FLOW_NODES);
    expect(cfg!.edges.every(e => cfg!.nodes.some(n => n.id === e.to) && cfg!.nodes.some(n => n.id === e.from))).toBe(true);
  });

  it('a function within the limit carries no marker', () => {
    expect(flowOf('function f() { a(); }').cfg!.truncated).toBeUndefined();
  });
});
