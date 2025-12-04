(class_specifier name: (type_identifier) @name.definition.class)
(struct_specifier name: (type_identifier) @name.definition.struct)
(function_definition declarator: (function_declarator declarator: (identifier) @name.definition.function))
(function_definition declarator: (function_declarator declarator: (field_identifier) @name.definition.method))
(declaration declarator: (function_declarator declarator: (identifier) @name.definition.function))
(type_definition declarator: (type_identifier) @name.definition.type)
(namespace_definition name: (namespace_identifier) @name.definition.module)

; Imports
(preproc_include
  path: (_) @import.source) @import.statement
