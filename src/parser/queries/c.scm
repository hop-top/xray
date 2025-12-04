(function_definition declarator: (function_declarator declarator: (identifier) @name.definition.function))
(struct_specifier name: (type_identifier) @name.definition.struct)
(enum_specifier name: (type_identifier) @name.definition.enum)
(type_definition declarator: (type_identifier) @name.definition.type)

; Imports
(preproc_include
  path: (_) @import.source) @import.statement
