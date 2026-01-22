// src/strategy/registry.ts
import { Strategy } from './types';

interface RegisteredStrategy {
  strategy: Strategy;
  priority: number;
  source: string;
}

export class StrategyRegistry {
  private strategies: Map<string, RegisteredStrategy> = new Map();

  register(strategy: Strategy, priority: number = 0, source: string = 'unknown'): void {
    const existing = this.strategies.get(strategy.name);

    // Higher priority wins
    if (!existing || priority > existing.priority) {
      this.strategies.set(strategy.name, {
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
      .map(r => r.strategy);
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
