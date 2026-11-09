import { cfgCheck, dfgCheck, flowOf, cfgShape, sorted } from './helpers';

/**
 * Python flow: exact graphs written by hand from what each function means.
 * `entry` / `exit` are the function's own. A name the function has more than
 * once (the copies of a `finally` or a `with` exit) is told apart by its
 * predecessors: `<kind> <label> <- <pred>, <pred> /<edge label>`.
 */
const cfg = cfgCheck('py');
const dfg = dfgCheck('py');

describe('Python CFG: straight line and branches', () => {
  it('chains statements; a lambda body is an implicit return', () => {
    cfg(`def f(a):
    b = a + 1
    log(b)
    assert b, "positive"
    return b`, ['stmt b = a + 1', 'stmt log(b)', 'stmt assert b, "positive"', 'return return b'], [
      'entry entry -> stmt b = a + 1',
      'stmt b = a + 1 -> stmt log(b)',
      'stmt log(b) -> stmt assert b, "positive"',
      'stmt assert b, "positive" -> return return b',
      'return return b -> exit exit',
    ]);
    cfg(`f = lambda a: a * 2`, ['return return a * 2'], [
      'entry entry -> return return a * 2', 'return return a * 2 -> exit exit']);
  });

  it('if / elif / else join at the next statement', () => {
    cfg(`def f(a):
    if a > 0:
        pos()
    elif a < 0:
        neg()
    else:
        zero()
    done()`, ['cond a > 0', 'stmt pos()', 'cond a < 0', 'stmt neg()', 'stmt zero()', 'stmt done()'], [
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

  it('and / or / not split into one node per operand; a conditional expression branches', () => {
    cfg(`def f(a, b, c, d):
    if a and (b or not c):
        yes()
    return 1 if d else 2`, [
      'cond a', 'cond b', 'cond not c', 'stmt yes()', 'cond d', 'expr 1', 'expr 2', 'return return 1 if d else 2',
    ], [
      'entry entry -> cond a',
      'cond a -> cond b [true]',
      'cond a -> cond d [false]',
      'cond b -> stmt yes() [true]',
      'cond b -> cond not c [false]',
      'cond not c -> stmt yes() [true]',
      'cond not c -> cond d [false]',
      'stmt yes() -> cond d',
      'cond d -> expr 1 [true]',
      'cond d -> expr 2 [false]',
      'expr 1 -> return return 1 if d else 2',
      'expr 2 -> return return 1 if d else 2',
      'return return 1 if d else 2 -> exit exit',
    ]);
  });

  it('a comprehension is one node: what is inside it does not branch', () => {
    cfg(`def f(xs):
    y = [a if a else 0 for a in xs if a]
    return y`, ['stmt y = [a if a else 0 for a in xs if a]', 'return return y'], [
      'entry entry -> stmt y = [a if a else 0 for a in xs if a]',
      'stmt y = [a if a else 0 for a in xs if a] -> return return y',
      'return return y -> exit exit',
    ]);
  });
});

describe('Python CFG: loops with else', () => {
  it('for/else: else runs when the loop ends by its iterator, break skips it', () => {
    cfg(`def f(xs):
    for x in xs:
        if x:
            break
    else:
        none()
    done()`, ['loop for x in xs', 'cond x', 'break break', 'stmt none()', 'stmt done()'], [
      'entry entry -> loop for x in xs',
      'loop for x in xs -> cond x [true]',
      'loop for x in xs -> stmt none() [false]',
      'cond x -> break break [true]',
      'cond x -> loop for x in xs [false]',
      'break break -> stmt done()',
      'stmt none() -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });

  it('while/else with continue', () => {
    cfg(`def f(c):
    while c():
        if skip():
            continue
        work()
    else:
        fin()
    return 1`, [
      'loop c()', 'cond skip()', 'continue continue', 'stmt work()', 'stmt fin()', 'return return 1',
    ], [
      'entry entry -> loop c()',
      'loop c() -> cond skip() [true]',
      'loop c() -> stmt fin() [false]',
      'cond skip() -> continue continue [true]',
      'cond skip() -> stmt work() [false]',
      'continue continue -> loop c()',
      'stmt work() -> loop c()',
      'stmt fin() -> return return 1',
      'return return 1 -> exit exit',
    ]);
  });

  it('a break inside an else belongs to the enclosing loop', () => {
    cfg(`def f(xs, ys):
    for x in xs:
        for y in ys:
            pass
        else:
            break
    done()`, ['loop for x in xs', 'loop for y in ys', 'break break', 'stmt done()'], [
      'entry entry -> loop for x in xs',
      'loop for x in xs -> loop for y in ys [true]',
      'loop for x in xs -> stmt done() [false]',
      'loop for y in ys -> loop for y in ys [true]',
      'loop for y in ys -> break break [false]',
      'break break -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });
});

describe('Python CFG: with', () => {
  it('the exit runs once per way out: normal and exception', () => {
    cfg(`def f(p):
    with open(p) as fh:
        use(fh)
    done()`, [
      'stmt with open(p) as fh', 'stmt use(fh)',
      'stmt end with open(p) as fh <- stmt use(fh)',
      'stmt end with open(p) as fh <- stmt use(fh) /throw',
      'rethrow rethrow', 'stmt done()',
    ], [
      'entry entry -> stmt with open(p) as fh',
      'stmt with open(p) as fh -> stmt use(fh)',
      'stmt use(fh) -> stmt end with open(p) as fh <- stmt use(fh)',
      'stmt use(fh) -> stmt end with open(p) as fh <- stmt use(fh) /throw [throw]',
      'stmt end with open(p) as fh <- stmt use(fh) -> stmt done()',
      'stmt end with open(p) as fh <- stmt use(fh) /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
      'stmt done() -> exit exit',
    ]);
  });

  it('return inside with runs the exit first', () => {
    cfg(`def f(p):
    with ctx(p):
        return load(p)`, [
      'stmt with ctx(p)', 'return return load(p)',
      'stmt end with ctx(p) <- return return load(p)',
      'stmt end with ctx(p) <- return return load(p) /throw',
      'rethrow rethrow',
    ], [
      'entry entry -> stmt with ctx(p)',
      'stmt with ctx(p) -> return return load(p)',
      'return return load(p) -> stmt end with ctx(p) <- return return load(p)',
      'return return load(p) -> stmt end with ctx(p) <- return return load(p) /throw [throw]',
      'stmt end with ctx(p) <- return return load(p) -> exit exit',
      'stmt end with ctx(p) <- return return load(p) /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });

  it('two items are two nested exits, the inner one runs first', () => {
    cfg(`def f():
    with a() as x, b():
        use(x)`, [
      'stmt with a() as x', 'stmt with b()', 'stmt use(x)',
      'stmt end with b() <- stmt use(x)',
      'stmt end with b() <- stmt use(x) /throw',
      'stmt end with a() as x <- stmt end with b()',
      'stmt end with a() as x <- rethrow rethrow /throw, stmt with b() /throw',
      'rethrow rethrow <- stmt end with a() as x',
      'rethrow rethrow <- stmt end with b()',
    ], [
      'entry entry -> stmt with a() as x',
      'stmt with a() as x -> stmt with b()',
      'stmt with b() -> stmt use(x)',
      'stmt with b() -> stmt end with a() as x <- rethrow rethrow /throw, stmt with b() /throw [throw]',
      'stmt use(x) -> stmt end with b() <- stmt use(x)',
      'stmt use(x) -> stmt end with b() <- stmt use(x) /throw [throw]',
      'stmt end with b() <- stmt use(x) -> stmt end with a() as x <- stmt end with b()',
      'stmt end with b() <- stmt use(x) /throw -> rethrow rethrow <- stmt end with b()',
      'rethrow rethrow <- stmt end with b() -> stmt end with a() as x <- rethrow rethrow /throw, stmt with b() /throw [throw]',
      'stmt end with a() as x <- stmt end with b() -> exit exit',
      'stmt end with a() as x <- rethrow rethrow /throw, stmt with b() /throw -> rethrow rethrow <- stmt end with a() as x',
      'rethrow rethrow <- stmt end with a() as x -> exit exit [throw]',
    ]);
  });

  it('async with and async for are the same shapes with an await inside', () => {
    cfg(`async def f(xs, m):
    async for x in xs:
        await use(x)
    async with m as c:
        await c.go()`, [
      'loop async for x in xs', 'stmt await use(x)', 'stmt with m as c', 'stmt await c.go()',
      'stmt end with m as c <- stmt await c.go()',
      'stmt end with m as c <- stmt await c.go() /throw',
      'rethrow rethrow',
    ], [
      'entry entry -> loop async for x in xs',
      'loop async for x in xs -> stmt await use(x) [true]',
      'loop async for x in xs -> stmt with m as c [false]',
      'stmt await use(x) -> loop async for x in xs',
      'stmt with m as c -> stmt await c.go()',
      'stmt await c.go() -> stmt end with m as c <- stmt await c.go()',
      'stmt await c.go() -> stmt end with m as c <- stmt await c.go() /throw [throw]',
      'stmt end with m as c <- stmt await c.go() -> exit exit',
      'stmt end with m as c <- stmt await c.go() /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });
});

describe('Python CFG: try / except / else / finally', () => {
  it('an exception tries the handlers in order, else runs only without one, finally always', () => {
    cfg(`def f(p):
    try:
        a()
    except E as e:
        h(e)
    else:
        o()
    finally:
        k()
    return 1`, [
      'stmt a()', 'catch except E as e', 'stmt h(e)', 'stmt o()',
      'stmt k() <- stmt h(e), stmt o()',
      'stmt k() <- rethrow rethrow /throw, stmt h(e) /throw, stmt o() /throw',
      'rethrow rethrow <- catch except E as e /false',
      'rethrow rethrow <- stmt k()',
      'return return 1',
    ], [
      'entry entry -> stmt a()',
      'stmt a() -> catch except E as e [throw]',
      'stmt a() -> stmt o()',
      'catch except E as e -> stmt h(e) [true]',
      'catch except E as e -> rethrow rethrow <- catch except E as e /false [false]',
      'rethrow rethrow <- catch except E as e /false -> stmt k() <- rethrow rethrow /throw, stmt h(e) /throw, stmt o() /throw [throw]',
      'stmt h(e) -> stmt k() <- stmt h(e), stmt o()',
      'stmt h(e) -> stmt k() <- rethrow rethrow /throw, stmt h(e) /throw, stmt o() /throw [throw]',
      'stmt o() -> stmt k() <- stmt h(e), stmt o()',
      'stmt o() -> stmt k() <- rethrow rethrow /throw, stmt h(e) /throw, stmt o() /throw [throw]',
      'stmt k() <- stmt h(e), stmt o() -> return return 1',
      'stmt k() <- rethrow rethrow /throw, stmt h(e) /throw, stmt o() /throw -> rethrow rethrow <- stmt k()',
      'rethrow rethrow <- stmt k() -> exit exit [throw]',
      'return return 1 -> exit exit',
    ]);
  });

  it('two handlers are tried in turn; a bare except takes everything left', () => {
    cfg(`def f():
    try:
        a()
    except (E1, E2):
        h1()
    except:
        h2()`, [
      'stmt a()', 'catch except (E1, E2)', 'stmt h1()', 'catch except', 'stmt h2()',
    ], [
      'entry entry -> stmt a()',
      'stmt a() -> catch except (E1, E2) [throw]',
      'stmt a() -> exit exit',
      'catch except (E1, E2) -> stmt h1() [true]',
      'catch except (E1, E2) -> catch except [false]',
      'catch except -> stmt h2()',
      'stmt h1() -> exit exit',
      'stmt h2() -> exit exit',
    ]);
  });

  it('a try body that cannot raise by itself keeps its except: conservatively reachable', () => {
    cfg(`def f():
    try:
        x = 1
    except:
        y = 2`, ['stmt x = 1', 'catch except', 'stmt y = 2'], [
      'entry entry -> stmt x = 1',
      'stmt x = 1 -> catch except [throw]',
      'stmt x = 1 -> exit exit',
      'catch except -> stmt y = 2',
      'stmt y = 2 -> exit exit',
    ]);
  });

  it('anything that reads may raise, not only calls: a subscript reaches the except', () => {
    cfg(`def f(d, k):
    try:
        warm()
        v = d[k]
    except KeyError:
        v = 0
    return v`, [
      'stmt warm()', 'stmt v = d[k]', 'catch except KeyError', 'stmt v = 0', 'rethrow rethrow', 'return return v',
    ], [
      'entry entry -> stmt warm()',
      'stmt warm() -> stmt v = d[k]',
      'stmt warm() -> catch except KeyError [throw]',
      'stmt v = d[k] -> catch except KeyError [throw]',
      'stmt v = d[k] -> return return v',
      'catch except KeyError -> stmt v = 0 [true]',
      'catch except KeyError -> rethrow rethrow [false]',
      'rethrow rethrow -> exit exit [throw]',
      'stmt v = 0 -> return return v',
      'return return v -> exit exit',
    ]);
  });

  it('raise inside try goes to the handlers; an unmatched exception goes on', () => {
    cfg(`def f(a):
    try:
        raise E(a)
    except E:
        h()`, ['throw raise E(a)', 'catch except E', 'stmt h()', 'rethrow rethrow'], [
      'entry entry -> throw raise E(a)',
      'throw raise E(a) -> catch except E [throw]',
      'catch except E -> stmt h() [true]',
      'catch except E -> rethrow rethrow [false]',
      'rethrow rethrow -> exit exit [throw]',
      'stmt h() -> exit exit',
    ]);
  });

  it('raise with no handler leaves the function by a throw edge', () => {
    cfg(`def f(a):
    if a:
        raise ValueError(a)
    return 1`, ['cond a', 'throw raise ValueError(a)', 'return return 1'], [
      'entry entry -> cond a',
      'cond a -> throw raise ValueError(a) [true]',
      'cond a -> return return 1 [false]',
      'throw raise ValueError(a) -> exit exit [throw]',
      'return return 1 -> exit exit',
    ]);
  });

  it('yield may be resumed with an exception: it throws into the finally', () => {
    cfg(`def f():
    try:
        got = yield 1
    finally:
        done()`, [
      'stmt got = yield 1', 'stmt done() <- stmt got = yield 1', 'stmt done() <- stmt got = yield 1 /throw',
      'rethrow rethrow',
    ], [
      'entry entry -> stmt got = yield 1',
      'stmt got = yield 1 -> stmt done() <- stmt got = yield 1',
      'stmt got = yield 1 -> stmt done() <- stmt got = yield 1 /throw [throw]',
      'stmt done() <- stmt got = yield 1 -> exit exit',
      'stmt done() <- stmt got = yield 1 /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });
});

describe('Python CFG: match', () => {
  it('cases are tried in order; a guard that fails falls to the next case; `_` takes the rest', () => {
    cfg(`def f(cmd):
    match cmd:
        case [a, b] if a:
            one()
        case Color.RED:
            two()
        case _:
            three()
    done()`, [
      'switch cmd', 'case case [a, b]', 'cond a', 'stmt one()', 'case case Color.RED', 'stmt two()',
      'stmt three()', 'stmt done()',
    ], [
      'entry entry -> switch cmd',
      'switch cmd -> case case [a, b]',
      'case case [a, b] -> cond a [true]',
      'case case [a, b] -> case case Color.RED [false]',
      'cond a -> stmt one() [true]',
      'cond a -> case case Color.RED [false]',
      'case case Color.RED -> stmt two() [true]',
      'case case Color.RED -> stmt three() [false]',
      'stmt one() -> stmt done()',
      'stmt two() -> stmt done()',
      'stmt three() -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });

  it('without an irrefutable case the match can fall through', () => {
    cfg(`def f(cmd):
    match cmd:
        case 1:
            one()
    done()`, ['switch cmd', 'case case 1', 'stmt one()', 'stmt done()'], [
      'entry entry -> switch cmd',
      'switch cmd -> case case 1',
      'case case 1 -> stmt one() [true]',
      'case case 1 -> stmt done() [false]',
      'stmt one() -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });

  it('break inside a match belongs to the loop around it', () => {
    cfg(`def f(xs):
    for x in xs:
        match x:
            case 0:
                break
    done()`, ['loop for x in xs', 'switch x', 'case case 0', 'break break', 'stmt done()'], [
      'entry entry -> loop for x in xs',
      'loop for x in xs -> switch x [true]',
      'loop for x in xs -> stmt done() [false]',
      'switch x -> case case 0',
      'case case 0 -> break break [true]',
      'case case 0 -> loop for x in xs [false]',
      'break break -> stmt done()',
      'stmt done() -> exit exit',
    ]);
  });
});

describe('Python CFG: definitions', () => {
  it('a decorated def is one node (decorators run there); its body is a closure', () => {
    const { cfg: c } = flowOf(`def f(x):
    @d(x)
    def g(a=x):
        return a
    return g`, 'f', { cfg: true, dfg: true }, undefined, 'py');
    expect(cfgShape(c!)).toEqual({
      nodes: sorted(['entry entry', 'exit exit', 'stmt @d(x) def g(a=x)', 'return return g']),
      edges: sorted([
        'entry entry -> stmt @d(x) def g(a=x)',
        'stmt @d(x) def g(a=x) -> return return g',
        'return return g -> exit exit',
      ]),
    });
    expect(c!.closures!.map(x => x.name)).toEqual(['g']);
    expect(cfgShape(c!.closures![0]).nodes).toEqual(sorted(['entry entry', 'exit exit', 'return return a']));
  });

  it('a class is one node; methods are closures; lambdas too', () => {
    const { cfg: c } = flowOf(`def f(n):
    class K(Base):
        z = n
        def m(self):
            return self.z
    sq = lambda v: v * n
    return K`, 'f', { cfg: true, dfg: true }, undefined, 'py');
    expect(cfgShape(c!).nodes).toEqual(sorted([
      'entry entry', 'exit exit', 'stmt class K(Base)', 'stmt sq = lambda v: v * n', 'return return K',
    ]));
    expect(c!.closures!.map(x => x.name)).toEqual(['m', 'sq']);
  });
});

describe('Python DFG', () => {
  it('parameters of every kind define at entry', () => {
    dfg(`def f(a, b=1, *args, c, d: int = 2, **kw):
    return a + b + c + d + len(args) + len(kw)`,
    ['a:param@1', 'b:param@1', 'args:param@1', 'c:param@1', 'd:param@1', 'kw:param@1'], [
      'a:param@1 -> return return a + b + c + d + len(args) + len(kw)',
      'b:param@1 -> return return a + b + c + d + len(args) + len(kw)',
      'args:param@1 -> return return a + b + c + d + len(args) + len(kw)',
      'c:param@1 -> return return a + b + c + d + len(args) + len(kw)',
      'd:param@1 -> return return a + b + c + d + len(args) + len(kw)',
      'kw:param@1 -> return return a + b + c + d + len(args) + len(kw)',
    ]);
  });

  it('unpacking, chained assignment, augmented assignment', () => {
    dfg(`def f(p):
    a, (b, *c) = p
    d = e = a
    d += b
    return d, e, c`, [
      'p:param@1', 'a:assign@2', 'b:assign@2', 'c:assign@2', 'd:assign@3', 'e:assign@3', 'd:update@4',
    ], [
      'p:param@1 -> stmt a, (b, *c) = p',
      'a:assign@2 -> stmt d = e = a',
      'b:assign@2 -> stmt d += b',
      'd:assign@3 -> stmt d += b',
      'd:update@4 -> return return d, e, c',
      'e:assign@3 -> return return d, e, c',
      'c:assign@2 -> return return d, e, c',
    ]);
  });

  it('for/else: the loop variable reaches the else; the else definition kills the earlier ones', () => {
    dfg(`def f(xs):
    last = None
    for i, x in enumerate(xs):
        last = x
    else:
        last = i
    return last`, [
      'xs:param@1', 'last:assign@2', 'i:loop@3', 'x:loop@3', 'last:assign@4', 'last:assign@6',
    ], [
      'xs:param@1 -> loop for i, x in enumerate(xs)',
      'x:loop@3 -> stmt last = x',
      'i:loop@3 -> stmt last = i',
      'last:assign@6 -> return return last',
    ]);
  });

  it('comprehension variables are the comprehension\'s own: the outer name is not read', () => {
    dfg(`def f(xs, i):
    ys = [i * 2 for i in xs]
    return i`, ['xs:param@1', 'i:param@1', 'ys:assign@2'], [
      'xs:param@1 -> stmt ys = [i * 2 for i in xs]',
      'i:param@1 -> return return i',
    ]);
  });

  it('walrus binds in the function, also from inside a comprehension', () => {
    dfg(`def f(xs):
    if (n := len(xs)) > 3:
        return n
    return 0`, ['xs:param@1', 'n:assign@2'], [
      'xs:param@1 -> cond (n := len(xs)) > 3',
      'n:assign@2 -> return return n',
    ]);
    dfg(`def f(xs):
    ys = [z for x in xs if (z := x)]
    return z`, ['xs:param@1', 'z:assign@2', 'ys:assign@2'], [
      'xs:param@1 -> stmt ys = [z for x in xs if (z := x)]',
      'z:assign@2 -> return return z',
    ]);
  });

  it('nonlocal: the outer variable is captured, and the closure counts as a read where it is defined', () => {
    dfg(`def f():
    count = 0
    def inc():
        nonlocal count
        count += 1
    inc()
    return count`, ['count:assign@2 captured', 'inc:function@3'], [
      'count:assign@2 captured -> stmt def inc()',
      'inc:function@3 -> stmt inc()',
      'count:assign@2 captured -> return return count',
    ]);
  });

  it('an attribute name and a keyword argument name are not reads of a variable of that name', () => {
    dfg(`def f(a, b):
    x = a.b
    y = g(b=a)
    return x, y`, ['a:param@1', 'b:param@1', 'x:assign@2', 'y:assign@3'], [
      'a:param@1 -> stmt x = a.b',
      'a:param@1 -> stmt y = g(b=a)',
      'x:assign@2 -> return return x, y',
      'y:assign@3 -> return return x, y',
    ]);
  });

  it('global: assignments to a global define nothing here', () => {
    dfg(`def f(a):
    global G
    G = a
    return G`, ['a:param@1'], ['a:param@1 -> stmt G = a']);
  });

  it('with and except bind their aliases', () => {
    dfg(`def f(p):
    with open(p) as fh:
        data = fh.read()
    try:
        risky()
    except E as err:
        log(err)
    return data`, ['p:param@1', 'fh:decl@2', 'data:assign@3', 'err:catch@6'], [
      'p:param@1 -> stmt with open(p) as fh',
      'fh:decl@2 -> stmt data = fh.read()',
      'err:catch@6 -> stmt log(err)',
      'data:assign@3 -> return return data',
    ]);
  });

  it('a throwing assignment does not complete: the except sees the earlier value', () => {
    dfg(`def f(x):
    try:
        x = g(x)
    except E:
        use(x)
    return x`, ['x:param@1', 'x:assign@3'], [
      'x:param@1 -> stmt x = g(x)',
      'x:param@1 -> stmt use(x)',
      'x:param@1 -> return return x',
      'x:assign@3 -> return return x',
    ]);
  });

  it('match: captured names are only maybe defined at the test', () => {
    dfg(`def f(cmd):
    r = 0
    match cmd:
        case [a, b]:
            r = a
    return r`, ['cmd:param@1', 'r:assign@2', 'a:maybe@4 weak', 'b:maybe@4 weak', 'r:assign@5'], [
      'cmd:param@1 -> switch cmd',
      'a:maybe@4 weak -> stmt r = a',
      'r:assign@2 -> return return r',
      'r:assign@5 -> return return r',
    ]);
  });

  it('a lambda captures where it is created; its parameters are its own', () => {
    const { cfg: c, dfg: d } = flowOf(`def f(n):
    sq = lambda v: v * n
    return sq(2)`, 'f', { cfg: true, dfg: true }, undefined, 'py');
    expect(d!.nodes.map(x => `${x.name}:${x.kind}${x.captured ? ' captured' : ''}`).sort())
      .toEqual(['n:param captured', 'sq:assign']);
    expect(d!.edges.length).toBe(2);
    expect(d!.closures!.map(x => x.name)).toEqual(['sq']);
    expect(d!.closures![0].nodes.map(x => x.name)).toEqual(['v']);
    expect(c!.closures![0].nodes.map(x => x.kind)).toEqual(['entry', 'exit', 'return']);
  });

  it('imports bind names', () => {
    dfg(`def f():
    import os.path as p
    from m import a, b as c
    return p, a, c`, ['p:decl@2', 'a:decl@3', 'c:decl@3'], [
      'p:decl@2 -> return return p, a, c',
      'a:decl@3 -> return return p, a, c',
      'c:decl@3 -> return return p, a, c',
    ]);
  });

  it('a class body is no scope for its methods; its bases and body read outer names', () => {
    dfg(`def f(n):
    class K:
        z = n
        def m(self):
            return z
    return K`, ['n:param@1', 'K:class@2'], [
      'n:param@1 -> stmt class K',
      'K:class@2 -> return return K',
    ]);
  });
});
