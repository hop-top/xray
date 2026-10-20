import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { handleQueryAction } from '../../src/commands/query';
import type { QueryCommandOptions } from '../../src/types/command-options';
import Graph from 'graphology';
import { GraphSerializer } from '../../src/lib/graph/serializer';

describe('Query Command', () => {
  const testDir = path.join(__dirname, '../fixtures/query');
  const graphFile = path.join(testDir, 'test-graph.json');

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create a test graph file
    const graph: any = new Graph();
    graph.addNode('src/main.ts', { type: 'file', label: 'src/main.ts' });
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
    graph.addEdge('src/main.ts', 'src/main.ts::main', { type: 'defines' });
    graph.addEdge('src/main.ts::main', 'src/api.ts::processData', { type: 'calls' });

    const serializer = new GraphSerializer();
    const serialized = serializer.serialize(graph, '/test/project');
    fs.writeFileSync(graphFile, JSON.stringify(serialized, null, 2));
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(graphFile)) {
      fs.unlinkSync(graphFile);
    }
  });

  describe('with --graph flag (offline mode)', () => {
    test('executes query against saved graph', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'json',
      };

      const result = await handleQueryAction('calls(main)', options);

      expect(result).toBeDefined();
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('processData');
    });

    test('throws error when graph file does not exist', async () => {
      const options: QueryCommandOptions = {
        graph: '/nonexistent/graph.json',
        format: 'json',
      };

      await expect(handleQueryAction('calls(main)', options)).rejects.toThrow();
    });

    test('throws error when graph file is invalid JSON', async () => {
      const invalidFile = path.join(testDir, 'invalid.json');
      fs.writeFileSync(invalidFile, 'not valid json');

      const options: QueryCommandOptions = {
        graph: invalidFile,
        format: 'json',
      };

      await expect(handleQueryAction('calls(main)', options)).rejects.toThrow();

      fs.unlinkSync(invalidFile);
    });
  });

  describe('output formats', () => {
    test('outputs JSON format', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'json',
      };

      const result = await handleQueryAction('calls(main)', options);

      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata.syntax).toBe('function');
    });

    test('outputs table format', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'table',
      };

      const output = await handleQueryAction('calls(main)', options);

      // Table format returns string
      expect(typeof output).toBe('string');
      expect(output).toContain('processData');
    });

    test('outputs tree format', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'tree',
      };

      const output = await handleQueryAction('calls(main)', options);

      // Tree format returns string
      expect(typeof output).toBe('string');
      expect(output).toContain('main');
      expect(output).toContain('processData');
    });

    test('defaults to table format when not specified', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
      };

      const output = await handleQueryAction('calls(main)', options);

      expect(typeof output).toBe('string');
    });
  });

  describe('adapter detection', () => {
    test('detects function-based syntax', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'json',
      };

      const result = await handleQueryAction('calls(main)', options);

      expect(result.metadata.syntax).toBe('function');
    });

    test('throws error when no adapter can parse query', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'json',
      };

      await expect(
        handleQueryAction('SELECT * FROM nodes', options)
      ).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    test('throws error for invalid query syntax', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'json',
      };

      await expect(
        handleQueryAction('invalid syntax', options)
      ).rejects.toThrow();
    });

    test('throws error when query is empty', async () => {
      const options: QueryCommandOptions = {
        graph: graphFile,
        format: 'json',
      };

      await expect(handleQueryAction('', options)).rejects.toThrow();
    });

    test('provides helpful error message for missing graph', async () => {
      const options: QueryCommandOptions = {
        format: 'json',
      };

      await expect(handleQueryAction('calls(main)', options)).rejects.toThrow(
        /graph/i
      );
    });
  });

  describe('--list-adapters flag', () => {
    test('lists available query adapters', async () => {
      const options: QueryCommandOptions = {
        listAdapters: true,
      };

      const output = await handleQueryAction('', options);

      expect(typeof output).toBe('string');
      expect(output).toContain('function');
      expect(output).toContain('Function Query Adapter');
    });
  });
});
