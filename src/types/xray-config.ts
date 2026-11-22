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
    churn?: boolean;
    blame?: boolean;
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
  fallbackCtags?: boolean;
  skipDetect?: boolean;
  share?: boolean | string;
  telemetry?: {
    enabled?: boolean;
  };
  extensions?: {
    [name: string]: XrayExtensionConfig;
  };
}

export interface XrayContextConfig {
  include: string[];
  exclude?: string[];
}

export type LlmProvider = 'openai' | 'anthropic';

export interface XrayLlmConfig {
  provider?: LlmProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  maxCost?: number;
}

export interface XrayGatewayUpstreamConfig {
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  headerEnv?: Record<string, string>;
  allowTools?: string[];
  blockTools?: string[];
}

export interface XrayGatewayConfig {
  upstreams?: {
    [name: string]: XrayGatewayUpstreamConfig;
  };
}

export interface XrayConfig extends XrayScopeConfig {
  lenses?: {
    [name: string]: XrayScopeConfig;
  };
  scopes?: {
    [name: string]: XrayScopeConfig;
  };
  contexts?: {
    [name: string]: XrayContextConfig;
  };
  aliases?: {
    [name: string]: string;
  };
  llm?: XrayLlmConfig;
  gateway?: XrayGatewayConfig;
}
