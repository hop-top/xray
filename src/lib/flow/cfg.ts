import type Parser from 'tree-sitter';
import type { CfgEdge, CfgEdgeLabel, CfgKind, CfgNode } from './types';
import type { FlowTable, StmtRule } from './table';
import { Scopes, kids } from './scope';
import { RefScanner, Refs, emptyRefs } from './refs';

type Node = Parser.SyntaxNode;

/** A dangling edge: leaves `from`, target not built yet. */
interface End { from: string; label?: CfgEdgeLabel }

/** CFG node with what it reads and writes (input of the data flow). */
export interface FlowNode extends CfgNode { refs: Refs }

type Frame =
  | { kind: 'loop'; labels: string[]; breaks: End[]; continues: End[] }
  | { kind: 'switch'; labels: string[]; breaks: End[] }
  | { kind: 'label'; label: string; breaks: End[] }
  | { kind: 'catch'; throws: End[] }
  | { kind: 'finally'; body: Node; memo: Map<string, string> };

export interface BuiltCfg {
  nodes: FlowNode[];
  edges: CfgEdge[];
  /** Nodes the function has (more than `nodes.length` when capped). */
  total: number;
}

const LABEL_CAP = 60;
const EVALUATES: CfgKind[] = ['stmt', 'expr', 'cond', 'loop', 'switch', 'case'];

/** Source text as a one-line label. */
export function labelOf(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim().replace(/;$/, '');
  return one.length > LABEL_CAP ? one.slice(0, LABEL_CAP - 1) + '…' : one;
}

/** Nested function-like nodes directly inside `fn` (not inside each other). */
export function nestedFunctions(fn: Node, table: FlowTable): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    if (table.data.skip.includes(n.type)) return;
    if (table.functions.includes(n.type)) { out.push(n); return; }
    for (const c of n.namedChildren) visit(c);
  };
  for (const c of fn.namedChildren) visit(c);
  return out;
}

/**
 * Control-flow graph of one function, built in evaluation order.
 *
 * Every construct returns its dangling exits (`End[]`) and takes the exits
 * of its predecessor, so nothing is ever linked to a node that does not
 * exist yet. `return` / `throw` / `break` / `continue` walk the frame stack:
 * a `finally` on the way gets one copy of its body per kind of jump that
 * crosses it, so a `return` inside `try` runs the `finally` and then leaves,
 * while normal completion runs another copy and falls through.
 */
export class CfgBuilder {
  private nodes: FlowNode[] = [];
  private edges: CfgEdge[] = [];
  private seen = new Set<string>();
  private total = 0;
  private frames: Frame[] = [];
  private pendingLabels: string[] = [];
  private readonly scanner: RefScanner;
  private readonly claimed = new Set<number>();

  constructor(
    private readonly fn: Node,
    private readonly table: FlowTable,
    private readonly scopes: Scopes,
    private readonly maxNodes: number
  ) {
    this.scanner = new RefScanner(table, scopes, fn, this.claimed);
  }

  build(): BuiltCfg {
    const t = this.table;
    const entryRefs = this.scanner.scanParams();
    for (const n of nestedFunctions(this.fn, t)) {
      this.scanner.markCaptured(n);
      const nameField = t.data.namedDecls[n.type];
      const name = nameField ? n.childForFieldName(nameField) : null;
      const b = name ? this.scopes.declared.get(name.id) : undefined;
      if (b && b.owner === this.fn.id && t.stmts[n.type]?.kind === 'hoisted') {
        entryRefs.defs.push({ binding: b, kind: 'function', weak: false, line: n.startPosition.row });
      }
    }
    const entry = this.mk('entry', 'entry', this.fn, entryRefs, [], this.fn.startPosition.row);
    const exit = this.mk('exit', 'exit', this.fn, emptyRefs(), [], this.fn.endPosition.row);
    const body = this.fn.childForFieldName(t.fn.body);
    let outs: End[] = [{ from: entry.id }];
    if (body) {
      const rule = t.stmts[body.type];
      if (rule && rule.kind === 'block') outs = this.block(body, outs);
      else outs = this.returnLike(body, outs);
    }
    this.link(outs, exit.id);
    const kept = new Set(this.nodes.map(n => n.id));
    return {
      nodes: this.nodes,
      edges: this.edges.filter(e => kept.has(e.from) && kept.has(e.to)),
      total: this.total,
    };
  }

  // ---- plumbing ---------------------------------------------------------

  private mk(kind: CfgKind, label: string, ast: Node | null, refs: Refs, ins: End[], line?: number): FlowNode {
    const id = `n${this.total++}`;
    const node: FlowNode = {
      id, kind, label: labelOf(label),
      line: line ?? (ast ? ast.startPosition.row : 0),
      refs,
    };
    if (refs.calls.length > 0) node.calls = [...refs.calls];
    if (this.nodes.length < this.maxNodes || kind === 'exit') this.nodes.push(node);
    this.link(ins, id);
    return node;
  }

  private link(ends: End[], to: string): void {
    for (const e of ends) {
      const key = `${e.from}>${to}>${e.label ?? ''}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const edge: CfgEdge = { from: e.from, to };
      if (e.label) edge.label = e.label;
      this.edges.push(edge);
    }
  }

  private takeLabels(): string[] {
    const l = this.pendingLabels;
    this.pendingLabels = [];
    return l;
  }

  private hasHandler(): boolean {
    return this.frames.some(f => f.kind === 'catch' || f.kind === 'finally');
  }

  /** A node that may throw reaches the nearest handler (only when one exists). */
  private thrower(node: FlowNode, refs: Refs): void {
    if (refs.throws && this.hasHandler()) this.jump([{ from: node.id, label: 'throw' }], 'throw');
  }

  // ---- jumps ------------------------------------------------------------

  private jump(ends: End[], kind: 'break' | 'continue' | 'return' | 'throw', label?: string): void {
    let cur = ends;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (kind === 'throw' && f.kind === 'catch') { f.throws.push(...cur); return; }
      if (kind === 'break') {
        if ((f.kind === 'loop' || f.kind === 'switch') && (label === undefined || f.labels.includes(label))) {
          f.breaks.push(...cur); return;
        }
        if (f.kind === 'label' && f.label === label) { f.breaks.push(...cur); return; }
      }
      if (kind === 'continue' && f.kind === 'loop' && (label === undefined || f.labels.includes(label))) {
        f.continues.push(...cur); return;
      }
      if (f.kind === 'finally') {
        const key = `${kind}:${label ?? ''}`;
        const known = f.memo.get(key);
        if (known) { this.link(cur, known); return; }
        const saved = this.frames;
        this.frames = saved.slice(0, i);
        const mark = this.total;
        const outs = this.copyOf(f.body, cur);
        this.frames = saved;
        if (this.total > mark) f.memo.set(key, `n${mark}`);
        cur = outs;
        if (kind === 'throw' && outs.length > 0) {
          // The exception leaves the copy through one node of its own, so a
          // branch at the end of the copy is never read as a way out.
          const r = this.mk('rethrow', 'rethrow', null, emptyRefs(), outs, f.body.endPosition.row);
          cur = [{ from: r.id, label: 'throw' }];
        }
        if (cur.length === 0) return;
      }
    }
    if (kind === 'return' || kind === 'throw') this.link(cur, 'n1');
  }

  /** Throw edges from every node built since `mark` that evaluates something and has none yet. */
  private mayThrow(mark: number): End[] {
    const has = new Set(this.edges.filter(e => e.label === 'throw').map(e => e.from));
    return this.nodes
      .filter(n => Number(n.id.slice(1)) >= mark && EVALUATES.includes(n.kind) && !has.has(n.id))
      .map(n => ({ from: n.id, label: 'throw' as const }));
  }

  // ---- statements -------------------------------------------------------

  private block(n: Node, ins: End[]): End[] {
    let outs = ins;
    for (const c of kids(n, this.table)) outs = this.stmt(c, outs);
    return outs;
  }

  /**
   * One more copy of a `finally` body. The copies share syntax nodes, so what
   * one copy claims (operands it scanned) must stay free for the next.
   */
  private copyOf(body: Node, ins: End[]): End[] {
    const before = new Set(this.claimed);
    const outs = this.block(body, ins);
    this.claimed.clear();
    for (const id of before) this.claimed.add(id);
    return outs;
  }

  private stmt(n: Node, ins: End[]): End[] {
    if (ins.length === 0) { this.pendingLabels = []; return []; }
    const rule: StmtRule | undefined = this.table.stmts[n.type];
    if (!rule) return this.simple(n, ins);
    switch (rule.kind) {
      case 'skip': case 'hoisted': return ins;
      case 'block': return this.block(n, ins);
      case 'if': return this.ifStmt(n, rule, ins);
      case 'for': case 'foreach': case 'while': case 'do': return this.loop(n, rule, ins);
      case 'switch': return this.switchStmt(n, rule, ins);
      case 'try': return this.tryStmt(n, rule, ins);
      case 'labeled': return this.labeled(n, rule, ins);
      case 'return': return this.returnLike(n, ins);
      case 'throw': {
        const refs = this.scanned(n, ins);
        const node = this.mk('throw', n.text, n, refs.refs, refs.pre);
        this.jump([{ from: node.id, label: 'throw' }], 'throw');
        return [];
      }
      case 'break': case 'continue': {
        const label = n.childForFieldName(rule.label)?.text;
        const node = this.mk(rule.kind, n.text, n, emptyRefs(), ins);
        this.jump([{ from: node.id }], rule.kind, label);
        return [];
      }
    }
  }

  /** Evaluate branchy operands of `n` first, then scan what is left of it. */
  private scanned(n: Node, ins: End[]): { pre: End[]; refs: Refs } {
    const pre = this.chain(n, ins);
    return { pre, refs: this.scanner.scan(n) };
  }

  private simple(n: Node, ins: End[]): End[] {
    const { pre, refs } = this.scanned(n, ins);
    const nameField = this.table.data.namedDecls[n.type];
    if (nameField && this.table.data.classes.includes(n.type)) {
      const name = n.childForFieldName(nameField);
      const b = name ? this.scopes.declared.get(name.id) : undefined;
      if (b && b.owner === this.fn.id) refs.defs.push({ binding: b, kind: 'class', weak: false, line: n.startPosition.row });
    }
    const node = this.mk('stmt', n.text, n, refs, pre);
    this.thrower(node, refs);
    return [{ from: node.id }];
  }

  /** `return x` (a return statement, or an arrow function's expression body). */
  private returnLike(n: Node, ins: End[]): End[] {
    const { pre, refs } = this.scanned(n, ins);
    const isStmt = this.table.stmts[n.type]?.kind === 'return';
    const node = this.mk('return', isStmt ? n.text : `return ${n.text}`, n, refs, pre);
    this.thrower(node, refs);
    this.jump([{ from: node.id }], 'return');
    return [];
  }

  private ifStmt(n: Node, rule: Extract<StmtRule, { kind: 'if' }>, ins: End[]): End[] {
    const cond = n.childForFieldName(rule.cond);
    if (!cond) return ins;
    const c = this.condEval(cond, ins, 'cond');
    const thenN = n.childForFieldName(rule.then);
    const thenOuts = thenN ? this.stmt(thenN, c.t) : c.t;
    let alt = n.childForFieldName(rule.else);
    let elseOuts = c.f;
    if (alt) {
      if (rule.elseWrapper && alt.type === rule.elseWrapper) alt = kids(alt, this.table)[0] ?? null;
      if (alt) elseOuts = this.stmt(alt, c.f);
    }
    return [...thenOuts, ...elseOuts];
  }

  private labeled(n: Node, rule: Extract<StmtRule, { kind: 'labeled' }>, ins: End[]): End[] {
    const label = n.childForFieldName(rule.label)?.text ?? '';
    const body = n.childForFieldName(rule.body);
    if (!body) return ins;
    const k = this.table.stmts[body.type]?.kind;
    if (k === 'for' || k === 'foreach' || k === 'while' || k === 'do' || k === 'switch') {
      this.pendingLabels.push(label);
      return this.stmt(body, ins);
    }
    const frame: Frame = { kind: 'label', label, breaks: [] };
    this.frames.push(frame);
    const outs = this.stmt(body, ins);
    this.frames.pop();
    return [...outs, ...frame.breaks];
  }

  private loop(n: Node, rule: Extract<StmtRule, { kind: 'for' | 'foreach' | 'while' | 'do' }>, ins: End[]): End[] {
    const labels = this.takeLabels();
    const frame: Extract<Frame, { kind: 'loop' }> = { kind: 'loop', labels, breaks: [], continues: [] };
    const body = n.childForFieldName(rule.body);
    const run = (from: End[]): End[] => {
      if (!body) return from;
      this.frames.push(frame);
      const outs = this.stmt(body, from);
      this.frames.pop();
      return outs;
    };

    if (rule.kind === 'while') {
      const cond = n.childForFieldName(rule.cond);
      if (!cond) return ins;
      const c = this.condEval(cond, ins, 'loop');
      const outs = run(c.t);
      this.link([...outs, ...frame.continues], c.entry);
      return [...c.f, ...frame.breaks];
    }

    if (rule.kind === 'do') {
      const mark = this.total;
      const bodyOuts = run(ins);
      const bodyEntry = this.total > mark ? `n${mark}` : undefined;
      const cond = n.childForFieldName(rule.cond);
      if (!cond) return [...bodyOuts, ...frame.breaks];
      const c = this.condEval(cond, [...bodyOuts, ...frame.continues], 'loop');
      this.link(c.t, bodyEntry ?? c.entry);
      return [...c.f, ...frame.breaks];
    }

    if (rule.kind === 'foreach') {
      const right = n.childForFieldName(rule.right);
      const left = n.childForFieldName(rule.left);
      const pre = right ? this.chain(right, ins) : ins;
      const refs = this.scanner.scan(right);
      const declares = n.children.some(c => !c.isNamed && c.type in this.table.data.loopDecl);
      this.scanner.bind(left, 'loop', declares ? 'declare' : 'assign', refs);
      const headText = body ? n.text.slice(0, body.startIndex - n.startIndex) : n.text;
      const head = this.mk('loop', headText, n, refs, pre);
      this.thrower(head, refs);
      const outs = run([{ from: head.id, label: 'true' }]);
      this.link([...outs, ...frame.continues], head.id);
      return [{ from: head.id, label: 'false' }, ...frame.breaks];
    }

    // classic `for (init; test; update)`
    const forRule = rule;
    const unwrapStmt = (x: Node | null): Node | null =>
      x && x.type === 'expression_statement' ? x.namedChild(0) : x;
    const init = n.childForFieldName(forRule.init);
    const initOuts = init ? this.stmt(init, ins) : ins;
    const condRaw = unwrapStmt(n.childForFieldName(forRule.cond));
    const cond = condRaw && this.table.stmts[condRaw.type]?.kind !== 'skip' ? condRaw : null;
    let bodyIns = initOuts;
    let exits: End[] = [];
    let testEntry: string | undefined;
    if (cond) {
      const c = this.condEval(cond, initOuts, 'loop');
      bodyIns = c.t;
      exits = c.f;
      testEntry = c.entry;
    }
    const bodyMark = this.total;
    const bodyOuts = run(bodyIns);
    const upd = unwrapStmt(n.childForFieldName(forRule.update));
    let back = [...bodyOuts, ...frame.continues];
    let target = testEntry ?? (this.total > bodyMark ? `n${bodyMark}` : undefined);
    if (upd) {
      const { pre, refs } = this.scanned(upd, back);
      const node = this.mk('stmt', upd.text, upd, refs, pre);
      this.thrower(node, refs);
      back = [{ from: node.id }];
      target = target ?? node.id;
    }
    if (target) this.link(back, target);
    return [...exits, ...frame.breaks];
  }


  private switchStmt(n: Node, rule: Extract<StmtRule, { kind: 'switch' }>, ins: End[]): End[] {
    const labels = this.takeLabels();
    const value = this.unwrap(n.childForFieldName(rule.value));
    if (!value) return ins;
    const pre = this.chain(value, ins);
    const refs = this.scanner.scan(value);
    const sw = this.mk('switch', value.text, value, refs, pre);
    this.thrower(sw, refs);
    const frame: Extract<Frame, { kind: 'switch' }> = { kind: 'switch', labels, breaks: [] };
    this.frames.push(frame);
    const sc = this.table.switchClauses;
    const body = n.childForFieldName(rule.body);
    const clauses = body ? kids(body, this.table).filter(c => c.type === sc.case || c.type === sc.default) : [];
    // Dispatch first: one test per `case`, in order; `default` is what is left.
    let fails: End[] = [{ from: sw.id }];
    const tests = new Map<number, string>();
    for (const cl of clauses) {
      if (cl.type !== sc.case) continue;
      const v = cl.childForFieldName(sc.value);
      const cpre = v ? this.chain(v, fails) : fails;
      const crefs = this.scanner.scan(v);
      const cn = this.mk('case', v ? v.text : 'case', v, crefs, cpre);
      this.thrower(cn, crefs);
      tests.set(cl.id, cn.id);
      fails = [{ from: cn.id, label: 'false' }];
    }
    // Then the bodies, in source order, falling through.
    let fall: End[] = [];
    for (const cl of clauses) {
      let cur: End[] = cl.type === sc.case
        ? [{ from: tests.get(cl.id)!, label: 'true' }, ...fall]
        : [...fall, ...fails];
      for (const st of cl.childrenForFieldName(sc.body)) {
        if (!this.table.ignore.includes(st.type)) cur = this.stmt(st, cur);
      }
      fall = cur;
    }
    this.frames.pop();
    const hasDefault = clauses.some(c => c.type === sc.default);
    return [...fall, ...frame.breaks, ...(hasDefault ? [] : fails)];
  }

  private tryStmt(n: Node, rule: Extract<StmtRule, { kind: 'try' }>, ins: End[]): End[] {
    const body = n.childForFieldName(rule.body);
    const handler = n.childForFieldName(rule.handler);
    const finalizer = n.childForFieldName(rule.finalizer);
    const finBody = finalizer ? finalizer.childForFieldName(this.table.finallyBody) : null;
    const fin: Extract<Frame, { kind: 'finally' }> | null =
      finBody && kids(finBody, this.table).length > 0 ? { kind: 'finally', body: finBody, memo: new Map() } : null;
    if (fin) this.frames.push(fin);
    const catchFrame: Extract<Frame, { kind: 'catch' }> | null = handler ? { kind: 'catch', throws: [] } : null;
    if (catchFrame) this.frames.push(catchFrame);
    const mark = this.total;
    let outs = body ? this.block(body, ins) : ins;
    if (catchFrame) this.frames.pop();
    // No node of the body is known to throw: any of them may (getters,
    // stack overflow...), so the catch stays reachable instead of vanishing.
    if (catchFrame && catchFrame.throws.length === 0) catchFrame.throws.push(...this.mayThrow(mark));
    if (handler && catchFrame && catchFrame.throws.length > 0) {
      const cb = handler.childForFieldName(this.table.catchClause.body);
      const refs = emptyRefs();
      this.scanner.bind(handler.childForFieldName(this.table.catchClause.param), 'catch', 'declare', refs);
      const head = cb ? handler.text.slice(0, cb.startIndex - handler.startIndex) : handler.text;
      const cn = this.mk('catch', head, handler, refs, catchFrame.throws);
      outs = [...outs, ...(cb ? this.block(cb, [{ from: cn.id }]) : [{ from: cn.id }])];
    }
    if (fin) {
      this.frames.pop();
      outs = this.copyOf(fin.body, outs);
    }
    return outs;
  }

  // ---- expressions ------------------------------------------------------

  private unwrap(n: Node | null): Node | null {
    let cur = n;
    while (cur && this.table.expr.parens.includes(cur.type)) cur = cur.namedChild(0);
    return cur;
  }

  private operator(n: Node): string | undefined {
    const e = this.table.expr.logical;
    return n.children.find(c => !c.isNamed && (e.ops.includes(c.type) || e.nullish.includes(c.type)))?.type;
  }

  private isBranchy(n: Node): boolean {
    const e = this.table.expr;
    if (n.type === e.ternary.type) return true;
    return n.type === e.logical.type && this.operator(n) !== undefined;
  }

  /** Evaluate every short-circuit / ternary found in `n`, in order; returns the exits after them. */
  private chain(n: Node, ins: End[]): End[] {
    let outs = ins;
    const visit = (c: Node): void => {
      if (this.claimed.has(c.id) || this.table.data.skip.includes(c.type) || this.table.functions.includes(c.type)) return;
      if (this.isBranchy(c)) {
        outs = this.branch(c, outs);
        this.claimed.add(c.id);
        return;
      }
      for (const k of kids(c, this.table)) visit(k);
    };
    visit(n);
    return outs;
  }

  /** Value of a branchy expression: exits of every way it can finish. */
  private branch(n: Node, ins: End[]): End[] {
    const e = this.table.expr;
    if (n.type === e.ternary.type) {
      const c = this.condEval(n.childForFieldName(e.ternary.cond)!, ins, 'cond');
      const a = this.valueEval(n.childForFieldName(e.ternary.then), c.t);
      const b = this.valueEval(n.childForFieldName(e.ternary.else), c.f);
      return [...a, ...b];
    }
    const op = this.operator(n)!;
    const left = n.childForFieldName(e.logical.left)!;
    const right = n.childForFieldName(e.logical.right);
    if (e.logical.nullish.includes(op)) {
      const l = this.leafCond(left, ins, 'cond', `${labelOf(left.text)} == null`);
      return [...l.f, ...this.valueEval(right, l.t)];
    }
    const l = this.condEval(left, ins, 'cond');
    return op === '&&'
      ? [...l.f, ...this.valueEval(right, l.t)]
      : [...l.t, ...this.valueEval(right, l.f)];
  }

  private valueEval(n: Node | null, ins: End[]): End[] {
    const e = this.unwrap(n);
    if (!e) return ins;
    if (this.isBranchy(e)) {
      const outs = this.branch(e, ins);
      this.claimed.add(e.id);
      return outs;
    }
    const { pre, refs } = this.scanned(e, ins);
    const node = this.mk('expr', e.text, e, refs, pre);
    this.thrower(node, refs);
    return [{ from: node.id }];
  }

  private leafCond(e: Node, ins: End[], kind: 'cond' | 'loop', label?: string): { t: End[]; f: End[]; entry: string } {
    const mark = this.total;
    const { pre, refs } = this.scanned(e, ins);
    const node = this.mk(kind, label ?? e.text, e, refs, pre);
    this.thrower(node, refs);
    return { t: [{ from: node.id, label: 'true' }], f: [{ from: node.id, label: 'false' }], entry: `n${mark}` };
  }

  /** Test: `&&` `||` `!(..)` split into one node per operand, with true/false exits. */
  private condEval(raw: Node, ins: End[], kind: 'cond' | 'loop'): { t: End[]; f: End[]; entry: string } {
    const e = this.unwrap(raw) ?? raw;
    const lg = this.table.expr.logical;
    if (e.type === lg.type) {
      const op = this.operator(e);
      if (op === '&&' || op === '||') {
        const l = this.condEval(e.childForFieldName(lg.left)!, ins, kind);
        const r = this.condEval(e.childForFieldName(lg.right)!, op === '&&' ? l.t : l.f, kind);
        this.claimed.add(e.id);
        return op === '&&'
          ? { t: r.t, f: [...l.f, ...r.f], entry: l.entry }
          : { t: [...l.t, ...r.t], f: r.f, entry: l.entry };
      }
    }
    const nt = this.table.expr.not;
    if (e.type === nt.type && e.children.some(c => !c.isNamed && c.type === nt.op)) {
      const inner = this.unwrap(e.childForFieldName(nt.operand));
      if (inner && inner.type === lg.type && ['&&', '||'].includes(this.operator(inner) ?? '')) {
        const r = this.condEval(inner, ins, kind);
        this.claimed.add(e.id);
        return { t: r.f, f: r.t, entry: r.entry };
      }
    }
    return this.leafCond(e, ins, kind);
  }
}
