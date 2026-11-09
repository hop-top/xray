// src/strategy/index.ts

// Export types
export type {
  Extension,
  ExtensionCommandOption,
  ExtensionCommandOptionDefinition,
  ExtensionDetection,
  ExtensionEvidence,
  ExtensionEvidenceSurface,
  ExtensionExportRecord,
  ExtensionSurface,
  FileMetadata,
  StrategyContext,
  StrategyContextOptions,
  FileQuery,
  Strategy,
  StrategyCommand,
  DetectedStrategy
} from './types';

export { normalizeDetectedStrategy } from './types';
export { strategyToExtension } from './types';

// Export classes
export { StrategyRegistry } from './registry';
export { StrategyLoader } from './loader';
export { StrategyDetector } from './detector';
export { StrategyContextImpl } from './context';
