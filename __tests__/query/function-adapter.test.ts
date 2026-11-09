import Graph from 'graphology';
import { FunctionAdapter } from '../../src/lib/query/adapters/function';

describe('FunctionAdapter', () => {
  let adapter: FunctionAdapter;
  let graph: any;

  beforeEach(() => {
    adapter = new FunctionAdapter();
    graph = new Graph();

    // Build test graph
    // Files
    graph.addNode('src/main.ts', { type: 'file', label: 'src/main.ts' });
    graph.addNode('src/api.ts', { type: 'file', label: 'src/api.ts' });
    graph.addNode('src/utils.ts', { type: 'file', label: 'src/utils.ts' });

    // Functions
    graph.addNode('src/main.ts::main', {
      type: 'tag',
      label: 'main',
      kind: 'function',
      file: 'src/main.ts',
      line: 5,
    });
    graph.addNode('src/api.ts::processData', {
      type: 'tag',
      label: 'processData',
      kind: 'function',
      file: 'src/api.ts',
      line: 10,
    });
    graph.addNode('src/utils.ts::validateInput', {
      type: 'tag',
      label: 'validateInput',
      kind: 'function',
      file: 'src/utils.ts',
      line: 20,
    });
    graph.addNode('src/utils.ts::checkSchema', {
      type: 'tag',
      label: 'checkSchema',
      kind: 'function',
      file: 'src/utils.ts',
      line: 30,
    });
    graph.addNode('src/utils.ts::transformData', {
      type: 'tag',
      label: 'transformData',
      kind: 'function',
      file: 'src/utils.ts',
      line: 40,
    });

    // Edges
    graph.addEdge('src/main.ts', 'src/main.ts::main', { type: 'defines' });
    graph.addEdge('src/api.ts', 'src/api.ts::processData', { type: 'defines' });
    graph.addEdge('src/utils.ts', 'src/utils.ts::validateInput', { type: 'defines' });
    graph.addEdge('src/utils.ts', 'src/utils.ts::checkSchema', { type: 'defines' });
    graph.addEdge('src/utils.ts', 'src/utils.ts::transformData', { type: 'defines' });

    graph.addEdge('src/main.ts::main', 'src/api.ts::processData', { type: 'calls' });
    graph.addEdge('src/api.ts::processData', 'src/utils.ts::validateInput', { type: 'calls' });
    graph.addEdge('src/api.ts::processData', 'src/utils.ts::transformData', { type: 'calls' });
    graph.addEdge('src/utils.ts::validateInput', 'src/utils.ts::checkSchema', { type: 'calls' });
  });

  describe('canParse', () => {
    test('returns true for function-based queries', () => {
      expect(adapter.canParse('calls(main)')).toBe(true);
      expect(adapter.canParse('callers(processData)')).toBe(true);
      expect(adapter.canParse('path(main, to=checkSchema)')).toBe(true);
      expect(adapter.canParse('hotspots(metric=calls, limit=10)')).toBe(true);
      expect(adapter.canParse('deps(lodash)')).toBe(true);
    });

    test('returns false for non-function queries', () => {
      expect(adapter.canParse('SELECT * FROM nodes')).toBe(false);
      expect(adapter.canParse('{ nodes { id } }')).toBe(false);
      expect(adapter.canParse('random text')).toBe(false);
      expect(adapter.canParse('')).toBe(false);
    });
  });

  describe('calls() - direct calls', () => {
    test('returns direct calls from a function', () => {
      const result = adapter.execute('calls(processData)', graph);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.map((n) => n.name)).toContain('validateInput');
      expect(result.nodes.map((n) => n.name)).toContain('transformData');
      expect(result.metadata.queryType).toBe('calls');
    });

    test('returns empty for function that calls nothing', () => {
      const result = adapter.execute('calls(checkSchema)', graph);

      expect(result.nodes).toHaveLength(0);
    });

    test('returns empty for non-existent function', () => {
      const result = adapter.execute('calls(nonexistent)', graph);

      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('calls() - recursive calls', () => {
    test('returns all recursive calls', () => {
      const result = adapter.execute('calls(main, recursive=true)', graph);

      // main -> processData -> validateInput, transformData
      // validateInput -> checkSchema
      expect(result.nodes.length).toBeGreaterThanOrEqual(4);
      expect(result.nodes.map((n) => n.name)).toContain('processData');
      expect(result.nodes.map((n) => n.name)).toContain('validateInput');
      expect(result.nodes.map((n) => n.name)).toContain('transformData');
      expect(result.nodes.map((n) => n.name)).toContain('checkSchema');
    });

    test('limits recursive calls by depth', () => {
      const result = adapter.execute('calls(main, recursive=true, depth=1)', graph);

      // Depth 1: only direct calls
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('processData');
    });

    test('handles cycles gracefully', () => {
      // Add a cycle: checkSchema -> validateInput
      graph.addEdge('src/utils.ts::checkSchema', 'src/utils.ts::validateInput', { type: 'calls' });

      const result = adapter.execute('calls(validateInput, recursive=true)', graph);

      // Should not infinite loop, should visit each node once
      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      expect(result.nodes.map((n) => n.name)).toContain('checkSchema');
    });
  });

  describe('callers() - who calls this function', () => {
    test('returns direct callers', () => {
      const result = adapter.execute('callers(processData)', graph);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('main');
    });

    test('returns all recursive callers', () => {
      const result = adapter.execute('callers(checkSchema, recursive=true)', graph);

      // checkSchema <- validateInput <- processData <- main
      expect(result.nodes.length).toBeGreaterThanOrEqual(3);
      expect(result.nodes.map((n) => n.name)).toContain('validateInput');
      expect(result.nodes.map((n) => n.name)).toContain('processData');
      expect(result.nodes.map((n) => n.name)).toContain('main');
    });

    test('returns empty for function with no callers', () => {
      const result = adapter.execute('callers(main)', graph);

      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('path() - find path between functions', () => {
    test('finds simple path between two functions', () => {
      const result = adapter.execute('path(main, to=checkSchema)', graph);

      // main -> processData -> validateInput -> checkSchema
      expect(result.nodes.length).toBeGreaterThanOrEqual(3);
      expect(result.nodes.map((n) => n.name)).toContain('processData');
      expect(result.nodes.map((n) => n.name)).toContain('validateInput');
    });

    test('returns empty when no path exists', () => {
      const result = adapter.execute('path(checkSchema, to=main)', graph);

      expect(result.nodes).toHaveLength(0);
    });

    test('handles cycles in path finding', () => {
      // Add cycle
      graph.addEdge('src/utils.ts::checkSchema', 'src/utils.ts::validateInput', { type: 'calls' });

      const result = adapter.execute('path(validateInput, to=checkSchema)', graph);

      // Should find path without infinite loop
      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hotspots() - find frequently called functions', () => {
    test('finds hotspots by calls metric', () => {
      const result = adapter.execute('hotspots(metric=calls, limit=3)', graph);

      // Most called functions should include processData, validateInput
      expect(result.nodes.length).toBeLessThanOrEqual(3);
      expect(result.nodes[0].score).toBeGreaterThan(0);
      // Should be sorted by score descending
      if (result.nodes.length > 1) {
        expect(result.nodes[0].score!).toBeGreaterThanOrEqual(result.nodes[1].score!);
      }
    });

    test('finds hotspots by fanout metric', () => {
      const result = adapter.execute('hotspots(metric=fanout, limit=3)', graph);

      // Functions with most outgoing calls: processData has 2 calls
      expect(result.nodes.length).toBeLessThanOrEqual(3);
      expect(result.nodes[0].score).toBeGreaterThan(0);
    });

    test('limits number of results', () => {
      const result = adapter.execute('hotspots(metric=calls, limit=2)', graph);

      expect(result.nodes.length).toBeLessThanOrEqual(2);
    });

    test('defaults to calls metric when not specified', () => {
      const result = adapter.execute('hotspots(limit=5)', graph);

      expect(result.metadata.queryType).toBe('hotspots');
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('pattern matching', () => {
    test('matches exact function name', () => {
      const result = adapter.execute('calls(processData)', graph);

      expect(result.nodes).toHaveLength(2);
    });

    test('matches with wildcard *', () => {
      const result = adapter.execute('calls(process*)', graph);

      // Should match processData
      expect(result.nodes).toHaveLength(2);
    });

    test('matches with wildcard ** for paths', () => {
      const result = adapter.execute('callers(src/utils.ts::*)', graph);

      // All functions in utils.ts should match
      // Should find callers of validateInput, checkSchema, transformData
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('rejects malicious ReDoS patterns', () => {
      // Catastrophic backtracking pattern
      const malicious = 'calls(a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b)';

      expect(() => adapter.execute(malicious, graph)).toThrow();
    });

    test('escapes regex special characters', () => {
      // Add node with regex special chars
      graph.addNode('src/test.ts::func(args)', {
        type: 'tag',
        label: 'func(args)',
        kind: 'function',
      });

      // Should not treat (args) as regex group
      const result = adapter.execute('calls(func(args))', graph);

      // Should either match exactly or error, but not treat as regex
      expect(result).toBeDefined();
    });
  });

  describe('error handling', () => {
    test('throws error for invalid query syntax', () => {
      expect(() => adapter.execute('invalid syntax', graph)).toThrow();
    });

    test('throws error for missing required parameters', () => {
      expect(() => adapter.execute('calls()', graph)).toThrow();
    });

    test('handles empty graph gracefully', () => {
      const emptyGraph = new Graph();
      const result = adapter.execute('calls(main)', emptyGraph);

      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('result metadata', () => {
    test('includes execution time', () => {
      const result = adapter.execute('calls(main)', graph);

      expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.metadata.executionTime).toBe('number');
    });

    test('includes result count', () => {
      const result = adapter.execute('calls(processData)', graph);

      expect(result.metadata.resultCount).toBe(result.nodes.length);
    });

    test('includes query type', () => {
      expect(adapter.execute('calls(main)', graph).metadata.queryType).toBe('calls');
      expect(adapter.execute('callers(main)', graph).metadata.queryType).toBe('callers');
      expect(adapter.execute('path(main, to=processData)', graph).metadata.queryType).toBe('path');
      expect(adapter.execute('hotspots()', graph).metadata.queryType).toBe('hotspots');
    });

    test('includes syntax', () => {
      const result = adapter.execute('calls(main)', graph);

      expect(result.metadata.syntax).toBe('function');
    });
  });
});
