// strategies/go-cli.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import Parser from 'tree-sitter';

// Use require for tree-sitter grammars as they are native modules
const Go = require('tree-sitter-go');

export default class GoCliStrategy implements Strategy {
  name = 'go-cli';
  version = '0.1.0';
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Go);
  }

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Check for CLI framework dependencies in go.mod
    const hasGoMod = ctx.hasFiles('go.mod');
    if (hasGoMod) {
      // Check for Cobra, urfave/cli dependencies
      const goModFiles = ctx.globFiles('go.mod');
      for (const file of goModFiles) {
        const content = await ctx.readFile(file);
        if (
          content.includes('github.com/spf13/cobra') ||
          content.includes('github.com/urfave/cli')
        ) {
          return true;
        }
      }
    }

    // Check for cmd/ directory (common CLI structure)
    const hasCmdDir = ctx.hasFiles('cmd/**/*.go');
    if (hasCmdDir) {
      return true;
    }

    // Check for main.go with flag package or CLI framework imports
    const goFiles = ctx.globFiles('**/*.go');
    for (const file of goFiles) {
      const content = await ctx.readFile(file);

      // Check for CLI framework imports
      if (
        content.includes('github.com/spf13/cobra') ||
        content.includes('github.com/urfave/cli') ||
        (content.includes('import') && content.includes('"flag"') && content.includes('func main()'))
      ) {
        return true;
      }
    }

    return false;
  }

  fileTypes(): string[] {
    return ['.go'];
  }

  ignorePatterns(): string[] {
    return [
      '**/*_test.go',
      '**/vendor/**',
      '**/testdata/**'
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
