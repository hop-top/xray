import type Parser from 'tree-sitter';
import type { FlowTable, MatchCase, TryParts, WithItem } from '../table';

type Node = Parser.SyntaxNode;

const last = (n: Node, type: string): Node | null => {
  const all = n.namedChildren.filter(c => c.type === type);
  return all[all.length - 1] ?? null;
};

/** `try` / `except` / `else` / `finally`. */
const pyTry = (n: Node): TryParts => {
  const handlers = n.namedChildren
    .filter(c => c.type === 'except_clause' || c.type === 'except_group_clause')
    .map(h => {
      const body = last(h, 'block');
      const first = h.namedChild(0);
      const value = first && first.type !== 'block' ? first : null;
      let types = value;
      let param: Node | null = null;
      if (value && value.type === 'as_pattern') {
        types = value.namedChild(0);
        param = value.childForFieldName('alias')?.namedChild(0) ?? null;
      }
      const head = (body ? h.text.slice(0, body.startIndex - h.startIndex) : h.text).replace(/:\s*$/, '');
      return { node: h, head, types, param, body };
    });
  const orelse = n.namedChildren.find(c => c.type === 'else_clause');
  const fin = n.namedChildren.find(c => c.type === 'finally_clause');
  return {
    body: n.childForFieldName('body'),
    handlers,
    orelse: orelse?.childForFieldName('body') ?? null,
    finalizer: fin ? last(fin, 'block') : null,
  };
};

/** `with a as x, b:` */
const pyWith = (n: Node): WithItem[] => {
  const clause = n.namedChildren.find(c => c.type === 'with_clause');
  if (!clause) return [];
  return clause.namedChildren.filter(c => c.type === 'with_item').flatMap(item => {
    const v = item.childForFieldName('value');
    if (!v) return [];
    if (v.type === 'as_pattern') {
      const expr = v.namedChild(0);
      const alias = v.childForFieldName('alias')?.namedChild(0) ?? null;
      return expr ? [{ node: item, value: expr, alias }] : [];
    }
    return [{ node: item, value: v, alias: null }];
  });
};

/** Values a pattern reads and names it binds. */
const collect = (n: Node, uses: Node[], binds: Node[]): void => {
  switch (n.type) {
    case 'identifier':
      if (n.text !== '_') binds.push(n);
      return;
    case 'dotted_name': {
      const first = n.namedChild(0);
      if (!first) return;
      // `Color.RED` reads Color; a lone name captures.
      if (n.namedChildCount > 1) uses.push(first);
      else if (first.text !== '_') binds.push(first);
      return;
    }
    case 'class_pattern': {
      const [cls, ...rest] = n.namedChildren;
      const first = cls?.namedChild(0);
      if (first) uses.push(first);
      for (const c of rest) collect(c, uses, binds);
      return;
    }
    case 'keyword_pattern':
      // `name=` is an attribute; only the pattern after it matters.
      for (const c of n.namedChildren.slice(1)) collect(c, uses, binds);
      return;
    case 'as_pattern':
      for (const c of n.namedChildren) collect(c, uses, binds);
      return;
    case 'dict_pattern':
      for (const c of n.namedChildren) if (c.type !== 'string') collect(c, uses, binds);
      return;
    default:
      for (const c of n.namedChildren) collect(c, uses, binds);
  }
};

/** `match` cases with their patterns, guards and bodies. */
const pyCases = (n: Node): MatchCase[] => {
  const body = n.childForFieldName('body');
  if (!body) return [];
  return body.childrenForFieldName('alternative').map(c => {
    const patterns = c.namedChildren.filter(x => x.type === 'case_pattern');
    const uses: Node[] = [];
    const binds: Node[] = [];
    for (const p of patterns) collect(p, uses, binds);
    const lastP = patterns[patterns.length - 1];
    const guard = c.childForFieldName('guard')?.namedChild(0) ?? null;
    const single = patterns.length === 1 ? patterns[0] : null;
    const dotted = single?.namedChild(0);
    const irrefutable = Boolean(single && (single.text === '_' ||
      (single.namedChildCount === 1 && dotted?.type === 'dotted_name' && dotted.namedChildCount === 1)));
    return {
      node: c,
      head: lastP ? c.text.slice(0, lastP.endIndex - c.startIndex) : 'case',
      uses, binds, guard,
      body: c.childForFieldName('consequence'),
      irrefutable,
    };
  });
};

const COMPREHENSIONS = ['list_comprehension', 'set_comprehension', 'dictionary_comprehension', 'generator_expression'];

/** Python (tree-sitter-python). */
export const pythonTable: FlowTable = {
  language: 'python',
  functions: ['function_definition', 'lambda'],
  fn: { body: 'body', name: 'name', params: ['parameters'] },
  paramLists: ['parameters', 'lambda_parameters'],
  paramPattern: { default_parameter: 'name', typed_default_parameter: 'name', typed_parameter: 0 },
  stmts: {
    block: { kind: 'block' },
    comment: { kind: 'skip' },
    pass_statement: { kind: 'skip' },
    global_statement: { kind: 'skip' },
    nonlocal_statement: { kind: 'skip' },
    type_alias_statement: { kind: 'skip' },
    function_definition: { kind: 'definition' },
    class_definition: { kind: 'definition', bases: 'superclasses' },
    decorated_definition: { kind: 'definition', inner: 'definition', bases: 'superclasses' },
    if_statement: {
      kind: 'if', cond: 'condition', then: 'consequence', else: 'alternative', elseWrapper: 'else_clause',
      elif: { type: 'elif_clause', cond: 'condition', then: 'consequence' },
    },
    for_statement: { kind: 'foreach', left: 'left', right: 'right', body: 'body', else: 'alternative' },
    while_statement: { kind: 'while', cond: 'condition', body: 'body', else: 'alternative' },
    try_statement: { kind: 'try', parts: pyTry },
    with_statement: { kind: 'with', items: pyWith, body: 'body' },
    match_statement: { kind: 'match', subject: 'subject', cases: pyCases },
    return_statement: { kind: 'return' },
    raise_statement: { kind: 'throw' },
    break_statement: { kind: 'break', label: '' },
    continue_statement: { kind: 'continue', label: '' },
  },
  ignore: ['comment'],
  switchClauses: { cases: [], default: '', value: [], body: '', fallsThrough: false },
  expr: {
    parens: ['parenthesized_expression'],
    logical: { type: 'boolean_operator', left: 'left', right: 'right', and: ['and'], or: ['or'], nullish: [] },
    ternary: { type: 'conditional_expression', cond: 1, then: 0, else: 2 },
    not: { type: 'not_operator', op: 'not', operand: 'argument' },
    calls: { call: 'call', callee: 'function', new: '', newCallee: '' },
    throwing: ['await', 'yield'],
    anyThrows: true,
    opaque: COMPREHENSIONS,
  },
  data: {
    identifiers: ['identifier'],
    declarations: {},
    declarator: { type: '', name: '', value: '' },
    assignment: { type: 'assignment', left: 'left', right: 'right' },
    augmented: { type: 'augmented_assignment', left: 'left', right: 'right', weakOps: [] },
    update: { types: [], argument: 0 },
    members: [
      { type: 'attribute', object: 'object' },
      { type: 'subscript', object: 'value' },
    ],
    patterns: {
      object: '', array: ['pattern_list', 'tuple_pattern', 'list_pattern'],
      rest: ['list_splat_pattern', 'dictionary_splat_pattern'], withDefault: [],
      pair: { type: '', key: '', value: '' }, shorthand: [], defaultLeft: '', defaultRight: '',
    },
    binders: [
      { type: 'assignment', field: 'left', scope: 'function' },
      { type: 'augmented_assignment', field: 'left', scope: 'function' },
      { type: 'for_statement', field: 'left', scope: 'function' },
      { type: 'for_in_clause', field: 'left', scope: 'comprehension' },
      { type: 'named_expression', field: 'name', scope: 'function', kind: 'assign' },
      { type: 'as_pattern_target', field: 0, scope: 'function' },
    ],
    imports: { types: ['import_statement', 'import_from_statement'], names: 'name', aliased: 'aliased_import', alias: 'alias' },
    hoists: ['global_statement', 'nonlocal_statement'],
    classScopes: true,
    nonRef: {
      attribute: ['attribute'], keyword_argument: ['name'],
      function_definition: ['name'], class_definition: ['name'],
    },
    loopDecl: {},
    blockScopes: COMPREHENSIONS,
    namedDecls: { function_definition: 'name', class_definition: 'name' },
    classes: ['class_definition'],
    skip: ['type'],
    firstChildOnly: [],
  },
  anonymous: '<lambda>',
};
