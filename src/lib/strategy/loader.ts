// src/strategy/loader.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
  Extension,
  Strategy,
  StrategyContext,
  strategyToExtension,
} from './types';
import { FileReadError } from '../error/types';
import { Logger } from '../logger';
import { isGrammarAvailable } from '../parser/grammars';

const warnedStrategies = new Set<string>();
const warnedProjectCode = new Set<string>();

/** Environment variable that lets code living in the project load as strategies. */
export const PROJECT_STRATEGIES_ENV = 'XRAY_ALLOW_PROJECT_STRATEGIES';

const CODE_EXTENSIONS = new Set(['.js', '.ts']);

/** The only project strategy format that runs no code; anything else counts as code. */
const isDeclarative = (file: string): boolean => /\.ya?ml$/.test(file);

/**
 * Whether the user opted in to running strategy code from the project.
 *
 * SECURITY: a scanned repo ships `.xray/strategies/*.js`, `node_modules`
 * packages and the like; running them hands the repo the user's
 * privileges. Only the user's own environment can enable it: never a
 * config file, `package.json` or anything else the repo controls.
 */
export function projectStrategiesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PROJECT_STRATEGIES_ENV] === '1';
}

/**
 * Text for strategy code found in the project but not loaded; names the
 * variable that opts in.
 */
export function skippedProjectCodeMessage(skipped: string[]): string {
  const noun = skipped.length === 1 ? 'strategy' : 'strategies';
  return `${skipped.length} project ${noun} not loaded (they run code): ${skipped.join(', ')}. ` +
    `Set ${PROJECT_STRATEGIES_ENV}=1 to load them, only for a repo you trust.`;
}

/**
 * Say that project strategy code was found but not loaded, naming the
 * variable that opts in. `warn` for commands about strategies or where the
 * user named one; `debug` everywhere else. Silent when nothing was skipped.
 */
export function reportSkippedProjectCode(
  level: 'warn' | 'debug',
  options: CodeLoadingOptions = {}
): void {
  const skipped = new StrategyLoader(options).skippedProjectCode();
  if (skipped.length === 0) return;
  const message = skippedProjectCodeMessage(skipped);
  if (level === 'warn') Logger.warn(message);
  else Logger.debug(message);
}

/**
 * Whether code living in the current project may be loaded.
 *
 * `projectCode: false` is for implicit invocations such as shell
 * completion, which runs on every tab in whatever directory the shell is
 * in (e.g. a freshly cloned, untrusted repo). Only code shipped with xray
 * or installed in the user's own directories loads; nothing resolved from
 * the working directory does.
 */
export interface CodeLoadingOptions {
  /**
   * Consult the working directory for strategies at all. Default true;
   * false for implicit invocations (shell completion).
   */
  projectCode?: boolean;
  /**
   * Run code found in the working directory (`.xray/strategies/*.js|ts`,
   * `node_modules` strategies). Default: the user's
   * XRAY_ALLOW_PROJECT_STRATEGIES=1. Declarative YAML strategies from the
   * working directory load either way.
   */
  allowProjectCode?: boolean;
}

export class StrategyLoader {
  private readonly projectCode: boolean;
  private readonly allowProjectCode: boolean;

  constructor(options: CodeLoadingOptions = {}) {
    this.projectCode = options.projectCode ?? true;
    this.allowProjectCode = this.projectCode && (options.allowProjectCode ?? projectStrategiesAllowed());
  }

  /** Directories resolved from the working directory. */
  private projectDirs(): string[] {
    if (!this.projectCode) return [];
    return [
      path.join(process.cwd(), '.xray/strategies'),
      path.join(process.cwd(), 'node_modules'),
    ];
  }

  /**
   * Project strategy code that is present but will not load, as paths
   * relative to the working directory. Lists names only; nothing is read
   * or executed. Empty when project code is allowed.
   */
  skippedProjectCode(): string[] {
    if (!this.projectCode || this.allowProjectCode) return [];
    const skipped: string[] = [];
    const cwd = process.cwd();
    for (const dir of this.projectDirs()) {
      let names: string[];
      try {
        names = fs.readdirSync(dir).sort();
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(dir, name);
        // Discovery treats every `xray-strategy-*` entry as a package.
        const skip = name.startsWith('xray-strategy-')
          ? this.packageEntryIsCode(file)
          : CODE_EXTENSIONS.has(path.extname(name));
        if (skip) skipped.push(path.relative(cwd, file));
      }
    }
    return skipped;
  }

  /** A strategy package declaring a code entry; a YAML entry runs no code. */
  private packageEntryIsCode(dir: string): boolean {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      const entry = pkg?.['xray-strategy']?.entry;
      return typeof entry === 'string' && !isDeclarative(entry);
    } catch {
      return false;
    }
  }

  getStrategyPaths(): string[] {
    const paths: string[] = [];
    // Without project code, a relative entry would resolve against cwd.
    const usable = (p: string) => p !== '' && (this.projectCode || path.isAbsolute(p));

    // 1. XRAY_STRATEGIES_PATH (highest priority)
    if (process.env.XRAY_STRATEGIES_PATH) {
      const customPaths = process.env.XRAY_STRATEGIES_PATH.split(':');
      paths.push(...customPaths.filter(usable));
    }

    // 2. Local project strategies
    if (this.projectCode) {
      paths.push(path.join(process.cwd(), '.xray/strategies'));
    }

    // 3. XDG_DATA_HOME or platform default
    const envDataHome = process.env.XDG_DATA_HOME;
    const xdgDataHome = envDataHome && usable(envDataHome)
      ? envDataHome
      : this.getDefaultDataHome();
    paths.push(path.join(xdgDataHome, 'xray/strategies'));

    // 4. NPM packages (will scan node_modules); code there loads only when opted in
    if (this.projectCode) {
      paths.push(path.join(process.cwd(), 'node_modules'));
    }

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
      return this.guardGrammars(await this.loadYamlStrategy(strategyPath));
    } else if (ext === '.ts' || ext === '.js') {
      return this.guardGrammars(await this.loadJsStrategy(strategyPath));
    }

    throw new Error(`Unsupported strategy file type: ${ext}`);
  }

  /**
   * A strategy that declares `requiresLanguages` is only reported as detected
   * when those grammars are installed; otherwise one warning per strategy.
   */
  private guardGrammars(strategy: Strategy): Strategy {
    const required = strategy.requiresLanguages;
    if (!required || required.length === 0 || typeof strategy.detect !== 'function') return strategy;

    const originalDetect = strategy.detect.bind(strategy);
    strategy.detect = async (ctx: StrategyContext) => {
      const result = await originalDetect(ctx);
      const applicable = typeof result === 'object' && result !== null ? result.matched !== false : !!result;
      if (!applicable) return result;
      const missing = required.filter(l => !isGrammarAvailable(l));
      if (missing.length === 0) return result;
      if (!warnedStrategies.has(strategy.name)) {
        warnedStrategies.add(strategy.name);
        Logger.warn(
          `strategy '${strategy.name}' applies here but needs the ${missing.join(', ')} grammar: ` +
          `run \`xray lang add ${missing.join(' ')}\``
        );
      }
      return false;
    };
    return strategy;
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
      requiresLanguages: config.requiresLanguages,
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
    const projectDirs = new Set(this.projectDirs());

    // Code from the working directory loads only on opt-in; YAML always does.
    const loadable = (searchPath: string, entry: string): boolean => {
      if (!projectDirs.has(searchPath) || isDeclarative(entry)) return true;
      if (!this.allowProjectCode) return false;
      if (!warnedProjectCode.has(entry)) {
        warnedProjectCode.add(entry);
        Logger.warn(`loading strategy code from project path ${entry} (${PROJECT_STRATEGIES_ENV}=1)`);
      }
      return true;
    };

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
                  if (!seen.has(pkg['xray-strategy'].name) && loadable(searchPath, entryPath)) {
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
            if (!loadable(searchPath, filePath)) continue;
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

  async discoverExtensions(strategies?: Strategy[]): Promise<Extension[]> {
    const discoveredStrategies = strategies || await this.discoverStrategies();
    return discoveredStrategies.map(strategyToExtension);
  }
}
