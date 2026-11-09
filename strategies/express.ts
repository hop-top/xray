// strategies/express.ts
import { Strategy, StrategyContext, FileMetadata, StrategyCommand } from '../src/lib/strategy/types';

export default class ExpressStrategy implements Strategy {
  name = 'express';
  description = 'Inspect Express routes, routers, middleware and error handlers';
  version = '0.1.0';

  commands: Record<string, StrategyCommand> = {
    routes: {
      description: 'List all Express routes',
      handler: async (ctx: StrategyContext) => {
        return this.listRoutes(ctx);
      }
    },
    routers: {
      description: 'List all Express Router instances',
      handler: async (ctx: StrategyContext) => {
        return this.listRouters(ctx);
      }
    },
    middleware: {
      description: 'List all Express middleware',
      handler: async (ctx: StrategyContext) => {
        return this.listMiddleware(ctx);
      }
    },
    'error-handlers': {
      description: 'List all Express error handlers',
      handler: async (ctx: StrategyContext) => {
        return this.listErrorHandlers(ctx);
      }
    }
  };

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Check for Express dependency in package.json
    if (ctx.hasDependency('express')) {
      return true;
    }

    // Check for Express patterns in JavaScript/TypeScript files
    const jsFiles = ctx.globFiles('**/*.{js,ts,jsx,tsx}');
    for (const file of jsFiles) {
      const content = await ctx.readFile(file);

      // Check for express() instantiation
      if (content.includes('express()') || content.includes('= express()')) {
        return true;
      }

      // Check for app.listen() - common Express pattern
      if (content.includes('app.listen(') || content.includes('.listen(')) {
        return true;
      }

      // Check for Express imports
      if (content.includes('require(\'express\')') ||
          content.includes('require("express")') ||
          content.includes('from \'express\'') ||
          content.includes('from "express"')) {
        return true;
      }
    }

    return false;
  }

  fileTypes(): string[] {
    return ['.js', '.ts', '.jsx', '.tsx'];
  }

  ignorePatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/*.test.js',
      '**/*.test.ts',
      '**/*.spec.js',
      '**/*.spec.ts',
      '**/dist/**',
      '**/build/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];
    const metadata: Record<string, any> = {};

    // Detect Express routes
    const routes = this.detectRoutes(content);
    if (routes.length > 0) {
      tags.push('express:route');
      metadata.routes = routes;
    }

    // Detect Router instances
    const routers = this.detectRouters(content);
    if (routers.length > 0) {
      tags.push('express:router');
      metadata.routers = routers;
    }

    // Detect router mounting
    const routerMounts = this.detectRouterMounts(content);
    if (routerMounts.length > 0) {
      tags.push('express:router-mount');
      metadata.routerMounts = routerMounts;
    }

    // Detect middleware
    const middleware = this.detectMiddleware(content);
    if (middleware.length > 0) {
      tags.push('express:middleware');
      metadata.middleware = middleware;
    }

    // Detect error handlers
    const errorHandlers = this.detectErrorHandlers(content);
    if (errorHandlers.length > 0) {
      tags.push('express:error-handler');
      metadata.errorHandlers = errorHandlers;
    }

    return {
      tags,
      exports: [],
      imports: [],
      metadata
    };
  }

  private detectRoutes(content: string): Array<{ method: string; path: string; handler?: string; middlewareChain?: string[] }> {
    const routes: Array<{ method: string; path: string; handler?: string; middlewareChain?: string[] }> = [];

    // Pattern: Find route definitions and extract everything until the closing parenthesis
    const routePattern = /\b\w+\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g;

    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];

      // Find the matching closing parenthesis by counting
      // We need to find the opening paren of the route call first
      let openParenIdx = content.lastIndexOf('(', match.index + match[0].length);
      let startIdx = match.index + match[0].length;
      let depth = 0;
      let endIdx = startIdx;

      for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '(') depth++;
        if (content[i] === ')') {
          if (depth === 0) {
            endIdx = i;
            break;
          }
          depth--;
        }
      }

      const handlersStr = content.substring(startIdx, endIdx);

      // Extract middleware chain by splitting carefully and extracting function names
      const handlers: string[] = [];
      let current = '';
      let parenDepth = 0;

      for (let i = 0; i < handlersStr.length; i++) {
        const char = handlersStr[i];
        if (char === '(') parenDepth++;
        if (char === ')') parenDepth--;

        if (char === ',' && parenDepth === 0) {
          if (current.trim()) handlers.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) handlers.push(current.trim());

      // Separate middleware from handler
      // If last item is an inline function/arrow function, all named functions are middleware
      // Otherwise, last named function is the handler, rest are middleware
      const hasInlineHandler = handlers.length > 0 &&
        (handlers[handlers.length - 1].includes('=>') || handlers[handlers.length - 1].startsWith('function'));

      const namedFunctions = handlers
        .filter(h => !h.includes('=>') && !h.startsWith('function'))
        .map(h => {
          const match = h.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
          return match?.[1];
        })
        .filter(Boolean) as string[];

      if (hasInlineHandler && namedFunctions.length > 0) {
        // All named functions are middleware
        routes.push({
          method,
          path,
          middlewareChain: namedFunctions
        });
      } else if (namedFunctions.length > 0) {
        // Last named function is handler, rest are middleware
        const handler = namedFunctions[namedFunctions.length - 1];
        const middlewareChain = namedFunctions.length > 1 ? namedFunctions.slice(0, -1) : undefined;

        routes.push({
          method,
          path,
          handler,
          ...(middlewareChain && middlewareChain.length > 0 && { middlewareChain })
        });
      } else {
        // No named handlers, just add route with method and path
        routes.push({ method, path });
      }
    }

    return routes;
  }

  private detectRouters(content: string): Array<{ variable: string }> {
    const routers: Array<{ variable: string }> = [];

    // Pattern: const router = express.Router() or var router = Router()
    const routerPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:express\.)?Router\s*\(\s*\)/g;

    let match;
    while ((match = routerPattern.exec(content)) !== null) {
      const variable = match[1];
      routers.push({ variable });
    }

    return routers;
  }

  private detectRouterMounts(content: string): Array<{ path: string; router: string }> {
    const mounts: Array<{ path: string; router: string }> = [];

    // Pattern: app.use('/path', routerVariable)
    const mountPattern = /\b\w+\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\s*\)/g;

    let match;
    while ((match = mountPattern.exec(content)) !== null) {
      const path = match[1];
      const router = match[2];
      mounts.push({ path, router });
    }

    return mounts;
  }

  private detectMiddleware(content: string): Array<{ name?: string; path?: string }> {
    const middleware: Array<{ name?: string; path?: string }> = [];

    // Pattern 1: app.use(middleware) - global middleware
    const globalPattern = /\b\w+\.use\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$.()]{0,127}(?:\([^)]{0,511}\))?)\s*\)/g;

    let match;
    while ((match = globalPattern.exec(content)) !== null) {
      const name = match[1];
      // Skip if it looks like a router mount (has a path string before it)
      const beforeMatch = content.substring(Math.max(0, match.index - 50), match.index);
      if (!beforeMatch.includes('\'') && !beforeMatch.includes('"') && !beforeMatch.includes('`')) {
        middleware.push({ name });
      }
    }

    // Pattern 2: app.use('/path', middleware) - path-specific middleware
    const pathPattern = /\b\w+\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([a-zA-Z_$][a-zA-Z0-9_$.()]{0,127}(?:\([^)]{0,511}\))?)\s*\)/g;

    while ((match = pathPattern.exec(content)) !== null) {
      const path = match[1];
      const name = match[2];
      // Only add if it's not a router variable (router mounts are handled separately)
      if (!name.match(/^[a-z][a-zA-Z]*Router$/)) {
        middleware.push({ name, path });
      }
    }

    return middleware;
  }

  private detectErrorHandlers(content: string): Array<{ name?: string; type: 'inline' | 'named' }> {
    const errorHandlers: Array<{ name?: string; type: 'inline' | 'named' }> = [];

    // Pattern 1: Inline error handler with 4 parameters (err, req, res, next)
    // app.use((err, req, res, next) => { ... })
    const inlinePattern = /\b\w+\.use\s*\(\s*\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)\s*=>/g;
    if (inlinePattern.test(content)) {
      errorHandlers.push({ type: 'inline' });
    }

    // Pattern 2: Inline error handler with function keyword
    // app.use(function(err, req, res, next) { ... })
    const inlineFunctionPattern = /\b\w+\.use\s*\(\s*function\s*\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)/g;
    if (inlineFunctionPattern.test(content)) {
      errorHandlers.push({ type: 'inline' });
    }

    // Names passed bare to `.use(name)`, collected in one linear pass so each
    // handler is a Set lookup rather than another scan of the file.
    const usedNames = new Set<string>();
    const useArgPattern = /\b\w+\.use\s*\(\s*(\w+)\s*\)/g;
    let match;
    while ((match = useArgPattern.exec(content)) !== null) usedNames.add(match[1]);

    // Pattern 3: Named error handler function definition
    // function errorHandler(err, req, res, next) { ... }
    const namedFunctionPattern = /function\s+(\w+)\s*\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)/g;
    while ((match = namedFunctionPattern.exec(content)) !== null) {
      const name = match[1];
      if (usedNames.has(name)) errorHandlers.push({ name, type: 'named' });
    }

    // Pattern 4: Arrow function error handler
    // const errorHandler = (err, req, res, next) => { ... }
    const arrowFunctionPattern = /(?:const|let|var)\s+(\w+)\s*=\s*\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)\s*=>/g;
    while ((match = arrowFunctionPattern.exec(content)) !== null) {
      const name = match[1];
      if (usedNames.has(name)) errorHandlers.push({ name, type: 'named' });
    }

    return errorHandlers;
  }

  // Command handlers
  private async listRoutes(ctx: StrategyContext): Promise<any[]> {
    const files = await ctx.findFiles({ tagged: 'express:route' });
    const routes: any[] = [];

    for (const file of files) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata?.routes) {
        for (const route of metadata.routes) {
          routes.push({
            method: route.method,
            path: route.path,
            file,
            ...(route.handler && { handler: route.handler }),
            ...(route.middlewareChain && { middleware: route.middlewareChain })
          });
        }
      }
    }

    return routes;
  }

  private async listRouters(ctx: StrategyContext): Promise<any[]> {
    const files = await ctx.findFiles({ tagged: 'express:router' });
    const routers: any[] = [];

    for (const file of files) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata?.routers) {
        for (const router of metadata.routers) {
          routers.push({
            variable: router.variable,
            file
          });
        }
      }
    }

    // Also include router mounts
    const mountFiles = await ctx.findFiles({ tagged: 'express:router-mount' });
    for (const file of mountFiles) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata?.routerMounts) {
        for (const mount of metadata.routerMounts) {
          routers.push({
            path: mount.path,
            router: mount.router,
            file,
            type: 'mount'
          });
        }
      }
    }

    return routers;
  }

  private async listMiddleware(ctx: StrategyContext): Promise<any[]> {
    const files = await ctx.findFiles({ tagged: 'express:middleware' });
    const middleware: any[] = [];

    for (const file of files) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata?.middleware) {
        for (const mw of metadata.middleware) {
          middleware.push({
            name: mw.name,
            ...(mw.path && { path: mw.path }),
            file
          });
        }
      }
    }

    return middleware;
  }

  private async listErrorHandlers(ctx: StrategyContext): Promise<any[]> {
    const files = await ctx.findFiles({ tagged: 'express:error-handler' });
    const errorHandlers: any[] = [];

    for (const file of files) {
      const metadata = ctx.getMetadata(file, this.name);
      if (metadata?.errorHandlers) {
        for (const handler of metadata.errorHandlers) {
          errorHandlers.push({
            ...(handler.name && { name: handler.name }),
            type: handler.type,
            file
          });
        }
      }
    }

    return errorHandlers;
  }
}
