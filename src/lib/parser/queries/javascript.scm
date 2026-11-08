; Classes
(class_declaration name: (identifier) @name.definition.class)

; Functions
(function_declaration name: (identifier) @name.definition.function)
(generator_function_declaration name: (identifier) @name.definition.function)

; Exported functions
(export_statement 
  (function_declaration name: (identifier) @name.definition.function))
(export_statement
  (generator_function_declaration name: (identifier) @name.definition.function))

; Variable declarations with arrow functions or function expressions
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)]))

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)]))

; Methods
(method_definition name: (property_identifier) @name.definition.method)

; Fields and properties
(field_definition property: (property_identifier) @name.definition.field)
