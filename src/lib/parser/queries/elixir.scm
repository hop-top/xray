; Elixir imports are represented as (call target: (identifier) (arguments ...))
; Imports
(call
  target: (identifier) @func_name
  (arguments (alias) @import.source)
  (#match? @func_name "^(import|require|use|alias)$")) @import.statement

