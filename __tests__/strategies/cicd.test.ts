// __tests__/strategies/cicd.test.ts
import CICDStrategy from '../../strategies/cicd';
import { StrategyContext } from '../../src/lib/strategy/types';

describe('CICD Strategy', () => {
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
    it('should detect GitHub Actions workflow files', async () => {
      mockContext.globFiles.mockReturnValue([
        '.github/workflows/ci.yml',
        'README.md'
      ]);

      const strategy = new CICDStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect GitLab CI file', async () => {
      mockContext.globFiles.mockReturnValue([
        '.gitlab-ci.yml',
        'README.md'
      ]);

      const strategy = new CICDStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect CircleCI config file', async () => {
      mockContext.globFiles.mockReturnValue([
        '.circleci/config.yml',
        'README.md'
      ]);

      const strategy = new CICDStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should detect multiple CI/CD platforms', async () => {
      mockContext.globFiles.mockReturnValue([
        '.github/workflows/ci.yml',
        '.gitlab-ci.yml',
        'README.md'
      ]);

      const strategy = new CICDStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(true);
    });

    it('should not detect when no CI/CD files present', async () => {
      mockContext.globFiles.mockReturnValue([
        'README.md',
        'package.json',
        'src/index.ts'
      ]);

      const strategy = new CICDStrategy();
      const detected = await strategy.detect(mockContext);

      expect(detected).toBe(false);
    });
  });

  describe('fileTypes', () => {
    it('should return all CI/CD file patterns', () => {
      const strategy = new CICDStrategy();
      const fileTypes = strategy.fileTypes!();

      expect(fileTypes).toContain('.github/workflows/*.yml');
      expect(fileTypes).toContain('.github/workflows/*.yaml');
      expect(fileTypes).toContain('.gitlab-ci.yml');
      expect(fileTypes).toContain('.circleci/config.yml');
    });
  });

  describe('ignorePatterns', () => {
    it('should return ignore patterns', () => {
      const strategy = new CICDStrategy();
      const patterns = strategy.ignorePatterns!();

      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('**/vendor/**');
      expect(patterns).toContain('**/.git/**');
    });
  });

  describe('analyze', () => {
    it('should parse GitHub Actions workflow file', async () => {
      const workflowContent = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;
      mockContext.readFile.mockResolvedValue(workflowContent);

      const strategy = new CICDStrategy();
      const metadata = await strategy.analyze('.github/workflows/ci.yml', mockContext);

      expect(metadata.tags).toContain('workflow:CI');
      expect(metadata.tags).toContain('job:CI:test');
      expect(metadata.metadata?.platform).toBe('github-actions');
      expect(metadata.metadata?.workflows).toHaveLength(1);
    });

    it('should parse GitLab CI file', async () => {
      const ciContent = `
test:
  script:
    - npm test

build:
  script:
    - npm run build
`;
      mockContext.readFile.mockResolvedValue(ciContent);

      const strategy = new CICDStrategy();
      const metadata = await strategy.analyze('.gitlab-ci.yml', mockContext);

      expect(metadata.tags).toContain('workflow:GitLab CI');
      expect(metadata.tags).toContain('job:GitLab CI:test');
      expect(metadata.tags).toContain('job:GitLab CI:build');
      expect(metadata.metadata?.platform).toBe('gitlab-ci');
    });

    it('should parse CircleCI config file', async () => {
      const ciContent = `
version: 2.1
jobs:
  test:
    docker:
      - image: node:18
    steps:
      - run: npm test
workflows:
  version: 2
  ci:
    jobs:
      - test
`;
      mockContext.readFile.mockResolvedValue(ciContent);

      const strategy = new CICDStrategy();
      const metadata = await strategy.analyze('.circleci/config.yml', mockContext);

      expect(metadata.tags).toContain('workflow:ci');
      expect(metadata.tags).toContain('job:ci:test');
      expect(metadata.metadata?.platform).toBe('circleci');
    });

    it('should return empty metadata for unknown file', async () => {
      mockContext.readFile.mockResolvedValue('some content');

      const strategy = new CICDStrategy();
      const metadata = await strategy.analyze('unknown.yml', mockContext);

      expect(metadata.tags).toEqual([]);
      expect(metadata.metadata).toEqual({});
    });

    it('should handle workflows with multiple jobs', async () => {
      const workflowContent = `
name: CI
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
`;
      mockContext.readFile.mockResolvedValue(workflowContent);

      const strategy = new CICDStrategy();
      const metadata = await strategy.analyze('.github/workflows/ci.yml', mockContext);

      expect(metadata.tags).toContain('workflow:CI');
      expect(metadata.tags).toContain('job:CI:lint');
      expect(metadata.tags).toContain('job:CI:test');
      expect(metadata.tags).toContain('job:CI:build');
      expect(metadata.metadata?.workflows[0].jobs).toHaveLength(3);
    });
  });

  describe('version', () => {
    it('should have version 0.1.0', () => {
      const strategy = new CICDStrategy();
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('name', () => {
    it('should have name cicd', () => {
      const strategy = new CICDStrategy();
      expect(strategy.name).toBe('cicd');
    });
  });

  describe('commands', () => {
    it('should have workflows command', () => {
      const strategy = new CICDStrategy();
      expect(strategy.commands).toHaveProperty('workflows');
      expect(strategy.commands!.workflows.description).toBeDefined();
    });

    it('should have graph command', () => {
      const strategy = new CICDStrategy();
      expect(strategy.commands).toHaveProperty('graph');
      expect(strategy.commands!.graph.description).toBeDefined();
    });

    it('should have deploy command', () => {
      const strategy = new CICDStrategy();
      expect(strategy.commands).toHaveProperty('deploy');
      expect(strategy.commands!.deploy.description).toBeDefined();
    });

    it('should have triggers command', () => {
      const strategy = new CICDStrategy();
      expect(strategy.commands).toHaveProperty('triggers');
      expect(strategy.commands!.triggers.description).toBeDefined();
    });
  });
});
