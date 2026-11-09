// tests/strategy/registry.test.ts
import { StrategyRegistry } from '../../src/lib/strategy/registry';
import { Extension, Strategy } from '../../src/lib/strategy/types';
import * as path from 'path';

describe('StrategyRegistry', () => {
  const mockStrategy: Strategy = {
    name: 'test',
    version: '1.0.0',
    detect: () => true,
    analyze: async () => ({ tags: [] })
  };

  it('should register strategies', () => {
    const registry = new StrategyRegistry();
    registry.register(mockStrategy);

    expect(registry.get('test')).toBeDefined();
  });

  it('should list all strategies', () => {
    const registry = new StrategyRegistry();
    registry.register(mockStrategy);

    const all = registry.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('test');
  });

  it('should handle strategy override by priority', () => {
    const registry = new StrategyRegistry();
    const strategy1 = { ...mockStrategy, version: '1.0.0' };
    const strategy2 = { ...mockStrategy, version: '2.0.0' };

    registry.register(strategy1, 1);
    registry.register(strategy2, 2);

    const result = registry.get('test');
    expect(result?.version).toBe('2.0.0');
  });

  it('should check if strategy exists', () => {
    const registry = new StrategyRegistry();
    registry.register(mockStrategy);

    expect(registry.has('test')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should get strategy source', () => {
    const registry = new StrategyRegistry();
    registry.register(mockStrategy, 0, 'builtin');

    expect(registry.getSource('test')).toBe('builtin');
    expect(registry.getSource('nonexistent')).toBeUndefined();
  });

  it('should remove strategies', () => {
    const registry = new StrategyRegistry();
    registry.register(mockStrategy);

    expect(registry.has('test')).toBe(true);

    const removed = registry.remove('test');
    expect(removed).toBe(true);
    expect(registry.has('test')).toBe(false);

    const removedAgain = registry.remove('test');
    expect(removedAgain).toBe(false);
  });

  it('should clear all strategies', () => {
    const registry = new StrategyRegistry();
    registry.register(mockStrategy);
    registry.register({ ...mockStrategy, name: 'test2' });

    expect(registry.list()).toHaveLength(2);

    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it('should not override higher priority strategies', () => {
    const registry = new StrategyRegistry();
    const strategy1 = { ...mockStrategy, version: '1.0.0' };
    const strategy2 = { ...mockStrategy, version: '2.0.0' };

    registry.register(strategy1, 10, 'local');
    registry.register(strategy2, 5, 'builtin');

    const result = registry.get('test');
    expect(result?.version).toBe('1.0.0');
    expect(registry.getSource('test')).toBe('local');
  });

  it('should sort strategies by priority in list', () => {
    const registry = new StrategyRegistry();
    const strategy1 = { ...mockStrategy, name: 'low', version: '1.0.0' };
    const strategy2 = { ...mockStrategy, name: 'high', version: '2.0.0' };
    const strategy3 = { ...mockStrategy, name: 'medium', version: '3.0.0' };

    registry.register(strategy1, 1);
    registry.register(strategy2, 10);
    registry.register(strategy3, 5);

    const all = registry.list();
    expect(all).toHaveLength(3);
    expect(all[0].name).toBe('high');
    expect(all[1].name).toBe('medium');
    expect(all[2].name).toBe('low');
  });

  it('registers command-only extensions without polluting strategy lookups', () => {
    const registry = new StrategyRegistry();
    const glossaryExtension: Extension = {
      id: 'glossary',
      name: 'glossary',
      version: '0.1.0',
      surface: 'glossary',
      detect: () => true,
      commands: {
        scan: {
          description: 'Scan glossary terms',
          handler: async () => [],
        },
      },
    };

    registry.registerExtension(glossaryExtension, 3, 'builtin');

    expect(registry.get('glossary')).toBeUndefined();
    expect(registry.getExtension('glossary')).toBe(glossaryExtension);
    expect(registry.list()).toEqual([]);
    expect(registry.listExtensions()).toContain(glossaryExtension);
  });
});
