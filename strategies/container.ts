// strategies/container.ts
import { Strategy, StrategyContext, FileMetadata, StrategyCommand } from '../src/lib/strategy/types';
import * as yaml from 'js-yaml';

interface BuildStage {
  name?: string;
  from: string;
  commands: DockerCommand[];
}

interface DockerCommand {
  instruction: string;
  args: string[];
}

interface Service {
  name: string;
  image?: string;
  build?: string | { context: string; dockerfile?: string };
  ports?: string[];
  dependsOn?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  networks?: string[];
}

export default class ContainerStrategy implements Strategy {
  name = 'container';
  description = 'Inspect Dockerfiles and docker-compose services';
  version = '0.1.0';

  commands: Record<string, StrategyCommand> = {
    analyze: {
      description: 'Analyze container configuration',
      handler: async (ctx: StrategyContext) => {
        return this.analyzeContainers(ctx);
      }
    },
    services: {
      description: 'Show docker-compose services',
      handler: async (ctx: StrategyContext) => {
        return this.listServices(ctx);
      }
    },
    stages: {
      description: 'Show Dockerfile build stages',
      handler: async (ctx: StrategyContext) => {
        return this.listStages(ctx);
      }
    }
  };

  async detect(ctx: StrategyContext): Promise<boolean> {
    return ctx.hasFiles('Dockerfile') ||
           ctx.hasFiles('docker-compose.yml') ||
           ctx.hasFiles('docker-compose.yaml') ||
           ctx.hasFiles('compose.yml') ||
           ctx.hasFiles('compose.yaml') ||
           ctx.hasFiles('Containerfile');
  }

  fileTypes(): string[] {
    return [
      'Dockerfile',
      '*.dockerfile',
      'Containerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      'docker-compose.override.yml',
      'compose.yml',
      'compose.yaml'
    ];
  }

  ignorePatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);

    if (file.includes('compose') || file.endsWith('docker-compose.yml') || file.endsWith('docker-compose.yaml')) {
      return this.analyzeCompose(file, content);
    } else {
      return this.analyzeDockerfile(file, content);
    }
  }

  private analyzeDockerfile(file: string, content: string): FileMetadata {
    const lines = content.split('\n');
    const stages: BuildStage[] = [];
    let currentStage: BuildStage | null = null;

    const exposedPorts: number[] = [];
    const env: Record<string, string> = {};
    const volumes: string[] = [];
    const args: string[] = [];
    let entrypoint: string[] | undefined;
    let cmd: string[] | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Handle line continuations with backslash
      let fullLine = trimmed;

      // Parse instruction and arguments
      const spaceIdx = fullLine.search(/\s/);
      if (spaceIdx === -1) continue;

      const instruction = fullLine.substring(0, spaceIdx).toUpperCase();
      const argsStr = fullLine.substring(spaceIdx + 1).trim();

      if (instruction === 'FROM') {
        // Parse FROM instruction
        // Format: FROM image[:tag] [AS name]
        const asMatch = argsStr.match(/^(.+?)\s+[Aa][Ss]\s+(\S+)$/);

        currentStage = {
          name: asMatch ? asMatch[2] : undefined,
          from: asMatch ? asMatch[1] : argsStr,
          commands: []
        };
        stages.push(currentStage);
      } else if (instruction === 'ARG' && !currentStage) {
        // Handle ARG before FROM (global build args)
        const parsedArgs = this.parseArgs(argsStr);
        parsedArgs.forEach(arg => {
          const argName = arg.split('=')[0];
          args.push(argName);
        });
      } else if (currentStage) {
        const parsedArgs = this.parseArgs(argsStr);
        currentStage.commands.push({
          instruction,
          args: parsedArgs
        });

        // Extract metadata from commands
        if (instruction === 'EXPOSE') {
          parsedArgs.forEach(p => {
            const port = parseInt(p.split('/')[0]);
            if (!isNaN(port)) {
              exposedPorts.push(port);
            }
          });
        } else if (instruction === 'ENV') {
          // ENV can be in format: ENV KEY value or ENV KEY=value
          if (parsedArgs.length === 1 && parsedArgs[0].includes('=')) {
            const [key, ...valueParts] = parsedArgs[0].split('=');
            env[key] = valueParts.join('=');
          } else if (parsedArgs.length >= 2) {
            const [key, ...valueParts] = parsedArgs;
            env[key] = valueParts.join(' ');
          }
        } else if (instruction === 'VOLUME') {
          // VOLUME can be in JSON array format or space-separated
          if (argsStr.startsWith('[')) {
            try {
              const volumeArray = JSON.parse(argsStr);
              volumes.push(...volumeArray);
            } catch {
              volumes.push(argsStr);
            }
          } else {
            volumes.push(...parsedArgs);
          }
        } else if (instruction === 'ARG') {
          // ARG can be ARG name or ARG name=default
          parsedArgs.forEach(arg => {
            const argName = arg.split('=')[0];
            args.push(argName);
          });
        } else if (instruction === 'ENTRYPOINT') {
          entrypoint = this.parseExecForm(argsStr);
        } else if (instruction === 'CMD') {
          cmd = this.parseExecForm(argsStr);
        }
      }
    }

    const tags = ['container:dockerfile'];
    stages.forEach((stage, i) => {
      if (stage.name) {
        tags.push(`stage:${stage.name}`);
      }
    });

    // If there's no ENTRYPOINT but there's a CMD, use CMD as entrypoint
    const finalEntrypoint = entrypoint || cmd;

    return {
      tags,
      metadata: {
        tool: 'dockerfile',
        stages,
        baseImages: stages.map(s => s.from),
        exposedPorts: exposedPorts.length > 0 ? exposedPorts : undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
        volumes: volumes.length > 0 ? volumes : undefined,
        args: args.length > 0 ? args : undefined,
        entrypoint: finalEntrypoint,
        ...(entrypoint && cmd && { cmd }),
        isMultiStage: stages.length > 1
      }
    };
  }

  private analyzeCompose(file: string, content: string): FileMetadata {
    const doc = yaml.load(content) as any;
    const services: Service[] = [];

    for (const [name, serviceDef] of Object.entries(doc.services || {})) {
      const svc = serviceDef as any;

      const service: Service = {
        name,
        image: svc.image,
        build: svc.build,
        ports: svc.ports || [],
        dependsOn: [],
        environment: svc.environment || {},
        volumes: svc.volumes || [],
        networks: svc.networks || []
      };

      // Handle depends_on which can be array or object
      if (Array.isArray(svc.depends_on)) {
        service.dependsOn = svc.depends_on;
      } else if (svc.depends_on && typeof svc.depends_on === 'object') {
        service.dependsOn = Object.keys(svc.depends_on);
      } else {
        service.dependsOn = [];
      }

      services.push(service);
    }

    const tags = ['container:compose', ...services.map(s => `service:${s.name}`)];

    return {
      tags,
      metadata: {
        tool: 'docker-compose',
        services,
        networks: Object.keys(doc.networks || {}),
        volumes: Object.keys(doc.volumes || {})
      }
    };
  }

  private parseArgs(argsStr: string): string[] {
    // Simple argument parser that handles quoted strings
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];

      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuote) {
        inQuote = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuote) {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  private parseExecForm(argsStr: string): string[] {
    // Try to parse as JSON array (exec form)
    if (argsStr.startsWith('[')) {
      try {
        const parsed = JSON.parse(argsStr);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to shell form
      }
    }

    // Shell form - parse as arguments
    return this.parseArgs(argsStr);
  }

  // Command handlers
  private async analyzeContainers(ctx: StrategyContext): Promise<any> {
    const result: any = {
      dockerfiles: [],
      composeFiles: []
    };

    // Find all Dockerfiles
    const dockerfiles = await ctx.findFiles({ pattern: 'Dockerfile' });
    for (const file of dockerfiles) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata) {
        result.dockerfiles.push({
          file,
          ...metadata
        });
      }
    }

    // Find all docker-compose files
    const composeFiles = await ctx.findFiles({ tagged: 'container:compose' });
    for (const file of composeFiles) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata) {
        result.composeFiles.push({
          file,
          ...metadata
        });
      }
    }

    return result;
  }

  private async listServices(ctx: StrategyContext): Promise<any[]> {
    const files = await ctx.findFiles({ tagged: 'container:compose' });
    const services: any[] = [];

    for (const file of files) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata?.services) {
        for (const service of metadata.services) {
          services.push({
            ...service,
            file
          });
        }
      }
    }

    return services;
  }

  private async listStages(ctx: StrategyContext): Promise<any[]> {
    const files = await ctx.findFiles({ tagged: 'container:dockerfile' });
    const stages: any[] = [];

    for (const file of files) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata?.stages) {
        for (const stage of metadata.stages) {
          stages.push({
            ...stage,
            file
          });
        }
      }
    }

    return stages;
  }
}
