// strategies/rest-api.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';

export default class RestApiStrategy implements Strategy {
  name = 'rest-api';
  description = 'Inspect REST API endpoints and middleware across frameworks';
  version = '0.1.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Check for Express.js (Node.js)
    if (ctx.hasDependency('express') || ctx.hasDependency('fastify') || ctx.hasDependency('koa')) {
      return true;
    }

    // Check for Flask/FastAPI/Django (Python)
    const pythonFiles = ctx.globFiles('**/*.py');
    for (const file of pythonFiles) {
      const content = await ctx.readFile(file);
      if (
        content.includes('from fastapi import') ||
        content.includes('from flask import') ||
        content.includes('from django.') ||
        content.includes('import fastapi') ||
        content.includes('import flask') ||
        content.includes('import django')
      ) {
        return true;
      }
    }

    // Check for Go HTTP handlers
    const goFiles = ctx.globFiles('**/*.go');
    for (const file of goFiles) {
      const content = await ctx.readFile(file);
      if (
        content.includes('net/http') ||
        content.includes('github.com/gin-gonic/gin') ||
        content.includes('github.com/gorilla/mux') ||
        content.includes('github.com/labstack/echo')
      ) {
        return true;
      }
    }

    return false;
  }

  fileTypes(): string[] {
    return ['.js', '.ts', '.jsx', '.tsx', '.py', '.go'];
  }

  ignorePatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/__pycache__/**',
      '**/vendor/**',
      '**/*.test.js',
      '**/*.test.ts',
      '**/*.spec.js',
      '**/*.spec.ts',
      '**/*_test.go',
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];
    const metadata: Record<string, any> = {};
    const endpoints: Array<{ method: string; path: string; handler?: string }> = [];

    // Detect Express routes (JavaScript/TypeScript)
    if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.jsx') || file.endsWith('.tsx')) {
      const expressEndpoints = this.detectExpressRoutes(content);
      endpoints.push(...expressEndpoints);
    }

    // Detect FastAPI routes (Python)
    if (file.endsWith('.py')) {
      const fastapiEndpoints = this.detectFastAPIRoutes(content);
      endpoints.push(...fastapiEndpoints);
    }

    // Detect Go HTTP handlers
    if (file.endsWith('.go')) {
      const goEndpoints = this.detectGoHTTPHandlers(content);
      endpoints.push(...goEndpoints);
    }

    if (endpoints.length > 0) {
      tags.push('rest-api:endpoint');
      metadata.endpoints = endpoints;
    }

    return {
      tags,
      exports: [],
      imports: [],
      metadata
    };
  }

  private detectExpressRoutes(content: string): Array<{ method: string; path: string; handler?: string }> {
    const endpoints: Array<{ method: string; path: string; handler?: string }> = [];

    // Pattern: app.get('/path', ...) or router.post('/path', ...)
    // Matches: app.METHOD, router.METHOD, someVar.METHOD where METHOD is get, post, put, delete, patch
    const routePattern = /\b\w+\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g;

    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];

      endpoints.push({
        method,
        path
      });
    }

    return endpoints;
  }

  private detectFastAPIRoutes(content: string): Array<{ method: string; path: string; handler?: string }> {
    const endpoints: Array<{ method: string; path: string; handler?: string }> = [];

    // Pattern: @app.get("/path") or @router.post("/path")
    // Matches: @app.METHOD, @router.METHOD, @someVar.METHOD where METHOD is get, post, put, delete, patch
    const decoratorPattern = /@\w+\.(get|post|put|delete|patch|head|options)\s*\(\s*['"]([^'"]+)['"]/g;

    let match;
    while ((match = decoratorPattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];

      endpoints.push({
        method,
        path
      });
    }

    return endpoints;
  }

  private detectGoHTTPHandlers(content: string): Array<{ method: string; path: string; handler?: string }> {
    const endpoints: Array<{ method: string; path: string; handler?: string }> = [];

    // Pattern 1: http.HandleFunc("/path", handler) or mux.HandleFunc("/path", handler)
    const handleFuncPattern = /\b\w+\.HandleFunc\s*\(\s*"([^"]+)"\s*,/g;
    let match;
    while ((match = handleFuncPattern.exec(content)) !== null) {
      const path = match[1];
      endpoints.push({ method: '', path });
    }

    // Pattern 2: .Methods("GET") - extract method from chained Methods() call
    const methodsPattern = /\.HandleFunc\s*\(\s*"([^"]+)"\s*,[^)]{1,1000}\)\s*\.Methods\s*\(\s*"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)"/g;
    while ((match = methodsPattern.exec(content)) !== null) {
      const path = match[1];
      const method = match[2];

      // Find and update existing endpoint or add new one
      const existing = endpoints.find(e => e.path === path && !e.method);
      if (existing) {
        existing.method = method;
      } else {
        endpoints.push({ method, path });
      }
    }

    // Pattern 3: http.Handle("GET /path", handler) - Go 1.22+ pattern with method in path
    const handleWithMethodPattern = /\.Handle\s*\(\s*"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^"]+)"/g;
    while ((match = handleWithMethodPattern.exec(content)) !== null) {
      const method = match[1];
      const path = match[2];
      endpoints.push({ method, path });
    }

    return endpoints;
  }

  commands = {
    'endpoints': {
      description: 'List all REST API endpoints across all frameworks',
      async handler(ctx: StrategyContext) {
        const files = await ctx.findFiles({ tagged: 'rest-api:endpoint' });
        const endpoints: Array<{ method: string; path: string; file: string; framework?: string }> = [];

        const detectFramework = (file: string): string => {
          if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.jsx') || file.endsWith('.tsx')) {
            return 'Express/Node.js';
          }
          if (file.endsWith('.py')) {
            return 'FastAPI/Flask/Django';
          }
          if (file.endsWith('.go')) {
            return 'Go HTTP';
          }
          return 'Unknown';
        };

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'rest-api');
          if (metadata?.endpoints) {
            const framework = detectFramework(file);
            for (const endpoint of metadata.endpoints) {
              endpoints.push({
                method: endpoint.method,
                path: endpoint.path,
                file,
                framework
              });
            }
          }
        }

        return endpoints;
      }
    },
    'methods': {
      description: 'List endpoints grouped by HTTP method',
      async handler(ctx: StrategyContext) {
        const files = await ctx.findFiles({ tagged: 'rest-api:endpoint' });
        const byMethod: Record<string, Array<{ path: string; file: string }>> = {};

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'rest-api');
          if (metadata?.endpoints) {
            for (const endpoint of metadata.endpoints) {
              const method = endpoint.method || 'UNKNOWN';
              if (!byMethod[method]) {
                byMethod[method] = [];
              }
              byMethod[method].push({
                path: endpoint.path,
                file
              });
            }
          }
        }

        return byMethod;
      }
    },
    'middleware': {
      description: 'List middleware and interceptors',
      async handler(ctx: StrategyContext) {
        const files = await ctx.findFiles({ tagged: 'rest-api:middleware' });
        const middleware: Array<{ name: string; file: string }> = [];

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'rest-api');
          if (metadata?.middleware) {
            for (const mw of metadata.middleware) {
              middleware.push({
                name: mw.name,
                file
              });
            }
          }
        }

        return middleware;
      }
    }
  };
}
