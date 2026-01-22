(class_declaration (type_identifier) @name.definition.class)
(object_declaration (type_identifier) @name.definition.class)
(function_declaration (simple_identifier) @name.definition.function)
(property_declaration (variable_declaration (simple_identifier) @name.definition.field))
(type_alias (type_identifier) @name.definition.type)

; Imports
(import_header
  (identifier) @import.source) @import.statement
