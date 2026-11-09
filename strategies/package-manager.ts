// strategies/package-manager.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import * as path from 'path';

interface DependencyMap {
  [key: string]: string;
}

interface PackageManagerMetadata {
  packageManager: string;
  packageName?: string;
  moduleName?: string;
  goVersion?: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  indirectDependencies?: DependencyMap;
  totalDependencies?: number;
}

export default class PackageManagerStrategy implements Strategy {
  name = 'package-manager';
  description = 'List dependencies across package managers (npm, pip, cargo, go, ...)';
  version = '0.1.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Check for npm/yarn/pnpm (JavaScript/TypeScript)
    const hasPackageJson = ctx.hasFiles('package.json');
    const hasYarnLock = ctx.hasFiles('yarn.lock');
    const hasPnpmLock = ctx.hasFiles('pnpm-lock.yaml');

    if (hasPackageJson || hasYarnLock || hasPnpmLock) {
      return true;
    }

    // Check for Cargo (Rust)
    const hasCargoToml = ctx.hasFiles('Cargo.toml');
    const hasCargoLock = ctx.hasFiles('Cargo.lock');

    if (hasCargoToml || hasCargoLock) {
      return true;
    }

    // Check for pip/poetry (Python)
    const hasRequirementsTxt = ctx.hasFiles('requirements.txt');
    const hasPyprojectToml = ctx.hasFiles('pyproject.toml');
    const hasPoetryLock = ctx.hasFiles('poetry.lock');

    if (hasRequirementsTxt || hasPyprojectToml || hasPoetryLock) {
      return true;
    }

    // Check for go mod (Go)
    const hasGoMod = ctx.hasFiles('go.mod');
    const hasGoSum = ctx.hasFiles('go.sum');

    if (hasGoMod || hasGoSum) {
      return true;
    }

    return false;
  }

  fileTypes(): string[] {
    return ['.json', '.toml', '.txt', '.mod', '.yaml', '.lock'];
  }

  ignorePatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/vendor/**',
      '**/.git/**',
      '**/venv/**',
      '**/__pycache__/**',
      '**/target/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const filename = path.basename(file);
    const tags: string[] = [];
    const metadata: PackageManagerMetadata = {
      packageManager: 'unknown'
    };

    try {
      switch (filename) {
        case 'package.json':
          await this.analyzePackageJson(file, ctx, tags, metadata);
          break;
        case 'Cargo.toml':
          await this.analyzeCargoToml(file, ctx, tags, metadata);
          break;
        case 'requirements.txt':
          await this.analyzeRequirementsTxt(file, ctx, tags, metadata);
          break;
        case 'pyproject.toml':
          await this.analyzePyprojectToml(file, ctx, tags, metadata);
          break;
        case 'go.mod':
          await this.analyzeGoMod(file, ctx, tags, metadata);
          break;
        default:
          break;
      }

      if (metadata.dependencies || metadata.devDependencies) {
        tags.push('dependencies');
      }
    } catch (error: any) {
      tags.push('parse-error');
    }

    return {
      tags,
      exports: [],
      imports: [],
      metadata
    };
  }

  private async analyzePackageJson(
    file: string,
    ctx: StrategyContext,
    tags: string[],
    metadata: PackageManagerMetadata
  ): Promise<void> {
    const content = await ctx.readFile(file);
    const pkg = JSON.parse(content);

    const dir = path.dirname(file);
    const hasYarnLock = ctx.globFiles(path.join(dir, 'yarn.lock')).length > 0;
    const hasPnpmLock = ctx.globFiles(path.join(dir, 'pnpm-lock.yaml')).length > 0;

    if (hasPnpmLock) {
      metadata.packageManager = 'pnpm';
      tags.push('package-manager:pnpm');
    } else if (hasYarnLock) {
      metadata.packageManager = 'yarn';
      tags.push('package-manager:yarn');
    } else {
      metadata.packageManager = 'npm';
      tags.push('package-manager:npm');
    }

    if (pkg.name) {
      metadata.packageName = pkg.name;
    }

    if (pkg.dependencies) {
      metadata.dependencies = pkg.dependencies;
    }

    if (pkg.devDependencies) {
      metadata.devDependencies = pkg.devDependencies;
    }

    const depCount = Object.keys(pkg.dependencies || {}).length;
    const devDepCount = Object.keys(pkg.devDependencies || {}).length;
    metadata.totalDependencies = depCount + devDepCount;
  }

  private async analyzeCargoToml(
    file: string,
    ctx: StrategyContext,
    tags: string[],
    metadata: PackageManagerMetadata
  ): Promise<void> {
    const content = await ctx.readFile(file);

    metadata.packageManager = 'cargo';
    tags.push('package-manager:cargo');

    const packageMatch = content.match(/\[package\]\s*\nname\s*=\s*"([^"]+)"/);
    if (packageMatch) {
      metadata.packageName = packageMatch[1];
    }

    const dependencies = this.parseTomlDependencies(content, '[dependencies]');
    if (Object.keys(dependencies).length > 0) {
      metadata.dependencies = dependencies;
    }

    const devDependencies = this.parseTomlDependencies(content, '[dev-dependencies]');
    if (Object.keys(devDependencies).length > 0) {
      metadata.devDependencies = devDependencies;
    }

    const depCount = Object.keys(metadata.dependencies || {}).length;
    const devDepCount = Object.keys(metadata.devDependencies || {}).length;
    metadata.totalDependencies = depCount + devDepCount;
  }

  private parseTomlDependencies(content: string, section: string): DependencyMap {
    const dependencies: DependencyMap = {};
    const sectionIndex = content.indexOf(section);

    if (sectionIndex === -1) {
      return dependencies;
    }

    const afterSection = content.substring(sectionIndex + section.length);
    const nextSectionIndex = afterSection.search(/\n\[/);
    const sectionContent = nextSectionIndex === -1
      ? afterSection
      : afterSection.substring(0, nextSectionIndex);

    const simplePattern = /^(\w[\w-]*)\s*=\s*"([^"]+)"/gm;
    let match;
    while ((match = simplePattern.exec(sectionContent)) !== null) {
      dependencies[match[1]] = match[2];
    }

    const complexPattern = /^(\w[\w-]*)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"[^}]*\}/gm;
    while ((match = complexPattern.exec(sectionContent)) !== null) {
      dependencies[match[1]] = match[2];
    }

    return dependencies;
  }

  private async analyzeRequirementsTxt(
    file: string,
    ctx: StrategyContext,
    tags: string[],
    metadata: PackageManagerMetadata
  ): Promise<void> {
    const content = await ctx.readFile(file);

    metadata.packageManager = 'pip';
    tags.push('package-manager:pip');

    const dependencies: DependencyMap = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const match = trimmed.match(/^([a-zA-Z0-9._-]+(?:\[[^\]]+\])?)\s*([=><!~]+[\d.]+.*?)(?:\s+#.*)?$/);
      if (match) {
        const [, pkgName, version] = match;
        dependencies[pkgName] = version;
      }
    }

    if (Object.keys(dependencies).length > 0) {
      metadata.dependencies = dependencies;
      metadata.totalDependencies = Object.keys(dependencies).length;
    }
  }

  private async analyzePyprojectToml(
    file: string,
    ctx: StrategyContext,
    tags: string[],
    metadata: PackageManagerMetadata
  ): Promise<void> {
    const content = await ctx.readFile(file);

    metadata.packageManager = 'poetry';
    tags.push('package-manager:poetry');

    const nameMatch = content.match(/\[tool\.poetry\]\s*\nname\s*=\s*"([^"]+)"/);
    if (nameMatch) {
      metadata.packageName = nameMatch[1];
    }

    const dependencies = this.parseTomlDependencies(content, '[tool.poetry.dependencies]');
    if (Object.keys(dependencies).length > 0) {
      metadata.dependencies = dependencies;
    }

    const devDependencies = this.parseTomlDependencies(content, '[tool.poetry.dev-dependencies]');
    if (Object.keys(devDependencies).length > 0) {
      metadata.devDependencies = devDependencies;
    }

    const depCount = Object.keys(metadata.dependencies || {}).length;
    const devDepCount = Object.keys(metadata.devDependencies || {}).length;
    metadata.totalDependencies = depCount + devDepCount;
  }

  private async analyzeGoMod(
    file: string,
    ctx: StrategyContext,
    tags: string[],
    metadata: PackageManagerMetadata
  ): Promise<void> {
    const content = await ctx.readFile(file);

    metadata.packageManager = 'go';
    tags.push('package-manager:go');

    const moduleMatch = content.match(/^module\s+(.+)$/m);
    if (moduleMatch) {
      metadata.moduleName = moduleMatch[1].trim();
    }

    const goVersionMatch = content.match(/^go\s+([\d.]+)$/m);
    if (goVersionMatch) {
      metadata.goVersion = goVersionMatch[1];
    }

    const dependencies: DependencyMap = {};
    const indirectDependencies: DependencyMap = {};

    const requireBlockPattern = /require\s*\(([\s\S]*?)\)/g;
    let blockMatch;

    while ((blockMatch = requireBlockPattern.exec(content)) !== null) {
      const blockContent = blockMatch[1];
      const lines = blockContent.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const depMatch = trimmed.match(/^([\w.\-/]+)\s+(v[\d.]+(?:-[\w.]+)?(?:\+[\w.]+)?)\s*(\/\/\s*indirect)?/);
        if (depMatch) {
          const [, pkgPath, version, indirect] = depMatch;
          if (indirect) {
            indirectDependencies[pkgPath] = version;
          } else {
            dependencies[pkgPath] = version;
          }
        }
      }
    }

    const singleRequirePattern = /^require\s+([\w.\-/]+)\s+(v[\d.]+(?:-[\w.]+)?(?:\+[\w.]+)?)\s*(\/\/\s*indirect)?/gm;
    let singleMatch;

    while ((singleMatch = singleRequirePattern.exec(content)) !== null) {
      const [, pkgPath, version, indirect] = singleMatch;
      if (indirect) {
        indirectDependencies[pkgPath] = version;
      } else {
        dependencies[pkgPath] = version;
      }
    }

    if (Object.keys(dependencies).length > 0) {
      metadata.dependencies = dependencies;
    }

    if (Object.keys(indirectDependencies).length > 0) {
      metadata.indirectDependencies = indirectDependencies;
    }

    const depCount = Object.keys(metadata.dependencies || {}).length;
    const indirectCount = Object.keys(metadata.indirectDependencies || {}).length;
    metadata.totalDependencies = depCount + indirectCount;
  }

  commands = {
    'list-dependencies': {
      description: 'List all dependencies from all package managers in the project',
      async handler(ctx: StrategyContext) {
        // Collect files from different patterns
        const packageJsonFiles = ctx.globFiles('**/package.json').filter(f => !f.includes('node_modules'));
        const cargoFiles = ctx.globFiles('**/Cargo.toml');
        const requirementsFiles = ctx.globFiles('**/requirements.txt');
        const pyprojectFiles = ctx.globFiles('**/pyproject.toml');
        const goModFiles = ctx.globFiles('**/go.mod');

        const allFiles = [
          ...packageJsonFiles,
          ...cargoFiles,
          ...requirementsFiles,
          ...pyprojectFiles,
          ...goModFiles
        ];

        const packageManagers = new Set<string>();
        const allDependencies: Array<{
          file: string;
          packageManager: string;
          dependencies: DependencyMap;
          devDependencies?: DependencyMap;
        }> = [];

        let totalDeps = 0;

        for (const file of allFiles) {
          const metadata = ctx.getMetadata(file, 'package-manager');
          if (metadata?.packageManager) {
            packageManagers.add(metadata.packageManager);

            const depCount = Object.keys(metadata.dependencies || {}).length;
            const devDepCount = Object.keys(metadata.devDependencies || {}).length;
            totalDeps += depCount + devDepCount;

            allDependencies.push({
              file,
              packageManager: metadata.packageManager,
              dependencies: metadata.dependencies || {},
              devDependencies: metadata.devDependencies
            });
          }
        }

        return {
          packageManagers: Array.from(packageManagers),
          files: allDependencies,
          totalDependencies: totalDeps
        };
      }
    },
    'summary': {
      description: 'Provide a summary of all package managers detected in the project',
      async handler(ctx: StrategyContext) {
        // Collect files from different patterns
        const packageJsonFiles = ctx.globFiles('**/package.json').filter(f => !f.includes('node_modules'));
        const cargoFiles = ctx.globFiles('**/Cargo.toml');
        const requirementsFiles = ctx.globFiles('**/requirements.txt');
        const pyprojectFiles = ctx.globFiles('**/pyproject.toml');
        const goModFiles = ctx.globFiles('**/go.mod');

        const allFiles = [
          ...packageJsonFiles,
          ...cargoFiles,
          ...requirementsFiles,
          ...pyprojectFiles,
          ...goModFiles
        ];

        const packageManagers = new Set<string>();
        let totalDeps = 0;

        for (const file of allFiles) {
          const metadata = ctx.getMetadata(file, 'package-manager');
          if (metadata?.packageManager) {
            packageManagers.add(metadata.packageManager);
            totalDeps += metadata.totalDependencies || 0;
          }
        }

        return {
          packageManagers: Array.from(packageManagers).sort(),
          fileCount: allFiles.length,
          totalDependencies: totalDeps
        };
      }
    }
  };
}
