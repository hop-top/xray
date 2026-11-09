import type Parser from 'tree-sitter';
import type { DefKind } from './types';
import type { FlowTable } from './table';
import { Scopes, Binding, kids, pick, pickAll, refKids, paramNodes, paramPatterns, importedNames } from './scope';

type Node = Parser.SyntaxNode;

export interface DefRec {
  binding: Binding;
  kind: DefKind;
  weak: boolean;
  /** Source order inside its node. */
  line: number;
}

/** What one CFG node reads, writes and calls. */
export interface Refs {
  uses: Binding[];
  defs: DefRec[];
  calls: string[];
  /** Evaluates something that may throw (call, `new`, `await`). */
  throws: boolean;
  /** Names something (a variable, a free name): where anything may raise, this can; a bare literal cannot. */
  reads: boolean;
}

export const emptyRefs = (): Refs => ({ uses: [], defs: [], calls: [], throws: false, reads: false });

const CALL_CAP = 40;
/** Per CFG node: reads and callee names kept (a generated 50k-name expression must not cost n squared). */
const USES_PER_NODE = 500;
const CALLS_PER_NODE = 200;
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Reads, writes and calls of source pieces, resolved to bindings.
 *
 * Only bindings owned by the analysed function count: a name of an outer
 * scope is free here (its function marks it captured instead). Function
 * calls never define anything: a call that mutates an argument or receiver
 * is invisible to the data flow (see docs/user/commands.md, graph limits).
 */
export class RefScanner {
  constructor(
    private readonly table: FlowTable,
    private readonly scopes: Scopes,
    private readonly fn: Node,
    /** Node ids already assigned to another CFG node; scanning skips them. */
    readonly claimed: Set<number>
  ) {}

  /** Scan a piece (an expression or statement) and claim it. */
  scan(n: Node | null): Refs {
    const acc = emptyRefs();
    if (n) {
      this.walk(n, acc);
      this.claimed.add(n.id);
    }
    return acc;
  }

  /** Parameters (defaults are uses; names are `param` defs) and named results (`decl`, zero valued) of the analysed function. */
  scanParams(): Refs {
    const acc = emptyRefs();
    for (const p of paramNodes(this.fn, this.table)) {
      const value = p.childForFieldName('value');
      if (value) this.walk(value, acc);
      for (const pat of paramPatterns(p, this.table)) this.bind(pat, 'param', 'declare', acc);
    }
    for (const p of paramNodes(this.fn, this.table, this.table.fn.results ?? [])) {
      for (const pat of paramPatterns(p, this.table)) this.bind(pat, 'decl', 'declare', acc);
    }
    return acc;
  }

  /** Bindings of the named results, in order (read where the function returns). */
  resultBindings(): Binding[] {
    const out: Binding[] = [];
    for (const p of paramNodes(this.fn, this.table, this.table.fn.results ?? [])) {
      for (const pat of paramPatterns(p, this.table)) {
        const b = this.scopes.declared.get(pat.id);
        if (b && b.owner === this.fn.id) out.push(b);
      }
    }
    return out;
  }

  /** Scan several pieces into one `Refs`. */
  scanAll(nodes: Array<Node | null>): Refs {
    const acc = emptyRefs();
    for (const n of nodes) {
      if (!n) continue;
      this.walk(n, acc);
      this.claimed.add(n.id);
    }
    return acc;
  }

  /** Record a read of the variable `id` names. */
  useOf(id: Node, acc: Refs): void { this.use(id, acc); }

  /** Record a write of the variable declared (or, `assign`, resolved) at `id`. */
  defOf(id: Node, kind: DefKind, mode: 'declare' | 'assign', acc: Refs, weak = false): void {
    this.define(id, kind, mode, acc, weak);
  }

  /** Mark every binding a function nested in the analysed one references as captured. */
  markCaptured(nested: Node): void {
    this.capture(nested, emptyRefs());
  }

  /** Bind a loop variable / catch parameter (`declare`) or assign to an existing target (`assign`). */
  bind(p: Node | null, kind: DefKind, mode: 'declare' | 'assign', acc: Refs): void {
    if (!p) return;
    const t = this.table;
    const pt = t.data.patterns;
    const ty = p.type;
    if (t.data.identifiers.includes(ty) || pt.shorthand.includes(ty)) {
      this.define(p, kind, mode, acc);
    } else if (ty === pt.object || pt.array.includes(ty) || pt.rest.includes(ty)) {
      for (const c of p.namedChildren) this.bind(c, kind, mode, acc);
    } else if (ty === pt.pair.type) {
      const key = p.childForFieldName(pt.pair.key);
      if (key && key.type === 'computed_property_name') this.walk(key, acc);
      this.bind(p.childForFieldName(pt.pair.value), kind, mode, acc);
    } else if (pt.withDefault.includes(ty)) {
      const right = p.childForFieldName(pt.defaultRight);
      if (right) this.walk(right, acc);
      this.bind(p.childForFieldName(pt.defaultLeft), kind, mode, acc);
    } else if (t.data.members.some(m => m.type === ty)) {
      this.member(p, acc);
    } else if (t.expr.parens.includes(ty)) {
      this.bind(p.namedChild(0), kind, mode, acc);
    } else {
      // `*p = v`, `f().x = v`: nothing to bind, but the target reads names.
      this.walk(p, acc);
    }
  }

  private define(id: Node, kind: DefKind, mode: 'declare' | 'assign', acc: Refs, weak = false): void {
    const b = mode === 'declare' ? this.scopes.declared.get(id.id) : this.scopes.resolve(id);
    if (b && b.owner === this.fn.id) {
      acc.defs.push({ binding: b, kind, weak, line: id.startPosition.row });
    }
  }

  private use(id: Node, acc: Refs): void {
    const b = this.scopes.resolve(id);
    if (b && b.owner === this.fn.id && acc.uses.length < USES_PER_NODE && !acc.uses.includes(b)) acc.uses.push(b);
  }

  /** `o.p = v` / `o[i]++`: uses `o` (and `i`), weakly defines the root variable. */
  private member(target: Node, acc: Refs): void {
    this.walk(target, acc);
    let root: Node | null = target;
    while (root && this.table.data.members.some(m => m.type === root!.type)) {
      const spec = this.table.data.members.find(m => m.type === root!.type)!;
      root = root.childForFieldName(spec.object);
    }
    if (root && this.table.data.identifiers.includes(root.type)) {
      this.define(root, 'member', 'assign', acc, true);
    }
  }

  private capture(n: Node, acc: Refs): void {
    const t = this.table;
    if (t.data.skip.includes(n.type)) return;
    if (t.data.identifiers.includes(n.type) || t.data.patterns.shorthand.includes(n.type)) {
      if (this.scopes.isDeclaration(n)) return;
      const b = this.scopes.resolve(n);
      if (b && b.owner === this.fn.id) {
        b.captured = true;
        if (acc.uses.length < USES_PER_NODE && !acc.uses.includes(b)) acc.uses.push(b);
      }
      return;
    }
    for (const c of refKids(n, t)) this.capture(c, acc);
  }

  private calleeText(n: Node | null): string {
    const s = collapse(n ? n.text : '?');
    return s.length > CALL_CAP ? s.slice(0, CALL_CAP - 1) + '…' : s;
  }

  private walk(n: Node, acc: Refs): void {
    const t = this.table;
    const d = t.data;
    if (this.claimed.has(n.id) || d.skip.includes(n.type)) return;
    const ty = n.type;
    if (d.firstChildOnly.includes(ty)) {
      const c = n.namedChild(0);
      if (c) this.walk(c, acc);
      return;
    }
    if (t.functions.includes(ty)) {
      this.capture(n, acc);
      return;
    }
    if (d.identifiers.includes(ty)) {
      if (!this.scopes.isDeclaration(n)) { acc.reads = true; this.use(n, acc); }
      return;
    }
    if (ty === t.expr.calls.call || ty === t.expr.calls.new) {
      const isNew = ty === t.expr.calls.new;
      const callee = n.childForFieldName(isNew ? t.expr.calls.newCallee : t.expr.calls.callee);
      const text = this.calleeText(callee);
      const name = isNew ? `new ${text}` : text;
      if (acc.calls.length < CALLS_PER_NODE && !acc.calls.includes(name)) acc.calls.push(name);
      acc.throws = true;
    } else if (t.expr.throwing.includes(ty)) {
      acc.throws = true;
    }
    if (ty === d.declarator.type) {
      const value = n.childForFieldName(d.declarator.value);
      if (value) this.walk(value, acc);
      const isVar = n.parent && d.declarations[n.parent.type] === 'function';
      // `var x;` neither defines nor resets x; `let x;` defines it as undefined.
      if (value || !isVar) this.bind(n.childForFieldName(d.declarator.name), 'decl', 'declare', acc);
      return;
    }
    const op = ty === d.assignment.type ? this.operatorOf(n) : '=';
    if (ty === d.assignment.type && (op === '=' || op === ':=')) {
      const right = n.childForFieldName(d.assignment.right);
      if (right) this.walk(right, acc);
      // `x: int` (no value) binds nothing yet; `a, b := f()` declares.
      if (right) this.bind(n.childForFieldName(d.assignment.left), 'assign', op === ':=' ? 'declare' : 'assign', acc);
      return;
    }
    if (ty === d.augmented.type || ty === d.assignment.type || d.update.types.includes(ty)) {
      const isAug = ty === d.augmented.type || ty === d.assignment.type;
      const side = ty === d.assignment.type ? d.assignment : d.augmented;
      const target = isAug ? n.childForFieldName(side.left) : pick(n, d.update.argument);
      if (isAug) {
        const right = n.childForFieldName(side.right);
        if (right) this.walk(right, acc);
      }
      const aop = isAug ? (ty === d.assignment.type ? op : this.operatorOf(n)) : '';
      const weak = isAug && d.augmented.weakOps.includes(aop);
      let tg = target;
      // `x += 1`, `(x) += 1`, and Go's `x += 1` whose target is a one-name list.
      while (tg && (t.expr.parens.includes(tg.type) || (t.data.patterns.array.includes(tg.type) && tg.namedChildCount === 1))) {
        tg = tg.namedChild(0);
      }
      if (tg && d.identifiers.includes(tg.type)) {
        this.use(tg, acc);
        this.define(tg, weak ? 'maybe' : 'update', 'assign', acc, weak);
      } else if (tg) {
        this.member(tg, acc);
      }
      return;
    }
    if (d.imports?.types.includes(ty)) {
      for (const id of importedNames(n, t)) this.define(id, 'decl', 'declare', acc);
      return;
    }
    const binder = d.binders.find(b => b.type === ty && (!b.when || n.children.some(c => !c.isNamed && c.type === b.when)));
    if (binder) {
      const targets = pickAll(n, binder.field);
      const ids = new Set(targets.map(x => x.id));
      for (const c of refKids(n, t)) if (!ids.has(c.id)) this.walk(c, acc);
      for (const tg of targets) this.bind(tg, binder.kind ?? 'decl', 'declare', acc);
      return;
    }
    for (const c of refKids(n, t)) this.walk(c, acc);
  }

  /** The `=` / `+=` / `:=` token of an assignment. */
  private operatorOf(n: Node): string {
    return n.children.find(c => !c.isNamed && c.type.endsWith('=') && !['==', '!=', '<=', '>=', '==='].includes(c.type))?.type ?? '=';
  }
}
