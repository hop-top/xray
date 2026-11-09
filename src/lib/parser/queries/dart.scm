(class_definition name: (identifier) @name.definition.class)
(mixin_declaration name: (identifier) @name.definition.mixin)
(extension_declaration name: (identifier) @name.definition.extension)
(enum_declaration name: (identifier) @name.definition.enum)
(function_signature name: (identifier) @name.definition.function)
(method_signature name: (identifier) @name.definition.method)
(getter_signature name: (identifier) @name.definition.method)
(setter_signature name: (identifier) @name.definition.method)
(constructor_signature name: (identifier) @name.definition.method)
(global_variable_declaration name: (identifier) @name.definition.variable)

; Imports
(import_or_export_part
  (string_literal) @import.source) @import.statement
