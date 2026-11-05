import type Parser from 'tree-sitter';
import type { CfgEdge, CfgEdgeLabel, CfgKind, CfgNode } from './types';
import type { FlowTable } from './table';
import { Scopes } from './scope';
import { RefScanner, Refs, emptyRefs } from './refs';

export type Node = Parser.SyntaxNode;

/** A dangling edge: leaves `from`, target not built yet. */
export interface End { from: string; label?: CfgEdgeLabel }

/** CFG node with what it reads and writes (input of the data flow). */
export interface FlowNode extends CfgNode { refs: Refs }

/**
 * Code that runs on the way out of a region, once per way out (a `finally`, a
 * `with` exit, Go's deferred calls): `run` builds one copy after `ins`.
 */
export interface Cleanup {
  kind: 'finally';
  run: (ins: End[]) => End[];
  /** Part of the memo key: copies are shared per (way out, key). */
  key: () => string;
  memo: Map<string, string>;
  /** Line of the code that runs (where a `rethrow` node is placed). */
  line: number;
  /** Nothing registered yet (no deferred call): jumps pass straight through. */
  active: () => boolean;
  /** An exception that reaches the end of a copy may be stopped here (Go `recover`). */
  recovers?: () => boolean;
}

export type Frame =
  | { kind: 'loop'; labels: string[]; breaks: End[]; continues: End[] }
  | { kind: 'switch'; labels: string[]; breaks: End[]; falls: End[] }
  | { kind: 'label'; label: string; breaks: End[] }
  | { kind: 'catch'; throws: End[] }
  | Cleanup;

export interface BuiltCfg {
  nodes: FlowNode[];
  edges: CfgEdge[];
  /** Nodes the function has (more than `nodes.length` when capped). */
  total: number;
  /** Construction stopped at the work cap: `total` is a lower bound. */
  partial: boolean;
}

const LABEL_CAP = 60;

/** Thrown by `mk` when the function used up its work cap; caught where the graph is assembled. */
export class BudgetExceeded extends Error {}
const EVALUATES: CfgKind[] = ['stmt', 'expr', 'cond', 'loop', 'switch', 'case'];

/** Source text as a one-line label. */
export function labelOf(s: string): string {
  // Only the head can show: do not normalise a megabyte of source for a 60 character label.
  const one = s.slice(0, LABEL_CAP * 4).replace(/\s+/g, ' ').trim().replace(/;$/, '');
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
 * Nodes, edges and the stack of regions a jump leaves.
 *
 * `return` / `throw` / `break` / `continue` walk the frame stack: a cleanup
 * on the way gets one copy per kind of jump that crosses it, so a `return`
 * inside `try` runs the `finally` and then leaves, while normal completion
 * runs another copy and falls through.
 */
export class FlowCore {
  protected nodes: FlowNode[] = [];
  protected edges: CfgEdge[] = [];
  protected seen = new Set<string>();
  protected total = 0;
  protected frames: Frame[] = [];
  protected pendingLabels: string[] = [];
  protected readonly scanner: RefScanner;
  protected readonly claimed = new Set<number>();

  constructor(
    protected readonly fn: Node,
    protected readonly table: FlowTable,
    protected readonly scopes: Scopes,
    protected readonly maxNodes: number,
    /** Nodes that may be created in all (see `flowWorkCap`). */
    protected readonly workCap: number = Infinity
  ) {
    this.scanner = new RefScanner(table, scopes, fn, this.claimed);
  }

  protected mk(kind: CfgKind, label: string, ast: Node | null, refs: Refs, ins: End[], line?: number): FlowNode {
    if (this.total >= this.workCap && kind !== 'exit') throw new BudgetExceeded();
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

  protected link(ends: End[], to: string): void {
    for (const e of ends) {
      const key = `${e.from}>${to}>${e.label ?? ''}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const edge: CfgEdge = { from: e.from, to };
      if (e.label) edge.label = e.label;
      this.edges.push(edge);
    }
  }

  protected takeLabels(): string[] {
    const l = this.pendingLabels;
    this.pendingLabels = [];
    return l;
  }

  protected hasHandler(): boolean {
    return this.frames.some(f => f.kind === 'catch' || (f.kind === 'finally' && f.active()));
  }

  /** A node that may throw reaches the nearest handler (only when one exists). */
  protected thrower(node: FlowNode, refs: Refs): void {
    if ((refs.throws || (this.table.expr.anyThrows && refs.reads)) && this.hasHandler()) this.jump([{ from: node.id, label: 'throw' }], 'throw');
  }

  /** Throw edges from every node built since `mark` that evaluates something and has none yet. */
  protected mayThrow(mark: number): End[] {
    const has = new Set(this.edges.filter(e => e.label === 'throw').map(e => e.from));
    return this.nodes
      .filter(n => Number(n.id.slice(1)) >= mark && EVALUATES.includes(n.kind) && !has.has(n.id))
      .map(n => ({ from: n.id, label: 'throw' as const }));
  }

  protected jump(ends: End[], kind: 'break' | 'continue' | 'return' | 'throw' | 'fallthrough', label?: string): void {
    let cur = ends;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (kind === 'throw' && f.kind === 'catch') { f.throws.push(...cur); return; }
      if (kind === 'fallthrough' && f.kind === 'switch') { f.falls.push(...cur); return; }
      if (kind === 'break') {
        if ((f.kind === 'loop' || f.kind === 'switch') && (label === undefined || f.labels.includes(label))) {
          f.breaks.push(...cur); return;
        }
        if (f.kind === 'label' && f.label === label) { f.breaks.push(...cur); return; }
      }
      if (kind === 'continue' && f.kind === 'loop' && (label === undefined || f.labels.includes(label))) {
        f.continues.push(...cur); return;
      }
      if (f.kind === 'finally' && f.active()) {
        const key = `${kind}:${label ?? ''}:${f.key()}`;
        const known = f.memo.get(key);
        if (known) { this.link(cur, known); return; }
        const saved = this.frames;
        this.frames = saved.slice(0, i);
        const mark = this.total;
        const outs = f.run(cur);
        this.frames = saved;
        if (this.total > mark) f.memo.set(key, `n${mark}`);
        cur = outs;
        if (kind === 'throw' && outs.length > 0) {
          // A panic a deferred call recovers: the function returns normally.
          if (f.recovers?.()) {
            const rc = this.mk('stmt', 'recovered', null, emptyRefs(), outs, f.line);
            this.link([{ from: rc.id }], 'n1');
          }
          // The exception leaves the copy through one node of its own, so a
          // branch at the end of the copy is never read as a way out.
          const r = this.mk('rethrow', 'rethrow', null, emptyRefs(), outs, f.line);
          cur = [{ from: r.id, label: 'throw' }];
        }
        if (cur.length === 0) return;
      }
    }
    if (kind === 'return' || kind === 'throw') this.link(cur, 'n1');
  }
}
