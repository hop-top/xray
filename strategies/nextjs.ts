// strategies/nextjs.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import Parser from 'tree-sitter';
import { requireGrammarModule } from '../src/lib/parser/grammars';

export default class NextjsStrategy implements Strategy {
  name = 'nextjs';
  version = '0.1.0';
  // Grammar is optional (language pack): detection is skipped when absent.
  requiresLanguages = ['typescript'];
  private parser?: Parser;

  // Lazy: see go-cli. TSX grammar covers both .tsx and .jsx (JSX syntax).
  private getParser(): Parser {
    if (!this.parser) {
      this.parser = new Parser();
      this.parser.setLanguage(requireGrammarModule('typescript').tsx);
    }
    return this.parser;
  }

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Check for Next.js dependency
    const hasNext = ctx.hasDependency('next') || ctx.hasDevDependency('next');

    // Check for Next.js config files
    const hasNextConfig = ctx.hasFiles('next.config.{js,ts,mjs}');

    // Check for app/ or pages/ directory (Next.js routing)
    const hasAppDir = ctx.hasFiles('app/**/page.{js,jsx,ts,tsx}');
    const hasPagesDir = ctx.hasFiles('pages/**/*.{js,jsx,ts,tsx}');

    // Detect if any of these conditions are met
    return hasNext || hasNextConfig || hasAppDir || hasPagesDir;
  }

  fileTypes(): string[] {
    return ['.jsx', '.tsx', '.ts', '.js'];
  }

  ignorePatterns(): string[] {
    return [
      '**/*.test.{js,jsx,ts,tsx}',
      '**/*.spec.{js,jsx,ts,tsx}',
      '**/__tests__/**',
      '**/node_modules/**',
      '**/.next/**'
    ];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];
    const metadata: Record<string, any> = {};

    return {
      tags,
      exports: [],
      imports: [],
      metadata
    };
  }
}
