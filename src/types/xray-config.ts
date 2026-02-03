export interface XrayScopeConfig {
  paths?: string[];
  output?: string;
  limit?: number;
  features?: {
    vars?: boolean;
    incs?: boolean;
    docs?: boolean;
    cost?: boolean;
    cf?: boolean;
    df?: boolean;
  };
  anchor?: string;
  depth?: number;
  match?: string[];
  catch?: string[];
  format?: 'txt' | 'csv' | 'xml';
  diagram?: 'mermaid' | 'dot';
  queries?: string[];
  json?: boolean;
  chunked?: boolean;
  skipDetect?: boolean;
}

export interface XrayConfig extends XrayScopeConfig {
  presets?: {
    [name: string]: XrayScopeConfig;
  };
  scopes?: {
    [name: string]: XrayScopeConfig;
  };
  aliases?: {
    [name: string]: string;
  };
}
