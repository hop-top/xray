// __tests__/strategy/cicd/parsers/gitlab-ci.test.ts
import { parseGitLabCI, gitlabCIPlatform } from '../../../../src/lib/strategy/cicd/parsers/gitlab-ci';

describe('GitLab CI Parser', () => {
  describe('gitlabCIPlatform.detect', () => {
    it('should detect .gitlab-ci.yml file', () => {
      const files = ['.gitlab-ci.yml', 'README.md', 'package.json'];
      const detected = gitlabCIPlatform.detect(files);
      expect(detected).toEqual(['.gitlab-ci.yml']);
    });

    it('should return null when no GitLab CI file present', () => {
      const files = ['README.md', 'package.json'];
      const detected = gitlabCIPlatform.detect(files);
      expect(detected).toBeNull();
    });

    it('should only match exact filename .gitlab-ci.yml', () => {
      const files = [
        'gitlab-ci.yml',
        '.gitlab-ci.yaml',
        '.gitlab-ci.yml'
      ];

      const detected = gitlabCIPlatform.detect(files);
      expect(detected).toEqual(['.gitlab-ci.yml']);
    });
  });

  describe('parseGitLabCI', () => {
    it('should parse basic GitLab CI configuration', () => {
      const content = `
stages:
  - test
  - build

test:
  stage: test
  script:
    - npm test

build:
  stage: build
  script:
    - npm run build
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.platform).toBe('gitlab-ci');
      expect(config.workflows).toHaveLength(1);
      expect(config.workflows[0].name).toBe('GitLab CI');
      expect(config.workflows[0].file).toBe('.gitlab-ci.yml');
      expect(config.workflows[0].jobs).toHaveLength(2);
    });

    it('should parse jobs with script commands', () => {
      const content = `
test:
  script:
    - npm install
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs[0].steps).toHaveLength(2);
      expect(config.workflows[0].jobs[0].steps[0].run).toBe('npm install');
      expect(config.workflows[0].jobs[0].steps[1].run).toBe('npm test');
    });

    it('should parse before_script and after_script', () => {
      const content = `
test:
  before_script:
    - npm install
  script:
    - npm test
  after_script:
    - npm run cleanup
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs[0].steps).toHaveLength(3);
      expect(config.workflows[0].jobs[0].steps[0].run).toBe('npm install');
      expect(config.workflows[0].jobs[0].steps[1].run).toBe('npm test');
      expect(config.workflows[0].jobs[0].steps[2].run).toBe('npm run cleanup');
    });

    it('should parse job with image (runsOn)', () => {
      const content = `
test:
  image: node:18
  script:
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs[0].runsOn).toBe('node:18');
    });

    it('should use default for runsOn when no image specified', () => {
      const content = `
test:
  script:
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs[0].runsOn).toBe('default');
    });

    it('should parse job dependencies using needs', () => {
      const content = `
test:
  script:
    - npm test

build:
  needs: [test]
  script:
    - npm run build

deploy:
  needs: [test, build]
  script:
    - npm run deploy
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs[0].dependsOn).toEqual([]);
      expect(config.workflows[0].jobs[1].dependsOn).toEqual(['test']);
      expect(config.workflows[0].jobs[2].dependsOn).toEqual(['test', 'build']);
    });

    it('should parse job with environment', () => {
      const content = `
deploy:
  script:
    - npm run deploy
  environment:
    name: production
    url: https://example.com
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs[0].environment).toBe('production');
    });

    it('should parse job with rules (sets condition)', () => {
      const content = `
deploy:
  script:
    - npm run deploy
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs[0].condition).toBe('conditional');
    });

    it('should ignore special keys', () => {
      const content = `
stages:
  - test
  - build

workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push"'

variables:
  NODE_ENV: production

default:
  retry: 2

test:
  stage: test
  script:
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      // Should only parse 'test' job, ignoring stages, workflow, variables, default
      expect(config.workflows[0].jobs).toHaveLength(1);
      expect(config.workflows[0].jobs[0].name).toBe('test');
    });

    it('should ignore hidden jobs (starting with dot)', () => {
      const content = `
.template:
  script:
    - echo "template"

test:
  extends: .template
  script:
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      // Should only parse 'test', not '.template'
      expect(config.workflows[0].jobs).toHaveLength(1);
      expect(config.workflows[0].jobs[0].name).toBe('test');
    });

    it('should parse triggers with default push', () => {
      const content = `
test:
  script:
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].triggers).toHaveLength(1);
      expect(config.workflows[0].triggers[0].type).toBe('push');
    });

    it('should parse triggers from workflow rules', () => {
      const content = `
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push"'

test:
  script:
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].triggers).toHaveLength(1);
      expect(config.workflows[0].triggers[0].type).toBe('push');
    });

    it('should handle complex GitLab CI configuration', () => {
      const content = `
stages:
  - lint
  - test
  - build
  - deploy

variables:
  NODE_VERSION: "18"

default:
  image: node:18
  before_script:
    - npm ci

lint:
  stage: lint
  script:
    - npm run lint

test:
  stage: test
  needs: [lint]
  script:
    - npm test
  coverage: '/Coverage: \\d+\\.\\d+/'

build:
  stage: build
  needs: [test]
  script:
    - npm run build
  artifacts:
    paths:
      - dist/

deploy:
  stage: deploy
  needs: [build]
  script:
    - npm run deploy
  environment:
    name: production
    url: https://example.com
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
  only:
    - main
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs).toHaveLength(4);

      // Check job dependencies
      expect(config.workflows[0].jobs[0].name).toBe('lint');
      expect(config.workflows[0].jobs[1].name).toBe('test');
      expect(config.workflows[0].jobs[1].dependsOn).toEqual(['lint']);
      expect(config.workflows[0].jobs[2].name).toBe('build');
      expect(config.workflows[0].jobs[2].dependsOn).toEqual(['test']);
      expect(config.workflows[0].jobs[3].name).toBe('deploy');
      expect(config.workflows[0].jobs[3].dependsOn).toEqual(['build']);

      // Check deploy job specifics
      expect(config.workflows[0].jobs[3].environment).toBe('production');
      expect(config.workflows[0].jobs[3].condition).toBe('conditional');
    });

    it('should handle jobs with multiple script formats', () => {
      const content = `
test-single:
  script: npm test

test-array:
  script:
    - npm install
    - npm test
`;

      const config = parseGitLabCI('.gitlab-ci.yml', content);

      expect(config.workflows[0].jobs).toHaveLength(2);
      expect(config.workflows[0].jobs[0].steps).toHaveLength(1);
      expect(config.workflows[0].jobs[1].steps).toHaveLength(2);
    });
  });
});
