// tests/strategy/types.test.ts
import { Strategy, StrategyContext, FileMetadata } from '../../src/strategy/types';

describe('Strategy Types', () => {
  it('should allow creating a strategy with required fields', () => {
    const strategy: Strategy = {
      name: 'test',
      version: '1.0.0',
      detect: () => true,
      analyze: async () => ({ tags: [] })
    };

    expect(strategy.name).toBe('test');
  });
});
