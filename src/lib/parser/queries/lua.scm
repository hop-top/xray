(function_declaration name: (identifier) @name.definition.function)
(function_declaration name: (dot_index_expression) @name.definition.method)
(function_declaration name: (colon_index_expression) @name.definition.method)
(variable_declaration (assignment_statement (variable_list name: (identifier) @name.definition.variable)))

; Imports
(function_call
  name: (identifier) @func_name
  arguments: (arguments (string) @import.source)
  (#eq? @func_name "require")) @import.statement
