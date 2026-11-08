// strategies/cicd.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import { CICDPlatform } from '../src/lib/strategy/cicd/types';
import { githubActionsPlatform } from '../src/lib/strategy/cicd/parsers/github-actions';
import { gitlabCIPlatform } from '../src/lib/strategy/cicd/parsers/gitlab-ci';
import { circleCIPlatform } from '../src/lib/strategy/cicd/parsers/circleci';

/**
 * CI/CD Strategy
 *
 * Unified strategy for detecting and analyzing CI/CD configurations:
 * - GitHub Actions (.github/workflows/*.yml)
 * - GitLab CI (.gitlab-ci.yml)
 * - CircleCI (.circleci/config.yml)
 *
 * Provides a unified interface to understand pipelines, workflows, jobs,
 * and deployment processes regardless of which CI/CD platform is used.
 */
export default class CICDStrategy implements Strategy {
  name = 'cicd';
  description = 'Inspect CI/CD workflows, triggers and deployments';
  version = '0.1.0';

  private cicdPlatforms: CICDPlatform[] = [
    githubActionsPlatform,
    gitlabCIPlatform,
    circleCIPlatform
  ];

  async detect(ctx: StrategyContext): Promise<boolean> {
    const files = ctx.globFiles('**/*');
    return this.cicdPlatforms.some(platform => platform.detect(files) !== null);
  }

  fileTypes(): string[] {
    return [
      '.github/workflows/*.yml',
      '.github/workflows/*.yaml',
      '.gitlab-ci.yml',
      '.circleci/config.yml'
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

    // Find matching platform for this file
    const platform = this.cicdPlatforms.find(p => {
      const detected = p.detect([file]);
      return detected && detected.includes(file);
    });

    if (!platform) {
      return { tags: [], metadata: {} };
    }

    // Parse with platform-specific parser
    const config = platform.parse(file, content);

    // Extract tags (workflows and jobs)
    const tags: string[] = [];
    for (const workflow of config.workflows) {
      tags.push(`workflow:${workflow.name}`);
      for (const job of workflow.jobs) {
        tags.push(`job:${workflow.name}:${job.name}`);
      }
    }

    return {
      tags,
      metadata: {
        platform: config.platform,
        workflows: config.workflows
      }
    };
  }

  commands = {
    workflows: {
      description: 'Show all CI/CD workflows',
      handler: async (ctx: StrategyContext) => {
        const results: any[] = [];
        const files = ctx.globFiles('**/*');

        // Find all CI/CD files
        for (const platform of this.cicdPlatforms) {
          const detected = platform.detect(files);
          if (detected) {
            for (const file of detected) {
              const metadata = ctx.getMetadata(file, 'cicd');
              if (metadata && metadata.workflows) {
                for (const workflow of metadata.workflows) {
                  results.push({
                    platform: metadata.platform,
                    name: workflow.name,
                    file: workflow.file,
                    triggers: workflow.triggers,
                    jobs: workflow.jobs,
                    schedule: workflow.schedule
                  });
                }
              }
            }
          }
        }

        return results;
      }
    },

    graph: {
      description: 'Show CI/CD pipeline dependency graph',
      handler: async (ctx: StrategyContext, opts?: any) => {
        const nodes: any[] = [];
        const edges: any[] = [];
        const files = ctx.globFiles('**/*');

        // Collect all jobs and their dependencies
        for (const platform of this.cicdPlatforms) {
          const detected = platform.detect(files);
          if (detected) {
            for (const file of detected) {
              const metadata = ctx.getMetadata(file, 'cicd');
              if (metadata && metadata.workflows) {
                for (const workflow of metadata.workflows) {
                  // Add nodes for each job
                  for (const job of workflow.jobs) {
                    nodes.push({
                      id: `${workflow.name}:${job.name}`,
                      label: job.name,
                      workflow: workflow.name,
                      platform: metadata.platform
                    });
                  }

                  // Add edges for dependencies
                  for (const job of workflow.jobs) {
                    for (const dep of job.dependsOn) {
                      edges.push({
                        from: `${workflow.name}:${job.name}`,
                        to: `${workflow.name}:${dep}`
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // If DOT format requested
        if (opts && opts.format === 'dot') {
          let dot = 'digraph cicd {\n';
          for (const edge of edges) {
            dot += `  "${edge.from}" -> "${edge.to}"\n`;
          }
          dot += '}';
          return { format: 'dot', content: dot };
        }

        return { nodes, edges };
      }
    },

    deploy: {
      description: 'Show deployment workflows',
      handler: async (ctx: StrategyContext) => {
        const results: any[] = [];
        const files = ctx.globFiles('**/*');

        // Find all CI/CD files and filter deployment-related jobs
        for (const platform of this.cicdPlatforms) {
          const detected = platform.detect(files);
          if (detected) {
            for (const file of detected) {
              const metadata = ctx.getMetadata(file, 'cicd');
              if (metadata && metadata.workflows) {
                for (const workflow of metadata.workflows) {
                  for (const job of workflow.jobs) {
                    // Check if job is deployment-related
                    const isDeployJob = job.name.toLowerCase().includes('deploy') ||
                                       job.name.toLowerCase().includes('release') ||
                                       job.name.toLowerCase().includes('publish') ||
                                       job.environment !== undefined;

                    if (isDeployJob) {
                      results.push({
                        workflow: workflow.name,
                        job: job.name,
                        platform: metadata.platform,
                        file: workflow.file,
                        environment: job.environment,
                        dependsOn: job.dependsOn,
                        condition: job.condition,
                        steps: job.steps
                      });
                    }
                  }
                }
              }
            }
          }
        }

        return results;
      }
    },

    triggers: {
      description: 'Show what triggers each workflow',
      handler: async (ctx: StrategyContext) => {
        const results: any[] = [];
        const files = ctx.globFiles('**/*');

        // Find all CI/CD files
        for (const platform of this.cicdPlatforms) {
          const detected = platform.detect(files);
          if (detected) {
            for (const file of detected) {
              const metadata = ctx.getMetadata(file, 'cicd');
              if (metadata && metadata.workflows) {
                for (const workflow of metadata.workflows) {
                  results.push({
                    workflow: workflow.name,
                    platform: metadata.platform,
                    file: workflow.file,
                    triggers: workflow.triggers,
                    schedule: workflow.schedule
                  });
                }
              }
            }
          }
        }

        return results;
      }
    }
  };
}
