// __tests__/strategy/cicd/types.test.ts
import {
  CICDPlatform,
  CICDConfig,
  Workflow,
  Job,
  Step,
  Trigger
} from '../../../src/lib/strategy/cicd/types';

describe('CICD Types', () => {
  describe('Trigger', () => {
    it('should support push trigger type', () => {
      const trigger: Trigger = {
        type: 'push',
        branches: ['main', 'develop']
      };

      expect(trigger.type).toBe('push');
      expect(trigger.branches).toEqual(['main', 'develop']);
    });

    it('should support pull_request trigger type', () => {
      const trigger: Trigger = {
        type: 'pull_request',
        branches: ['main']
      };

      expect(trigger.type).toBe('pull_request');
    });

    it('should support tag trigger type', () => {
      const trigger: Trigger = {
        type: 'tag',
        tags: ['v*', 'release-*']
      };

      expect(trigger.type).toBe('tag');
      expect(trigger.tags).toEqual(['v*', 'release-*']);
    });

    it('should support schedule trigger type', () => {
      const trigger: Trigger = {
        type: 'schedule'
      };

      expect(trigger.type).toBe('schedule');
    });

    it('should support manual trigger type', () => {
      const trigger: Trigger = {
        type: 'manual'
      };

      expect(trigger.type).toBe('manual');
    });

    it('should support workflow_dispatch trigger type', () => {
      const trigger: Trigger = {
        type: 'workflow_dispatch'
      };

      expect(trigger.type).toBe('workflow_dispatch');
    });

    it('should support paths filter', () => {
      const trigger: Trigger = {
        type: 'push',
        paths: ['src/**', 'lib/**']
      };

      expect(trigger.paths).toEqual(['src/**', 'lib/**']);
    });
  });

  describe('Step', () => {
    it('should support action-based steps', () => {
      const step: Step = {
        name: 'Checkout',
        uses: 'actions/checkout@v3',
        with: {
          'fetch-depth': 0
        }
      };

      expect(step.uses).toBe('actions/checkout@v3');
      expect(step.with).toEqual({ 'fetch-depth': 0 });
    });

    it('should support run-based steps', () => {
      const step: Step = {
        name: 'Run tests',
        run: 'npm test'
      };

      expect(step.run).toBe('npm test');
    });

    it('should allow steps without names', () => {
      const step: Step = {
        run: 'echo "Hello"'
      };

      expect(step.name).toBeUndefined();
      expect(step.run).toBe('echo "Hello"');
    });
  });

  describe('Job', () => {
    it('should have required properties', () => {
      const job: Job = {
        name: 'test',
        runsOn: 'ubuntu-latest',
        dependsOn: [],
        steps: [
          { run: 'npm test' }
        ]
      };

      expect(job.name).toBe('test');
      expect(job.runsOn).toBe('ubuntu-latest');
      expect(job.dependsOn).toEqual([]);
      expect(job.steps).toHaveLength(1);
    });

    it('should support job dependencies', () => {
      const job: Job = {
        name: 'deploy',
        runsOn: 'ubuntu-latest',
        dependsOn: ['test', 'build'],
        steps: []
      };

      expect(job.dependsOn).toEqual(['test', 'build']);
    });

    it('should support conditional execution', () => {
      const job: Job = {
        name: 'deploy',
        runsOn: 'ubuntu-latest',
        dependsOn: [],
        steps: [],
        condition: 'github.ref == "refs/heads/main"'
      };

      expect(job.condition).toBe('github.ref == "refs/heads/main"');
    });

    it('should support environment specification', () => {
      const job: Job = {
        name: 'deploy',
        runsOn: 'ubuntu-latest',
        dependsOn: [],
        steps: [],
        environment: 'production'
      };

      expect(job.environment).toBe('production');
    });
  });

  describe('Workflow', () => {
    it('should have required properties', () => {
      const workflow: Workflow = {
        name: 'CI',
        file: '.github/workflows/ci.yml',
        triggers: [{ type: 'push' }],
        jobs: []
      };

      expect(workflow.name).toBe('CI');
      expect(workflow.file).toBe('.github/workflows/ci.yml');
      expect(workflow.triggers).toHaveLength(1);
      expect(workflow.jobs).toEqual([]);
    });

    it('should support multiple triggers', () => {
      const workflow: Workflow = {
        name: 'CI',
        file: '.github/workflows/ci.yml',
        triggers: [
          { type: 'push', branches: ['main'] },
          { type: 'pull_request', branches: ['main'] }
        ],
        jobs: []
      };

      expect(workflow.triggers).toHaveLength(2);
    });

    it('should support schedule property', () => {
      const workflow: Workflow = {
        name: 'Nightly',
        file: '.github/workflows/nightly.yml',
        triggers: [{ type: 'schedule' }],
        jobs: [],
        schedule: '0 0 * * *'
      };

      expect(workflow.schedule).toBe('0 0 * * *');
    });
  });

  describe('CICDConfig', () => {
    it('should have required properties', () => {
      const config: CICDConfig = {
        platform: 'github-actions',
        workflows: []
      };

      expect(config.platform).toBe('github-actions');
      expect(config.workflows).toEqual([]);
    });

    it('should support multiple workflows', () => {
      const config: CICDConfig = {
        platform: 'github-actions',
        workflows: [
          {
            name: 'CI',
            file: '.github/workflows/ci.yml',
            triggers: [{ type: 'push' }],
            jobs: []
          },
          {
            name: 'Release',
            file: '.github/workflows/release.yml',
            triggers: [{ type: 'tag' }],
            jobs: []
          }
        ]
      };

      expect(config.workflows).toHaveLength(2);
    });
  });

  describe('CICDPlatform', () => {
    it('should have required properties', () => {
      const platform: CICDPlatform = {
        name: 'test-platform',
        detect: (files: string[]) => files.length > 0 ? files : null,
        parse: (file: string, content: string) => ({
          platform: 'test-platform',
          workflows: []
        })
      };

      expect(platform.name).toBe('test-platform');
      expect(typeof platform.detect).toBe('function');
      expect(typeof platform.parse).toBe('function');
    });

    it('should allow detect to return null', () => {
      const platform: CICDPlatform = {
        name: 'test-platform',
        detect: (files: string[]) => null,
        parse: (file: string, content: string) => ({
          platform: 'test-platform',
          workflows: []
        })
      };

      const result = platform.detect([]);
      expect(result).toBeNull();
    });

    it('should allow detect to return file paths', () => {
      const platform: CICDPlatform = {
        name: 'test-platform',
        detect: (files: string[]) => files.filter(f => f.endsWith('.yml')),
        parse: (file: string, content: string) => ({
          platform: 'test-platform',
          workflows: []
        })
      };

      const result = platform.detect(['test.yml', 'readme.md']);
      expect(result).toEqual(['test.yml']);
    });

    it('should parse files and return CICDConfig', () => {
      const platform: CICDPlatform = {
        name: 'test-platform',
        detect: (files: string[]) => files,
        parse: (file: string, content: string) => ({
          platform: 'test-platform',
          workflows: [{
            name: 'Test Workflow',
            file,
            triggers: [{ type: 'push' }],
            jobs: []
          }]
        })
      };

      const config = platform.parse('test.yml', 'content');
      expect(config.platform).toBe('test-platform');
      expect(config.workflows).toHaveLength(1);
      expect(config.workflows[0].file).toBe('test.yml');
    });
  });
});
