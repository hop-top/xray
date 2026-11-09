// __tests__/strategies/build.test.ts
import BuildStrategy from '../../strategies/build';
import { StrategyContext } from '../../src/lib/strategy/types';

describe('Build Strategy', () => {
  let mockContext: jest.Mocked<StrategyContext>;

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
      getProjectRoot: jest.fn(),
      getConfig: jest.fn(),
      addFileTag: jest.fn(),
      setFileMetadata: jest.fn()
    } as any;
  });

  describe('detect', () => {
    it('should detect Makefile', async () => {
      mockContext.globFiles.mockReturnValue(['src/main.c', 'Makefile', 'README.md']);

      const strategy = new BuildStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect Justfile', async () => {
      mockContext.globFiles.mockReturnValue(['src/main.rs', 'Justfile']);

      const strategy = new BuildStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect Taskfile.yml', async () => {
      mockContext.globFiles.mockReturnValue(['main.go', 'Taskfile.yml']);

      const strategy = new BuildStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect package.json with scripts', async () => {
      mockContext.globFiles.mockReturnValue(['src/index.ts', 'package.json']);

      const strategy = new BuildStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect multiple build files', async () => {
      mockContext.globFiles.mockReturnValue([
        'Makefile',
        'package.json',
        'Justfile'
      ]);

      const strategy = new BuildStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should not detect when no build files present', async () => {
      mockContext.globFiles.mockReturnValue(['src/main.c', 'README.md']);

      const strategy = new BuildStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(false);
    });
  });

  describe('fileTypes', () => {
    it('should return all build file patterns', () => {
      const strategy = new BuildStrategy();
      const fileTypes = strategy.fileTypes!();

      expect(fileTypes).toContain('Makefile');
      expect(fileTypes).toContain('makefile');
      expect(fileTypes).toContain('.mk');
      expect(fileTypes).toContain('Justfile');
      expect(fileTypes).toContain('justfile');
      expect(fileTypes).toContain('.justfile');
      expect(fileTypes).toContain('Taskfile.yml');
      expect(fileTypes).toContain('Taskfile.yaml');
      expect(fileTypes).toContain('package.json');
    });
  });

  describe('analyze', () => {
    it('should parse Makefile and return metadata', async () => {
      const makefileContent = `all: build test

build:
\tgcc -o app src/*.c

test: build
\t./app --test`;

      mockContext.readFile.mockResolvedValue(makefileContent);

      const strategy = new BuildStrategy();
      const metadata = await strategy.analyze('Makefile', mockContext);

      expect(metadata.tags).toContain('build:all');
      expect(metadata.tags).toContain('build:build');
      expect(metadata.tags).toContain('build:test');
      expect(metadata.metadata?.buildTool).toBe('make');
      expect(metadata.metadata?.targets).toHaveLength(3);
      expect(metadata.metadata?.defaultTarget).toBe('all');
    });

    it('should parse Justfile and return metadata', async () => {
      const justfileContent = `# Build the app
build:
  gcc -o app src/*.c

test: build
  ./app --test`;

      mockContext.readFile.mockResolvedValue(justfileContent);

      const strategy = new BuildStrategy();
      const metadata = await strategy.analyze('Justfile', mockContext);

      expect(metadata.tags).toContain('build:build');
      expect(metadata.tags).toContain('build:test');
      expect(metadata.metadata?.buildTool).toBe('just');
      expect(metadata.metadata?.targets).toHaveLength(2);
      expect(metadata.metadata?.targets[0].description).toBe('Build the app');
    });

    it('should parse Taskfile.yml and return metadata', async () => {
      const taskfileContent = `version: '3'

tasks:
  build:
    desc: Build the application
    cmds:
      - go build -o app

  test:
    deps: [build]
    cmds:
      - go test ./...`;

      mockContext.readFile.mockResolvedValue(taskfileContent);

      const strategy = new BuildStrategy();
      const metadata = await strategy.analyze('Taskfile.yml', mockContext);

      expect(metadata.tags).toContain('build:build');
      expect(metadata.tags).toContain('build:test');
      expect(metadata.metadata?.buildTool).toBe('task');
      expect(metadata.metadata?.targets).toHaveLength(2);
    });

    it('should parse package.json and return metadata', async () => {
      const packageContent = JSON.stringify({
        scripts: {
          build: 'tsc',
          test: 'npm run build && jest',
          start: 'node dist/index.js'
        }
      });

      mockContext.readFile.mockResolvedValue(packageContent);

      const strategy = new BuildStrategy();
      const metadata = await strategy.analyze('package.json', mockContext);

      expect(metadata.tags).toContain('build:build');
      expect(metadata.tags).toContain('build:test');
      expect(metadata.tags).toContain('build:start');
      expect(metadata.metadata?.buildTool).toBe('npm');
      expect(metadata.metadata?.targets).toHaveLength(3);
      expect(metadata.metadata?.defaultTarget).toBe('start');
    });

    it('should return empty metadata for unknown file', async () => {
      mockContext.readFile.mockResolvedValue('some content');

      const strategy = new BuildStrategy();
      const metadata = await strategy.analyze('unknown.txt', mockContext);

      expect(metadata.tags).toEqual([]);
      expect(metadata.metadata).toEqual({});
    });
  });

  describe('metadata structure', () => {
    it('should include dependencies in metadata', async () => {
      const makefileContent = `all: build test

build:
\techo "Building"

test: build
\techo "Testing"`;

      mockContext.readFile.mockResolvedValue(makefileContent);

      const strategy = new BuildStrategy();
      const metadata = await strategy.analyze('Makefile', mockContext);

      expect(metadata.metadata?.dependencies).toEqual({
        'all': ['build', 'test'],
        'build': [],
        'test': ['build']
      });
    });

    it('should include target details in metadata', async () => {
      const justfileContent = `build:
  gcc -o app src/*.c`;

      mockContext.readFile.mockResolvedValue(justfileContent);

      const strategy = new BuildStrategy();
      const metadata = await strategy.analyze('Justfile', mockContext);

      expect(metadata.metadata?.targets[0]).toMatchObject({
        name: 'build',
        dependencies: [],
        recipe: ['gcc -o app src/*.c']
      });
    });
  });

  describe('version', () => {
    it('should have version 0.1.0', () => {
      const strategy = new BuildStrategy();
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('name', () => {
    it('should have name build', () => {
      const strategy = new BuildStrategy();
      expect(strategy.name).toBe('build');
    });
  });
});
