(function_declaration name: (identifier) @name.definition.function)
(method_declaration name: (field_identifier) @name.definition.method)
(type_spec name: (type_identifier) @name.definition.type)

; Imports - captures both single and grouped imports
; Mark all import declarations as statements
(import_declaration) @import.statement

; Capture sources from any import_spec (works for both grouped and single imports)
(import_spec
  (interpreted_string_literal) @import.source)

(import_spec
  (raw_string_literal) @import.source)
