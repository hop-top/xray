// src/strategy/loader.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { Strategy, StrategyContext } from './types';
import { FileReadError } from '../error/types';
import { Logger } from '../logger';

export class StrategyLoader {
  getStrategyPaths(): string[] {
    const paths: string[] = [];

    // 1. XRAY_STRATEGIES_PATH (highest priority)
    if (process.env.XRAY_STRATEGIES_PATH) {
      const customPaths = process.env.XRAY_STRATEGIES_PATH.split(':');
      paths.push(...customPaths);
    }

    // 2. Local project strategies
    paths.push(path.join(process.cwd(), '.xray/strategies'));

    // 3. XDG_DATA_HOME or platform default
    const xdgDataHome = process.env.XDG_DATA_HOME ||
                        this.getDefaultDataHome();
    paths.push(path.join(xdgDataHome, 'xray/strategies'));

    // 4. NPM packages (will scan node_modules)
    paths.push(path.join(process.cwd(), 'node_modules'));

    // 5. Built-in strategies
    // When running from bin/strategy/loader.js, __dirname is bin/strategy/
    // When running from src (TypeScript/tests), __dirname is src/lib/strategy/
    // Try multiple locations:
    const possiblePaths = [
      path.join(__dirname, '../strategies'),           // From dist/lib/strategy -> dist/strategies
      path.join(__dirname, '../../strategies'),        // From src/lib/strategy -> src/strategies (doesn't exist)
      path.join(__dirname, '../../../strategies'),     // From src/lib/strategy -> strategies (source)
      path.join(__dirname, '../../../dist/strategies') // From src/lib/strategy -> dist/strategies (compiled)
    ];

    for (const strategiesPath of possiblePaths) {
      if (fs.existsSync(strategiesPath)) {
        paths.push(strategiesPath);
        break; // Use the first one found
      }
    }

    return paths;
  }

  private getDefaultDataHome(): string {
    const platform = os.platform();
    const home = os.homedir();

    switch (platform) {
      case 'darwin':
        return path.join(home, 'Library/Application Support');
      case 'win32':
        return process.env.APPDATA || path.join(home, 'AppData/Roaming');
      default: // Linux, BSD, etc.
        return path.join(home, '.local/share');
    }
  }

  async loadStrategy(strategyPath: string): Promise<Strategy> {
    const ext = path.extname(strategyPath);

    if (ext === '.yml' || ext === '.yaml') {
      return this.loadYamlStrategy(strategyPath);
    } else if (ext === '.ts' || ext === '.js') {
      return this.loadJsStrategy(strategyPath);
    }

    throw new Error(`Unsupported strategy file type: ${ext}`);
  }

  private async loadYamlStrategy(strategyPath: string): Promise<Strategy> {
    let content: string;
    try {
      content = fs.readFileSync(strategyPath, 'utf-8');
    } catch (err: any) {
      throw new FileReadError(strategyPath, err);
    }
    const config = yaml.load(content) as any;

    return {
      name: config.name,
      version: config.version,
      detect: (ctx: StrategyContext) => {
        if (config.detect.files) {
          for (const pattern of config.detect.files) {
            if (ctx.hasFiles(pattern)) return true;
          }
        }
        if (config.detect.dependencies) {
          for (const dep of config.detect.dependencies) {
            if (ctx.hasDependency(dep)) return true;
          }
        }
        return false;
      },
      fileTypes: config.fileTypes ? () => config.fileTypes : undefined,
      ignorePatterns: config.ignorePatterns ? () => config.ignorePatterns : undefined,
      analyze: async (file: string, ctx: StrategyContext) => {
        const tags: string[] = [];

        if (config.tags) {
          const content = await ctx.readFile(file);
          for (const tagRule of config.tags) {
            if (content.includes(tagRule.pattern)) {
              tags.push(tagRule.tag);
            }
          }
        }

        return { tags };
      },
      commands: config.commands
    };
  }

  private async loadJsStrategy(strategyPath: string): Promise<Strategy> {
    // For built-in strategies, we need to resolve the path correctly
    // When running from bin/, __dirname is bin/strategy/, and built-in strategies are at ../../strategies
    // When testing, strategies/ is at the project root
    let resolvedPath = strategyPath;

    // Check if this is a built-in strategy path
    if (strategyPath.includes('/strategies/') && strategyPath.endsWith('.ts')) {
      // In development/testing, use the TypeScript file as-is
      // In production, try to load from compiled location
      const tsPath = strategyPath;
      const jsPath = strategyPath.replace(/\.ts$/, '.js');

      // Check if we're in a built environment (JS file exists)
      if (fs.existsSync(jsPath)) {
        resolvedPath = jsPath;
      } else {
        resolvedPath = tsPath;
      }
    }

    const module = await import(resolvedPath);

    // Handle both default exports and class exports
    if (module.default) {
      // If it's a class constructor, instantiate it
      if (typeof module.default === 'function' && module.default.prototype) {
        return new module.default();
      }
      return module.default;
    }

    // Handle named exports or direct class exports
    const exportedValue = Object.values(module).find(exp =>
      typeof exp === 'function' || (exp && typeof exp === 'object')
    );

    if (exportedValue && typeof exportedValue === 'function' && exportedValue.prototype) {
      return new (exportedValue as any)();
    }

    return module;
  }

  async discoverStrategies(): Promise<Strategy[]> {
    const strategies: Strategy[] = [];
    const paths = this.getStrategyPaths();
    const seen = new Set<string>();

    for (const searchPath of paths) {
      if (!fs.existsSync(searchPath)) continue;

      const stat = fs.statSync(searchPath);

      if (stat.isDirectory()) {
        const files = fs.readdirSync(searchPath);

        for (const file of files) {
          const filePath = path.join(searchPath, file);

          // Handle NPM packages
          if (file.startsWith('xray-strategy-')) {
            const pkgPath = path.join(filePath, 'package.json');
            if (fs.existsSync(pkgPath)) {
              try {
                const content = fs.readFileSync(pkgPath, 'utf-8');
                const pkg = JSON.parse(content);
                if (pkg['xray-strategy']) {
                  const entryPath = path.join(filePath, pkg['xray-strategy'].entry);
                  if (!seen.has(pkg['xray-strategy'].name)) {
                    const strategy = await this.loadStrategy(entryPath);
                    strategies.push(strategy);
                    seen.add(strategy.name);
                  }
                }
              } catch (err: any) {
                // Log warning but continue - individual strategy failures shouldn't block discovery
                Logger.warn(`Failed to load strategy from ${pkgPath}: ${err.message}`);
              }
            }
          }
          // Handle direct strategy files
          else if (file.endsWith('.yml') || file.endsWith('.yaml') ||
                   file.endsWith('.ts') || file.endsWith('.js')) {
            const strategy = await this.loadStrategy(filePath);
            if (!seen.has(strategy.name)) {
              strategies.push(strategy);
              seen.add(strategy.name);
            }
          }
        }
      }
    }

    return strategies;
  }
}
