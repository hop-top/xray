import { QueryAdapterRegistry } from '../../src/lib/query/registry';
import type { QueryAdapter, QueryResult } from '../../src/lib/query/types';

// Mock adapter for testing
class MockAdapter implements QueryAdapter {
  constructor(
    public name: string,
    public syntax: string,
    private canParseImpl: (query: string) => boolean = () => true
  ) {}

  canParse(query: string): boolean {
    return this.canParseImpl(query);
  }

  execute(query: string, graph: any): QueryResult {
    return {
      nodes: [],
      edges: [],
      metadata: {
        syntax: this.syntax,
        queryType: 'test',
        executionTime: 0,
        resultCount: 0,
      },
    };
  }
}

describe('QueryAdapterRegistry', () => {
  let registry: QueryAdapterRegistry;

  beforeEach(() => {
    registry = new QueryAdapterRegistry();
  });

  describe('register', () => {
    test('registers an adapter', () => {
      const adapter = new MockAdapter('Test Adapter', 'test');

      registry.register(adapter);

      const adapters = registry.list();
      expect(adapters).toHaveLength(1);
      expect(adapters[0].name).toBe('Test Adapter');
      expect(adapters[0].syntax).toBe('test');
    });

    test('registers multiple adapters', () => {
      const adapter1 = new MockAdapter('Adapter 1', 'syntax1');
      const adapter2 = new MockAdapter('Adapter 2', 'syntax2');

      registry.register(adapter1);
      registry.register(adapter2);

      const adapters = registry.list();
      expect(adapters).toHaveLength(2);
    });

    test('throws error when registering duplicate syntax', () => {
      const adapter1 = new MockAdapter('Adapter 1', 'test');
      const adapter2 = new MockAdapter('Adapter 2', 'test');

      registry.register(adapter1);

      expect(() => registry.register(adapter2)).toThrow(
        "Adapter 'test' already registered"
      );
    });
  });

  describe('unregister', () => {
    test('unregisters an adapter', () => {
      const adapter = new MockAdapter('Test Adapter', 'test');

      registry.register(adapter);
      expect(registry.list()).toHaveLength(1);

      registry.unregister('test');
      expect(registry.list()).toHaveLength(0);
    });

    test('unregister non-existent adapter is safe', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow();
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe('find', () => {
    test('finds adapter that can parse query', () => {
      const adapter = new MockAdapter(
        'Function Adapter',
        'function',
        (q) => q.startsWith('calls(')
      );

      registry.register(adapter);

      const found = registry.find('calls(main)');
      expect(found).not.toBeNull();
      expect(found?.syntax).toBe('function');
    });

    test('returns null when no adapter can parse query', () => {
      const adapter = new MockAdapter(
        'Function Adapter',
        'function',
        (q) => q.startsWith('calls(')
      );

      registry.register(adapter);

      const found = registry.find('SELECT * FROM nodes');
      expect(found).toBeNull();
    });

    test('returns first matching adapter when multiple match', () => {
      const adapter1 = new MockAdapter('Adapter 1', 'syntax1', () => true);
      const adapter2 = new MockAdapter('Adapter 2', 'syntax2', () => true);

      registry.register(adapter1);
      registry.register(adapter2);

      const found = registry.find('any query');
      expect(found).not.toBeNull();
      expect(found?.syntax).toBe('syntax1'); // First registered wins
    });

    test('returns null for empty registry', () => {
      const found = registry.find('any query');
      expect(found).toBeNull();
    });
  });

  describe('list', () => {
    test('returns empty array for new registry', () => {
      const adapters = registry.list();
      expect(adapters).toEqual([]);
    });

    test('returns all registered adapters', () => {
      const adapter1 = new MockAdapter('Adapter 1', 'syntax1');
      const adapter2 = new MockAdapter('Adapter 2', 'syntax2');
      const adapter3 = new MockAdapter('Adapter 3', 'syntax3');

      registry.register(adapter1);
      registry.register(adapter2);
      registry.register(adapter3);

      const adapters = registry.list();
      expect(adapters).toHaveLength(3);
      expect(adapters.map((a) => a.syntax)).toEqual(['syntax1', 'syntax2', 'syntax3']);
    });
  });

  describe('instance isolation (thread-safety)', () => {
    test('separate instances have independent adapter lists', () => {
      const registry1 = new QueryAdapterRegistry();
      const registry2 = new QueryAdapterRegistry();

      const adapter1 = new MockAdapter('Adapter 1', 'syntax1');
      const adapter2 = new MockAdapter('Adapter 2', 'syntax2');

      registry1.register(adapter1);
      registry2.register(adapter2);

      expect(registry1.list()).toHaveLength(1);
      expect(registry1.list()[0].syntax).toBe('syntax1');

      expect(registry2.list()).toHaveLength(1);
      expect(registry2.list()[0].syntax).toBe('syntax2');
    });

    test('unregister in one instance does not affect other instances', () => {
      const registry1 = new QueryAdapterRegistry();
      const registry2 = new QueryAdapterRegistry();

      const adapter = new MockAdapter('Test Adapter', 'test');

      registry1.register(adapter);
      registry2.register(adapter);

      registry1.unregister('test');

      expect(registry1.list()).toHaveLength(0);
      expect(registry2.list()).toHaveLength(1);
    });
  });

  describe('test isolation (no test pollution)', () => {
    test('first test registers adapter', () => {
      const adapter = new MockAdapter('Test Adapter', 'test');
      registry.register(adapter);
      expect(registry.list()).toHaveLength(1);
    });

    test('second test starts with clean registry', () => {
      // If registry was static, this would fail because previous test left data
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe('adapter lookup order', () => {
    test('find returns adapters in registration order', () => {
      const calls: string[] = [];

      const adapter1 = new MockAdapter('Adapter 1', 'syntax1', (q) => {
        calls.push('adapter1');
        return false;
      });

      const adapter2 = new MockAdapter('Adapter 2', 'syntax2', (q) => {
        calls.push('adapter2');
        return true;
      });

      const adapter3 = new MockAdapter('Adapter 3', 'syntax3', (q) => {
        calls.push('adapter3');
        return true;
      });

      registry.register(adapter1);
      registry.register(adapter2);
      registry.register(adapter3);

      registry.find('test query');

      // Should stop at adapter2 (first match)
      expect(calls).toEqual(['adapter1', 'adapter2']);
    });
  });
});
