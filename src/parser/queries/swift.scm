(class_declaration name: (type_identifier) @name.definition.class)
(struct_declaration name: (type_identifier) @name.definition.struct)
(enum_declaration name: (type_identifier) @name.definition.enum)
(protocol_declaration name: (type_identifier) @name.definition.interface)
(extension_declaration (type_identifier) @name.definition.extension)
(function_declaration name: (simple_identifier) @name.definition.function)
(init_declaration) @name.definition.method
(deinit_declaration) @name.definition.method
(subscript_declaration) @name.definition.method
(typealias_declaration name: (type_identifier) @name.definition.type)
(variable_declaration name: (pattern) @name.definition.variable)
