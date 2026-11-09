// src/strategy/types.ts
import type { XrayExtensionConfig } from '../../types/xray-config';

export interface FileMetadata {
  tags: string[];
  exports?: string[];
  imports?: string[];
  metadata?: Record<string, any>;
}

export type ExtensionSurface =
  | 'strategy'
  | 'glossary'
  | 'command'
  | 'config'
  | 'export'
  | string;

export type ExtensionEvidenceSurface =
  | 'dependency'
  | 'devDependency'
  | 'file'
  | 'tag'
  | 'metadata'
  | 'config'
  | 'runtime'
  | 'manual'
  | string;

export interface ExtensionEvidence {
  surface: ExtensionEvidenceSurface;
  value: string;
  reason?: string;
  file?: string;
  line?: number;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface ExtensionDetection {
  matched?: boolean;
  score?: number;
  detectedAt?: number;
  config?: unknown;
  evidence?: ExtensionEvidence[];
  surface?: ExtensionSurface;
}

export interface ExtensionCommandOptionDefinition {
  description: string;
  alias?: string;
  type?: 'boolean' | 'string' | 'number';
  repeatable?: boolean;
  placeholder?: string;
}

export type ExtensionCommandOption =
  | string
  | ExtensionCommandOptionDefinition;

export interface ExtensionExportRecord {
  kind: string;
  title: string;
  source?: string;
  path?: string;
  data?: unknown;
  evidence?: ExtensionEvidence[];
  metadata?: Record<string, unknown>;
}

export interface Extension {
  id: string;
  name: string;
  version: string;
  surface: ExtensionSurface;
  /** One-line summary shown in help/describe for the command group. */
  description?: string;
  detect(
    ctx: StrategyContext
  ): boolean | ExtensionDetection | Promise<boolean | ExtensionDetection>;
  fileTypes?(): string[];
  ignorePatterns?(): string[];
  analyze?(file: string, ctx: StrategyContext): Promise<FileMetadata>;
  commands?: Record<string, StrategyCommand>;
  strategy?: Strategy;
}

export interface StrategyContextOptions {
  extensions?: Record<string, XrayExtensionConfig>;
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
  getExtensionConfig(name: string): XrayExtensionConfig | undefined;
}

export interface FileQuery {
  tagged?: string | string[];
  pattern?: string;
  extension?: string;
}

export interface Strategy {
  name: string;
  version: string;
  /** One-line summary shown in help/describe for the command group. */
  description?: string;
  surface?: ExtensionSurface;
  /** Language packs (grammars) this strategy needs, e.g. ['go']. Missing => not detected + one warning. */
  requiresLanguages?: string[];
  detect(
    ctx: StrategyContext
  ): boolean | ExtensionDetection | Promise<boolean | ExtensionDetection>;
  fileTypes?(): string[];
  ignorePatterns?(): string[];
  analyze(file: string, ctx: StrategyContext): Promise<FileMetadata>;
  commands?: Record<string, StrategyCommand>;
}

export interface StrategyCommand {
  description: string;
  options?: Record<string, ExtensionCommandOption>;
  /** One required positional argument; its value arrives in `opts[name]`. */
  positional?: { name: string; description: string };
  /**
   * Side-effect tier and idempotency kit gates on. Default: a read
   * (`read` / `yes`): strategy commands analyze and print. A command that
   * runs code or changes anything must declare it. Under a root `--dry-run`
   * a non-read command's handler gets `opts.dryRun === true` and returns
   * `{ effects }` (kit's plan entries) instead of acting.
   */
  effect?: { tier: 'read' | 'write-local' | 'destructive-local' | 'interactive'; idempotent: 'yes' | 'no' | 'conditional' };
  handler(ctx: StrategyContext, opts?: any): Promise<any>;
}

export interface DetectedStrategy extends ExtensionDetection {
  name: string;
  version: string;
  detectedAt: number;
}

export function normalizeDetectedStrategy(
  strategy: Pick<Strategy, 'name' | 'version' | 'surface'>,
  result: boolean | ExtensionDetection | null | undefined
): DetectedStrategy | null {
  if (!result) {
    return null;
  }

  if (result === true) {
    return {
      name: strategy.name,
      version: strategy.version,
      detectedAt: Date.now(),
      surface: strategy.surface ?? 'strategy',
    };
  }

  if (result.matched === false) {
    return null;
  }

  return {
    name: strategy.name,
    version: strategy.version,
    detectedAt: result.detectedAt ?? Date.now(),
    config: result.config,
    score: result.score,
    evidence: result.evidence,
    surface: result.surface ?? strategy.surface ?? 'strategy',
  };
}

export function strategyToExtension(strategy: Strategy): Extension {
  return {
    id: strategy.name,
    name: strategy.name,
    version: strategy.version,
    description: strategy.description,
    surface: strategy.surface ?? 'strategy',
    detect: strategy.detect.bind(strategy),
    fileTypes: strategy.fileTypes?.bind(strategy),
    ignorePatterns: strategy.ignorePatterns?.bind(strategy),
    analyze: strategy.analyze?.bind(strategy),
    commands: strategy.commands,
    strategy,
  };
}
