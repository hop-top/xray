import type Parser from 'tree-sitter';
import type { FlowTable, TryParts } from '../table';

type Node = Parser.SyntaxNode;

/** `try` / `catch` / `finally` as the ECMAScript grammars shape them. */
export const ecmaTry = (n: Node): TryParts => {
  const h = n.childForFieldName('handler');
  const hb = h?.childForFieldName('body') ?? null;
  const fin = n.childForFieldName('finalizer');
  return {
    body: n.childForFieldName('body'),
    handlers: h ? [{
      node: h,
      head: hb ? h.text.slice(0, hb.startIndex - h.startIndex) : h.text,
      types: null,
      param: h.childForFieldName('parameter'),
      body: hb,
    }] : [],
    orelse: null,
    finalizer: fin ? fin.childForFieldName('body') : null,
  };
};

/**
 * TypeScript / TSX (tree-sitter-typescript). JavaScript shares every
 * statement and expression shape; only the type syntax in `data.skip` is
 * TypeScript-only.
 */
export const typescriptTable: FlowTable = {
  language: 'typescript',
  functions: [
    'function_declaration', 'generator_function_declaration', 'function_expression',
    'generator_function', 'arrow_function', 'method_definition',
  ],
  fn: { body: 'body', name: 'name', params: ['parameters', 'parameter'] },
  paramLists: ['formal_parameters'],
  paramPattern: { required_parameter: 'pattern', optional_parameter: 'pattern' },
  stmts: {
    statement_block: { kind: 'block' },
    comment: { kind: 'skip' },
    empty_statement: { kind: 'skip' },
    interface_declaration: { kind: 'skip' },
    type_alias_declaration: { kind: 'skip' },
    enum_declaration: { kind: 'skip' },
    function_declaration: { kind: 'hoisted' },
    generator_function_declaration: { kind: 'hoisted' },
    if_statement: { kind: 'if', cond: 'condition', then: 'consequence', else: 'alternative', elseWrapper: 'else_clause' },
    for_statement: { kind: 'for', init: 'initializer', cond: 'condition', update: 'increment', body: 'body' },
    for_in_statement: { kind: 'foreach', left: 'left', right: 'right', body: 'body' },
    while_statement: { kind: 'while', cond: 'condition', body: 'body' },
    do_statement: { kind: 'do', body: 'body', cond: 'condition' },
    switch_statement: { kind: 'switch', value: 'value', body: 'body' },
    try_statement: { kind: 'try', parts: ecmaTry },
    return_statement: { kind: 'return' },
    throw_statement: { kind: 'throw' },
    break_statement: { kind: 'break', label: 'label' },
    continue_statement: { kind: 'continue', label: 'label' },
    labeled_statement: { kind: 'labeled', label: 'label', body: 'body' },
  },
  ignore: ['comment'],
  switchClauses: { cases: ['switch_case'], default: 'switch_default', value: ['value'], body: 'body', fallsThrough: true },
  catchClause: { type: 'catch_clause', param: 'parameter' },
  expr: {
    parens: ['parenthesized_expression'],
    logical: { type: 'binary_expression', left: 'left', right: 'right', and: ['&&'], or: ['||'], nullish: ['??'] },
    ternary: { type: 'ternary_expression', cond: 'condition', then: 'consequence', else: 'alternative' },
    not: { type: 'unary_expression', op: '!', operand: 'argument' },
    calls: { call: 'call_expression', callee: 'function', new: 'new_expression', newCallee: 'constructor' },
    throwing: ['await_expression', 'yield_expression'],
  },
  data: {
    identifiers: ['identifier', 'shorthand_property_identifier'],
    declarations: { lexical_declaration: 'block', variable_declaration: 'function' },
    declarator: { type: 'variable_declarator', name: 'name', value: 'value' },
    assignment: { type: 'assignment_expression', left: 'left', right: 'right' },
    augmented: { type: 'augmented_assignment_expression', left: 'left', right: 'right', weakOps: ['||=', '&&=', '??='] },
    update: { types: ['update_expression'], argument: 'argument' },
    members: [
      { type: 'member_expression', object: 'object' },
      { type: 'subscript_expression', object: 'object' },
    ],
    patterns: {
      object: 'object_pattern', array: ['array_pattern'], rest: ['rest_pattern'],
      withDefault: ['assignment_pattern', 'object_assignment_pattern'],
      pair: { type: 'pair_pattern', key: 'key', value: 'value' },
      shorthand: ['shorthand_property_identifier_pattern'],
      defaultLeft: 'left', defaultRight: 'right',
    },
    binders: [],
    loopDecl: { const: 'block', let: 'block', var: 'function' },
    blockScopes: ['statement_block', 'for_statement', 'for_in_statement', 'switch_body', 'catch_clause'],
    namedDecls: { function_declaration: 'name', generator_function_declaration: 'name', class_declaration: 'name' },
    classes: ['class_declaration', 'class'],
    skip: [
      'type_annotation', 'type_arguments', 'type_parameters', 'type_query', 'interface_declaration',
      'type_alias_declaration', 'enum_declaration', 'type_predicate_annotation', 'asserts_annotation',
    ],
    firstChildOnly: ['as_expression', 'satisfies_expression'],
  },
  anonymous: '<anonymous>',
};
