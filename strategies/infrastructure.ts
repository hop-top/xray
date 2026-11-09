// strategies/infrastructure.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import { InfrastructureTool } from '../src/lib/strategy/infrastructure/types';
import { terraformTool } from '../src/lib/strategy/infrastructure/parsers/terraform';
import { kubernetesTool } from '../src/lib/strategy/infrastructure/parsers/kubernetes';
import { helmTool } from '../src/lib/strategy/infrastructure/parsers/helm';
import { cloudFormationTool } from '../src/lib/strategy/infrastructure/parsers/cloudformation';

export default class InfrastructureStrategy implements Strategy {
  name = 'infrastructure';
  description = 'Inspect infrastructure-as-code resources, providers and dependencies';
  version = '0.1.0';

  private tools: InfrastructureTool[] = [
    terraformTool,
    helmTool,
    cloudFormationTool,
    kubernetesTool
  ];

  /**
   * Assign each file to the first tool (in priority order) whose detect()
   * claims it. Detectors overlap (any .yaml matches kubernetes, templates
   * match cloudformation); analyze() already stores one result per file under
   * the first match, so listing must use the same owner or the file's
   * resources are emitted once per overlapping tool.
   */
  private claimFiles(files: string[]): Map<InfrastructureTool, string[] | null> {
    const claimed = new Set<string>();
    const owned = new Map<InfrastructureTool, string[] | null>();
    for (const tool of this.tools) {
      const mine = (tool.detect(files) ?? []).filter(f => !claimed.has(f));
      mine.forEach(f => claimed.add(f));
      owned.set(tool, mine.length > 0 ? mine : null);
    }
    return owned;
  }

  async detect(ctx: StrategyContext): Promise<boolean> {
    const files = ctx.globFiles('**/*');
    return this.tools.some(tool => tool.detect(files) !== null);
  }

  fileTypes(): string[] {
    return [
      '.tf',
      '.yaml',
      '.yml',
      'Chart.yaml',
      'values.yaml',
      '.template.json',
      '.template.yaml',
      '.template.yml'
    ];
  }

  ignorePatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/.terraform/**',
      '**/.git/**',
      '**/vendor/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);

    const tool = this.tools.find(t => {
      const detected = t.detect([file]);
      return detected && detected.includes(file);
    });

    if (!tool) {
      return { tags: [], metadata: {} };
    }

    const config = tool.parse(file, content);

    const tags = config.resources.map(r => `infra:${r.type}`);

    return {
      tags,
      metadata: {
        tool: config.tool,
        resources: config.resources,
        variables: config.variables,
        outputs: config.outputs,
        dependencies: config.dependencies
      }
    };
  }

  commands = {
    resources: {
      description: 'List all infrastructure resources (options: type, tool, provider)',
      options: {
        'type': 'Filter by resource type (e.g., aws_instance, Deployment)',
        'tool': 'Filter by infrastructure tool (terraform, kubernetes, helm, cloudformation)',
        'provider': 'Filter by cloud provider (aws, google, azure)'
      },
      handler: async (ctx: StrategyContext, opts?: any) => {
        const results: any[] = [];
        const files = ctx.globFiles('**/*');
        const owned = this.claimFiles(files);

        for (const tool of this.tools) {
          const infraFiles = owned.get(tool);
          if (infraFiles) {
            for (const file of infraFiles) {
              const metadata = ctx.getMetadata(file, 'infrastructure');
              if (metadata && metadata.resources) {
                for (const resource of metadata.resources) {
                  results.push({
                    type: resource.type,
                    name: resource.name,
                    tool: metadata.tool,
                    file,
                    properties: resource.properties,
                    dependencies: resource.dependencies
                  });
                }
              }
            }
          }
        }

        // Apply filters if options provided
        let filtered = results;

        if (opts?.type) {
          filtered = filtered.filter(r => r.type === opts.type);
        }

        if (opts?.tool) {
          filtered = filtered.filter(r => r.tool === opts.tool);
        }

        if (opts?.provider) {
          filtered = filtered.filter(r => {
            const provider = extractProvider(r.type);
            return provider === opts.provider;
          });
        }

        return filtered;
      }
    },

    providers: {
      description: 'List cloud providers used',
      handler: async (ctx: StrategyContext) => {
        const providerMap = new Map<string, Set<string>>();
        const files = ctx.globFiles('**/*');
        const owned = this.claimFiles(files);

        for (const tool of this.tools) {
          const infraFiles = owned.get(tool);
          if (infraFiles) {
            for (const file of infraFiles) {
              const metadata = ctx.getMetadata(file, 'infrastructure');
              if (metadata && metadata.resources) {
                for (const resource of metadata.resources) {
                  const provider = extractProvider(resource.type);
                  if (provider) {
                    if (!providerMap.has(provider)) {
                      providerMap.set(provider, new Set());
                    }
                    providerMap.get(provider)!.add(resource.type);
                  }
                }
              }
            }
          }
        }

        const results = [];
        for (const [provider, types] of providerMap.entries()) {
          results.push({
            provider,
            count: types.size,
            resources: Array.from(types)
          });
        }

        return results;
      }
    },

    graph: {
      description: 'Generate infrastructure dependency graph',
      handler: async (ctx: StrategyContext, opts?: any) => {
        const nodes: any[] = [];
        const edges: any[] = [];
        const files = ctx.globFiles('**/*');
        const owned = this.claimFiles(files);

        for (const tool of this.tools) {
          const infraFiles = owned.get(tool);
          if (infraFiles) {
            for (const file of infraFiles) {
              const metadata = ctx.getMetadata(file, 'infrastructure');
              if (metadata && metadata.resources) {
                for (const resource of metadata.resources) {
                  const nodeId = `${resource.type}.${resource.name}`;
                  nodes.push({
                    id: nodeId,
                    label: resource.name,
                    type: resource.type,
                    tool: metadata.tool
                  });

                  if (resource.dependencies) {
                    for (const dep of resource.dependencies) {
                      edges.push({ from: nodeId, to: dep });
                    }
                  }
                }
              }
            }
          }
        }

        if (opts && opts.format === 'dot') {
          let dot = 'digraph infrastructure {\n';
          for (const edge of edges) {
            dot += `  ${edge.from} -> ${edge.to}\n`;
          }
          dot += '}';
          return { format: 'dot', content: dot };
        }

        return { nodes, edges };
      }
    },

    summary: {
      description: 'Infrastructure summary',
      handler: async (ctx: StrategyContext) => {
        const tools = new Set<string>();
        let totalResources = 0;
        const byTool: Record<string, number> = {};
        const files = ctx.globFiles('**/*');
        const owned = this.claimFiles(files);

        for (const tool of this.tools) {
          const infraFiles = owned.get(tool);
          if (infraFiles) {
            for (const file of infraFiles) {
              const metadata = ctx.getMetadata(file, 'infrastructure');
              if (metadata && metadata.resources) {
                tools.add(metadata.tool);
                totalResources += metadata.resources.length;
                byTool[metadata.tool] = (byTool[metadata.tool] || 0) + metadata.resources.length;
              }
            }
          }
        }

        return {
          tools: Array.from(tools),
          totalResources,
          byTool
        };
      }
    },

    validate: {
      description: 'Validate infrastructure configuration',
      handler: async (ctx: StrategyContext) => {
        const issues: any[] = [];
        const files = ctx.globFiles('**/*');
        const owned = this.claimFiles(files);
        const resourceMap = new Map<string, any>();

        // Collect all resources
        for (const tool of this.tools) {
          const infraFiles = owned.get(tool);
          if (infraFiles) {
            for (const file of infraFiles) {
              const metadata = ctx.getMetadata(file, 'infrastructure');
              if (metadata && metadata.resources) {
                for (const resource of metadata.resources) {
                  const resourceId = `${resource.type}.${resource.name}`;
                  resourceMap.set(resourceId, { ...resource, file, tool: metadata.tool });
                }
              }
            }
          }
        }

        // Check for missing dependencies
        for (const [resourceId, resource] of resourceMap.entries()) {
          if (resource.dependencies) {
            for (const dep of resource.dependencies) {
              if (!resourceMap.has(dep)) {
                issues.push({
                  type: 'missing-dependency',
                  severity: 'error',
                  resource: resourceId,
                  dependency: dep,
                  file: resource.file,
                  message: `Resource ${resourceId} depends on ${dep} which is not defined`
                });
              }
            }
          }
        }

        // Check for circular dependencies
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCircularDep = (resourceId: string): boolean => {
          if (!visited.has(resourceId)) {
            visited.add(resourceId);
            recursionStack.add(resourceId);

            const resource = resourceMap.get(resourceId);
            if (resource?.dependencies) {
              for (const dep of resource.dependencies) {
                if (!visited.has(dep) && hasCircularDep(dep)) {
                  return true;
                }
                if (recursionStack.has(dep)) {
                  issues.push({
                    type: 'circular-dependency',
                    severity: 'error',
                    resource: resourceId,
                    dependency: dep,
                    file: resource.file,
                    message: `Circular dependency detected: ${resourceId} -> ${dep}`
                  });
                  return true;
                }
              }
            }
          }

          recursionStack.delete(resourceId);
          return false;
        };

        for (const resourceId of resourceMap.keys()) {
          visited.clear();
          recursionStack.clear();
          hasCircularDep(resourceId);
        }

        return {
          valid: issues.length === 0,
          issues,
          resourceCount: resourceMap.size
        };
      }
    }
  };
}

function extractProvider(resourceType: string): string | null {
  if (resourceType.startsWith('aws_')) return 'aws';
  if (resourceType.startsWith('google_')) return 'google';
  if (resourceType.startsWith('azurerm_')) return 'azure';
  if (resourceType.startsWith('AWS::')) return 'aws';
  if (resourceType.startsWith('Google::')) return 'google';
  if (resourceType.startsWith('Azure::')) return 'azure';
  return null;
}
