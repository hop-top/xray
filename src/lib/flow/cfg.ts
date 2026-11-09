import type { CfgEdge } from './types';
import type { FlowTable, Spec, StmtRule } from './table';
import type { Scopes, Binding } from './scope';
import { kids, pick, pickAll } from './scope';
import { emptyRefs } from './refs';
import { BranchFlow } from './cfg-stmt';
import { BudgetExceeded, BuiltCfg, Cleanup, End, FlowNode, Frame, Node, labelOf, nestedFunctions } from './cfg-core';

export { labelOf, nestedFunctions };
export type { BuiltCfg, FlowNode };

type Loop = Extract<StmtRule, { kind: 'for' | 'foreach' | 'while' | 'do' }>;
type Deferred = { node: Node; text: string; calls: string[]; recovers: boolean };

/**
 * Control-flow graph of one function, built in evaluation order.
 *
 * Every construct returns its dangling exits (`End[]`) and takes the exits
 * of its predecessor, so nothing is ever linked to a node that does not
 * exist yet (a `goto` to a label further down is the one exception: it waits
 * for the label). See cfg-core.ts for how jumps cross `finally` / `with` /
 * `defer`, cfg-expr.ts for branchy expressions, cfg-stmt.ts for the
 * multi-arm statements.
 */
export class CfgBuilder extends BranchFlow {
  private readonly labelEntry = new Map<string, string>();
  private readonly gotos = new Map<string, End[]>();
  private readonly deferred: Deferred[] = [];
  private deferFrame: Cleanup | null = null;
  private results: Binding[] = [];

  constructor(fn: Node, table: FlowTable, scopes: Scopes, maxNodes: number, workCap?: number) {
    super(fn, table, scopes, maxNodes, workCap);
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
    // Named results are read where the function returns.
    this.results = this.scanner.resultBindings();
    const exitRefs = emptyRefs();
    exitRefs.uses.push(...this.results);
    const exit = this.mk('exit', 'exit', this.fn, exitRefs, [], this.fn.endPosition.row);
    if (Object.values(t.stmts).some(r => r.kind === 'defer')) this.pushDeferFrame();
    const body = this.fn.childForFieldName(t.fn.body);
    let partial = false;
    try {
      let outs: End[] = [{ from: entry.id }];
      if (body) {
        const rule = t.stmts[body.type];
        if (rule && rule.kind === 'block') outs = this.block(body, outs);
        else outs = this.returnLike(body, outs);
      }
      if (this.deferFrame && this.deferFrame.active()) outs = this.deferFrame.run(outs);
      this.link(outs, exit.id);
    } catch (e) {
      // Work cap reached: what is built so far is the (truncated) graph.
      if (!(e instanceof BudgetExceeded)) throw e;
      partial = true;
    }
    const kept = new Set(this.nodes.map(n => n.id));
    return {
      nodes: this.nodes,
      edges: this.edges.filter((e: CfgEdge) => kept.has(e.from) && kept.has(e.to)),
      total: this.total,
      partial,
    };
  }

  // ---- statements -------------------------------------------------------

  protected block(n: Node, ins: End[]): End[] {
    let outs = ins;
    for (const c of kids(n, this.table)) outs = this.stmt(c, outs);
    return outs;
  }

  private ruleOf(n: Node): StmtRule | undefined {
    const r = this.table.stmts[n.type];
    return r && r.kind === 'dispatch' ? r.pick(n) : r;
  }

  protected stmt(n: Node, ins: End[]): End[] {
    const rule = this.ruleOf(n);
    // A label is a way in for `goto`s even when nothing falls into it.
    if (ins.length === 0 && rule?.kind !== 'labeled') { this.pendingLabels = []; return []; }
    if (!rule) return this.simple(n, ins);
    switch (rule.kind) {
      case 'skip': case 'hoisted': return ins;
      case 'block': return this.block(n, ins);
      case 'definition': return this.definition(n, rule, ins);
      case 'if': return this.ifStmt(n, rule, ins);
      case 'for': case 'foreach': case 'while': case 'do': return this.loop(n, rule, ins);
      case 'dispatch': return ins;
      case 'switch': return this.switchStmt(n, rule, ins);
      case 'select': return this.selectStmt(n, ins);
      case 'try': return this.tryStmt(n, rule, ins);
      case 'with': return this.withStmt(n, rule, ins);
      case 'match': return this.matchStmt(n, rule, ins);
      case 'labeled': return this.labeled(n, rule, ins);
      case 'return': return this.returnLike(n, ins);
      case 'throw': return this.throwStmt(n, ins);
      case 'break': case 'continue': {
        const label = pick(n, rule.label)?.text;
        const node = this.mk(rule.kind, n.text, n, emptyRefs(), ins);
        this.jump([{ from: node.id }], rule.kind, label);
        return [];
      }
      case 'fallthrough': {
        const node = this.mk('stmt', 'fallthrough', n, emptyRefs(), ins);
        this.jump([{ from: node.id }], 'fallthrough');
        return [];
      }
      case 'goto': return this.gotoStmt(n, rule, ins);
      case 'defer': return this.deferStmt(n, ins);
      case 'go': return this.goStmt(n, ins);
    }
  }

  private throwStmt(n: Node, ins: End[]): End[] {
    const refs = this.scanned(n, ins);
    const node = this.mk('throw', n.text, n, refs.refs, refs.pre);
    this.jump([{ from: node.id, label: 'throw' }], 'throw');
    return [];
  }

  private simple(n: Node, ins: End[]): End[] {
    const e = this.table.expr;
    if (e.noReturn && n.type === 'expression_statement') {
      const call = n.namedChild(0);
      const callee = call && call.type === e.calls.call ? call.childForFieldName(e.calls.callee) : null;
      if (callee && e.noReturn.includes(callee.text)) return this.throwStmt(n, ins);
    }
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

  /** `def` / `class` (behind decorators too): decorators, defaults and bases run here; the name is bound here. */
  private definition(n: Node, rule: Extract<StmtRule, { kind: 'definition' }>, ins: End[]): End[] {
    const def = (rule.inner ? n.childForFieldName(rule.inner) : null) ?? n;
    const decorators = def === n ? [] : n.namedChildren.filter(c => c.type === 'decorator');
    const isClass = this.table.data.classes.includes(def.type);
    const body = def.childForFieldName(isClass ? 'body' : this.table.fn.body);
    const parts: Array<Node | null> = [...decorators];
    if (isClass) parts.push(rule.bases ? def.childForFieldName(rule.bases) : null, body);
    // A function reads what it captures where it is created (as a function expression does).
    else parts.push(def);
    const refs = this.scanner.scanAll(parts);
    const nameN = def.childForFieldName(isClass ? this.table.data.namedDecls[def.type] : this.table.fn.name);
    const b = nameN ? this.scopes.declared.get(nameN.id) : undefined;
    if (b && b.owner === this.fn.id) refs.defs.push({ binding: b, kind: isClass ? 'class' : 'function', weak: false, line: def.startPosition.row });
    const head = (body ? def.text.slice(0, body.startIndex - def.startIndex) : def.text).replace(/:\s*$/, '');
    const label = [...decorators.map(d => d.text), head].join(' ');
    const node = this.mk('stmt', label, n, refs, ins);
    this.thrower(node, refs);
    return [{ from: node.id }];
  }

  /** `return x` (a return statement, or an arrow function's expression body). */
  private returnLike(n: Node, ins: End[]): End[] {
    const { pre, refs } = this.scanned(n, ins);
    const isStmt = this.table.stmts[n.type]?.kind === 'return';
    // `return a, b` assigns the named results before deferred calls run.
    if (isStmt && n.namedChildCount > 0) {
      for (const b of this.results) refs.defs.push({ binding: b, kind: 'assign', weak: false, line: n.startPosition.row });
    }
    const node = this.mk('return', isStmt ? n.text : `return ${n.text}`, n, refs, pre);
    this.thrower(node, refs);
    this.jump([{ from: node.id }], 'return');
    return [];
  }

  private ifStmt(n: Node, rule: Extract<StmtRule, { kind: 'if' }>, ins: End[]): End[] {
    const initN = pick(n, rule.init);
    const start = initN ? this.stmt(initN, ins) : ins;
    const cond = pick(n, rule.cond);
    if (!cond) return start;
    const c = this.condEval(cond, start, 'cond');
    const thenN = pick(n, rule.then);
    const thenOuts = thenN ? this.stmt(thenN, c.t) : c.t;
    return [...thenOuts, ...this.alternatives(pickAll(n, rule.else), rule, c.f)];
  }

  /** `elif`s and the `else` that follow an `if`, each reached when the previous test fails. */
  private alternatives(alts: Node[], rule: Extract<StmtRule, { kind: 'if' }>, ins: End[]): End[] {
    const [alt, ...rest] = alts;
    if (!alt) return ins;
    if (rule.elif && alt.type === rule.elif.type) {
      const cond = pick(alt, rule.elif.cond);
      if (!cond) return ins;
      const c = this.condEval(cond, ins, 'cond');
      const then = pick(alt, rule.elif.then);
      return [...(then ? this.stmt(then, c.t) : c.t), ...this.alternatives(rest, rule, c.f)];
    }
    const body = rule.elseWrapper && alt.type === rule.elseWrapper ? (alt.childForFieldName('body') ?? kids(alt, this.table)[0] ?? null) : alt;
    return body ? this.stmt(body, ins) : ins;
  }

  private labeled(n: Node, rule: Extract<StmtRule, { kind: 'labeled' }>, ins: End[]): End[] {
    const label = pick(n, rule.label)?.text ?? '';
    const body = pick(n, rule.body);
    if (!body) return ins;
    // Earlier `goto`s wait here.
    const jumpIns = this.gotos.get(label) ?? [];
    this.gotos.delete(label);
    const start = [...ins, ...jumpIns];
    if (start.length === 0) return [];
    // The label is its statement's first node, known before the statement is built (a `goto` inside it comes back here).
    const mark = this.total;
    this.labelEntry.set(label, `n${mark}`);
    const k = this.ruleOf(body)?.kind;
    let outs: End[];
    if (k === 'for' || k === 'foreach' || k === 'while' || k === 'do' || k === 'switch' || k === 'select') {
      this.pendingLabels.push(label);
      outs = this.stmt(body, start);
    } else {
      const frame: Frame = { kind: 'label', label, breaks: [] };
      this.frames.push(frame);
      const inner = this.stmt(body, start);
      this.frames.pop();
      outs = [...inner, ...frame.breaks];
    }
    if (this.total === mark) this.labelEntry.delete(label);
    return outs;
  }

  private gotoStmt(n: Node, rule: Extract<StmtRule, { kind: 'goto' }>, ins: End[]): End[] {
    const label = pick(n, rule.label)?.text ?? '';
    const node = this.mk('goto', n.text, n, emptyRefs(), ins);
    const known = this.labelEntry.get(label);
    if (known) this.link([{ from: node.id }], known);
    else this.gotos.set(label, [...(this.gotos.get(label) ?? []), { from: node.id }]);
    return [];
  }

  // ---- go / defer -------------------------------------------------------

  private pushDeferFrame(): void {
    const f: Cleanup = {
      kind: 'finally', memo: new Map(), line: this.fn.endPosition.row,
      key: () => String(this.deferred.length),
      active: () => this.deferred.length > 0,
      recovers: () => this.deferred.some(d => d.recovers),
      // Deferred calls run last-in first-out; only those registered so far can have run.
      run: ins => {
        let cur = ins;
        for (let i = this.deferred.length - 1; i >= 0 && cur.length > 0; i--) {
          const d = this.deferred[i];
          const refs = emptyRefs();
          refs.calls.push(...d.calls);
          cur = [{ from: this.mk('stmt', `deferred ${d.text}`, d.node, refs, cur).id }];
        }
        return cur;
      },
    };
    this.deferFrame = f;
    this.frames.push(f);
  }

  private callParts(n: Node): { call: Node | null; callee: Node | null; args: Node | null } {
    const c = this.table.expr.calls;
    const call = kids(n, this.table).find(k => k.type === c.call) ?? null;
    return { call, callee: call?.childForFieldName(c.callee) ?? null, args: call?.childForFieldName('arguments') ?? null };
  }

  /** `defer f(x)`: the callee and arguments evaluate now; the call is made when the function exits. */
  private deferStmt(n: Node, ins: End[]): End[] {
    const { call, callee, args } = this.callParts(n);
    const pre = call ? this.chain(call, ins) : ins;
    const refs = this.scanner.scanAll([callee, args]);
    const node = this.mk('stmt', n.text, n, refs, pre);
    // Evaluating the operands may panic before the call is registered.
    this.thrower(node, refs);
    if (call && callee) {
      this.deferred.push({
        node: n, text: labelOf(call.text), calls: [labelOf(callee.text)], recovers: this.mayRecover(callee),
      });
    }
    return [{ from: node.id }];
  }

  /** A deferred function literal that calls `recover()` may stop the panic. */
  private mayRecover(callee: Node): boolean {
    const name = this.table.expr.recover;
    if (!name || !this.table.functions.includes(callee.type)) return false;
    const body = callee.childForFieldName(this.table.fn.body);
    const find = (x: Node): boolean => {
      if (this.table.functions.includes(x.type)) return false;
      if (x.type === this.table.expr.calls.call && x.childForFieldName(this.table.expr.calls.callee)?.text === name) return true;
      return x.namedChildren.some(find);
    };
    return body ? find(body) : false;
  }

  /** `go f(x)`: arguments evaluate here, the call runs on its own. */
  private goStmt(n: Node, ins: End[]): End[] {
    const { call, callee, args } = this.callParts(n);
    const pre = call ? this.chain(call, ins) : ins;
    const refs = this.scanner.scanAll([callee, args]);
    if (callee && !refs.calls.includes(labelOf(callee.text))) refs.calls.push(labelOf(callee.text));
    const node = this.mk('stmt', n.text, n, refs, pre);
    this.thrower(node, refs);
    return [{ from: node.id }];
  }

  // ---- loops ------------------------------------------------------------

  private head(n: Node, rule: { via?: string }): Node {
    return (rule.via ? n.namedChildren.find(c => c.type === rule.via) : null) ?? n;
  }

  private elseBody(n: Node, rule: { else?: Spec }): Node | null {
    const e = pick(n, rule.else);
    return e ? (e.childForFieldName('body') ?? kids(e, this.table)[0] ?? null) : null;
  }

  private loop(n: Node, rule: Loop, ins: End[]): End[] {
    const labels = this.takeLabels();
    const frame: Extract<Frame, { kind: 'loop' }> = { kind: 'loop', labels, breaks: [], continues: [] };
    const body = pick(n, rule.body);
    const run = (from: End[]): End[] => {
      if (!body) return from;
      this.frames.push(frame);
      const outs = this.stmt(body, from);
      this.frames.pop();
      return outs;
    };
    /** The loop ended by its test: `else` runs, a `break` skips it. */
    const finish = (natural: End[], elseN: Node | null): End[] =>
      [...(elseN ? this.stmt(elseN, natural) : natural), ...frame.breaks];

    if (rule.kind === 'while') {
      const cond = pick(n, rule.cond);
      if (!cond) return ins;
      const c = this.condEval(cond, ins, 'loop');
      const outs = run(c.t);
      this.link([...outs, ...frame.continues], c.entry);
      return finish(c.f, this.elseBody(n, rule));
    }

    if (rule.kind === 'do') {
      const mark = this.total;
      const bodyOuts = run(ins);
      const bodyEntry = this.total > mark ? `n${mark}` : undefined;
      const cond = pick(n, rule.cond);
      if (!cond) return [...bodyOuts, ...frame.breaks];
      const c = this.condEval(cond, [...bodyOuts, ...frame.continues], 'loop');
      this.link(c.t, bodyEntry ?? c.entry);
      return [...c.f, ...frame.breaks];
    }

    if (rule.kind === 'foreach') {
      const hdr = this.head(n, rule);
      const right = pick(hdr, rule.right);
      const left = pick(hdr, rule.left);
      const pre = right ? this.chain(right, ins) : ins;
      const refs = this.scanner.scan(right);
      const declares = hdr.children.some(c => !c.isNamed && c.type in this.table.data.loopDecl);
      this.scanner.bind(left, 'loop', declares ? 'declare' : 'assign', refs);
      const headText = (body ? n.text.slice(0, body.startIndex - n.startIndex) : n.text).replace(/:\s*$/, '');
      const head = this.mk('loop', headText, n, refs, pre);
      this.thrower(head, refs);
      const outs = run([{ from: head.id, label: 'true' }]);
      this.link([...outs, ...frame.continues], head.id);
      return finish([{ from: head.id, label: 'false' }], this.elseBody(n, rule));
    }

    // classic `for (init; test; update)`, or an endless `for {}`
    const hdr = this.head(n, rule);
    const unwrapStmt = (x: Node | null): Node | null =>
      x && x.type === 'expression_statement' ? x.namedChild(0) : x;
    const init = pick(hdr, rule.init);
    const initOuts = init ? this.stmt(init, ins) : ins;
    const condRaw = unwrapStmt(pick(hdr, rule.cond));
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
    const upd = unwrapStmt(pick(hdr, rule.update));
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
}
