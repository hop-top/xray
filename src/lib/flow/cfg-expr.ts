import type { Refs } from './refs';
import { FlowCore, End, Node, labelOf } from './cfg-core';
import { kids, pick } from './scope';

type Cond = { t: End[]; f: End[]; entry: string };

/**
 * Expressions that branch: `&&` `||` `??` / `and` `or`, `!` / `not`, `?:`.
 * Each operand becomes its own node with true/false exits.
 */
export abstract class ExprFlow extends FlowCore {
  /** Evaluate branchy operands of `n` first, then scan what is left of it. */
  protected scanned(n: Node, ins: End[]): { pre: End[]; refs: Refs } {
    const pre = this.chain(n, ins);
    return { pre, refs: this.scanner.scan(n) };
  }

  protected unwrap(n: Node | null): Node | null {
    let cur = n;
    while (cur && this.table.expr.parens.includes(cur.type)) cur = cur.namedChild(0);
    return cur;
  }

  private operator(n: Node): string | undefined {
    const e = this.table.expr.logical;
    return n.children.find(c => !c.isNamed && (e.and.includes(c.type) || e.or.includes(c.type) || e.nullish.includes(c.type)))?.type;
  }

  private isBranchy(n: Node): boolean {
    const e = this.table.expr;
    if (e.ternary.type && n.type === e.ternary.type) return true;
    return n.type === e.logical.type && this.operator(n) !== undefined;
  }

  /** Evaluate every short-circuit / ternary found in `n`, in order; returns the exits after them. */
  protected chain(n: Node, ins: End[]): End[] {
    let outs = ins;
    const opaque = this.table.expr.opaque ?? [];
    const visit = (c: Node): void => {
      if (this.claimed.has(c.id) || this.table.data.skip.includes(c.type) || this.table.functions.includes(c.type) || opaque.includes(c.type)) return;
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
    if (e.ternary.type && n.type === e.ternary.type) {
      const c = this.condEval(pick(n, e.ternary.cond)!, ins, 'cond');
      const a = this.valueEval(pick(n, e.ternary.then), c.t);
      const b = this.valueEval(pick(n, e.ternary.else), c.f);
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
    return e.logical.and.includes(op)
      ? [...l.f, ...this.valueEval(right, l.t)]
      : [...l.t, ...this.valueEval(right, l.f)];
  }

  protected valueEval(n: Node | null, ins: End[]): End[] {
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

  protected leafCond(e: Node, ins: End[], kind: 'cond' | 'loop', label?: string): Cond {
    const mark = this.total;
    const { pre, refs } = this.scanned(e, ins);
    const node = this.mk(kind, label ?? e.text, e, refs, pre);
    this.thrower(node, refs);
    return { t: [{ from: node.id, label: 'true' }], f: [{ from: node.id, label: 'false' }], entry: `n${mark}` };
  }

  /** Test: `&&` `||` `!(..)` split into one node per operand, with true/false exits. */
  protected condEval(raw: Node, ins: End[], kind: 'cond' | 'loop'): Cond {
    const e = this.unwrap(raw) ?? raw;
    const lg = this.table.expr.logical;
    if (e.type === lg.type) {
      const op = this.operator(e);
      const isAnd = op !== undefined && lg.and.includes(op);
      if (op !== undefined && (isAnd || lg.or.includes(op))) {
        const l = this.condEval(e.childForFieldName(lg.left)!, ins, kind);
        const r = this.condEval(e.childForFieldName(lg.right)!, isAnd ? l.t : l.f, kind);
        this.claimed.add(e.id);
        return isAnd
          ? { t: r.t, f: [...l.f, ...r.f], entry: l.entry }
          : { t: [...l.t, ...r.t], f: r.f, entry: l.entry };
      }
    }
    const nt = this.table.expr.not;
    if (nt.type && e.type === nt.type && e.children.some(c => !c.isNamed && c.type === nt.op)) {
      const inner = this.unwrap(e.childForFieldName(nt.operand));
      if (inner && inner.type === lg.type) {
        const iop = this.operator(inner);
        if (iop !== undefined && (lg.and.includes(iop) || lg.or.includes(iop))) {
          const r = this.condEval(inner, ins, kind);
          this.claimed.add(e.id);
          return { t: r.f, f: r.t, entry: r.entry };
        }
      }
    }
    return this.leafCond(e, ins, kind);
  }
}
