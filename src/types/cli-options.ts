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
  config?: string;
  lens?: string;
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
