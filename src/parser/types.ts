export interface Tag {
  file: string;
  name: string;
  kind: string;
  line: number;
  endLine?: number;
  col: number;
  signature?: string; // Optional signature for functions/methods
  doc?: string; // Optional docstring
  references?: string[]; // Function names called by this tag
  cfg?: any; // Optional Control Flow Graph
  dfg?: any; // Optional Data Flow Graph
}

export interface Import {
  file: string;
  source: string; // The module being imported
  text?: string; // The full import statement text
}
