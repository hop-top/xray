import type { StmtRule } from './table';
import { Cleanup, Frame, End, Node } from './cfg-core';
import { ExprFlow } from './cfg-expr';
import { emptyRefs, Refs } from './refs';
import { kids, pick, pickAll } from './scope';

/**
 * Statements with several arms: `switch`, `select`, `try`, `with`, `match`.
 * Arms are built by `stmt` / `block`, which the concrete builder supplies.
 */
export abstract class BranchFlow extends ExprFlow {
  protected abstract stmt(n: Node, ins: End[]): End[];
  protected abstract block(n: Node, ins: End[]): End[];

  /**
   * One more copy of cleanup code that shares syntax with its other copies:
   * what one copy claims (operands it scanned) must stay free for the next.
   */
  protected copyOf(body: Node, ins: End[]): End[] {
    const before = new Set(this.claimed);
    const outs = this.block(body, ins);
    this.claimed.clear();
    for (const id of before) this.claimed.add(id);
    return outs;
  }

  // ---- switch / select ---------------------------------------------------

  /** Statements of a clause: its `body` field, or (no such field) everything but its value. */
  private clauseBody(cl: Node): Node[] {
    const sc = this.table.switchClauses;
    if (sc.body) return cl.childrenForFieldName(sc.body);
    const values = new Set(this.values(cl).map(v => v.id));
    return kids(cl, this.table).filter(c => !values.has(c.id));
  }

  /** What a clause tests (`case 1, 2`, `case int, string`, `case <-ch`). */
  private values(cl: Node): Node[] {
    return this.table.switchClauses.value.flatMap(f => cl.childrenForFieldName(f));
  }

  private clauses(n: Node, rule: Extract<StmtRule, { kind: 'switch' }>): Node[] {
    const sc = this.table.switchClauses;
    const body = rule.body === undefined ? n : pick(n, rule.body);
    return body ? kids(body, this.table).filter(c => sc.cases.includes(c.type) || c.type === sc.default) : [];
  }

  protected switchStmt(n: Node, rule: Extract<StmtRule, { kind: 'switch' }>, ins: End[]): End[] {
    const labels = this.takeLabels();
    const initN = pick(n, rule.init);
    const start = initN ? this.stmt(initN, ins) : ins;
    const valueN = this.unwrap(pick(n, rule.value));
    const sc = this.table.switchClauses;
    let from: End[] = start;
    if (valueN) {
      const pre = this.chain(valueN, start);
      const refs = this.scanner.scan(valueN);
      this.scanner.bind(pick(n, rule.alias), 'decl', 'declare', refs);
      const sw = this.mk('switch', valueN.text + (rule.suffix ?? ''), valueN, refs, pre);
      this.thrower(sw, refs);
      from = [{ from: sw.id }];
    }
    const frame: Extract<Frame, { kind: 'switch' }> = { kind: 'switch', labels, breaks: [], falls: [] };
    this.frames.push(frame);
    const clauses = this.clauses(n, rule);
    // Dispatch first: one test per `case`, in order; `default` is what is left.
    let fails: End[] = from;
    const tests = new Map<number, string>();
    for (const cl of clauses) {
      if (cl.type === sc.default) continue;
      const vs = this.values(cl);
      const cpre = vs.length > 0 ? this.chainAll(vs, fails) : fails;
      const crefs = this.scanner.scanAll(vs);
      const text = vs.length > 0 ? cl.text.slice(vs[0].startIndex - cl.startIndex, vs[vs.length - 1].endIndex - cl.startIndex) : 'case';
      const cn = this.mk('case', text, vs[0] ?? null, crefs, cpre);
      this.thrower(cn, crefs);
      tests.set(cl.id, cn.id);
      fails = [{ from: cn.id, label: 'false' }];
    }
    // Then the bodies, in source order; a clause runs into the next only where the language says so.
    let fall: End[] = [];
    const outs: End[] = [];
    for (const cl of clauses) {
      const falls = frame.falls.splice(0);
      let cur: End[] = cl.type === sc.default
        ? [...fall, ...falls, ...fails]
        : [{ from: tests.get(cl.id)!, label: 'true' }, ...fall, ...falls];
      for (const st of this.clauseBody(cl)) {
        if (!this.table.ignore.includes(st.type)) cur = this.stmt(st, cur);
      }
      if (sc.fallsThrough) fall = cur;
      else outs.push(...cur);
    }
    this.frames.pop();
    const hasDefault = clauses.some(c => c.type === sc.default);
    return [...outs, ...fall, ...frame.breaks, ...(hasDefault ? [] : fails)];
  }

  private chainAll(nodes: Node[], ins: End[]): End[] {
    let outs = ins;
    for (const v of nodes) outs = this.chain(v, outs);
    return outs;
  }

  /** `select`: every communication is an alternative, entered from the select node. */
  protected selectStmt(n: Node, ins: End[]): End[] {
    const labels = this.takeLabels();
    const sw = this.mk('switch', 'select', n, emptyRefs(), ins);
    const frame: Extract<Frame, { kind: 'switch' }> = { kind: 'switch', labels, breaks: [], falls: [] };
    this.frames.push(frame);
    const sc = this.table.switchClauses;
    const outs: End[] = [];
    for (const cl of kids(n, this.table)) {
      if (!sc.cases.includes(cl.type) && cl.type !== sc.default) continue;
      let cur: End[] = [{ from: sw.id }];
      if (cl.type !== sc.default) {
        const comm = this.values(cl)[0];
        const pre = comm ? this.chain(comm, cur) : cur;
        const refs = this.scanner.scan(comm ?? null);
        const cn = this.mk('stmt', `case ${comm?.text ?? ''}`, comm ?? cl, refs, pre);
        this.thrower(cn, refs);
        cur = [{ from: cn.id }];
      }
      for (const st of this.clauseBody(cl)) {
        if (!this.table.ignore.includes(st.type)) cur = this.stmt(st, cur);
      }
      outs.push(...cur);
    }
    this.frames.pop();
    return [...outs, ...frame.breaks];
  }

  // ---- try / with --------------------------------------------------------

  protected tryStmt(n: Node, rule: Extract<StmtRule, { kind: 'try' }>, ins: End[]): End[] {
    const parts = rule.parts(n);
    const fb = parts.finalizer;
    const fin: Cleanup | null = fb && kids(fb, this.table).length > 0
      ? {
        kind: 'finally', run: x => this.copyOf(fb, x), key: () => '', memo: new Map(),
        active: () => true, line: fb.endPosition.row,
      } : null;
    if (fin) this.frames.push(fin);
    const catchFrame: Extract<Frame, { kind: 'catch' }> | null = parts.handlers.length > 0 ? { kind: 'catch', throws: [] } : null;
    if (catchFrame) this.frames.push(catchFrame);
    const mark = this.total;
    let outs = parts.body ? this.block(parts.body, ins) : ins;
    if (catchFrame) this.frames.pop();
    // No node of the body is known to throw: any of them may (getters,
    // stack overflow...), so the catch stays reachable instead of vanishing.
    if (catchFrame && catchFrame.throws.length === 0) catchFrame.throws.push(...this.mayThrow(mark));
    if (parts.orelse) outs = this.block(parts.orelse, outs);
    if (catchFrame && catchFrame.throws.length > 0) {
      // An exception tries the handlers in order; one that no handler takes goes on.
      let pending: End[] = catchFrame.throws;
      let caught = false;
      for (const h of parts.handlers) {
        const refs = h.types ? this.scanner.scan(h.types) : emptyRefs();
        this.scanner.bind(h.param, 'catch', 'declare', refs);
        const cn = this.mk('catch', h.head, h.node, refs, pending);
        const entry: End[] = h.types ? [{ from: cn.id, label: 'true' }] : [{ from: cn.id }];
        outs = [...outs, ...(h.body ? this.block(h.body, entry) : entry)];
        if (!h.types) { caught = true; break; }
        pending = [{ from: cn.id, label: 'false' }];
      }
      if (!caught) {
        const r = this.mk('rethrow', 'rethrow', null, emptyRefs(), pending, n.endPosition.row);
        this.jump([{ from: r.id, label: 'throw' }], 'throw');
      }
    }
    if (fin) {
      this.frames.pop();
      outs = fin.run(outs);
    }
    return outs;
  }

  protected withStmt(n: Node, rule: Extract<StmtRule, { kind: 'with' }>, ins: End[]): End[] {
    const cleanups: Cleanup[] = [];
    let cur = ins;
    for (const it of rule.items(n)) {
      const { pre, refs } = this.scanned(it.value, cur);
      this.scanner.bind(it.alias, 'decl', 'declare', refs);
      const node = this.mk('stmt', `with ${it.node.text}`, it.node, refs, pre);
      this.thrower(node, refs);
      cur = [{ from: node.id }];
      const text = `end with ${it.node.text}`;
      const row = it.node.endPosition.row;
      const c: Cleanup = {
        kind: 'finally', memo: new Map(), key: () => '', active: () => true, line: row,
        run: x => x.length === 0 ? [] : [{ from: this.mk('stmt', text, null, emptyRefs(), x, row).id }],
      };
      cleanups.push(c);
      this.frames.push(c);
    }
    const body = pick(n, rule.body);
    let outs = body ? this.block(body, cur) : cur;
    for (const c of cleanups.reverse()) {
      this.frames.pop();
      outs = c.run(outs);
    }
    return outs;
  }

  // ---- match -------------------------------------------------------------

  protected matchStmt(n: Node, rule: Extract<StmtRule, { kind: 'match' }>, ins: End[]): End[] {
    const subject = pick(n, rule.subject);
    if (!subject) return ins;
    const pre = this.chain(subject, ins);
    const sw = this.mk('switch', subject.text, subject, this.scanner.scan(subject), pre);
    let fails: End[] = [{ from: sw.id }];
    const outs: End[] = [];
    for (const c of rule.cases(n)) {
      let into: End[];
      const refs: Refs = emptyRefs();
      for (const u of c.uses) this.scanner.useOf(u, refs);
      if (c.irrefutable && !c.guard) {
        // Takes everything left: no test, nothing falls past it.
        if (c.binds.length > 0) {
          for (const b of c.binds) this.scanner.defOf(b, 'decl', 'declare', refs);
          const node = this.mk('stmt', c.head, c.node, refs, fails);
          into = [{ from: node.id }];
        } else into = fails;
        fails = [];
      } else {
        // A failed pattern binds nothing: the names are only maybe defined at the test.
        for (const b of c.binds) this.scanner.defOf(b, 'maybe', 'declare', refs, true);
        const test = this.mk('case', c.head, c.node, refs, fails);
        into = [{ from: test.id, label: 'true' }];
        fails = [{ from: test.id, label: 'false' }];
        if (c.guard) {
          const g = this.condEval(c.guard, into, 'cond');
          into = g.t;
          fails = [...fails, ...g.f];
        }
      }
      outs.push(...(c.body ? this.stmt(c.body, into) : into));
    }
    return [...outs, ...fails];
  }
}
