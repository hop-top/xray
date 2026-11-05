// __tests__/strategies/build-commands.test.ts
import BuildStrategy from '../../strategies/build';
import { StrategyContext } from '../../src/lib/strategy/types';

describe('Build Strategy Commands', () => {
  let mockContext: jest.Mocked<StrategyContext>;
  let strategy: BuildStrategy;

  beforeEach(() => {
    mockContext = {
      hasDependency: jest.fn(),
      hasDevDependency: jest.fn(),
      hasFiles: jest.fn(),
      parseAST: jest.fn(),
      readFile: jest.fn(),
      findFiles: jest.fn(),
      hasTag: jest.fn(),
      getTags: jest.fn(),
      getMetadata: jest.fn(),
      getCached: jest.fn(),
      setCached: jest.fn(),
      globFiles: jest.fn(),
      getProjectRoot: jest.fn().mockReturnValue('/project'),
      getConfig: jest.fn(),
      addFileTag: jest.fn(),
      setFileMetadata: jest.fn()
    } as any;

    strategy = new BuildStrategy();
  });

  describe('build:targets command', () => {
    it('should list all targets from a Makefile', async () => {
      mockContext.globFiles.mockReturnValue(['Makefile']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'make',
        targets: [
          {
            name: 'all',
            dependencies: ['build', 'test'],
            recipe: [],
            phony: false
          },
          {
            name: 'build',
            dependencies: [],
            recipe: ['gcc -o app src/*.c'],
            phony: false
          },
          {
            name: 'test',
            dependencies: ['build'],
            recipe: ['./app --test'],
            phony: false
          },
          {
            name: 'clean',
            dependencies: [],
            recipe: ['rm -f *.o app'],
            phony: true
          }
        ],
        defaultTarget: 'all',
        dependencies: {
          'all': ['build', 'test'],
          'build': [],
          'test': ['build'],
          'clean': []
        }
      });

      const result = await strategy.commands.targets.handler(mockContext);

      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        name: 'all',
        tool: 'make',
        file: 'Makefile',
        dependencies: ['build', 'test'],
        isDefault: true
      });
      expect(result[3]).toMatchObject({
        name: 'clean',
        phony: true
      });
    });

    it('should list all targets from package.json', async () => {
      mockContext.globFiles.mockReturnValue(['package.json']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'npm',
        targets: [
          {
            name: 'build',
            dependencies: [],
            recipe: ['tsc']
          },
          {
            name: 'test',
            dependencies: ['build'],
            recipe: ['npm run build && jest']
          },
          {
            name: 'start',
            dependencies: [],
            recipe: ['node dist/index.js']
          }
        ],
        defaultTarget: 'start',
        dependencies: {
          'build': [],
          'test': ['build'],
          'start': []
        }
      });

      const result = await strategy.commands.targets.handler(mockContext);

      expect(result).toHaveLength(3);
      expect(result[2]).toMatchObject({
        name: 'start',
        tool: 'npm',
        file: 'package.json',
        isDefault: true
      });
    });

    it('should handle multiple build files', async () => {
      mockContext.globFiles.mockReturnValue(['Makefile', 'package.json']);

      mockContext.getMetadata.mockImplementation((file: string, strategy: string) => {
        if (file === 'Makefile') {
          return {
            buildTool: 'make',
            targets: [
              {
                name: 'build',
                dependencies: [],
                recipe: ['gcc -o app src/*.c']
              }
            ],
            defaultTarget: 'build',
            dependencies: { 'build': [] }
          };
        } else if (file === 'package.json') {
          return {
            buildTool: 'npm',
            targets: [
              {
                name: 'test',
                dependencies: [],
                recipe: ['jest']
              }
            ],
            dependencies: { 'test': [] }
          };
        }
        return null;
      });

      const result = await strategy.commands.targets.handler(mockContext);

      expect(result).toHaveLength(2);
      expect(result[0].file).toBe('Makefile');
      expect(result[1].file).toBe('package.json');
    });

    it('should return empty array when no build files found', async () => {
      mockContext.globFiles.mockReturnValue([]);

      const result = await strategy.commands.targets.handler(mockContext);

      expect(result).toEqual([]);
    });
  });

  describe('build:graph command', () => {
    it('should return dependency graph structure', async () => {
      mockContext.globFiles.mockReturnValue(['Makefile']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'make',
        targets: [
          { name: 'all', dependencies: ['build', 'test'], recipe: [] },
          { name: 'build', dependencies: [], recipe: ['gcc -o app src/*.c'] },
          { name: 'test', dependencies: ['build'], recipe: ['./app --test'] }
        ],
        dependencies: {
          'all': ['build', 'test'],
          'build': [],
          'test': ['build']
        }
      });

      const result = await strategy.commands.graph.handler(mockContext);

      expect(result.nodes).toBeDefined();
      expect(result.edges).toBeDefined();
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toContainEqual({ from: 'all', to: 'build' });
      expect(result.edges).toContainEqual({ from: 'all', to: 'test' });
      expect(result.edges).toContainEqual({ from: 'test', to: 'build' });
    });

    it('should support DOT format output', async () => {
      mockContext.globFiles.mockReturnValue(['Makefile']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'make',
        targets: [
          { name: 'all', dependencies: ['build'], recipe: [] },
          { name: 'build', dependencies: [], recipe: ['gcc -o app src/*.c'] }
        ],
        dependencies: {
          'all': ['build'],
          'build': []
        }
      });

      const result = await strategy.commands.graph.handler(mockContext, { format: 'dot' });

      expect(result.format).toBe('dot');
      expect(result.content).toContain('digraph build');
      expect(result.content).toContain('all -> build');
    });
  });

  describe('build:run command', () => {
    it('should prepare command to run a target', async () => {
      mockContext.globFiles.mockReturnValue(['Makefile']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'make',
        targets: [
          { name: 'build', dependencies: [], recipe: ['gcc -o app src/*.c'] }
        ]
      });

      const result = await strategy.commands.run.handler(mockContext, { target: 'build' });

      expect(result).toMatchObject({
        tool: 'make',
        command: 'make build',
        target: 'build',
        file: 'Makefile'
      });
    });

    it('should handle npm scripts', async () => {
      mockContext.globFiles.mockReturnValue(['package.json']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'npm',
        targets: [
          { name: 'test', dependencies: [], recipe: ['jest'] }
        ]
      });

      const result = await strategy.commands.run.handler(mockContext, { target: 'test' });

      expect(result).toMatchObject({
        tool: 'npm',
        command: 'npm run test',
        target: 'test',
        file: 'package.json'
      });
    });

    it('should handle just recipes', async () => {
      mockContext.globFiles.mockReturnValue(['Justfile']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'just',
        targets: [
          { name: 'build', dependencies: [], recipe: ['cargo build'] }
        ]
      });

      const result = await strategy.commands.run.handler(mockContext, { target: 'build' });

      expect(result).toMatchObject({
        tool: 'just',
        command: 'just build',
        target: 'build',
        file: 'Justfile'
      });
    });

    it('should handle task targets', async () => {
      mockContext.globFiles.mockReturnValue(['Taskfile.yml']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'task',
        targets: [
          { name: 'build', dependencies: [], recipe: ['go build'] }
        ]
      });

      const result = await strategy.commands.run.handler(mockContext, { target: 'build' });

      expect(result).toMatchObject({
        tool: 'task',
        command: 'task build',
        target: 'build',
        file: 'Taskfile.yml'
      });
    });

    it('should error when target not found', async () => {
      mockContext.globFiles.mockReturnValue(['Makefile']);
      mockContext.getMetadata.mockReturnValue({
        buildTool: 'make',
        targets: [
          { name: 'build', dependencies: [], recipe: ['gcc -o app src/*.c'] }
        ]
      });

      await expect(
        strategy.commands.run.handler(mockContext, { target: 'nonexistent' })
      ).rejects.toMatchObject({
        exitCode: 3,
        message: expect.stringContaining('Target "nonexistent" not found'),
      });
    });

    it('should error when no target specified', async () => {
      await expect(strategy.commands.run.handler(mockContext, {})).rejects.toMatchObject({
        exitCode: 2,
        message: expect.stringContaining('No target specified'),
      });
    });
  });
});
