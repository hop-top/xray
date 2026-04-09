export interface XrayExtensionConfig {
  enabled?: boolean;
  threshold?: number;
  hints?: string[];
  enabledSurfaces?: {
    [name: string]: boolean;
  };
  config?: {
    [name: string]: unknown;
  };
}

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
  share?: boolean | string;
  telemetry?: {
    enabled?: boolean;
  };
  extensions?: {
    [name: string]: XrayExtensionConfig;
  };
}

export interface XrayConfig extends XrayScopeConfig {
  lenses?: {
    [name: string]: XrayScopeConfig;
  };
  scopes?: {
    [name: string]: XrayScopeConfig;
  };
  aliases?: {
    [name: string]: string;
  };
}
