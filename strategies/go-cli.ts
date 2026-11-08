// strategies/go-cli.ts
import * as path from 'path';
import { Strategy, StrategyContext, FileMetadata, StrategyCommand } from '../src/lib/strategy/types';
import { extractCommandsAst, extractFile, loadGoGrammar, GrammarLoader } from '../src/lib/strategy/go-cli/ast';
import { obtainToolspec, execRequested, ToolspecOptions } from '../src/lib/strategy/go-cli/binary';
import { CommandsReport, normalizeReport, renderJson, renderText } from '../src/lib/strategy/go-cli/model';

const CLI_DEP_MARKERS = ['github.com/spf13/cobra', 'github.com/urfave/cli', 'hop.top/kit'];

export default class GoCliStrategy implements Strategy {
  name = 'go-cli';
  description = 'Show the command tree of Go CLI apps (cobra/kit)';
  version = '0.2.0';
  // Grammar is optional (language pack): resolved lazily via the grammar registry;
  // AST extraction degrades to an empty result with a warning when absent.
  requiresLanguages = ['go'];

  /** Test seam: override how tree-sitter-go is loaded. */
  grammarLoader: GrammarLoader = loadGoGrammar;
  /** Test seam: extra toolspec options (runner, sandbox). */
  toolspecOverrides: Partial<ToolspecOptions> = {};

  async detect(ctx: StrategyContext): Promise<boolean> {
    if (ctx.hasFiles('go.mod')) {
      for (const file of ctx.globFiles('go.mod')) {
        const content = await ctx.readFile(file);
        if (CLI_DEP_MARKERS.some(m => content.includes(m))) return true;
      }
    }

    // cmd/ directory (common CLI structure)
    if (ctx.hasFiles('cmd/**/*.go')) return true;

    // CLI framework imports, or flag package in a main file
    for (const file of ctx.globFiles('**/*.go')) {
      const content = await ctx.readFile(file);
      if (
        content.includes('github.com/spf13/cobra') ||
        content.includes('github.com/urfave/cli') ||
        content.includes('"hop.top/kit/') ||
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
    return ['**/*_test.go', '**/vendor/**', '**/testdata/**'];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const content = await ctx.readFile(file);
    const tags: string[] = [];
    const metadata: Record<string, any> = {};
    if (!/spf13\/cobra|urfave\/cli/.test(content)) return { tags, exports: [], imports: [], metadata };

    const grammar = this.grammarLoader();
    if (!grammar) return { tags, exports: [], imports: [], metadata: { astSkipped: 'tree-sitter-go unavailable' } };

    try {
      const rel = path.isAbsolute(file) ? path.relative(ctx.getProjectRoot(), file) : file;
      const defs = extractFile(rel, content, grammar);
      if (defs.cmds.length) {
        tags.push('go-cli:command');
        metadata.commands = defs.cmds.map(c => ({
          name: c.name ?? c.boundNames[0] ?? null,
          short: c.short ?? null,
          framework: c.framework,
          line: c.line,
          flags: c.flags.length,
        }));
        const first = defs.cmds[0];
        metadata.commandName = first.name;
        metadata.commandShort = first.short;
        metadata.commandLong = first.long;
      }
      const flags = [...defs.cmds.flatMap(c => c.flags), ...defs.flagAttach.map(f => f.flag)];
      if (flags.length) {
        tags.push('go-cli:flags');
        metadata.flags = flags.map(f => ({ name: f.name, type: f.type, usage: f.description, shorthand: f.shorthand }));
      }
      if (defs.adds.length || defs.cmds.some(c => c.children.length)) tags.push('go-cli:hierarchy');
      const app = defs.cmds.find(c => c.isApp);
      if (app) {
        tags.push('go-cli:urfave-app');
        metadata.appName = app.name;
        metadata.appUsage = app.short;
      }
    } catch (e: any) {
      metadata.astError = e.message;
    }
    return { tags, exports: [], imports: [], metadata };
  }

  commands: Record<string, StrategyCommand> = {
    commands: {
      description: 'Show the CLI command tree (AST by default; toolspec via --exec-binary/--binary)',
      options: {
        binary: { description: 'Run this prebuilt binary (`spec --format json`) inside an OS sandbox', placeholder: '<path>' },
        'exec-binary': { type: 'boolean', description: 'Build the main package and run it for its kit toolspec, inside an OS sandbox' },
        'unsafe-no-sandbox': { type: 'boolean', description: 'Allow --exec-binary/--binary without an OS sandbox (runs repo code unconfined)' },
        'allow-cgo': { type: 'boolean', description: 'With --exec-binary: build with cgo enabled (runs the C toolchain on repo code)' },
        format: { description: 'Output format: text|json (default text)', placeholder: '<text|json>' },
      },
      handler: async (ctx: StrategyContext, opts: any = {}) => this.runCommands(ctx, opts),
    },
  };

  private async runCommands(ctx: StrategyContext, opts: any): Promise<string> {
    const root = ctx.getProjectRoot();
    const format = String(opts.format || (opts.json ? 'json' : 'text')).toLowerCase();
    if (format !== 'text' && format !== 'json') {
      throw new Error(`unsupported --format "${format}" (use text or json)`);
    }
    const warnings: string[] = [];
    let report: CommandsReport | undefined;

    // Execution is opt-in by the user only: flags or user-level env. Never
    // derived from anything inside the scanned repository.
    const wantExec = execRequested({ binary: opts.binary, execBinary: opts.execBinary ?? opts['exec-binary'] });
    if (wantExec) {
      const out = await obtainToolspec(root, {
        binary: opts.binary,
        execBinary: !!(opts.execBinary ?? opts['exec-binary']) || (!opts.binary && process.env.XRAY_GO_CLI_EXEC === '1'),
        unsafeNoSandbox: !!(opts.unsafeNoSandbox ?? opts['unsafe-no-sandbox']),
        // cgo runs the C toolchain on repo code: explicit user opt-in only.
        allowCgo: !!(opts.allowCgo ?? opts['allow-cgo']) || process.env.XRAY_GO_CLI_CGO === '1',
        ...this.toolspecOverrides,
      });
      report = out.report;
      if (!report && out.reason) warnings.push(`toolspec unavailable (${out.reason}); falling back to AST`);
    }

    if (!report) {
      const files: Array<{ rel: string; src: string }> = [];
      for (const f of ctx.globFiles('**/*.go')) {
        if (/(^|\/)(vendor|testdata)\//.test(f) || f.endsWith('_test.go')) continue;
        files.push({ rel: f, src: await ctx.readFile(f) });
      }
      const ast = extractCommandsAst({
        files,
        fallbackTool: path.basename(root),
        loadGrammar: this.grammarLoader,
      });
      if (ast.report) report = ast.report;
      else warnings.push(ast.reason ?? 'AST extraction unavailable');
    }

    if (!report) {
      report = normalizeReport({ source: 'ast', tool: path.basename(root), commands: [], warnings: [] });
    }
    report.warnings.unshift(...warnings);
    report = normalizeReport(report);
    return format === 'json' ? renderJson(report) : renderText(report);
  }
}
