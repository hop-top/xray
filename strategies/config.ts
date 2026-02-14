// strategies/config.ts
import { Strategy, StrategyContext, FileMetadata, StrategyCommand } from '../src/lib/strategy/types';
import { ParserFactory } from '../src/lib/config/parser-factory';
import { Logger } from '../src/lib/logger';
import * as path from 'path';

export default class ConfigStrategy implements Strategy {
  name = 'config';
  version = '0.1.0';
  private parserFactory: ParserFactory;

  constructor() {
    this.parserFactory = new ParserFactory();
  }

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Detect if project has any config files
    const hasEnv = ctx.hasFiles('.env') ||
                   ctx.hasFiles('.env.*');
    const hasJson = ctx.hasFiles('**/config.json') ||
                    ctx.hasFiles('**/*.config.json');
    const hasYaml = ctx.hasFiles('**/*.yml') ||
                    ctx.hasFiles('**/*.yaml');
    const hasToml = ctx.hasFiles('**/*.toml');

    return hasEnv || hasJson || hasYaml || hasToml;
  }

  fileTypes(): string[] {
    return ['.env', '.json', '.yml', '.yaml', '.toml'];
  }

  ignorePatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/package.json',
      '**/package-lock.json',
      '**/tsconfig.json',
      '**/tsconfig.*.json',
      '**/.git/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const tags: string[] = [];

    // Tag based on config file type
    if (file.includes('.env')) {
      tags.push('env-config');
    } else if (file.endsWith('.json')) {
      tags.push('json-config');
    } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      tags.push('yaml-config');
    } else if (file.endsWith('.toml')) {
      tags.push('toml-config');
    }

    return {
      tags,
      exports: [],
      imports: [],
      metadata: {}
    };
  }

  commands: Record<string, StrategyCommand> = {
    list: {
      description: 'List all configuration files in the project',
      options: {
        'pattern': 'Filter files by pattern (e.g., *.env*, *.json)'
      },
      handler: async (ctx: StrategyContext, opts?: any) => {
        const pattern = opts?.pattern || opts?.['pattern'];
        const files = this.findConfigFiles(ctx, pattern);

        Logger.output('\nConfiguration Files:\n');

        const grouped = this.groupFilesByType(files);

        for (const [type, typeFiles] of Object.entries(grouped)) {
          if (typeFiles.length > 0) {
            Logger.output(`\n${type.toUpperCase()} Files:`);
            for (const file of typeFiles) {
              const relativePath = path.relative(ctx.getProjectRoot(), file);
              Logger.output(`  ${relativePath}`);
            }
          }
        }

        Logger.output(`\nTotal: ${files.length} file(s)\n`);

        return { files, count: files.length };
      }
    },

    keys: {
      description: 'List all configuration keys',
      options: {
        'file': 'Specific config file to analyze (relative to project root)'
      },
      handler: async (ctx: StrategyContext, opts?: any) => {
        const files = opts?.file || opts?.['file']
          ? [path.join(ctx.getProjectRoot(), opts.file || opts?.['file'])]
          : this.findConfigFiles(ctx);

        const allKeys: string[] = [];

        for (const file of files) {
          try {
            const content = await ctx.readFile(file);
            const parser = this.parserFactory.getParser(file);

            if (!parser) {
              continue;
            }

            const parsed = parser.parse(content, file);
            const keys = parsed.entries.map(e => e.key);
            allKeys.push(...keys);
          } catch (err: any) {
            Logger.warn(`Failed to parse ${file}: ${err.message}`);
          }
        }

        // Remove duplicates and sort
        const uniqueKeys = Array.from(new Set(allKeys)).sort();

        Logger.output('\nConfiguration Keys:\n');
        for (const key of uniqueKeys) {
          Logger.output(`  ${key}`);
        }
        Logger.output(`\nTotal: ${uniqueKeys.length} key(s)\n`);

        return { keys: uniqueKeys, count: uniqueKeys.length };
      }
    },

    values: {
      description: 'Display configuration values',
      options: {
        'file': 'Specific config file to display (relative to project root)',
        'show-secrets': 'Show sensitive values (default: false)'
      },
      handler: async (ctx: StrategyContext, opts?: any) => {
        const files = opts?.file || opts?.['file']
          ? [path.join(ctx.getProjectRoot(), opts.file || opts?.['file'])]
          : this.findConfigFiles(ctx);

        const showSecrets = opts?.['show-secrets'] === true || opts?.['showSecrets'] === true || opts?.showSecrets === true;

        Logger.output('\nConfiguration Values:\n');

        for (const file of files) {
          try {
            const content = await ctx.readFile(file);
            const parser = this.parserFactory.getParser(file);

            if (!parser) {
              continue;
            }

            const parsed = parser.parse(content, file);
            const relativePath = path.relative(ctx.getProjectRoot(), file);

            if (files.length > 1) {
              Logger.output(`\n${relativePath}:`);
            }

            for (const entry of parsed.entries) {
              let displayValue = entry.value;

              // Redact sensitive values unless --show-secrets is set
              if (entry.sensitive && !showSecrets) {
                displayValue = '***';
              }

              // Format arrays and objects
              if (Array.isArray(displayValue)) {
                displayValue = JSON.stringify(displayValue);
              } else if (typeof displayValue === 'object' && displayValue !== null) {
                displayValue = JSON.stringify(displayValue);
              }

              Logger.output(`  ${entry.key} = ${displayValue}`);
            }
          } catch (err: any) {
            Logger.error(`Error parsing ${file}: ${err.message}`);
          }
        }

        Logger.output('');
        return {};
      }
    }
  };

  private findConfigFiles(ctx: StrategyContext, pattern?: string): string[] {
    const projectRoot = ctx.getProjectRoot();
    const allFiles: string[] = [];

    // Patterns for config files
    const patterns = pattern ? [pattern] : [
      '.env',
      '.env.*',
      '*.config.json',
      'config.json',
      '**/*.config.json',
      '**/config.json',
      'config/**/*.json',  // JSON files in config directory
      '*.yml',
      '*.yaml',
      '**/*.yml',
      '**/*.yaml',
      '*.toml',
      '**/*.toml'
    ];

    for (const pat of patterns) {
      const files = ctx.globFiles(pat);
      allFiles.push(...files);
    }

    // Filter using parser factory and ignore patterns
    const ignorePatterns = this.ignorePatterns();
    const filtered = allFiles.filter(file => {
      // Check if file matches ignore patterns
      for (const ignorePattern of ignorePatterns) {
        const pattern = ignorePattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
        const regex = new RegExp(pattern);
        if (regex.test(file)) {
          return false;
        }
      }

      // Check if parser can handle this file
      return this.parserFactory.isConfigFile(file);
    });

    // Remove duplicates
    return Array.from(new Set(filtered)).sort();
  }

  private groupFilesByType(files: string[]): Record<string, string[]> {
    const groups: Record<string, string[]> = {
      env: [],
      json: [],
      yaml: [],
      toml: []
    };

    for (const file of files) {
      if (file.includes('.env')) {
        groups.env.push(file);
      } else if (file.endsWith('.json')) {
        groups.json.push(file);
      } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        groups.yaml.push(file);
      } else if (file.endsWith('.toml')) {
        groups.toml.push(file);
      }
    }

    return groups;
  }
}
