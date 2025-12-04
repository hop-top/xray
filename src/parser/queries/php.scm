(class_declaration name: (name) @name.definition.class)
(interface_declaration name: (name) @name.definition.interface)
(trait_declaration name: (name) @name.definition.interface)
(function_definition name: (name) @name.definition.function)
(method_declaration name: (name) @name.definition.method)

; Imports
(namespace_use_declaration
  (namespace_use_clause (qualified_name) @import.source)) @import.statement

(require_expression (string) @import.source) @import.statement
(include_expression (string) @import.source) @import.statement
(require_once_expression (string) @import.source) @import.statement
(include_once_expression (string) @import.source) @import.statement
