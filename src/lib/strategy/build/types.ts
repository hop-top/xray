// src/lib/strategy/build/types.ts

/**
 * Unified build configuration interface
 */
export interface BuildConfig {
  tool: string;
  targets: BuildTarget[];
  defaultTarget?: string;
  dependencies: Record<string, string[]>;
}

/**
 * Build target interface
 */
export interface BuildTarget {
  name: string;
  description?: string;
  dependencies: string[];
  recipe: string[];
  phony?: boolean;
}

/**
 * Build tool interface for parser implementations
 */
export interface BuildTool {
  name: string;
  detect: (files: string[]) => string | null;
  parse: (file: string, content: string) => BuildConfig;
}
