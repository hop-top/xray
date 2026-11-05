// strategies/build.ts
import { NotFoundError, UsageError } from '../src/lib/error/types';
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import { BuildTool } from '../src/lib/strategy/build/types';
import { makeTool } from '../src/lib/strategy/build/parsers/makefile';
import { justTool } from '../src/lib/strategy/build/parsers/justfile';
import { taskTool } from '../src/lib/strategy/build/parsers/taskfile';
import { npmScriptsTool } from '../src/lib/strategy/build/parsers/npm-scripts';

/**
 * Build Strategy
 *
 * Unified strategy for detecting and analyzing build systems:
 * - Make (Makefile, makefile, *.mk)
 * - Just (Justfile, justfile, .justfile)
 * - Task (Taskfile.yml, Taskfile.yaml)
 * - npm scripts (package.json)
 *
 * Provides a unified interface to understand build targets, dependencies,
 * and recipes regardless of which build tool is used.
 */
export default class BuildStrategy implements Strategy {
  name = 'build';
  version = '0.1.0';

  private buildTools: BuildTool[] = [
    makeTool,
    npmScriptsTool,
    justTool,
    taskTool
  ];

  async detect(ctx: StrategyContext): Promise<boolean> {
    const files = ctx.globFiles('**/*');
    return this.buildTools.some(tool => tool.detect(files) !== null);
  }

  fileTypes(): string[] {
    return [
      'Makefile',
      'makefile',
      '.mk',
      'Justfile',
      'justfile',
      '.justfile',
      'Taskfile.yml',
      'Taskfile.yaml',
      'package.json'
    ];
  }

  ignorePatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/vendor/**',
      '**/.git/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);

    // Find matching tool for this file
    const tool = this.buildTools.find(t => t.detect([file]) === file);
    if (!tool) {
      return { tags: [], metadata: {} };
    }

    // Parse with tool-specific parser
    const config = tool.parse(file, content);

    // Generate tags for each target
    const tags = config.targets.map(t => `build:${t.name}`);

    // Return unified metadata
    return {
      tags,
      metadata: {
        buildTool: config.tool,
        targets: config.targets,
        defaultTarget: config.defaultTarget,
        dependencies: config.dependencies
      }
    };
  }

  commands = {
    targets: {
      description: 'Show all build targets',
      handler: async (ctx: StrategyContext) => {
        const results: any[] = [];
        const files = ctx.globFiles('**/*');

        // Find all build files
        for (const tool of this.buildTools) {
          const buildFile = tool.detect(files);
          if (buildFile) {
            const metadata = ctx.getMetadata(buildFile, 'build');
            if (metadata && metadata.targets) {
              for (const target of metadata.targets) {
                results.push({
                  name: target.name,
                  tool: metadata.buildTool,
                  file: buildFile,
                  dependencies: target.dependencies || [],
                  recipe: target.recipe || [],
                  description: target.description,
                  phony: target.phony,
                  isDefault: target.name === metadata.defaultTarget
                });
              }
            }
          }
        }

        return results;
      }
    },
    graph: {
      description: 'Show build dependency graph',
      handler: async (ctx: StrategyContext, opts?: any) => {
        const nodes: any[] = [];
        const edges: any[] = [];
        const files = ctx.globFiles('**/*');

        // Collect all targets and their dependencies
        for (const tool of this.buildTools) {
          const buildFile = tool.detect(files);
          if (buildFile) {
            const metadata = ctx.getMetadata(buildFile, 'build');
            if (metadata && metadata.targets) {
              // Add nodes
              for (const target of metadata.targets) {
                nodes.push({
                  id: target.name,
                  label: target.name,
                  tool: metadata.buildTool
                });
              }

              // Add edges
              if (metadata.dependencies) {
                for (const [target, deps] of Object.entries(metadata.dependencies)) {
                  for (const dep of deps as string[]) {
                    edges.push({ from: target, to: dep });
                  }
                }
              }
            }
          }
        }

        // If DOT format requested
        if (opts && opts.format === 'dot') {
          let dot = 'digraph build {\n';
          for (const edge of edges) {
            dot += `  ${edge.from} -> ${edge.to}\n`;
          }
          dot += '}';
          return { format: 'dot', content: dot };
        }

        return { nodes, edges };
      }
    },
    run: {
      description: 'Run a specific build target',
      options: {
        'target': 'Target name to run'
      },
      handler: async (ctx: StrategyContext, opts?: any) => {
        if (!opts || !opts.target) {
          throw new UsageError('No target specified. Use --target=<name>');
        }

        const targetName = opts.target;
        const files = ctx.globFiles('**/*');

        // Find the build file containing this target
        for (const tool of this.buildTools) {
          const buildFile = tool.detect(files);
          if (buildFile) {
            const metadata = ctx.getMetadata(buildFile, 'build');
            if (metadata && metadata.targets) {
              const target = metadata.targets.find((t: any) => t.name === targetName);
              if (target) {
                // Build the command based on the tool
                let command: string;
                switch (metadata.buildTool) {
                  case 'make':
                    command = `make ${targetName}`;
                    break;
                  case 'npm':
                    command = `npm run ${targetName}`;
                    break;
                  case 'just':
                    command = `just ${targetName}`;
                    break;
                  case 'task':
                    command = `task ${targetName}`;
                    break;
                  default:
                    command = targetName;
                }

                return {
                  tool: metadata.buildTool,
                  command,
                  target: targetName,
                  file: buildFile
                };
              }
            }
          }
        }

        throw new NotFoundError(`Target "${targetName}" not found in any build file`);
      }
    }
  };
}
