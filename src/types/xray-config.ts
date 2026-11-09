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
  format?: 'txt' | 'csv' | 'xml' | 'json';
  queries?: string[];
  json?: boolean;
  chunked?: boolean;
  /** Language packs (names or bundles) to parse; each must be installed. Default: auto-detect. */
  languages?: string[];
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
