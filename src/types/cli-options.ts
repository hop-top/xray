export interface CliOptions {
  path?: string[];
  output?: string;
  limit?: string;
  with?: string[];
  anchor?: string;
  depth?: string;
  query?: string[];
  match?: string[];
  catch?: string[];
  txt?: boolean;
  csv?: boolean;
  xml?: boolean;
  json?: boolean;
  mermaid?: boolean;
  dot?: boolean;
  config?: string;
  preset?: string;
  scope?: string;
  allScopes?: boolean;
}

export interface MergedOptions extends CliOptions {
  path: string[];
  limit: string;
  match: string[];
  catch: string[];
  query: string[];
  with: string[];
}
