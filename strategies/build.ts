// strategies/build.ts
import * as path from 'path';
import { spawn } from 'child_process';
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
  description = 'Inspect build targets and dependencies (Makefile, package.json scripts)';
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

    // The loader passes absolute paths; tool detection is project-relative.
    const root = ctx.getProjectRoot?.();
    const rel = root && path.isAbsolute(file) ? path.relative(root, file) : file;

    // Find matching tool for this file
    const tool = this.buildTools.find(t => t.detect([rel]) === rel);
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
      description: 'Print the command for a build target (does not run it; see `build exec`)',
      options: {
        'target': 'Target name to print the command for'
      },
      handler: async (ctx: StrategyContext, opts?: any) => {
        if (!opts || !opts.target) {
          throw new UsageError('No target specified. Use --target=<name>');
        }
        const r = resolveTarget(this.buildTools, ctx, opts.target);
        return { tool: r.tool, command: r.argv.join(' '), target: opts.target, file: r.file };
      }
    },
    exec: {
      description: 'Run a build target (executes the repo\'s build recipe)',
      positional: { name: 'target', description: 'Target name to run' },
      effect: { tier: 'destructive-local' as const, idempotent: 'no' as const },
      handler: async (ctx: StrategyContext, opts?: any) => {
        if (!opts || !opts.target) {
          throw new UsageError('No target specified. Use: build exec <target>');
        }
        const targetName: string = opts.target;
        // A leading dash would be read as an option by the build tool.
        if (targetName.startsWith('-')) {
          throw new UsageError(`Refusing to run target "${targetName}": names starting with "-" are options`);
        }
        const r = resolveTarget(this.buildTools, ctx, targetName);
        const cwd = ctx.getProjectRoot();
        if (opts.dryRun) {
          return {
            effects: [{ kind: 'exec', target: r.argv.join(' '), reversible: false, detail: `runs the repo's recipe in ${cwd}` }]
          };
        }
        // Child output streams to the terminal; no result document follows.
        await execTarget(r.argv, targetName, r.tool, cwd);
        return undefined;
      }
    }
  };
}

/** Find `targetName` in a detected build file; its tool, argv and file. */
function resolveTarget(
  buildTools: BuildTool[], ctx: StrategyContext, targetName: string
): { tool: string; argv: string[]; file: string } {
  const files = ctx.globFiles('**/*');
  for (const tool of buildTools) {
    const buildFile = tool.detect(files);
    if (!buildFile) continue;
    const metadata = ctx.getMetadata(buildFile, 'build');
    if (!metadata || !metadata.targets) continue;
    if (!metadata.targets.find((t: any) => t.name === targetName)) continue;
    const argvFor: Record<string, string[]> = {
      make: ['make', targetName],
      npm: ['npm', 'run', targetName],
      just: ['just', targetName],
      task: ['task', targetName],
    };
    return { tool: metadata.buildTool, argv: argvFor[metadata.buildTool] ?? [targetName], file: buildFile };
  }
  throw new NotFoundError(`Target "${targetName}" not found in any build file`);
}

/**
 * Run a build target: argv array (never a shell string), project root as
 * cwd, inherited stdio. The child's exit code becomes the process exit
 * code; a signal exits 1 with a message; a missing build tool exits 3.
 */
async function execTarget(argv: string[], target: string, tool: string, cwd: string): Promise<void> {
  if (!['make', 'npm', 'just', 'task'].includes(tool)) {
    throw new UsageError(`Cannot run target "${target}": unknown build tool "${tool}"`);
  }
  const [bin, ...args] = argv;
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      throw new NotFoundError(`Build tool "${bin}" not found on PATH`, err);
    }
    throw err;
  });
  if (result.signal) {
    throw new Error(`"${argv.join(' ')}" was terminated by signal ${result.signal}`);
  }
  if (result.code) process.exitCode = result.code;
}
