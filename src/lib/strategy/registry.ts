// src/strategy/registry.ts
import { Extension, Strategy, strategyToExtension } from './types';

interface RegisteredStrategy {
  extension: Extension;
  strategy?: Strategy;
  priority: number;
  source: string;
}

function asRegisteredStrategy(extension: Extension): Strategy | undefined {
  if (extension.strategy) {
    return extension.strategy;
  }

  if (typeof extension.analyze === 'function') {
    return extension as Strategy;
  }

  return undefined;
}

export class StrategyRegistry {
  private strategies: Map<string, RegisteredStrategy> = new Map();

  register(strategy: Strategy, priority: number = 0, source: string = 'unknown'): void {
    this.registerExtension(strategyToExtension(strategy), priority, source);
  }

  registerExtension(
    extension: Extension,
    priority: number = 0,
    source: string = 'unknown'
  ): void {
    const existing = this.strategies.get(extension.name);
    const strategy = asRegisteredStrategy(extension);

    // Higher priority wins
    if (!existing || priority > existing.priority) {
      this.strategies.set(extension.name, {
        extension,
        strategy,
        priority,
        source
      });
    }
  }

  get(name: string): Strategy | undefined {
    return this.strategies.get(name)?.strategy;
  }

  list(): Strategy[] {
    return Array.from(this.strategies.values())
      .sort((a, b) => b.priority - a.priority)
      .map(r => r.strategy)
      .filter((strategy): strategy is Strategy => !!strategy);
  }

  getExtension(name: string): Extension | undefined {
    return this.strategies.get(name)?.extension;
  }

  listExtensions(): Extension[] {
    return Array.from(this.strategies.values())
      .sort((a, b) => b.priority - a.priority)
      .map(r => r.extension);
  }

  has(name: string): boolean {
    return this.strategies.has(name);
  }

  getSource(name: string): string | undefined {
    return this.strategies.get(name)?.source;
  }

  clear(): void {
    this.strategies.clear();
  }

  remove(name: string): boolean {
    return this.strategies.delete(name);
  }
}
