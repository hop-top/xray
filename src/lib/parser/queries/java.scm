(class_declaration name: (identifier) @name.definition.class)
(interface_declaration name: (identifier) @name.definition.interface)
(enum_declaration name: (identifier) @name.definition.enum)
(method_declaration name: (identifier) @name.definition.method)
(constructor_declaration name: (identifier) @name.definition.method)
(field_declaration 
  declarator: (variable_declarator 
    name: (identifier) @name.definition.field))

; Imports
(import_declaration
  (scoped_identifier) @import.source) @import.statement

(import_declaration
  (identifier) @import.source) @import.statement
