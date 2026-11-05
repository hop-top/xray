import type Parser from 'tree-sitter';
import type { FlowTable, StmtRule } from '../table';

type Node = Parser.SyntaxNode;

/** Go's `for` is four statements: range, three-part, condition only, endless. */
const goFor = (n: Node): StmtRule => {
  const kids = n.namedChildren;
  if (kids.some(c => c.type === 'range_clause')) {
    return { kind: 'foreach', left: 'left', right: 'right', body: 'body', via: 'range_clause' };
  }
  if (kids.some(c => c.type === 'for_clause')) {
    return { kind: 'for', init: 'initializer', cond: 'condition', update: 'update', body: 'body', via: 'for_clause' };
  }
  if (kids.some(c => c.type !== 'block' && c.type !== 'comment')) return { kind: 'while', cond: 0, body: 'body' };
  return { kind: 'for', body: 'body' };
};

/** `f := func() {}`, `var f = func() {}`, `f = func() {}`: the name on the left. */
const closureName = (fn: Node): string | null => {
  const list = fn.parent;
  const decl = list?.parent;
  if (!list || !decl || list.type !== 'expression_list') return null;
  const at = list.namedChildren.findIndex(c => c.id === fn.id);
  const names = decl.type === 'var_spec'
    ? decl.childrenForFieldName('name')
    : decl.childForFieldName('left')?.namedChildren;
  return names?.[at]?.text ?? null;
};

/** Keys of a struct literal (`T{name: v}`) are field names; a map literal's are values. */
const structKey = (n: Node): boolean => {
  const el = n.parent;
  if (n.type !== 'literal_element' || !el || el.type !== 'keyed_element' || el.childForFieldName('key')?.id !== n.id) return false;
  const lit = el.parent?.parent;
  const type = lit?.type === 'composite_literal' ? lit.childForFieldName('type') : null;
  return !type || type.type !== 'map_type';
};

/** Go (tree-sitter-go). */
export const goTable: FlowTable = {
  language: 'go',
  functions: ['function_declaration', 'method_declaration', 'func_literal'],
  fn: { body: 'body', name: 'name', params: ['receiver', 'parameters'], results: ['result'] },
  paramLists: ['parameter_list'],
  paramPattern: { parameter_declaration: 'name', variadic_parameter_declaration: 'name' },
  stmts: {
    block: { kind: 'block' },
    statement_list: { kind: 'block' },
    comment: { kind: 'skip' },
    empty_statement: { kind: 'skip' },
    type_declaration: { kind: 'skip' },
    if_statement: { kind: 'if', cond: 'condition', then: 'consequence', else: 'alternative', init: 'initializer' },
    for_statement: { kind: 'dispatch', pick: goFor },
    expression_switch_statement: { kind: 'switch', value: 'value', init: 'initializer' },
    type_switch_statement: { kind: 'switch', value: 'value', init: 'initializer', alias: 'alias', suffix: '.(type)' },
    select_statement: { kind: 'select' },
    return_statement: { kind: 'return' },
    break_statement: { kind: 'break', label: { type: 'label_name' } },
    continue_statement: { kind: 'continue', label: { type: 'label_name' } },
    goto_statement: { kind: 'goto', label: { type: 'label_name' } },
    fallthrough_statement: { kind: 'fallthrough' },
    defer_statement: { kind: 'defer' },
    go_statement: { kind: 'go' },
    labeled_statement: { kind: 'labeled', label: 'label', body: -1 },
  },
  ignore: ['comment'],
  switchClauses: {
    cases: ['expression_case', 'type_case', 'communication_case'], default: 'default_case',
    value: ['value', 'type', 'communication'], body: '', fallsThrough: false,
  },
  expr: {
    parens: ['parenthesized_expression'],
    logical: { type: 'binary_expression', left: 'left', right: 'right', and: ['&&'], or: ['||'], nullish: [] },
    ternary: { type: '', cond: '', then: '', else: '' },
    not: { type: 'unary_expression', op: '!', operand: 'operand' },
    calls: { call: 'call_expression', callee: 'function', new: '', newCallee: '' },
    throwing: [],
    noReturn: ['panic'],
    recover: 'recover',
  },
  data: {
    identifiers: ['identifier'],
    declarations: {},
    declarator: { type: '', name: '', value: '' },
    assignment: { type: 'assignment_statement', left: 'left', right: 'right' },
    augmented: { type: '', left: '', right: '', weakOps: [] },
    update: { types: ['inc_statement', 'dec_statement'], argument: 0 },
    members: [
      { type: 'selector_expression', object: 'operand' },
      { type: 'index_expression', object: 'operand' },
      { type: 'slice_expression', object: 'operand' },
    ],
    patterns: {
      object: '', array: ['expression_list'], rest: [], withDefault: [],
      pair: { type: '', key: '', value: '' }, shorthand: [], defaultLeft: '', defaultRight: '',
    },
    binders: [
      { type: 'short_var_declaration', field: 'left', scope: 'block' },
      { type: 'var_spec', field: 'name', scope: 'block' },
      { type: 'const_spec', field: 'name', scope: 'block' },
      { type: 'range_clause', field: 'left', scope: 'block', when: ':=' },
      { type: 'receive_statement', field: 'left', scope: 'block', when: ':=' },
      { type: 'type_switch_statement', field: 'alias', scope: 'block' },
    ],
    blank: '_',
    skipNode: structKey,
    loopDecl: {},
    blockScopes: [
      'block', 'if_statement', 'for_statement', 'expression_switch_statement', 'type_switch_statement',
      'select_statement', 'expression_case', 'type_case', 'communication_case', 'default_case',
    ],
    namedDecls: { function_declaration: 'name', method_declaration: 'name' },
    classes: [],
    skip: [],
    firstChildOnly: [],
  },
  nameOf: closureName,
  anonymous: '<anonymous>',
};
