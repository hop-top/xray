import type Parser from 'tree-sitter';
import type { FlowTable, Spec } from './table';

type Node = Parser.SyntaxNode;

export interface Binding {
  id: number;
  name: string;
  /** Node id of the function whose graph owns the binding (comprehensions and class bodies own their own: never tracked). */
  owner: number;
  /** Referenced (read or written) from a function nested in the owner. */
  captured: boolean;
}

/** Named children, skipping comments. */
export const kids = (n: Node, table: FlowTable): Node[] =>
  n.namedChildren.filter(c => !table.ignore.includes(c.type));

/** The part of `n` a spec points at. */
export function pick(n: Node | null | undefined, spec: Spec | undefined): Node | null {
  if (!n || spec === undefined || spec === '') return null;
  if (typeof spec === 'string') return n.childForFieldName(spec);
  if (typeof spec === 'number') {
    const c = n.namedChildren;
    return (spec < 0 ? c[c.length + spec] : c[spec]) ?? null;
  }
  return n.namedChildren.find(c => c.type === spec.type) ?? null;
}

/** Every part of `n` a spec points at (a field can hold several nodes). */
export function pickAll(n: Node | null | undefined, spec: Spec | undefined): Node[] {
  if (!n || spec === undefined || spec === '') return [];
  if (typeof spec === 'string') return n.childrenForFieldName(spec);
  const one = pick(n, spec);
  return one ? [one] : [];
}

/** Child nodes of `n` that can hold variable references (not `a.b`'s `b`, not `f(k=1)`'s `k`). */
export function refKids(n: Node, table: FlowTable): Node[] {
  const skip = table.data.nonRef?.[n.type];
  const all = kids(n, table).filter(c => !table.data.skipNode?.(c));
  if (!skip) return all;
  const ids = new Set(skip.flatMap(f => pickAll(n, f)).map(c => c.id));
  return all.filter(c => !ids.has(c.id));
}

/** Parameter nodes of a function-like node. */
export function paramNodes(fn: Node, table: FlowTable, fields: string[] = table.fn.params): Node[] {
  const out: Node[] = [];
  for (const field of fields) {
    const p = fn.childForFieldName(field);
    if (!p) continue;
    if (table.paramLists.includes(p.type)) out.push(...kids(p, table));
    else out.push(p);
  }
  return out;
}

/** Binding patterns of a parameter node (`required_parameter` -> its `pattern`; `a, b int` -> `a`, `b`). */
export function paramPatterns(p: Node, table: FlowTable): Node[] {
  const spec = table.paramPattern[p.type];
  return spec === undefined ? [p] : pickAll(p, spec);
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
  /** Function (or class body) node id -> names `global` / `nonlocal` took out of it. */
  private readonly excluded = new Map<number, Set<string>>();
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
    const t = this.table;
    let crossed = false;
    for (let a: Node | null = id.parent; a; a = a.parent) {
      // A class body is no scope for the methods inside it.
      const hidden = crossed && t.data.classScopes && t.data.classes.includes(a.type);
      const hit = hidden ? undefined : this.scopes.get(a.id)?.get(id.text);
      if (hit) return hit;
      if (t.functions.includes(a.type)) crossed = true;
      if (a.id === this.root.id) break;
    }
    return undefined;
  }

  private declare(scope: Node, name: Node, owner: Node, functionLevel = false): void {
    const blank = this.table.data.blank;
    if (blank && name.text === blank) return;
    if (functionLevel && this.excluded.get(scope.id)?.has(name.text)) return;
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
  private declarePattern(p: Node | null, scope: Node, owner: Node, functionLevel = false): void {
    if (!p) return;
    const pt = this.table.data.patterns;
    if (this.table.data.identifiers.includes(p.type) || pt.shorthand.includes(p.type)) {
      this.declare(scope, p, owner, functionLevel);
    } else if (p.type === pt.object || pt.array.includes(p.type) || pt.rest.includes(p.type)) {
      for (const c of p.namedChildren) this.declarePattern(c, scope, owner, functionLevel);
    } else if (p.type === pt.pair.type) {
      this.declarePattern(p.childForFieldName(pt.pair.value), scope, owner, functionLevel);
    } else if (pt.withDefault.includes(p.type)) {
      this.declarePattern(p.childForFieldName(pt.defaultLeft), scope, owner, functionLevel);
    } else if (this.table.expr.parens.includes(p.type)) {
      this.declarePattern(p.namedChild(0), scope, owner, functionLevel);
    }
  }

  private visitFunction(fn: Node): void {
    const t = this.table;
    const name = fn.childForFieldName(t.fn.name);
    const declaration = fn.type in t.data.namedDecls;
    // A function expression's own name is visible inside it only.
    if (name && !declaration && t.data.identifiers.includes(name.type)) this.declare(fn, name, fn);
    const params = [...paramNodes(fn, t), ...paramNodes(fn, t, t.fn.results ?? [])];
    for (const p of params) for (const pat of paramPatterns(p, t)) this.declarePattern(pat, fn, fn);
    for (const p of params) this.visit(p, fn, fn, fn);
    const body = fn.childForFieldName(t.fn.body);
    if (!body) return;
    // The body block shares the function's scope.
    if (body.type in t.stmts && t.stmts[body.type].kind === 'block') {
      for (const c of body.namedChildren) this.visit(c, fn, fn, fn);
    } else this.visit(body, fn, fn, fn);
  }

  /**
   * `scope`: innermost scope node (block, comprehension). `fscope`: where
   * function level names go (the function, or the class body being run).
   */
  private visit(n: Node, scope: Node, fn: Node, fscope: Node): void {
    const t = this.table;
    if (t.data.skip.includes(n.type)) return;
    if (t.functions.includes(n.type)) {
      const nm = n.childForFieldName(t.fn.name);
      if (nm && n.type in t.data.namedDecls) this.declare(scope, nm, fscope);
      this.visitFunction(n);
      return;
    }
    const named = t.data.namedDecls[n.type];
    let inner = scope;
    let innerF = fscope;
    if (named && t.data.classes.includes(n.type)) {
      const nm = n.childForFieldName(named);
      if (nm) this.declare(scope, nm, fscope);
      if (t.data.classScopes) { inner = n; innerF = n; }
    }
    const declKind = t.data.declarations[n.type];
    if (declKind) {
      for (const d of n.namedChildren) {
        if (d.type !== t.data.declarator.type) continue;
        this.declarePattern(d.childForFieldName(t.data.declarator.name), declKind === 'function' ? fscope : scope, fscope);
      }
    }
    if (t.data.blockScopes.includes(n.type)) {
      inner = n;
      if (!this.scopes.has(n.id)) this.scopes.set(n.id, new Map());
      if (t.catchClause && n.type === t.catchClause.type) {
        this.declarePattern(n.childForFieldName(t.catchClause.param), n, fscope);
      }
      const rule = t.stmts[n.type];
      if (rule && rule.kind === 'foreach') {
        const hdr = rule.via ? n.namedChildren.find(c => c.type === rule.via) ?? n : n;
        const kw = hdr.children.find(c => !c.isNamed && c.type in t.data.loopDecl);
        if (kw) {
          const target = t.data.loopDecl[kw.type] === 'function' ? fscope : n;
          for (const l of pickAll(hdr, rule.left)) this.declarePattern(l, target, fscope);
        }
      }
    }
    this.bind(n, inner, fscope);
    const rule = t.stmts[n.type];
    if (rule && rule.kind === 'match') {
      for (const c of rule.cases(n)) for (const b of c.binds) this.declare(fscope, b, fscope, true);
    }
    for (const c of n.namedChildren) this.visit(c, inner, fn, innerF);
  }

  /** Names a statement binds on its own (assignments, `for`, `as`, imports, `global`). */
  private bind(n: Node, scope: Node, fscope: Node): void {
    const d = this.table.data;
    for (const b of d.binders) {
      if (b.type !== n.type) continue;
      if (b.when && !n.children.some(c => !c.isNamed && c.type === b.when)) continue;
      const level = b.scope === 'function';
      const target = level ? fscope : scope;
      for (const p of pickAll(n, b.field)) this.declarePattern(p, target, b.scope === 'comprehension' ? scope : fscope, level);
    }
    if (d.hoists?.includes(n.type)) {
      const names = this.excluded.get(fscope.id) ?? new Set<string>();
      for (const c of n.namedChildren) if (d.identifiers.includes(c.type)) names.add(c.text);
      this.excluded.set(fscope.id, names);
    }
    if (d.imports?.types.includes(n.type)) {
      for (const id of importedNames(n, this.table)) this.declare(fscope, id, fscope, true);
    }
  }
}

/** Identifier nodes an import statement binds (`import a.b` binds `a`, `x as y` binds `y`). */
export function importedNames(n: Node, table: FlowTable): Node[] {
  const im = table.data.imports;
  if (!im) return [];
  const out: Node[] = [];
  for (const c of n.childrenForFieldName(im.names)) {
    if (c.type === im.aliased) {
      const a = c.childForFieldName(im.alias);
      if (a) out.push(a);
    } else {
      const first = c.type === 'dotted_name' ? c.namedChild(0) : c;
      if (first && table.data.identifiers.includes(first.type)) out.push(first);
    }
  }
  return out;
}
