(class_declaration name: (type_identifier) @name.definition.class)
; struct parsed as class_declaration
; enum parsed as class_declaration with enum_class_body
; (class_declaration body: (enum_class_body) name: (type_identifier) @name.definition.enum)
(protocol_declaration name: (type_identifier) @name.definition.interface)
; extension parsed as class_declaration
(function_declaration name: (simple_identifier) @name.definition.function)
(init_declaration) @name.definition.method
(deinit_declaration) @name.definition.method
(subscript_declaration) @name.definition.method
(typealias_declaration name: (type_identifier) @name.definition.type)
(property_declaration name: (pattern) @name.definition.variable)

; Imports
(import_declaration
  (identifier (simple_identifier) @import.source)) @import.statement
