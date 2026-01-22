(class_definition name: (identifier) @name.definition.class)
(object_definition name: (identifier) @name.definition.class)
(trait_definition name: (identifier) @name.definition.interface)
(function_definition name: (identifier) @name.definition.function)
(val_definition pattern: (identifier) @name.definition.constant)
(var_definition pattern: (identifier) @name.definition.variable)
(type_definition name: (identifier) @name.definition.type)

; Imports
(import_declaration) @import.statement @import.source
