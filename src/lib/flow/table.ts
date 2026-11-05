/**
 * Per-language description of the syntax the flow builder understands.
 *
 * The builder (cfg.ts, refs.ts, scope.ts) knows nothing of any grammar: it
 * reads node types and field names from a table. A language with the same
 * statement shapes as an existing table (JavaScript is TypeScript without the
 * type syntax) is a new table plus fixtures; a language with different
 * statement kinds (Python's `for ... else`, `with`, `match`; Go's `select`,
 * `defer`, `goto`) also needs builder support for them.
 */

/** Statement rules, discriminated by `kind`. Field values are tree-sitter field names. */
export type StmtRule =
  | { kind: 'block' }
  | { kind: 'skip' }
  /** Hoisted declaration (no node; its body is a closure; binding defined at entry). */
  | { kind: 'hoisted' }
  | { kind: 'if'; cond: string; then: string; else: string; elseWrapper?: string }
  | { kind: 'for'; init: string; cond: string; update: string; body: string }
  | { kind: 'foreach'; left: string; right: string; body: string }
  | { kind: 'while'; cond: string; body: string }
  | { kind: 'do'; body: string; cond: string }
  | { kind: 'switch'; value: string; body: string }
  | { kind: 'try'; body: string; handler: string; finalizer: string }
  | { kind: 'return' }
  | { kind: 'throw' }
  | { kind: 'break'; label: string }
  | { kind: 'continue'; label: string }
  | { kind: 'labeled'; label: string; body: string };

export interface FlowTable {
  /** Language name, for messages. */
  language: string;
  /** Function-like node types; each is its own graph. */
  functions: string[];
  /** Field of a function node holding its body / name; parameter fields (a list node, or one pattern). */
  fn: { body: string; name: string; params: string[] };
  /** Node types that group parameters (their named children are the parameters). */
  paramLists: string[];
  /** A parameter node type -> field holding its binding pattern. */
  paramPattern: Record<string, string>;
  /** Statement rules by node type; anything else is one simple statement node. */
  stmts: Record<string, StmtRule>;
  /** Comment / noise node types ignored in statement lists. */
  ignore: string[];
  /** switch body children: case clauses (`value`) and the default clause. */
  switchClauses: { case: string; default: string; value: string; body: string };
  /** catch clause fields. */
  catchClause: { param: string; body: string };
  /** finally clause body field. */
  finallyBody: string;
  expr: {
    parens: string[];
    /** Binary node type, its operand fields and the short-circuit operators. */
    logical: { type: string; left: string; right: string; ops: string[]; nullish: string[] };
    ternary: { type: string; cond: string; then: string; else: string };
    not: { type: string; op: string; operand: string };
    calls: { call: string; callee: string; new: string; newCallee: string };
    /** Await / yield: may throw. */
    throwing: string[];
  };
  /** Data flow syntax. */
  data: {
    identifiers: string[];
    /** Declaration statements and whether their names are block scoped (`let`/`const`) or function scoped (`var`). */
    declarations: Record<string, 'block' | 'function'>;
    declarator: { type: string; name: string; value: string };
    assignment: { type: string; left: string; right: string };
    augmented: { type: string; left: string; right: string; weakOps: string[] };
    update: { type: string; argument: string };
    members: { type: string; object: string }[];
    patterns: {
      object: string; array: string; rest: string; withDefault: string[];
      pair: { type: string; key: string; value: string };
      shorthand: string[];
      /** `[a = 1]` / `{a = 1}`: left, right. */
      defaultLeft: string; defaultRight: string;
    };
    /** `for (const k of o)` keyword tokens that declare the loop variable, and which scope they bind in. */
    loopDecl: Record<string, 'block' | 'function'>;
    /** Node types that bind a block scope. */
    blockScopes: string[];
    /** Declarations of named hoisted bindings (function, class) -> name field. */
    namedDecls: Record<string, string>;
    /** Class-like node types (body methods are closures). */
    classes: string[];
    /** Types and annotations: identifiers inside are not variable references. */
    skip: string[];
    /** Expression forms whose first named child only is an expression (`x as T`). */
    firstChildOnly: string[];
  };
  /** Table's name for a function's display name when it has none. */
  anonymous: string;
}
