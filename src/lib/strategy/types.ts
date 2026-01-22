// src/strategy/types.ts
export interface FileMetadata {
  tags: string[];
  exports?: string[];
  imports?: string[];
  metadata?: Record<string, any>;
}

export interface StrategyContext {
  hasDependency(name: string): boolean;
  hasDevDependency(name: string): boolean;
  hasFiles(pattern: string): boolean;
  parseAST(file: string): Promise<any>;
  readFile(file: string): Promise<string>;
  findFiles(query: FileQuery): Promise<string[]>;
  hasTag(file: string, tag: string): boolean;
  getTags(file: string): string[];
  getMetadata(file: string, strategy: string): any;
  getCached(key: string): any;
  setCached(key: string, value: any): void;
  globFiles(pattern: string): string[];
  getProjectRoot(): string;
  getConfig(key: string): any;
}

export interface FileQuery {
  tagged?: string | string[];
  pattern?: string;
  extension?: string;
}

export interface Strategy {
  name: string;
  version: string;
  detect(ctx: StrategyContext): boolean | Promise<boolean>;
  fileTypes?(): string[];
  ignorePatterns?(): string[];
  analyze(file: string, ctx: StrategyContext): Promise<FileMetadata>;
  commands?: Record<string, StrategyCommand>;
}

export interface StrategyCommand {
  description: string;
  options?: Record<string, string>;
  handler(ctx: StrategyContext, opts?: any): Promise<any>;
}

export interface DetectedStrategy {
  name: string;
  version: string;
  detectedAt: number;
  config?: any;
}
