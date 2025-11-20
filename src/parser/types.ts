export interface Tag {
  file: string;
  name: string;
  kind: string;
  line: number;
  col: number;
  signature?: string; // Optional signature for functions/methods
  doc?: string; // Optional docstring
}

export interface Import {
  file: string;
  source: string; // The module being imported
}
