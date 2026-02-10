// __tests__/strategy/cicd/parsers/github-actions.test.ts
import { parseGitHubActions, githubActionsPlatform } from '../../../../src/lib/strategy/cicd/parsers/github-actions';

describe('GitHub Actions Parser', () => {
  describe('githubActionsPlatform.detect', () => {
    it('should detect GitHub Actions workflow files', () => {
      const files = [
        '.github/workflows/ci.yml',
        '.github/workflows/release.yaml',
        'README.md',
        'package.json'
      ];

      const detected = githubActionsPlatform.detect(files);
      expect(detected).toEqual([
        '.github/workflows/ci.yml',
        '.github/workflows/release.yaml'
      ]);
    });

    it('should return null when no workflow files present', () => {
      const files = ['README.md', 'package.json'];
      const detected = githubActionsPlatform.detect(files);
      expect(detected).toBeNull();
    });

    it('should only match files in .github/workflows/', () => {
      const files = [
        'workflows/ci.yml',
        '.github/ci.yml',
        '.github/workflows/ci.yml'
      ];

      const detected = githubActionsPlatform.detect(files);
      expect(detected).toEqual(['.github/workflows/ci.yml']);
    });

    it('should match both .yml and .yaml extensions', () => {
      const files = [
        '.github/workflows/ci.yml',
        '.github/workflows/deploy.yaml'
      ];

      const detected = githubActionsPlatform.detect(files);
      expect(detected).toHaveLength(2);
    });
  });

  describe('parseGitHubActions', () => {
    it('should parse workflow with basic structure', () => {
      const content = `
name: CI
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm test
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.platform).toBe('github-actions');
      expect(config.workflows).toHaveLength(1);
      expect(config.workflows[0].name).toBe('CI');
      expect(config.workflows[0].file).toBe('.github/workflows/ci.yml');
    });

    it('should use filename as workflow name when name is missing', () => {
      const content = `
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].name).toBe('ci');
    });

    it('should parse string trigger', () => {
      const content = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "test"
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].triggers).toHaveLength(1);
      expect(config.workflows[0].triggers[0].type).toBe('push');
    });

    it('should parse array of triggers', () => {
      const content = `
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "test"
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].triggers).toHaveLength(2);
      expect(config.workflows[0].triggers[0].type).toBe('push');
      expect(config.workflows[0].triggers[1].type).toBe('pull_request');
    });

    it('should parse triggers with branch filters', () => {
      const content = `
name: CI
on:
  push:
    branches:
      - main
      - develop
  pull_request:
    branches:
      - main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "test"
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].triggers).toHaveLength(2);
      expect(config.workflows[0].triggers[0].type).toBe('push');
      expect(config.workflows[0].triggers[0].branches).toEqual(['main', 'develop']);
      expect(config.workflows[0].triggers[1].type).toBe('pull_request');
      expect(config.workflows[0].triggers[1].branches).toEqual(['main']);
    });

    it('should parse triggers with tag filters', () => {
      const content = `
name: Release
on:
  push:
    tags:
      - 'v*'
      - 'release-*'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo "publish"
`;

      const config = parseGitHubActions('.github/workflows/release.yml', content);

      expect(config.workflows[0].triggers[0].tags).toEqual(['v*', 'release-*']);
    });

    it('should parse triggers with path filters', () => {
      const content = `
name: CI
on:
  push:
    paths:
      - 'src/**'
      - 'lib/**'
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "test"
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].triggers[0].paths).toEqual(['src/**', 'lib/**']);
    });

    it('should parse jobs with dependencies', () => {
      const content = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: npm run build

  deploy:
    needs: [test, build]
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].jobs).toHaveLength(3);
      expect(config.workflows[0].jobs[0].name).toBe('test');
      expect(config.workflows[0].jobs[0].dependsOn).toEqual([]);
      expect(config.workflows[0].jobs[1].name).toBe('build');
      expect(config.workflows[0].jobs[1].dependsOn).toEqual(['test']);
      expect(config.workflows[0].jobs[2].name).toBe('deploy');
      expect(config.workflows[0].jobs[2].dependsOn).toEqual(['test', 'build']);
    });

    it('should parse job with condition', () => {
      const content = `
name: Deploy
on: push
jobs:
  deploy:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy
`;

      const config = parseGitHubActions('.github/workflows/deploy.yml', content);

      expect(config.workflows[0].jobs[0].condition).toBe("github.ref == 'refs/heads/main'");
    });

    it('should parse job with environment', () => {
      const content = `
name: Deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: npm run deploy
`;

      const config = parseGitHubActions('.github/workflows/deploy.yml', content);

      expect(config.workflows[0].jobs[0].environment).toBe('production');
    });

    it('should parse steps with uses and with parameters', () => {
      const content = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3
        with:
          fetch-depth: 0
          submodules: true
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].jobs[0].steps).toHaveLength(1);
      expect(config.workflows[0].jobs[0].steps[0].name).toBe('Checkout');
      expect(config.workflows[0].jobs[0].steps[0].uses).toBe('actions/checkout@v3');
      expect(config.workflows[0].jobs[0].steps[0].with).toEqual({
        'fetch-depth': 0,
        'submodules': true
      });
    });

    it('should parse steps with run commands', () => {
      const content = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Run tests
        run: npm test
      - name: Multi-line script
        run: |
          echo "Building"
          npm run build
`;

      const config = parseGitHubActions('.github/workflows/ci.yml', content);

      expect(config.workflows[0].jobs[0].steps).toHaveLength(2);
      expect(config.workflows[0].jobs[0].steps[0].name).toBe('Run tests');
      expect(config.workflows[0].jobs[0].steps[0].run).toBe('npm test');
      expect(config.workflows[0].jobs[0].steps[1].run).toContain('npm run build');
    });

    it('should parse multiple jobs with different runners', () => {
      const content = `
name: Multi-OS
on: push
jobs:
  test-ubuntu:
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  test-windows:
    runs-on: windows-latest
    steps:
      - run: npm test

  test-macos:
    runs-on: macos-latest
    steps:
      - run: npm test
`;

      const config = parseGitHubActions('.github/workflows/multi-os.yml', content);

      expect(config.workflows[0].jobs).toHaveLength(3);
      expect(config.workflows[0].jobs[0].runsOn).toBe('ubuntu-latest');
      expect(config.workflows[0].jobs[1].runsOn).toBe('windows-latest');
      expect(config.workflows[0].jobs[2].runsOn).toBe('macos-latest');
    });

    it('should handle workflow_dispatch trigger', () => {
      const content = `
name: Manual Deploy
on: workflow_dispatch
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying"
`;

      const config = parseGitHubActions('.github/workflows/manual.yml', content);

      expect(config.workflows[0].triggers[0].type).toBe('workflow_dispatch');
    });

    it('should handle schedule trigger', () => {
      const content = `
name: Nightly
on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

      const config = parseGitHubActions('.github/workflows/nightly.yml', content);

      expect(config.workflows[0].triggers[0].type).toBe('schedule');
    });

    it('should handle complex workflow with multiple features', () => {
      const content = `
name: Complex CI/CD
on:
  push:
    branches: [main, develop]
    paths:
      - 'src/**'
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run linter
        run: npm run lint

  test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm run build

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: npm run deploy
`;

      const config = parseGitHubActions('.github/workflows/complex.yml', content);

      expect(config.workflows[0].name).toBe('Complex CI/CD');
      expect(config.workflows[0].triggers).toHaveLength(3);
      expect(config.workflows[0].jobs).toHaveLength(4);

      // Verify job dependency chain
      expect(config.workflows[0].jobs[1].dependsOn).toEqual(['lint']);
      expect(config.workflows[0].jobs[2].dependsOn).toEqual(['test']);
      expect(config.workflows[0].jobs[3].dependsOn).toEqual(['build']);

      // Verify deploy job
      expect(config.workflows[0].jobs[3].name).toBe('deploy');
      expect(config.workflows[0].jobs[3].condition).toBe("github.ref == 'refs/heads/main'");
      expect(config.workflows[0].jobs[3].environment).toBe('production');
    });
  });
});
