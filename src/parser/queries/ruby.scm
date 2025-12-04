(class name: (constant) @name.definition.class)
(module name: (constant) @name.definition.module)
(method name: (identifier) @name.definition.method)
(singleton_method name: (identifier) @name.definition.method)

; Imports
(call
  method: (identifier) @func_name
  arguments: (argument_list (string) @import.source)
  (#match? @func_name "^(require|require_relative|load)$")) @import.statement
