(function_definition name: (word) @name.definition.function)
(variable_assignment name: (variable_name) @name.definition.variable)

; Imports
(command
  (command_name (word) @cmd_name)
  (word) @import.source
  (#match? @cmd_name "^(source|\\.)$")) @import.statement
