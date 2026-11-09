// __tests__/strategies/cicd-commands.test.ts
import CICDStrategy from '../../strategies/cicd';
import { StrategyContext } from '../../src/lib/strategy/types';

describe('CICD Strategy Commands', () => {
  let mockContext: jest.Mocked<StrategyContext>;
  let strategy: CICDStrategy;

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

    strategy = new CICDStrategy();
  });

  describe('workflows command', () => {
    it('should list all workflows from all platforms', async () => {
      mockContext.globFiles.mockReturnValue([
        '.github/workflows/ci.yml',
        '.gitlab-ci.yml'
      ]);

      mockContext.getMetadata
        .mockReturnValueOnce({
          platform: 'github-actions',
          workflows: [{
            name: 'CI',
            file: '.github/workflows/ci.yml',
            triggers: [{ type: 'push' }],
            jobs: [{ name: 'test', runsOn: 'ubuntu-latest', dependsOn: [], steps: [] }]
          }]
        })
        .mockReturnValueOnce({
          platform: 'gitlab-ci',
          workflows: [{
            name: 'GitLab CI',
            file: '.gitlab-ci.yml',
            triggers: [{ type: 'push' }],
            jobs: [{ name: 'test', runsOn: 'default', dependsOn: [], steps: [] }]
          }]
        });

      const result = await strategy.commands!.workflows.handler(mockContext);

      expect(result).toHaveLength(2);
      expect(result[0].platform).toBe('github-actions');
      expect(result[0].name).toBe('CI');
      expect(result[1].platform).toBe('gitlab-ci');
      expect(result[1].name).toBe('GitLab CI');
    });

    it('should return empty array when no CI/CD files found', async () => {
      mockContext.globFiles.mockReturnValue(['README.md', 'package.json']);

      const result = await strategy.commands!.workflows.handler(mockContext);

      expect(result).toEqual([]);
    });
  });

  describe('graph command', () => {
    it('should generate job dependency graph', async () => {
      mockContext.globFiles.mockReturnValue(['.github/workflows/ci.yml']);

      mockContext.getMetadata.mockReturnValue({
        platform: 'github-actions',
        workflows: [{
          name: 'CI',
          file: '.github/workflows/ci.yml',
          triggers: [{ type: 'push' }],
          jobs: [
            { name: 'test', runsOn: 'ubuntu-latest', dependsOn: [], steps: [] },
            { name: 'build', runsOn: 'ubuntu-latest', dependsOn: ['test'], steps: [] },
            { name: 'deploy', runsOn: 'ubuntu-latest', dependsOn: ['build'], steps: [] }
          ]
        }]
      });

      const result = await strategy.commands!.graph.handler(mockContext);

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
      expect(result.edges).toContainEqual({ from: 'CI:build', to: 'CI:test' });
      expect(result.edges).toContainEqual({ from: 'CI:deploy', to: 'CI:build' });
    });

    it('should generate DOT format when requested', async () => {
      mockContext.globFiles.mockReturnValue(['.github/workflows/ci.yml']);

      mockContext.getMetadata.mockReturnValue({
        platform: 'github-actions',
        workflows: [{
          name: 'CI',
          file: '.github/workflows/ci.yml',
          triggers: [{ type: 'push' }],
          jobs: [
            { name: 'test', runsOn: 'ubuntu-latest', dependsOn: [], steps: [] },
            { name: 'build', runsOn: 'ubuntu-latest', dependsOn: ['test'], steps: [] }
          ]
        }]
      });

      const result = await strategy.commands!.graph.handler(mockContext, { format: 'dot' });

      expect(result.format).toBe('dot');
      expect(result.content).toContain('digraph cicd');
      expect(result.content).toContain('"CI:build" -> "CI:test"');
    });
  });

  describe('deploy command', () => {
    it('should filter deployment-related jobs', async () => {
      mockContext.globFiles.mockReturnValue(['.github/workflows/ci.yml']);

      mockContext.getMetadata.mockReturnValue({
        platform: 'github-actions',
        workflows: [{
          name: 'CI',
          file: '.github/workflows/ci.yml',
          triggers: [{ type: 'push' }],
          jobs: [
            { name: 'test', runsOn: 'ubuntu-latest', dependsOn: [], steps: [] },
            { name: 'build', runsOn: 'ubuntu-latest', dependsOn: ['test'], steps: [] },
            {
              name: 'deploy',
              runsOn: 'ubuntu-latest',
              dependsOn: ['build'],
              steps: [],
              environment: 'production'
            }
          ]
        }]
      });

      const result = await strategy.commands!.deploy.handler(mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].job).toBe('deploy');
      expect(result[0].environment).toBe('production');
      expect(result[0].dependsOn).toEqual(['build']);
    });

    it('should detect deploy jobs by name', async () => {
      mockContext.globFiles.mockReturnValue(['.github/workflows/release.yml']);

      mockContext.getMetadata.mockReturnValue({
        platform: 'github-actions',
        workflows: [{
          name: 'Release',
          file: '.github/workflows/release.yml',
          triggers: [{ type: 'tag' }],
          jobs: [
            { name: 'build', runsOn: 'ubuntu-latest', dependsOn: [], steps: [] },
            { name: 'publish', runsOn: 'ubuntu-latest', dependsOn: ['build'], steps: [] }
          ]
        }]
      });

      const result = await strategy.commands!.deploy.handler(mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].job).toBe('publish');
    });
  });

  describe('triggers command', () => {
    it('should list all workflow triggers', async () => {
      mockContext.globFiles.mockReturnValue(['.github/workflows/ci.yml']);

      mockContext.getMetadata.mockReturnValue({
        platform: 'github-actions',
        workflows: [{
          name: 'CI',
          file: '.github/workflows/ci.yml',
          triggers: [
            { type: 'push', branches: ['main'] },
            { type: 'pull_request', branches: ['main'] }
          ],
          jobs: []
        }]
      });

      const result = await strategy.commands!.triggers.handler(mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].workflow).toBe('CI');
      expect(result[0].triggers).toHaveLength(2);
      expect(result[0].triggers[0].type).toBe('push');
      expect(result[0].triggers[1].type).toBe('pull_request');
    });

    it('should include schedule information', async () => {
      mockContext.globFiles.mockReturnValue(['.github/workflows/nightly.yml']);

      mockContext.getMetadata.mockReturnValue({
        platform: 'github-actions',
        workflows: [{
          name: 'Nightly',
          file: '.github/workflows/nightly.yml',
          triggers: [{ type: 'schedule' }],
          jobs: [],
          schedule: '0 0 * * *'
        }]
      });

      const result = await strategy.commands!.triggers.handler(mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].schedule).toBe('0 0 * * *');
    });
  });
});
