// __tests__/strategy/build/parsers/npm-scripts.test.ts
import { parsePackageJson, npmScriptsTool } from '../../../../src/lib/strategy/build/parsers/npm-scripts';

describe('npm Scripts Parser', () => {
  describe('parsePackageJson', () => {
    it('should parse npm scripts', () => {
      const content = JSON.stringify({
        name: 'my-app',
        scripts: {
          build: 'tsc',
          test: 'jest',
          start: 'node dist/index.js'
        }
      });

      const config = parsePackageJson('package.json', content);

      expect(config.tool).toBe('npm');
      expect(config.targets).toHaveLength(3);

      expect(config.targets[0].name).toBe('build');
      expect(config.targets[0].recipe).toEqual(['tsc']);
      expect(config.targets[0].dependencies).toEqual([]);

      expect(config.targets[1].name).toBe('test');
      expect(config.targets[1].recipe).toEqual(['jest']);
      expect(config.targets[1].dependencies).toEqual([]);

      expect(config.targets[2].name).toBe('start');
      expect(config.targets[2].recipe).toEqual(['node dist/index.js']);
      expect(config.targets[2].dependencies).toEqual([]);
    });

    it('should detect npm run dependencies', () => {
      const content = JSON.stringify({
        scripts: {
          build: 'tsc',
          test: 'npm run build && jest',
          dev: 'npm run build && nodemon'
        }
      });

      const config = parsePackageJson('package.json', content);

      expect(config.targets).toHaveLength(3);

      const testTarget = config.targets.find(t => t.name === 'test');
      expect(testTarget?.dependencies).toContain('build');

      const devTarget = config.targets.find(t => t.name === 'dev');
      expect(devTarget?.dependencies).toContain('build');
    });

    it('should detect yarn dependencies', () => {
      const content = JSON.stringify({
        scripts: {
          build: 'tsc',
          test: 'yarn build && jest'
        }
      });

      const config = parsePackageJson('package.json', content);

      const testTarget = config.targets.find(t => t.name === 'test');
      expect(testTarget?.dependencies).toContain('build');
    });

    it('should detect pnpm dependencies', () => {
      const content = JSON.stringify({
        scripts: {
          build: 'tsc',
          test: 'pnpm run build && jest'
        }
      });

      const config = parsePackageJson('package.json', content);

      const testTarget = config.targets.find(t => t.name === 'test');
      expect(testTarget?.dependencies).toContain('build');
    });

    it('should handle multiple npm run calls', () => {
      const content = JSON.stringify({
        scripts: {
          clean: 'rm -rf dist',
          build: 'tsc',
          test: 'jest',
          all: 'npm run clean && npm run build && npm run test'
        }
      });

      const config = parsePackageJson('package.json', content);

      const allTarget = config.targets.find(t => t.name === 'all');
      expect(allTarget?.dependencies).toEqual(['clean', 'build', 'test']);
    });

    it('should set default target to start if present', () => {
      const content = JSON.stringify({
        scripts: {
          build: 'tsc',
          start: 'node dist/index.js',
          test: 'jest'
        }
      });

      const config = parsePackageJson('package.json', content);

      expect(config.defaultTarget).toBe('start');
    });

    it('should handle missing start script', () => {
      const content = JSON.stringify({
        scripts: {
          build: 'tsc',
          test: 'jest'
        }
      });

      const config = parsePackageJson('package.json', content);

      expect(config.defaultTarget).toBeUndefined();
    });

    it('should handle missing scripts field', () => {
      const content = JSON.stringify({
        name: 'my-app',
        version: '1.0.0'
      });

      const config = parsePackageJson('package.json', content);

      expect(config.tool).toBe('npm');
      expect(config.targets).toEqual([]);
      expect(config.dependencies).toEqual({});
    });

    it('should handle empty scripts', () => {
      const content = JSON.stringify({
        scripts: {}
      });

      const config = parsePackageJson('package.json', content);

      expect(config.targets).toEqual([]);
    });

    it('should build dependencies map', () => {
      const content = JSON.stringify({
        scripts: {
          clean: 'rm -rf dist',
          build: 'npm run clean && tsc',
          test: 'npm run build && jest',
          all: 'npm run test'
        }
      });

      const config = parsePackageJson('package.json', content);

      expect(config.dependencies).toEqual({
        'clean': [],
        'build': ['clean'],
        'test': ['build'],
        'all': ['test']
      });
    });

    it('should handle scripts with colons in names', () => {
      const content = JSON.stringify({
        scripts: {
          'build:prod': 'tsc --production',
          'build:dev': 'tsc --dev',
          'test:unit': 'jest --testPathPattern=unit',
          'test:integration': 'npm run build:prod && jest --testPathPattern=integration'
        }
      });

      const config = parsePackageJson('package.json', content);

      expect(config.targets).toHaveLength(4);

      const integrationTest = config.targets.find(t => t.name === 'test:integration');
      expect(integrationTest?.dependencies).toContain('build:prod');
    });

    it('should not detect false positives', () => {
      const content = JSON.stringify({
        scripts: {
          build: 'echo "not npm run something"',
          test: 'jest # comment: npm run fake'
        }
      });

      const config = parsePackageJson('package.json', content);

      expect(config.targets[0].dependencies).toEqual([]);
      expect(config.targets[1].dependencies).toEqual([]);
    });

    it('should handle scripts with && and || operators', () => {
      const content = JSON.stringify({
        scripts: {
          prebuild: 'echo "Pre-build"',
          build: 'tsc',
          postbuild: 'echo "Post-build"',
          'build:all': 'npm run prebuild && npm run build || npm run postbuild'
        }
      });

      const config = parsePackageJson('package.json', content);

      const buildAll = config.targets.find(t => t.name === 'build:all');
      expect(buildAll?.dependencies).toContain('prebuild');
      expect(buildAll?.dependencies).toContain('build');
      expect(buildAll?.dependencies).toContain('postbuild');
    });
  });

  describe('npmScriptsTool', () => {
    it('should detect package.json', () => {
      const files = ['src/index.ts', 'package.json', 'README.md'];
      const detected = npmScriptsTool.detect(files);
      expect(detected).toBe('package.json');
    });

    it('should return null if no package.json', () => {
      const files = ['src/index.ts', 'Makefile', 'README.md'];
      const detected = npmScriptsTool.detect(files);
      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(npmScriptsTool.name).toBe('npm');
    });
  });
});
