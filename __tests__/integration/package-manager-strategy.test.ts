// tests/integration/package-manager-strategy.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import PackageManagerStrategy from '../../strategies/package-manager';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('PackageManager Strategy Integration', () => {
  let strategy: PackageManagerStrategy;

  beforeEach(() => {
    strategy = new PackageManagerStrategy();
  });

  describe('Strategy Metadata', () => {
    it('should have correct metadata', () => {
      expect(strategy.name).toBe('package-manager');
      expect(strategy.version).toBe('0.1.0');
      expect(strategy.commands).toBeDefined();
      expect(strategy.commands?.['list-dependencies']).toBeDefined();
      expect(strategy.commands?.['summary']).toBeDefined();
    });
  });

  describe('Multi-Project Detection', () => {
    it('should detect project with multiple package managers', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-multi-pm-'));

      // Create JavaScript project
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-app',
          dependencies: { express: '^4.18.0' }
        })
      );

      // Create Go project
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        'module github.com/test/app\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.0'
      );

      const context = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(context);

      expect(detected).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('Real World Project Analysis', () => {
    it('should analyze xray project itself', async () => {
      const projectRoot = path.join(__dirname, '../..');
      const context = new StrategyContextImpl(projectRoot);

      const detected = await strategy.detect(context);
      expect(detected).toBe(true);

      // Analyze package.json
      const pkgJsonPath = path.join(projectRoot, 'package.json');
      const metadata = await strategy.analyze(pkgJsonPath, context);

      expect(metadata.tags).toContain('package-manager:npm');
      expect(metadata.tags).toContain('dependencies');
      expect(metadata.metadata?.packageManager).toBe('npm');
      expect(metadata.metadata?.packageName).toBe('@hop-top/xray');
      expect(metadata.metadata?.dependencies).toBeDefined();
      expect(metadata.metadata?.devDependencies).toBeDefined();
      expect(metadata.metadata?.totalDependencies).toBeGreaterThan(0);
    });
  });

  describe('Polyglot Project Support', () => {
    it('should handle project with npm, pip, and go', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-polyglot-'));

      // npm
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'polyglot-app',
          dependencies: { express: '^4.0.0' }
        })
      );

      // pip
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'flask==2.3.0\nrequests>=2.28.0'
      );

      // go
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        'module github.com/test/app\n\ngo 1.21\n'
      );

      const context = new StrategyContextImpl(tempDir);

      // Detect
      const detected = await strategy.detect(context);
      expect(detected).toBe(true);

      // Analyze each file
      const pkgMetadata = await strategy.analyze(path.join(tempDir, 'package.json'), context);
      expect(pkgMetadata.metadata?.packageManager).toBe('npm');

      const reqMetadata = await strategy.analyze(path.join(tempDir, 'requirements.txt'), context);
      expect(reqMetadata.metadata?.packageManager).toBe('pip');

      const goMetadata = await strategy.analyze(path.join(tempDir, 'go.mod'), context);
      expect(goMetadata.metadata?.packageManager).toBe('go');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('Command Execution', () => {
    it('should execute list-dependencies command', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cmd-list-'));

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          dependencies: { lodash: '^4.17.0' },
          devDependencies: { jest: '^29.0.0' }
        })
      );

      const context = new StrategyContextImpl(tempDir);

      // Analyze file to populate metadata
      const relPath = 'package.json';
      const metadata = await strategy.analyze(path.join(tempDir, relPath), context);
      context.setFileMetadata(relPath, 'package-manager', metadata.metadata);

      // Execute command
      const result = await strategy.commands!['list-dependencies'].handler(context);

      expect(result.packageManagers).toContain('npm');
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.totalDependencies).toBe(2);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should execute summary command', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cmd-summary-'));

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.0.0' } })
      );

      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'flask==2.3.0'
      );

      const context = new StrategyContextImpl(tempDir);

      // Analyze files
      const pkgMetadata = await strategy.analyze(path.join(tempDir, 'package.json'), context);
      context.setFileMetadata('package.json', 'package-manager', pkgMetadata.metadata);

      const reqMetadata = await strategy.analyze(path.join(tempDir, 'requirements.txt'), context);
      context.setFileMetadata('requirements.txt', 'package-manager', reqMetadata.metadata);

      // Execute command
      const result = await strategy.commands!['summary'].handler(context);

      expect(result.packageManagers).toEqual(expect.arrayContaining(['npm', 'pip']));
      expect(result.fileCount).toBe(2);
      expect(result.totalDependencies).toBe(2);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty package.json', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-empty-'));

      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');

      const context = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'package.json'), context);

      expect(metadata.metadata?.packageManager).toBe('npm');
      expect(metadata.metadata?.totalDependencies).toBe(0);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should handle malformed JSON gracefully', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-malformed-'));

      fs.writeFileSync(path.join(tempDir, 'package.json'), '{ invalid json }');

      const context = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'package.json'), context);

      expect(metadata.tags).toContain('parse-error');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
