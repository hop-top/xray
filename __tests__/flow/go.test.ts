import { cfgCheck, dfgCheck, flowOf, cfgShape, sorted } from './helpers';

/**
 * Go flow: exact graphs written by hand from what each function means.
 * Copies of the deferred calls (one per way out of the function) are told
 * apart by their predecessors, as in the other languages.
 */
const cfg = cfgCheck('go');
const dfg = dfgCheck('go');

describe('Go CFG: statements', () => {
  it('multiple return values; each return leaves the function', () => {
    cfg(`func f(a int) (int, error) {
	b := a + 1
	if b > 3 {
		return b, nil
	}
	return 0, errBad
}`, ['stmt b := a + 1', 'cond b > 3', 'return return b, nil', 'return return 0, errBad'], [
      'entry entry -> stmt b := a + 1',
      'stmt b := a + 1 -> cond b > 3',
      'cond b > 3 -> return return b, nil [true]',
      'cond b > 3 -> return return 0, errBad [false]',
      'return return b, nil -> exit exit',
      'return return 0, errBad -> exit exit',
    ]);
  });

  it('range, three-part for, condition-only for and endless for with break', () => {
    cfg(`func f(xs []int, n int) {
	for _, x := range xs {
		use(x)
	}
	for i := 0; i < n; i++ {
		if skip(i) {
			continue
		}
		work(i)
	}
	for ready() {
		tick()
	}
	for {
		if done() {
			break
		}
	}
	end()
}`, [
      'loop for _, x := range xs', 'stmt use(x)',
      'stmt i := 0', 'loop i < n', 'cond skip(i)', 'continue continue', 'stmt work(i)', 'stmt i++',
      'loop ready()', 'stmt tick()', 'cond done()', 'break break', 'stmt end()',
    ], [
      'entry entry -> loop for _, x := range xs',
      'loop for _, x := range xs -> stmt use(x) [true]',
      'loop for _, x := range xs -> stmt i := 0 [false]',
      'stmt use(x) -> loop for _, x := range xs',
      'stmt i := 0 -> loop i < n',
      'loop i < n -> cond skip(i) [true]',
      'loop i < n -> loop ready() [false]',
      'cond skip(i) -> continue continue [true]',
      'cond skip(i) -> stmt work(i) [false]',
      'continue continue -> stmt i++',
      'stmt work(i) -> stmt i++',
      'stmt i++ -> loop i < n',
      'loop ready() -> stmt tick() [true]',
      'loop ready() -> cond done() [false]',
      'stmt tick() -> loop ready()',
      'cond done() -> break break [true]',
      'cond done() -> cond done() [false]',
      'break break -> stmt end()',
      'stmt end() -> exit exit',
    ]);
  });

  it('range with no variables, and over a channel', () => {
    cfg(`func f(ch chan int) {
	for range ch {
		tick()
	}
}`, ['loop for range ch', 'stmt tick()'], [
      'entry entry -> loop for range ch',
      'loop for range ch -> stmt tick() [true]',
      'loop for range ch -> exit exit [false]',
      'stmt tick() -> loop for range ch',
    ]);
  });

  it('labelled break and continue name the outer loop', () => {
    cfg(`func f(n int) {
outer:
	for i := 0; i < n; i++ {
		for j := range n {
			if j == 2 {
				continue outer
			}
			if j == 3 {
				break outer
			}
		}
	}
	end()
}`, [
      'stmt i := 0', 'loop i < n', 'loop for j := range n', 'cond j == 2', 'continue continue outer',
      'cond j == 3', 'break break outer', 'stmt i++', 'stmt end()',
    ], [
      'entry entry -> stmt i := 0',
      'stmt i := 0 -> loop i < n',
      'loop i < n -> loop for j := range n [true]',
      'loop i < n -> stmt end() [false]',
      'loop for j := range n -> cond j == 2 [true]',
      'loop for j := range n -> stmt i++ [false]',
      'cond j == 2 -> continue continue outer [true]',
      'cond j == 2 -> cond j == 3 [false]',
      'continue continue outer -> stmt i++',
      'cond j == 3 -> break break outer [true]',
      'cond j == 3 -> loop for j := range n [false]',
      'break break outer -> stmt end()',
      'stmt i++ -> loop i < n',
      'stmt end() -> exit exit',
    ]);
  });

  it('goto: backwards to a label, and forwards past code', () => {
    cfg(`func f(n int) int {
	i := 0
again:
	if i < n {
		i++
		goto again
	}
	return i
}`, ['stmt i := 0', 'cond i < n', 'stmt i++', 'goto goto again', 'return return i'], [
      'entry entry -> stmt i := 0',
      'stmt i := 0 -> cond i < n',
      'cond i < n -> stmt i++ [true]',
      'cond i < n -> return return i [false]',
      'stmt i++ -> goto goto again',
      'goto goto again -> cond i < n',
      'return return i -> exit exit',
    ]);
    cfg(`func f(a int) int {
	if a > 0 {
		goto out
	}
	work()
out:
	return a
}`, ['cond a > 0', 'goto goto out', 'stmt work()', 'return return a'], [
      'entry entry -> cond a > 0',
      'cond a > 0 -> goto goto out [true]',
      'cond a > 0 -> stmt work() [false]',
      'goto goto out -> return return a',
      'stmt work() -> return return a',
      'return return a -> exit exit',
    ]);
  });

  it('a label nothing falls into is still reached by the goto before it', () => {
    cfg(`func f(a int) int {
	goto out
out:
	return a
}`, ['goto goto out', 'return return a'], [
      'entry entry -> goto goto out',
      'goto goto out -> return return a',
      'return return a -> exit exit',
    ]);
  });

  it('panic leaves by a throw edge', () => {
    cfg(`func f(a int) {
	if a < 0 {
		panic("neg")
	}
	ok()
}`, ['cond a < 0', 'throw panic("neg")', 'stmt ok()'], [
      'entry entry -> cond a < 0',
      'cond a < 0 -> throw panic("neg") [true]',
      'cond a < 0 -> stmt ok() [false]',
      'throw panic("neg") -> exit exit [throw]',
      'stmt ok() -> exit exit',
    ]);
  });
});

describe('Go CFG: switch', () => {
  it('init, tag, several values per case, fallthrough into the next body, default last', () => {
    cfg(`func f(x int) string {
	switch y := x % 3; y {
	case 0:
		a()
		fallthrough
	case 1, 2:
		b()
	default:
		c()
	}
	return "x"
}`, [
      'stmt y := x % 3', 'switch y', 'case 0', 'case 1, 2', 'stmt a()', 'stmt fallthrough', 'stmt b()',
      'stmt c()', 'return return "x"',
    ], [
      'entry entry -> stmt y := x % 3',
      'stmt y := x % 3 -> switch y',
      'switch y -> case 0',
      'case 0 -> stmt a() [true]',
      'case 0 -> case 1, 2 [false]',
      'case 1, 2 -> stmt b() [true]',
      'case 1, 2 -> stmt c() [false]',
      'stmt a() -> stmt fallthrough',
      'stmt fallthrough -> stmt b()',
      'stmt b() -> return return "x"',
      'stmt c() -> return return "x"',
      'return return "x" -> exit exit',
    ]);
  });

  it('a case does not run into the next one; break leaves the switch; no default can fall past all cases', () => {
    cfg(`func f(x int) {
	switch x {
	case 1:
		if p() {
			break
		}
		q()
	case 2:
		r()
	}
	end()
}`, ['switch x', 'case 1', 'cond p()', 'break break', 'stmt q()', 'case 2', 'stmt r()', 'stmt end()'], [
      'entry entry -> switch x',
      'switch x -> case 1',
      'case 1 -> cond p() [true]',
      'case 1 -> case 2 [false]',
      'cond p() -> break break [true]',
      'cond p() -> stmt q() [false]',
      'break break -> stmt end()',
      'stmt q() -> stmt end()',
      'case 2 -> stmt r() [true]',
      'case 2 -> stmt end() [false]',
      'stmt r() -> stmt end()',
      'stmt end() -> exit exit',
    ]);
  });

  it('a switch without a tag tests each condition in turn', () => {
    cfg(`func f(i int) {
	switch {
	case i > 1:
		big()
	case i < 0:
		neg()
	}
}`, ['case i > 1', 'stmt big()', 'case i < 0', 'stmt neg()'], [
      'entry entry -> case i > 1',
      'case i > 1 -> stmt big() [true]',
      'case i > 1 -> case i < 0 [false]',
      'case i < 0 -> stmt neg() [true]',
      'case i < 0 -> exit exit [false]',
      'stmt big() -> exit exit',
      'stmt neg() -> exit exit',
    ]);
  });

  it('a type switch tests each type list; an empty case continues after the switch', () => {
    cfg(`func f(v interface{}) {
	switch t := v.(type) {
	case int, string:
		use(t)
	case nil:
	}
	end()
}`, ['switch v.(type)', 'case int, string', 'stmt use(t)', 'case nil', 'stmt end()'], [
      'entry entry -> switch v.(type)',
      'switch v.(type) -> case int, string',
      'case int, string -> stmt use(t) [true]',
      'case int, string -> case nil [false]',
      'case nil -> stmt end() [true]',
      'case nil -> stmt end() [false]',
      'stmt use(t) -> stmt end()',
      'stmt end() -> exit exit',
    ]);
  });
});

describe('Go CFG: select, go', () => {
  it('select enters exactly one communication; default is taken when none is ready', () => {
    cfg(`func f(ch chan int, done chan struct{}) {
	select {
	case v := <-ch:
		use(v)
	case ch <- 1:
	case <-done:
		return
	default:
		idle()
	}
	end()
}`, [
      'switch select', 'stmt case v := <-ch', 'stmt use(v)', 'stmt case ch <- 1', 'stmt case <-done',
      'return return', 'stmt idle()', 'stmt end()',
    ], [
      'entry entry -> switch select',
      'switch select -> stmt case v := <-ch',
      'switch select -> stmt case ch <- 1',
      'switch select -> stmt case <-done',
      'switch select -> stmt idle()',
      'stmt case v := <-ch -> stmt use(v)',
      'stmt use(v) -> stmt end()',
      'stmt case ch <- 1 -> stmt end()',
      'stmt case <-done -> return return',
      'return return -> exit exit',
      'stmt idle() -> stmt end()',
      'stmt end() -> exit exit',
    ]);
  });

  it('select {} blocks forever: nothing leaves it', () => {
    cfg(`func f() {
	select {}
}`, ['switch select'], ['entry entry -> switch select']);
  });

  it('break inside a select leaves the select', () => {
    cfg(`func f(ch chan int) {
	select {
	case <-ch:
		break
	}
	end()
}`, ['switch select', 'stmt case <-ch', 'break break', 'stmt end()'], [
      'entry entry -> switch select',
      'switch select -> stmt case <-ch',
      'stmt case <-ch -> break break',
      'break break -> stmt end()',
      'stmt end() -> exit exit',
    ]);
  });

  it('go: arguments evaluate here, the call runs elsewhere; closures are their own graphs', () => {
    const { cfg: c } = flowOf(`func f(n int) {
	ch := make(chan int)
	go worker(ch, n)
	go func(k int) { ch <- k }(n)
	fn := func(a int) int { return a + n }
	_ = fn
}`, 'f', { cfg: true, dfg: true }, undefined, 'go');
    expect(cfgShape(c!)).toEqual({
      nodes: sorted([
        'entry entry', 'exit exit', 'stmt ch := make(chan int)', 'stmt go worker(ch, n)',
        'stmt go func(k int) { ch <- k }(n)', 'stmt fn := func(a int) int { return a + n }', 'stmt _ = fn',
      ]),
      edges: sorted([
        'entry entry -> stmt ch := make(chan int)',
        'stmt ch := make(chan int) -> stmt go worker(ch, n)',
        'stmt go worker(ch, n) -> stmt go func(k int) { ch <- k }(n)',
        'stmt go func(k int) { ch <- k }(n) -> stmt fn := func(a int) int { return a + n }',
        'stmt fn := func(a int) int { return a + n } -> stmt _ = fn',
        'stmt _ = fn -> exit exit',
      ]),
    });
    expect(c!.closures!.map(x => x.name)).toEqual(['<anonymous>', 'fn']);
    expect(c!.nodes.find(n => n.label === 'go worker(ch, n)')!.calls).toEqual(['worker']);
  });
});

describe('Go CFG: defer', () => {
  it('a deferred call runs on every way out after it was registered, and on a panic', () => {
    cfg(`func f(p string) error {
	fh, err := open(p)
	if err != nil {
		return err
	}
	defer fh.Close()
	work(fh)
	return nil
}`, [
      'stmt fh, err := open(p)', 'cond err != nil', 'return return err', 'stmt defer fh.Close()', 'stmt work(fh)',
      'return return nil',
      'stmt deferred fh.Close() <- return return nil',
      'stmt deferred fh.Close() <- stmt work(fh) /throw',
      'rethrow rethrow',
    ], [
      'entry entry -> stmt fh, err := open(p)',
      'stmt fh, err := open(p) -> cond err != nil',
      'cond err != nil -> return return err [true]',
      'cond err != nil -> stmt defer fh.Close() [false]',
      'return return err -> exit exit',
      'stmt defer fh.Close() -> stmt work(fh)',
      'stmt work(fh) -> return return nil',
      'stmt work(fh) -> stmt deferred fh.Close() <- stmt work(fh) /throw [throw]',
      'return return nil -> stmt deferred fh.Close() <- return return nil',
      'stmt deferred fh.Close() <- return return nil -> exit exit',
      'stmt deferred fh.Close() <- stmt work(fh) /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });

  it('falling off the end runs the deferred calls too', () => {
    cfg(`func f() {
	defer a()
	work()
}`, [
      'stmt defer a()', 'stmt work()',
      'stmt deferred a() <- stmt work()',
      'stmt deferred a() <- stmt work() /throw',
      'rethrow rethrow',
    ], [
      'entry entry -> stmt defer a()',
      'stmt defer a() -> stmt work()',
      'stmt work() -> stmt deferred a() <- stmt work()',
      'stmt work() -> stmt deferred a() <- stmt work() /throw [throw]',
      'stmt deferred a() <- stmt work() -> exit exit',
      'stmt deferred a() <- stmt work() /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });

  it('a go statement does not panic into this function: its call runs elsewhere', () => {
    cfg(`func f() {
	defer a()
	go work()
}`, ['stmt defer a()', 'stmt go work()', 'stmt deferred a()'], [
      'entry entry -> stmt defer a()',
      'stmt defer a() -> stmt go work()',
      'stmt go work() -> stmt deferred a()',
      'stmt deferred a() -> exit exit',
    ]);
  });

  it('deferred calls run last in, first out, and only those registered before the way out', () => {
    cfg(`func f(c bool) {
	defer a()
	if c {
		return
	}
	defer b()
	work()
}`, [
      'stmt defer a()', 'cond c', 'return return', 'stmt defer b()', 'stmt work()',
      'stmt deferred a() <- return return',
      'stmt deferred b() <- stmt work()',
      'stmt deferred b() <- stmt work() /throw',
      'stmt deferred a() <- stmt deferred b() <- stmt work()',
      'stmt deferred a() <- stmt deferred b() <- stmt work() /throw',
      'rethrow rethrow',
    ], [
      'entry entry -> stmt defer a()',
      'stmt defer a() -> cond c',
      'cond c -> return return [true]',
      'cond c -> stmt defer b() [false]',
      'return return -> stmt deferred a() <- return return',
      'stmt deferred a() <- return return -> exit exit',
      'stmt defer b() -> stmt work()',
      'stmt work() -> stmt deferred b() <- stmt work()',
      'stmt work() -> stmt deferred b() <- stmt work() /throw [throw]',
      'stmt deferred b() <- stmt work() -> stmt deferred a() <- stmt deferred b() <- stmt work()',
      'stmt deferred a() <- stmt deferred b() <- stmt work() -> exit exit',
      'stmt deferred b() <- stmt work() /throw -> stmt deferred a() <- stmt deferred b() <- stmt work() /throw',
      'stmt deferred a() <- stmt deferred b() <- stmt work() /throw -> rethrow rethrow',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });

  it('each return gets the deferred calls registered before it, not those of another return', () => {
    cfg(`func f(c, d bool) {
	defer a()
	if c {
		return
	}
	defer b()
	if d {
		return
	}
}`, [
      'stmt defer a()', 'cond c', 'return return <- cond c /true', 'stmt defer b()', 'cond d',
      'return return <- cond d /true',
      'stmt deferred a() <- return return',
      'stmt deferred b() <- return return',
      'stmt deferred a() <- stmt deferred b() <- return return',
      'stmt deferred b() <- cond d /false',
      'stmt deferred a() <- stmt deferred b() <- cond d /false',
    ], [
      'entry entry -> stmt defer a()',
      'stmt defer a() -> cond c',
      'cond c -> return return <- cond c /true [true]',
      'cond c -> stmt defer b() [false]',
      'return return <- cond c /true -> stmt deferred a() <- return return',
      'stmt deferred a() <- return return -> exit exit',
      'stmt defer b() -> cond d',
      'cond d -> return return <- cond d /true [true]',
      'cond d -> stmt deferred b() <- cond d /false [false]',
      'return return <- cond d /true -> stmt deferred b() <- return return',
      'stmt deferred b() <- return return -> stmt deferred a() <- stmt deferred b() <- return return',
      'stmt deferred a() <- stmt deferred b() <- return return -> exit exit',
      'stmt deferred b() <- cond d /false -> stmt deferred a() <- stmt deferred b() <- cond d /false',
      'stmt deferred a() <- stmt deferred b() <- cond d /false -> exit exit',
    ]);
  });

  it('a deferred function literal that calls recover may stop the panic: the function then returns normally', () => {
    cfg(`func f(xs []int) (n int, err error) {
	defer func() { err = wrap(recover()) }()
	for _, x := range xs {
		if x < 0 {
			panic("neg")
		}
		n += x
	}
	return n, nil
}`, [
      'stmt defer func() { err = wrap(recover()) }()',
      'loop for _, x := range xs', 'cond x < 0', 'throw panic("neg")', 'stmt n += x', 'return return n, nil',
      'stmt deferred func() { err = wrap(recover()) }() <- return return n, nil',
      'stmt deferred func() { err = wrap(recover()) }() <- throw panic("neg") /throw',
      'stmt recovered', 'rethrow rethrow',
    ], [
      'entry entry -> stmt defer func() { err = wrap(recover()) }()',
      'stmt defer func() { err = wrap(recover()) }() -> loop for _, x := range xs',
      'loop for _, x := range xs -> cond x < 0 [true]',
      'loop for _, x := range xs -> return return n, nil [false]',
      'cond x < 0 -> throw panic("neg") [true]',
      'cond x < 0 -> stmt n += x [false]',
      'stmt n += x -> loop for _, x := range xs',
      'throw panic("neg") -> stmt deferred func() { err = wrap(recover()) }() <- throw panic("neg") /throw [throw]',
      'return return n, nil -> stmt deferred func() { err = wrap(recover()) }() <- return return n, nil',
      'stmt deferred func() { err = wrap(recover()) }() <- return return n, nil -> exit exit',
      'stmt deferred func() { err = wrap(recover()) }() <- throw panic("neg") /throw -> stmt recovered',
      'stmt deferred func() { err = wrap(recover()) }() <- throw panic("neg") /throw -> rethrow rethrow',
      'stmt recovered -> exit exit',
      'rethrow rethrow -> exit exit [throw]',
    ]);
  });
});

describe('Go DFG', () => {
  it('named results are defined at entry, assigned by `return a, b`, and read where the function exits', () => {
    dfg(`func f(a, b int) (q, r int, err error) {
	if b == 0 {
		err = errDiv
		return
	}
	q, r = a/b, a%b
	return
}`, [
      'a:param@1', 'b:param@1', 'q:decl@1', 'r:decl@1', 'err:decl@1', 'err:assign@3', 'q:assign@6', 'r:assign@6',
    ], [
      'b:param@1 -> cond b == 0',
      'a:param@1 -> stmt q, r = a/b, a%b',
      'b:param@1 -> stmt q, r = a/b, a%b',
      'q:decl@1 -> exit exit',
      'r:decl@1 -> exit exit',
      'err:decl@1 -> exit exit',
      'err:assign@3 -> exit exit',
      'q:assign@6 -> exit exit',
      'r:assign@6 -> exit exit',
    ]);
  });

  it('return with values assigns the named results before the deferred calls run', () => {
    dfg(`func f(x int) (n int, err error) {
	defer func() { err = fix(err) }()
	return x, nil
}`, ['x:param@1', 'n:decl@1', 'err:decl@1 captured', 'n:assign@3', 'err:assign@3 captured'], [
      'err:decl@1 captured -> stmt defer func() { err = fix(err) }()',
      'x:param@1 -> return return x, nil',
      'n:assign@3 -> exit exit',
      'err:assign@3 captured -> exit exit',
    ]);
  });

  it(':= declares in the block; a name already in that block is assigned, a name in an outer block is shadowed', () => {
    dfg(`func f() int {
	x := 1
	if cond {
		x := 2
		use(x)
	}
	a, x := 3, 4
	return a + x
}`, ['x:decl@2', 'x:decl@4', 'a:decl@7', 'x:decl@7'], [
      'x:decl@4 -> stmt use(x)',
      'a:decl@7 -> return return a + x',
      'x:decl@7 -> return return a + x',
    ]);
  });

  it('range with = assigns existing variables; var declares with a zero value', () => {
    dfg(`func f(xs []int) int {
	var last int
	var i int
	for i = range xs {
		last = xs[i]
	}
	return last + i
}`, ['xs:param@1', 'last:decl@2', 'i:decl@3', 'i:loop@4', 'last:assign@5'], [
      'xs:param@1 -> loop for i = range xs',
      'xs:param@1 -> stmt last = xs[i]',
      'i:loop@4 -> stmt last = xs[i]',
      'last:decl@2 -> return return last + i',
      'last:assign@5 -> return return last + i',
      'i:loop@4 -> return return last + i',
    ]);
  });

  it('type switch: the alias is defined at the switch and read in the clauses', () => {
    dfg(`func f(v interface{}) {
	switch t := v.(type) {
	case int:
		use(t)
	}
}`, ['v:param@1', 't:decl@2'], [
      'v:param@1 -> switch v.(type)',
      't:decl@2 -> stmt use(t)',
    ]);
  });

  it('a closure counts as a read where it is created; the variable is captured', () => {
    dfg(`func f() int {
	n := 0
	inc := func() { n++ }
	inc()
	return n
}`, ['n:decl@2 captured', 'inc:decl@3'], [
      'n:decl@2 captured -> stmt inc := func() { n++ }',
      'inc:decl@3 -> stmt inc()',
      'n:decl@2 captured -> return return n',
    ]);
  });

  it('the blank identifier binds nothing and is never read', () => {
    dfg(`func f(xs []int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	_ = t
	return t
}`, ['xs:param@1', 't:decl@2', 'x:loop@3', 't:update@4'], [
      'xs:param@1 -> loop for _, x := range xs',
      'x:loop@3 -> stmt t += x',
      't:decl@2 -> stmt t += x',
      't:update@4 -> stmt t += x',
      't:decl@2 -> stmt _ = t',
      't:update@4 -> stmt _ = t',
      't:decl@2 -> return return t',
      't:update@4 -> return return t',
    ]);
  });

  it('a struct literal key is a field name, a map literal key is a read', () => {
    dfg(`func f(name, k string) {
	a := Config{name: 1}
	b := map[string]int{k: 2}
	use(a, b)
}`, ['name:param@1', 'k:param@1', 'a:decl@2', 'b:decl@3'], [
      'k:param@1 -> stmt b := map[string]int{k: 2}',
      'a:decl@2 -> stmt use(a, b)',
      'b:decl@3 -> stmt use(a, b)',
    ]);
  });

  it('a write through a pointer reads the pointer', () => {
    dfg(`func f(p *int) {
	*p = 3
}`, ['p:param@1'], ['p:param@1 -> stmt *p = 3']);
  });
});
