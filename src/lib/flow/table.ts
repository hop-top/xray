import type Parser from 'tree-sitter';

type Node = Parser.SyntaxNode;

/**
 * Per-language description of the syntax the flow builder understands.
 *
 * The builder (cfg*.ts, refs.ts, scope.ts) knows nothing of any grammar: it
 * reads node types and field names from a table. A language with the same
 * statement shapes as an existing table (JavaScript is TypeScript without the
 * type syntax) is a new table plus fixtures; a language with different
 * statement kinds (Python's `with`, `match`; Go's `select`, `defer`, `goto`)
 * names them in `stmts` and the builder already has them. The few shapes a
 * field name cannot express (an `except` clause, a `case` pattern) are small
 * functions on the table.
 */

/**
 * Where a part of a node lives: a field name, the n-th named child (negative:
 * from the end), or the first named child of a node type.
 */
export type Spec = string | number | { type: string };

/** One handler of a `try`: `catch (e)`, `except (A, B) as e`. */
export interface TryHandler {
  node: Node;
  /** Source of the clause up to its body, for the label. */
  head: string;
  /** Expression naming what it catches; absent: catches everything. */
  types: Node | null;
  /** Binding of the caught exception. */
  param: Node | null;
  body: Node | null;
}

export interface TryParts {
  body: Node | null;
  handlers: TryHandler[];
  /** `else` of a Python `try`: runs when the body did not raise. */
  orelse: Node | null;
  /** Statements of the `finally`. */
  finalizer: Node | null;
}

/** One `with` item: the context expression and what it binds. */
export interface WithItem { node: Node; value: Node; alias: Node | null }

/** One `case` of a `match`. */
export interface MatchCase {
  node: Node;
  /** Source of the clause up to the end of its pattern. */
  head: string;
  /** Values the pattern reads (`Color.RED`, class names) and names it binds. */
  uses: Node[];
  binds: Node[];
  guard: Node | null;
  body: Node | null;
  /** `_` or a bare name: matches anything. */
  irrefutable: boolean;
}

/** Statement rules, discriminated by `kind`. */
export type StmtRule =
  | { kind: 'block' }
  | { kind: 'skip' }
  /** Hoisted declaration (no node; its body is a closure; binding defined at entry). */
  | { kind: 'hoisted' }
  /** `def` / `class` (also behind decorators): one node that binds the name; decorators and defaults run there. */
  | { kind: 'definition'; inner?: string; bases?: string }
  | { kind: 'if'; cond: Spec; then: Spec; else: Spec; elseWrapper?: string; init?: Spec;
      elif?: { type: string; cond: Spec; then: Spec } }
  | { kind: 'for'; init?: Spec; cond?: Spec; update?: Spec; body: Spec; via?: string }
  | { kind: 'foreach'; left?: Spec; right: Spec; body: Spec; via?: string; else?: Spec }
  | { kind: 'while'; cond: Spec; body: Spec; else?: Spec }
  | { kind: 'do'; body: Spec; cond: Spec }
  /** Picks the rule from the node itself (Go's `for` is four statements). */
  | { kind: 'dispatch'; pick: (n: Node) => StmtRule }
  | { kind: 'switch'; value?: Spec; body?: Spec; init?: Spec; alias?: Spec; suffix?: string }
  | { kind: 'select' }
  | { kind: 'try'; parts: (n: Node) => TryParts }
  | { kind: 'with'; items: (n: Node) => WithItem[]; body: Spec }
  | { kind: 'match'; subject: Spec; cases: (n: Node) => MatchCase[] }
  | { kind: 'return' }
  | { kind: 'throw' }
  | { kind: 'break'; label: Spec }
  | { kind: 'continue'; label: Spec }
  | { kind: 'goto'; label: Spec }
  | { kind: 'fallthrough' }
  /** Go `defer f()`: the call runs when the function exits. */
  | { kind: 'defer' }
  /** Go `go f()`: arguments evaluate here, the call runs elsewhere. */
  | { kind: 'go' }
  | { kind: 'labeled'; label: Spec; body: Spec };

/** A statement type that declares the names found in one of its parts. */
export interface Binder {
  type: string;
  field: Spec;
  /** Where the names live: the function (Python), the innermost block (Go), the comprehension. */
  scope: 'function' | 'block' | 'comprehension';
  /** Only when this token is among the node's children (`:=`). */
  when?: string;
  /** Definition kind recorded (default `decl`). */
  kind?: 'decl' | 'assign';
}

export interface FlowTable {
  /** Language name, for messages. */
  language: string;
  /** Function-like node types; each is its own graph. */
  functions: string[];
  /** Fields of a function node holding its body / name; parameter fields (a list node, or one pattern); named results. */
  fn: { body: string; name: string; params: string[]; results?: string[] };
  /** Node types that group parameters (their named children are the parameters). */
  paramLists: string[];
  /** A parameter node type -> where its binding pattern(s) are. */
  paramPattern: Record<string, Spec>;
  /** Statement rules by node type; anything else is one simple statement node. */
  stmts: Record<string, StmtRule>;
  /** Comment / noise node types ignored in statement lists. */
  ignore: string[];
  /**
   * switch clauses: case clause types, the default clause, fields of the case
   * value(s) (one per clause type), field of the body statements ('': the clause's other children)
   * and whether a clause runs into the next one (`fallthrough` jumps otherwise).
   */
  switchClauses: { cases: string[]; default: string; value: string[]; body: string; fallsThrough: boolean };
  /** catch clause type and the field of its parameter, for scoping. */
  catchClause?: { type: string; param: string };
  expr: {
    parens: string[];
    /** Binary node type, its operand fields and the short-circuit operators. */
    logical: { type: string; left: string; right: string; and: string[]; or: string[]; nullish: string[] };
    /** Absent in languages without `?:` (type ''). */
    ternary: { type: string; cond: Spec; then: Spec; else: Spec };
    not: { type: string; op: string; operand: string };
    calls: { call: string; callee: string; new: string; newCallee: string };
    /** Await / yield: may throw. */
    throwing: string[];
    /** Anything may raise (Python): every node under a handler throws, not just calls. */
    anyThrows?: boolean;
    /** Expressions evaluated as one node: no branch inside is split out (comprehensions). */
    opaque?: string[];
    /** A call statement that never returns normally (`panic`): a throw. */
    noReturn?: string[];
    /** Name of the builtin that stops a panic (Go `recover`). */
    recover?: string;
  };
  /** Data flow syntax. */
  data: {
    identifiers: string[];
    /** Declaration statements and whether their names are block scoped (`let`/`const`) or function scoped (`var`). */
    declarations: Record<string, 'block' | 'function'>;
    declarator: { type: string; name: string; value: string };
    assignment: { type: string; left: string; right: string };
    augmented: { type: string; left: string; right: string; weakOps: string[] };
    update: { types: string[]; argument: Spec };
    members: { type: string; object: string }[];
    patterns: {
      object: string; array: string[]; rest: string[]; withDefault: string[];
      pair: { type: string; key: string; value: string };
      shorthand: string[];
      /** `[a = 1]` / `{a = 1}`: left, right. */
      defaultLeft: string; defaultRight: string;
    };
    /** Statements binding names (Python assignment / `for` / `as`, Go `:=` / `var`). */
    binders: Binder[];
    /** `import x` / `from m import x`: types, field of the names, aliased form and its alias field. */
    imports?: { types: string[]; names: string; aliased: string; alias: string };
    /** `global x` / `nonlocal x`: the names are not local. */
    hoists?: string[];
    /** Class bodies are scopes methods do not see (Python). */
    classScopes?: boolean;
    /** Name that binds nothing (`_`). */
    blank?: string;
    /** Nodes that are never read as variables (a struct literal's `key:`). */
    skipNode?: (n: Node) => boolean;
    /** Child fields that are names but not variable references (`a.b`'s `b`, `f(k=1)`'s `k`). */
    nonRef?: Record<string, string[]>;
    /** `for (const k of o)` keyword tokens that declare the loop variable, and which scope they bind in. */
    loopDecl: Record<string, 'block' | 'function'>;
    /** Node types that bind a block scope (comprehensions included). */
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
  /** Display name of a function node that has none (assigned to a variable, a field...). */
  nameOf?: (fn: Node) => string | null;
  /** Table's name for a function's display name when it has none. */
  anonymous: string;
}
