(class_declaration name: (identifier) @name.definition.class)
(interface_declaration name: (identifier) @name.definition.interface)
(enum_declaration name: (identifier) @name.definition.enum)
(struct_declaration name: (identifier) @name.definition.struct)
(record_declaration name: (identifier) @name.definition.class)
(method_declaration name: (identifier) @name.definition.method)
(constructor_declaration name: (identifier) @name.definition.method)
(property_declaration name: (identifier) @name.definition.field)
(event_declaration name: (identifier) @name.definition.event)
(delegate_declaration name: (identifier) @name.definition.type)

; Imports
(using_directive
  [(identifier) (qualified_name)] @import.source) @import.statement
