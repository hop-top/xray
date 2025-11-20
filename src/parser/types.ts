export interface Tag {
  file: string;
  name: string;
  kind: string;
  line: number;
  col: number;
  signature?: string; // Optional signature for functions/methods
  doc?: string; // Optional docstring
  cfg?: any; // Optional Control Flow Graph
  dfg?: any; // Optional Data Flow Graph
}

export interface Import {
  file: string;
  source: string; // The module being imported
}
