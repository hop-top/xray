// src/lib/strategy/infrastructure/types.ts

/**
 * Unified infrastructure configuration interface
 */
export interface InfrastructureConfig {
  tool: string;
  resources: InfrastructureResource[];
  variables?: Record<string, any>;
  outputs?: Record<string, any>;
  dependencies?: Record<string, string[]>;
}

/**
 * Infrastructure resource interface
 */
export interface InfrastructureResource {
  type: string;
  name: string;
  properties?: Record<string, any>;
  dependencies?: string[];
  metadata?: Record<string, any>;
}

/**
 * Infrastructure tool interface for parser implementations
 */
export interface InfrastructureTool {
  name: string;
  detect: (files: string[]) => string[] | null;
  parse: (file: string, content: string) => InfrastructureConfig;
}
