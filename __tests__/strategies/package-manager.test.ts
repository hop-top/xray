// tests/strategies/package-manager.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import PackageManagerStrategy from '../../strategies/package-manager';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('PackageManagerStrategy', () => {
  let strategy: PackageManagerStrategy;

  beforeEach(() => {
    strategy = new PackageManagerStrategy();
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('package-manager');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('detection', () => {
    describe('npm/yarn/pnpm detection', () => {
      it('should detect npm project with package.json', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-npm-'));

        const pkgJson = {
          name: 'test-project',
          version: '1.0.0',
          dependencies: {
            'express': '^4.18.0'
          }
        };

        fs.writeFileSync(
          path.join(tempDir, 'package.json'),
          JSON.stringify(pkgJson, null, 2)
        );

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect yarn project with yarn.lock', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-yarn-'));

        fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect pnpm project with pnpm-lock.yaml', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pnpm-'));

        fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('Cargo detection', () => {
      it('should detect Rust project with Cargo.toml', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cargo-'));

        const cargoToml = `[package]
name = "test-project"
version = "0.1.0"

[dependencies]
serde = "1.0"
`;

        fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), cargoToml);

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect Cargo.lock', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cargo-lock-'));

        fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\nname = "test"');
        fs.writeFileSync(path.join(tempDir, 'Cargo.lock'), '');

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('pip/poetry detection', () => {
      it('should detect pip project with requirements.txt', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pip-'));

        const requirements = `flask==2.3.0
requests>=2.28.0
pytest~=7.0.0
`;

        fs.writeFileSync(path.join(tempDir, 'requirements.txt'), requirements);

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect poetry project with pyproject.toml', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-poetry-'));

        const pyproject = `[tool.poetry]
name = "test-project"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.9"
flask = "^2.3.0"
`;

        fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), pyproject);

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect poetry.lock', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-poetry-lock-'));

        fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), '[tool.poetry]');
        fs.writeFileSync(path.join(tempDir, 'poetry.lock'), '');

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('go mod detection', () => {
      it('should detect Go project with go.mod', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-go-'));

        const goMod = `module github.com/user/test-project

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    github.com/stretchr/testify v1.8.0
)
`;

        fs.writeFileSync(path.join(tempDir, 'go.mod'), goMod);

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect go.sum', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-go-sum-'));

        fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module test');
        fs.writeFileSync(path.join(tempDir, 'go.sum'), '');

        const ctx = new StrategyContextImpl(tempDir);
        const detected = await strategy.detect(ctx);

        expect(detected).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    it('should not detect project without package manager files', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-pm-'));

      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test');

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(false);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('file analysis', () => {
    describe('package.json analysis', () => {
      it('should analyze package.json and extract dependencies', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pkg-analysis-'));

        const pkgJson = {
          name: 'test-project',
          version: '1.0.0',
          dependencies: {
            'express': '^4.18.0',
            'lodash': '~4.17.21'
          },
          devDependencies: {
            'jest': '^29.0.0',
            'typescript': '^5.0.0'
          }
        };

        const pkgPath = path.join(tempDir, 'package.json');
        fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2));

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(pkgPath, ctx);

        expect(metadata.tags).toContain('package-manager:npm');
        expect(metadata.tags).toContain('dependencies');
        expect(metadata.metadata?.packageManager).toBe('npm');
        expect(metadata.metadata?.dependencies).toEqual({
          'express': '^4.18.0',
          'lodash': '~4.17.21'
        });
        expect(metadata.metadata?.devDependencies).toEqual({
          'jest': '^29.0.0',
          'typescript': '^5.0.0'
        });
        expect(metadata.metadata?.totalDependencies).toBe(4);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect yarn when yarn.lock is present', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-yarn-detect-'));

        const pkgPath = path.join(tempDir, 'package.json');
        fs.writeFileSync(pkgPath, JSON.stringify({ name: 'test' }));
        fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(pkgPath, ctx);

        expect(metadata.tags).toContain('package-manager:yarn');
        expect(metadata.metadata?.packageManager).toBe('yarn');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should detect pnpm when pnpm-lock.yaml is present', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pnpm-detect-'));

        const pkgPath = path.join(tempDir, 'package.json');
        fs.writeFileSync(pkgPath, JSON.stringify({ name: 'test' }));
        fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(pkgPath, ctx);

        expect(metadata.tags).toContain('package-manager:pnpm');
        expect(metadata.metadata?.packageManager).toBe('pnpm');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('Cargo.toml analysis', () => {
      it('should analyze Cargo.toml and extract dependencies', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cargo-analysis-'));

        const cargoToml = `[package]
name = "test-project"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1.25"

[dev-dependencies]
criterion = "0.5"
`;

        const cargoPath = path.join(tempDir, 'Cargo.toml');
        fs.writeFileSync(cargoPath, cargoToml);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(cargoPath, ctx);

        expect(metadata.tags).toContain('package-manager:cargo');
        expect(metadata.tags).toContain('dependencies');
        expect(metadata.metadata?.packageManager).toBe('cargo');
        expect(metadata.metadata?.packageName).toBe('test-project');
        expect(metadata.metadata?.dependencies).toBeDefined();
        expect(metadata.metadata?.dependencies['serde']).toBeDefined();
        expect(metadata.metadata?.dependencies['tokio']).toBe('1.25');
        expect(metadata.metadata?.devDependencies).toBeDefined();
        expect(metadata.metadata?.devDependencies['criterion']).toBe('0.5');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('requirements.txt analysis', () => {
      it('should analyze requirements.txt and extract dependencies', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-req-analysis-'));

        const requirements = `# Core dependencies
flask==2.3.0
requests>=2.28.0
pytest~=7.0.0
django<4.0.0

# Optional
pandas[excel]>=1.5.0
`;

        const reqPath = path.join(tempDir, 'requirements.txt');
        fs.writeFileSync(reqPath, requirements);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(reqPath, ctx);

        expect(metadata.tags).toContain('package-manager:pip');
        expect(metadata.tags).toContain('dependencies');
        expect(metadata.metadata?.packageManager).toBe('pip');
        expect(metadata.metadata?.dependencies).toBeDefined();
        expect(metadata.metadata?.dependencies['flask']).toBe('==2.3.0');
        expect(metadata.metadata?.dependencies['requests']).toBe('>=2.28.0');
        expect(metadata.metadata?.dependencies['pytest']).toBe('~=7.0.0');
        expect(metadata.metadata?.dependencies['django']).toBe('<4.0.0');
        expect(metadata.metadata?.dependencies['pandas[excel]']).toBe('>=1.5.0');
        expect(metadata.metadata?.totalDependencies).toBe(5);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should handle requirements.txt with comments and blank lines', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-req-comments-'));

        const requirements = `
# This is a comment
flask==2.3.0

# Another comment
requests>=2.28.0

`;

        const reqPath = path.join(tempDir, 'requirements.txt');
        fs.writeFileSync(reqPath, requirements);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(reqPath, ctx);

        expect(metadata.metadata?.totalDependencies).toBe(2);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('pyproject.toml analysis', () => {
      it('should analyze pyproject.toml and extract poetry dependencies', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-poetry-analysis-'));

        const pyproject = `[tool.poetry]
name = "test-project"
version = "0.1.0"
description = "A test project"

[tool.poetry.dependencies]
python = "^3.9"
flask = "^2.3.0"
requests = "~2.28.0"

[tool.poetry.dev-dependencies]
pytest = "^7.0.0"
black = ">=22.0.0"
`;

        const pyprojectPath = path.join(tempDir, 'pyproject.toml');
        fs.writeFileSync(pyprojectPath, pyproject);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(pyprojectPath, ctx);

        expect(metadata.tags).toContain('package-manager:poetry');
        expect(metadata.tags).toContain('dependencies');
        expect(metadata.metadata?.packageManager).toBe('poetry');
        expect(metadata.metadata?.packageName).toBe('test-project');
        expect(metadata.metadata?.dependencies).toBeDefined();
        expect(metadata.metadata?.dependencies['python']).toBe('^3.9');
        expect(metadata.metadata?.dependencies['flask']).toBe('^2.3.0');
        expect(metadata.metadata?.devDependencies).toBeDefined();
        expect(metadata.metadata?.devDependencies['pytest']).toBe('^7.0.0');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('go.mod analysis', () => {
      it('should analyze go.mod and extract dependencies', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-go-analysis-'));

        const goMod = `module github.com/user/test-project

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    github.com/stretchr/testify v1.8.0
    golang.org/x/sync v0.1.0
)

require (
    github.com/go-playground/validator/v10 v10.11.2 // indirect
)
`;

        const goModPath = path.join(tempDir, 'go.mod');
        fs.writeFileSync(goModPath, goMod);

        const ctx = new StrategyContextImpl(tempDir);
        const metadata = await strategy.analyze(goModPath, ctx);

        expect(metadata.tags).toContain('package-manager:go');
        expect(metadata.tags).toContain('dependencies');
        expect(metadata.metadata?.packageManager).toBe('go');
        expect(metadata.metadata?.moduleName).toBe('github.com/user/test-project');
        expect(metadata.metadata?.goVersion).toBe('1.21');
        expect(metadata.metadata?.dependencies).toBeDefined();
        expect(metadata.metadata?.dependencies['github.com/gin-gonic/gin']).toBe('v1.9.0');
        expect(metadata.metadata?.dependencies['github.com/stretchr/testify']).toBe('v1.8.0');
        expect(metadata.metadata?.dependencies['golang.org/x/sync']).toBe('v0.1.0');
        expect(metadata.metadata?.indirectDependencies).toBeDefined();
        expect(metadata.metadata?.indirectDependencies['github.com/go-playground/validator/v10']).toBe('v10.11.2');

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });
  });

  describe('commands', () => {
    describe('list-dependencies command', () => {
      it('should list all dependencies across all package managers', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-list-deps-'));

        // Create package.json
        fs.writeFileSync(
          path.join(tempDir, 'package.json'),
          JSON.stringify({
            dependencies: { express: '^4.18.0' },
            devDependencies: { jest: '^29.0.0' }
          })
        );

        const ctx = new StrategyContextImpl(tempDir);

        // Analyze the file first to populate metadata using relative path
        const relPath = 'package.json';
        const metadata = await strategy.analyze(path.join(tempDir, relPath), ctx);
        ctx.setFileMetadata(relPath, 'package-manager', metadata.metadata);

        const result = await strategy.commands!['list-dependencies'].handler(ctx);

        expect(result.packageManagers).toContain('npm');
        expect(result.files).toHaveLength(1);
        expect(result.totalDependencies).toBeGreaterThan(0);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('summary command', () => {
      it('should provide summary of all package managers in project', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-summary-'));

        fs.writeFileSync(
          path.join(tempDir, 'package.json'),
          JSON.stringify({ dependencies: { express: '^4.18.0' } })
        );

        const ctx = new StrategyContextImpl(tempDir);

        // Analyze the file first to populate metadata using relative path
        const relPath = 'package.json';
        const metadata = await strategy.analyze(path.join(tempDir, relPath), ctx);
        ctx.setFileMetadata(relPath, 'package-manager', metadata.metadata);

        const result = await strategy.commands!['summary'].handler(ctx);

        expect(result.packageManagers).toEqual(['npm']);
        expect(result.fileCount).toBe(1);
        expect(result.totalDependencies).toBeGreaterThanOrEqual(1);

        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });
  });

  describe('file types', () => {
    it('should return supported package manager file extensions', () => {
      const fileTypes = strategy.fileTypes!();

      expect(fileTypes).toContain('.json'); // package.json
      expect(fileTypes).toContain('.toml'); // Cargo.toml, pyproject.toml
      expect(fileTypes).toContain('.txt');  // requirements.txt
      expect(fileTypes).toContain('.mod');  // go.mod
    });
  });

  describe('ignore patterns', () => {
    it('should return patterns to ignore', () => {
      const patterns = strategy.ignorePatterns!();

      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('**/vendor/**');
      expect(patterns).toContain('**/.git/**');
    });
  });
});
