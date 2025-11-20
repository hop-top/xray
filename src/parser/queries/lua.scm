(function_declaration name: (identifier) @name.definition.function)
(function_declaration name: (dot_index_expression) @name.definition.method)
(function_declaration name: (colon_index_expression) @name.definition.method)
(variable_declaration (assignment_statement (variable_list name: (identifier) @name.definition.variable)))
