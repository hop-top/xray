; Classes and Interfaces
(class_declaration name: (type_identifier) @name.definition.class)
(interface_declaration name: (type_identifier) @name.definition.interface)
(type_alias_declaration name: (type_identifier) @name.definition.type)
(enum_declaration name: (identifier) @name.definition.enum)

; Functions
(function_declaration name: (identifier) @name.definition.function)
(generator_function_declaration name: (identifier) @name.definition.function)
(method_definition name: (property_identifier) @name.definition.method)

; Exported declarations
(export_statement 
  (class_declaration name: (type_identifier) @name.definition.class))
(export_statement 
  (interface_declaration name: (type_identifier) @name.definition.interface))
(export_statement 
  (function_declaration name: (identifier) @name.definition.function))
(export_statement
  (generator_function_declaration name: (identifier) @name.definition.function))
(export_statement
  (type_alias_declaration name: (type_identifier) @name.definition.type))
(export_statement
  (enum_declaration name: (identifier) @name.definition.enum))

; Variable declarations with arrow functions (capture as functions)
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: (arrow_function)))

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: (arrow_function)))

; Constants and variables without arrow functions
; Note: This will also match arrow functions, but we process them first
; The renderer will deduplicate based on name
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.variable))

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.variable))

; Exported constants
(export_statement
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name.definition.variable)))

; Fields and properties
(public_field_definition name: (property_identifier) @name.definition.field)
(property_signature name: (property_identifier) @name.definition.field)
