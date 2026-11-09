import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { addQueryOutputFlags, handleQueryAction, runQueryCommand } from '../../src/commands/query';
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

    test('returns the structured result regardless of format', async () => {
      const result = await handleQueryAction('calls(main)', { graph: graphFile, format: 'table' });
      expect(typeof result).toBe('object');
      expect((result as any).nodes[0].name).toBe('processData');
    });
  });

  describe('xray query output (kit dispatch)', () => {
    let writeSpy: jest.SpyInstance;
    const captured = () => writeSpy.mock.calls.map(c => String(c[0])).join('');

    beforeEach(() => {
      writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });
    afterEach(() => writeSpy.mockRestore());

    async function runQuery(...args: string[]): Promise<void> {
      const program = new Command();
      program.exitOverride();
      addQueryOutputFlags(program.command('query').argument('[query]').option('--graph <file>'))
        .option('--list-adapters')
        .action(runQueryCommand);
      await program.parseAsync(['node', 'test', 'query', ...args]);
    }

    test('json is byte-identical to JSON.stringify(result, null, 2)', async () => {
      await runQuery('--graph', graphFile, '--format', 'json', 'calls(main)');
      const out = captured();
      const doc = JSON.parse(out);
      expect(doc).toHaveProperty('nodes');
      expect(doc).toHaveProperty('edges');
      expect(doc).toHaveProperty('metadata');
      expect(out).toBe(JSON.stringify(doc, null, 2) + '\n');
    });

    test('table (default) renders node rows through kit table', async () => {
      await runQuery('--graph', graphFile, 'calls(main)');
      const lines = captured().trimEnd().split('\n');
      expect(lines[0].split(/\s+/)).toEqual(['name', 'kind', 'file', 'line']);
      // graph line 10 -> editor line 11
      expect(lines[1]).toMatch(/^processData\s+function\s+src\/api\.ts\s+11$/);
    });

    test('csv honors --cols (incl. non-default columns)', async () => {
      await runQuery('calls(main)', '--graph', graphFile, '--format', 'csv', '--cols', 'id,name');
      expect(captured()).toBe('id,name\nsrc/api.ts::processData,processData\n');
    });

    test('tree renders the call tree', async () => {
      await runQuery('--graph', graphFile, '--format', 'tree', 'calls(main)');
      const out = captured();
      expect(out).toContain('Call Tree:');
      expect(out).toContain('processData');
    });

    test('yaml emits the whole result document', async () => {
      await runQuery('--graph', graphFile, '--format', 'yaml', 'calls(main)');
      expect(captured()).toMatch(/^nodes:/m);
      expect(captured()).toMatch(/^metadata:/m);
    });

    test('unknown format is a usage error (exit 2)', async () => {
      await expect(
        runQuery('--graph', graphFile, '--format', 'xml', 'calls(main)')
      ).rejects.toMatchObject({ exitCode: 2 });
    });

    test('unknown column is a usage error (exit 2)', async () => {
      await expect(
        runQuery('calls(main)', '--graph', graphFile, '--cols', 'nope')
      ).rejects.toMatchObject({ exitCode: 2 });
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
