// src/strategy/index.ts

// Export types
export type {
  FileMetadata,
  StrategyContext,
  FileQuery,
  Strategy,
  StrategyCommand,
  DetectedStrategy
} from './types';

// Export classes
export { StrategyRegistry } from './registry';
export { StrategyLoader } from './loader';
export { StrategyDetector } from './detector';
export { StrategyContextImpl } from './context';
