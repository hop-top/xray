// __tests__/strategy/cicd/parsers/circleci.test.ts
import { parseCircleCI, circleCIPlatform } from '../../../../src/lib/strategy/cicd/parsers/circleci';

describe('CircleCI Parser', () => {
  describe('circleCIPlatform.detect', () => {
    it('should detect .circleci/config.yml file', () => {
      const files = ['.circleci/config.yml', 'README.md', 'package.json'];
      const detected = circleCIPlatform.detect(files);
      expect(detected).toEqual(['.circleci/config.yml']);
    });

    it('should return null when no CircleCI config present', () => {
      const files = ['README.md', 'package.json'];
      const detected = circleCIPlatform.detect(files);
      expect(detected).toBeNull();
    });

    it('should only match exact path .circleci/config.yml', () => {
      const files = [
        'config.yml',
        '.circleci/ci.yml',
        '.circleci/config.yml'
      ];

      const detected = circleCIPlatform.detect(files);
      expect(detected).toEqual(['.circleci/config.yml']);
    });
  });

  describe('parseCircleCI', () => {
    it('should parse basic CircleCI configuration', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - checkout
      - run: npm test

workflows:
  version: 2
  build:
    jobs:
      - test
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.platform).toBe('circleci');
      expect(config.workflows).toHaveLength(1);
      expect(config.workflows[0].name).toBe('build');
      expect(config.workflows[0].file).toBe('.circleci/config.yml');
      expect(config.workflows[0].jobs).toHaveLength(1);
    });

    it('should use default workflow name when not specified', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - run: npm test
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].name).toBe('default');
    });

    it('should parse job with docker executor', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18-alpine
    steps:
      - run: npm test
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].jobs[0].runsOn).toBe('node:18-alpine');
    });

    it('should parse job with machine executor', () => {
      const content = `
version: 2.1

jobs:
  test:
    machine:
      image: ubuntu-2204:2023.04.2
    steps:
      - run: npm test
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].jobs[0].runsOn).toBe('ubuntu-2204:2023.04.2');
    });

    it('should use unknown for runsOn when no executor specified', () => {
      const content = `
version: 2.1

jobs:
  test:
    steps:
      - run: npm test
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].jobs[0].runsOn).toBe('unknown');
    });

    it('should parse checkout step', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - checkout
      - run: npm test
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].jobs[0].steps).toHaveLength(2);
      expect(config.workflows[0].jobs[0].steps[0].name).toBe('Checkout code');
      expect(config.workflows[0].jobs[0].steps[0].uses).toBe('checkout');
    });

    it('should parse run steps with string format', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - run: npm test
      - run: npm run build
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].jobs[0].steps).toHaveLength(2);
      expect(config.workflows[0].jobs[0].steps[0].run).toBe('npm test');
      expect(config.workflows[0].jobs[0].steps[1].run).toBe('npm run build');
    });

    it('should parse run steps with object format', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - run:
          name: Run tests
          command: npm test
      - run:
          command: npm run build
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].jobs[0].steps).toHaveLength(2);
      expect(config.workflows[0].jobs[0].steps[0].name).toBe('Run tests');
      expect(config.workflows[0].jobs[0].steps[0].run).toBe('npm test');
      expect(config.workflows[0].jobs[0].steps[1].run).toBe('npm run build');
    });

    it('should parse job dependencies from workflow', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - run: npm test

  build:
    docker:
      - image: node:18
    steps:
      - run: npm run build

  deploy:
    docker:
      - image: node:18
    steps:
      - run: npm run deploy

workflows:
  version: 2
  build-and-deploy:
    jobs:
      - test
      - build:
          requires:
            - test
      - deploy:
          requires:
            - test
            - build
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].jobs).toHaveLength(3);
      expect(config.workflows[0].jobs[0].name).toBe('test');
      expect(config.workflows[0].jobs[0].dependsOn).toEqual([]);
      expect(config.workflows[0].jobs[1].name).toBe('build');
      expect(config.workflows[0].jobs[1].dependsOn).toEqual(['test']);
      expect(config.workflows[0].jobs[2].name).toBe('deploy');
      expect(config.workflows[0].jobs[2].dependsOn).toEqual(['test', 'build']);
    });

    it('should handle default push trigger', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - run: npm test
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].triggers).toHaveLength(1);
      expect(config.workflows[0].triggers[0].type).toBe('push');
    });

    it('should parse complex CircleCI configuration', () => {
      const content = `
version: 2.1

executors:
  node:
    docker:
      - image: node:18

jobs:
  lint:
    executor: node
    steps:
      - checkout
      - run:
          name: Install dependencies
          command: npm ci
      - run:
          name: Run linter
          command: npm run lint

  test:
    docker:
      - image: node:18
    steps:
      - checkout
      - run: npm ci
      - run: npm test

  build:
    machine:
      image: ubuntu-2204:2023.04.2
    steps:
      - checkout
      - run: npm run build

  deploy:
    docker:
      - image: node:18
    steps:
      - run: npm run deploy

workflows:
  version: 2
  ci-cd:
    jobs:
      - lint
      - test:
          requires:
            - lint
      - build:
          requires:
            - test
      - deploy:
          requires:
            - build
          filters:
            branches:
              only: main
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      expect(config.workflows[0].name).toBe('ci-cd');
      expect(config.workflows[0].jobs).toHaveLength(4);

      // Verify job chain
      expect(config.workflows[0].jobs[0].name).toBe('lint');
      expect(config.workflows[0].jobs[1].name).toBe('test');
      expect(config.workflows[0].jobs[1].dependsOn).toEqual(['lint']);
      expect(config.workflows[0].jobs[2].name).toBe('build');
      expect(config.workflows[0].jobs[2].dependsOn).toEqual(['test']);
      expect(config.workflows[0].jobs[3].name).toBe('deploy');
      expect(config.workflows[0].jobs[3].dependsOn).toEqual(['build']);

      // Verify different executors
      expect(config.workflows[0].jobs[0].runsOn).toBe('node:18');
      expect(config.workflows[0].jobs[2].runsOn).toBe('ubuntu-2204:2023.04.2');
    });

    it('should handle multiple workflows', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - run: npm test

  deploy:
    docker:
      - image: node:18
    steps:
      - run: npm run deploy

workflows:
  version: 2
  test-workflow:
    jobs:
      - test
  deploy-workflow:
    jobs:
      - deploy
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      // Should use first workflow
      expect(config.workflows[0].name).toBe('test-workflow');
    });

    it('should handle various step types', () => {
      const content = `
version: 2.1

jobs:
  test:
    docker:
      - image: node:18
    steps:
      - checkout
      - run: npm install
      - run:
          name: Test with coverage
          command: npm test -- --coverage
      - store_artifacts:
          path: coverage
      - store_test_results:
          path: test-results
`;

      const config = parseCircleCI('.circleci/config.yml', content);

      const steps = config.workflows[0].jobs[0].steps;
      expect(steps).toHaveLength(5);
      expect(steps[0].uses).toBe('checkout');
      expect(steps[1].run).toBe('npm install');
      expect(steps[2].name).toBe('Test with coverage');
    });
  });
});
