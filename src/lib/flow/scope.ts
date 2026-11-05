import type Parser from 'tree-sitter';
import type { FlowTable } from './table';

type Node = Parser.SyntaxNode;

export interface Binding {
  id: number;
  name: string;
  /** Node id of the function whose graph owns the binding. */
  owner: number;
  /** Referenced (read or written) from a function nested in the owner. */
  captured: boolean;
}

/** Named children, skipping comments. */
export const kids = (n: Node, table: FlowTable): Node[] =>
  n.namedChildren.filter(c => !table.ignore.includes(c.type));

/** Parameter nodes of a function-like node. */
export function paramNodes(fn: Node, table: FlowTable): Node[] {
  const out: Node[] = [];
  for (const field of table.fn.params) {
    const p = fn.childForFieldName(field);
    if (!p) continue;
    if (table.paramLists.includes(p.type)) out.push(...kids(p, table));
    else out.push(p);
  }
  return out;
}

/** Binding pattern of a parameter node (`required_parameter` -> its `pattern`). */
export function paramPattern(p: Node, table: FlowTable): Node {
  const field = table.paramPattern[p.type];
  return (field && p.childForFieldName(field)) || p;
}

/**
 * Lexical scopes of one analysed function and everything nested in it:
 * which identifier is a declaration, and which binding every other
 * identifier refers to (none: free, i.e. global / module / outer scope).
 */
export class Scopes {
  readonly bindings: Binding[] = [];
  /** Identifier node id -> binding, for declaring identifiers. */
  readonly declared = new Map<number, Binding>();
  private readonly scopes = new Map<number, Map<string, Binding>>();
  private readonly root: Node;

  constructor(fn: Node, private readonly table: FlowTable) {
    this.root = fn;
    this.visitFunction(fn);
  }

  isDeclaration(n: Node): boolean {
    return this.declared.has(n.id);
  }

  /** Binding `id` refers to, walking enclosing scopes outward. */
  resolve(id: Node): Binding | undefined {
    for (let a: Node | null = id.parent; a; a = a.parent) {
      const hit = this.scopes.get(a.id)?.get(id.text);
      if (hit) return hit;
      if (a.id === this.root.id) break;
    }
    return undefined;
  }

  private declare(scope: Node, name: Node, owner: Node): void {
    let names = this.scopes.get(scope.id);
    if (!names) this.scopes.set(scope.id, (names = new Map()));
    let b = names.get(name.text);
    if (!b) {
      b = { id: this.bindings.length, name: name.text, owner: owner.id, captured: false };
      this.bindings.push(b);
      names.set(name.text, b);
    }
    this.declared.set(name.id, b);
  }

  /** Declare every name a binding pattern introduces. */
  private declarePattern(p: Node | null, scope: Node, owner: Node): void {
    if (!p) return;
    const pt = this.table.data.patterns;
    if (this.table.data.identifiers.includes(p.type) || pt.shorthand.includes(p.type)) {
      this.declare(scope, p, owner);
    } else if (p.type === pt.object || p.type === pt.array || p.type === pt.rest) {
      for (const c of p.namedChildren) this.declarePattern(c, scope, owner);
    } else if (p.type === pt.pair.type) {
      this.declarePattern(p.childForFieldName(pt.pair.value), scope, owner);
    } else if (pt.withDefault.includes(p.type)) {
      this.declarePattern(p.childForFieldName(pt.defaultLeft), scope, owner);
    }
  }

  private visitFunction(fn: Node): void {
    const t = this.table;
    const name = fn.childForFieldName(t.fn.name);
    const declaration = fn.type in t.data.namedDecls;
    // A function expression's own name is visible inside it only.
    if (name && !declaration && t.data.identifiers.includes(name.type)) this.declare(fn, name, fn);
    for (const p of paramNodes(fn, t)) this.declarePattern(paramPattern(p, t), fn, fn);
    for (const p of paramNodes(fn, t)) this.visit(p, fn, fn);
    const body = fn.childForFieldName(t.fn.body);
    if (!body) return;
    // The body block shares the function's scope.
    if (body.type in t.stmts && t.stmts[body.type].kind === 'block') {
      for (const c of body.namedChildren) this.visit(c, fn, fn);
    } else this.visit(body, fn, fn);
  }

  private nearest(scope: Node, kind: 'block' | 'function', fn: Node): Node {
    return kind === 'function' ? fn : scope;
  }

  private visit(n: Node, scope: Node, fn: Node): void {
    const t = this.table;
    if (t.data.skip.includes(n.type)) return;
    if (t.functions.includes(n.type)) {
      const nm = n.childForFieldName(t.fn.name);
      if (nm && n.type in t.data.namedDecls) this.declare(this.nearest(scope, 'block', fn), nm, fn);
      this.visitFunction(n);
      return;
    }
    const named = t.data.namedDecls[n.type];
    if (named && t.data.classes.includes(n.type)) {
      const nm = n.childForFieldName(named);
      if (nm) this.declare(scope, nm, fn);
    }
    const declKind = t.data.declarations[n.type];
    if (declKind) {
      for (const d of n.namedChildren) {
        if (d.type !== t.data.declarator.type) continue;
        this.declarePattern(d.childForFieldName(t.data.declarator.name), this.nearest(scope, declKind, fn), fn);
      }
    }
    let inner = scope;
    if (t.data.blockScopes.includes(n.type)) {
      inner = n;
      if (!this.scopes.has(n.id)) this.scopes.set(n.id, new Map());
      if (n.type === 'catch_clause') {
        this.declarePattern(n.childForFieldName(t.catchClause.param), n, fn);
      }
      const rule = t.stmts[n.type];
      if (rule && rule.kind === 'foreach') {
        const kw = n.children.find(c => !c.isNamed && c.type in t.data.loopDecl);
        if (kw) {
          const target = t.data.loopDecl[kw.type] === 'function' ? fn : n;
          this.declarePattern(n.childForFieldName(rule.left), target, fn);
        }
      }
    }
    for (const c of n.namedChildren) this.visit(c, inner, fn);
  }
}
