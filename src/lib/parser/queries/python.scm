(class_definition name: (identifier) @name.definition.class)
(function_definition name: (identifier) @name.definition.function)

; Imports
(import_statement
  name: (dotted_name) @import.source) @import.statement

(import_from_statement
  module_name: (dotted_name) @import.source) @import.statement

(import_from_statement
  module_name: (relative_import) @import.source) @import.statement
