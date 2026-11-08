import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../lib/logger';
import { NotFoundError } from '../lib/error/types';
import { FileScanner } from '../lib/scanner';
import { terminalSafe } from '../lib/terminal-safe';
import { readTextSafe } from '../lib/safe-read';
import { assertPatternLengths, compileMatchers } from '../lib/path-match';
import { resolvePath } from './common';
import { UsageError } from '../lib/error/types';
import type { Command } from 'commander';
import { ExploreCommandOptions } from '../types/command-options';
import {
  addOutputFlags, assertFormat, columns, emit, outputRegistry, textFormatter,
  type ColumnSpec, type Formatter,
} from '../lib/output';

interface MatchRow { path: string }
interface SearchRow { file: string; line: number; keyword: string; content: string }
interface StatsRow { type: string; files: number; lines: number }
interface ListRow { type: string; path: string }

/** Group rows by `key`, preserving first-seen order. */
function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    let g = out.get(k);
    if (!g) out.set(k, (g = []));
    g.push(r);
  }
  return out;
}

const matchText = textFormatter<MatchRow[]>('text', (rows, put) => {
  rows.forEach((r) => put(`  ${terminalSafe(r.path)}`));
});

const searchText = textFormatter<SearchRow[]>('text', (rows, put, s) => {
  for (const [file, lines] of groupBy(rows, (r) => r.file)) {
    put(s.accent(`${terminalSafe(file)}:`));
    lines.slice(0, 5).forEach(({ line, content, keyword }) => {
      put(`  ${s.muted(`${line}:`)} ${s.warn(`[${terminalSafe(keyword)}]`)} ${terminalSafe(content)}`);
    });
    if (lines.length > 5) {
      put(s.muted(`  ... and ${lines.length - 5} more matches`));
    }
    put('');
  }
});

const statsText = textFormatter<StatsRow[]>('text', (rows, put, s) => {
  const totalFiles = rows.reduce((n, r) => n + r.files, 0);
  const totalLines = rows.reduce((n, r) => n + r.lines, 0);
  put(`  ${s.bold('Total Files:')} ${totalFiles}`);
  put(`  ${s.bold('Total Lines:')} ${totalLines.toLocaleString()}\n`);
  put(`  ${s.bold('Files by Type:')}`);
  rows.forEach((r) => put(`    ${terminalSafe(r.type).padEnd(10)} ${r.files}`));
});

const listText = textFormatter<ListRow[]>('text', (rows, put, s) => {
  for (const [ext, group] of groupBy(rows, (r) => r.type)) {
    put(s.accent(`${terminalSafe(ext)} (${group.length}):`));
    group.slice(0, 10).forEach((r) => put(`  ${terminalSafe(r.path)}`));
    if (group.length > 10) {
      put(s.muted(`  ... and ${group.length - 10} more`));
    }
    put('');
  }
});

// Registration-time registry (format keys for help / --format-help); each
// mode renders through its own registry carrying the matching text view.
const exploreRegistry = outputRegistry(listText);

/** Attach explore's output flags (`--format text|json|yaml|table|csv`, ...). */
export function addExploreOutputFlags(cmd: Command): Command {
  return addOutputFlags(cmd, exploreRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  });
}

async function render<T>(
  cmd: Command | undefined, rows: T[], text: Formatter<T[]>, cols: ColumnSpec[]
): Promise<void> {
  if (!cmd) {
    // Programmatic call without a command: human view on stdout.
    text.render(process.stdout, rows, {}, []);
    return;
  }
  await emit(cmd, rows, { registry: outputRegistry(text), columns: cols, defaultFormat: 'text' });
}

/** Option-value key under which the default route hands over a bare path (`xray <path>`). */
export const ROUTED_PATH_KEY = 'routedPath';

/** Set when default routing passes the word `explore` itself through as an operand. */
export const ROUTED_SELF_KEY = 'routedSelf';

export const handleExploreAction = async (
  options: ExploreCommandOptions,
  cmd?: Command
) => {
    if (cmd) assertFormat(cmd, exploreRegistry);

    // explore takes no operand. The one exception is a path that default
    // routing handed over (`xray <path>`), which becomes a scan root.
    const routed = (options as Record<string, unknown>)[ROUTED_PATH_KEY] as string | undefined;
    const self = (options as Record<string, unknown>)[ROUTED_SELF_KEY] === true;
    let operands = (cmd?.args ?? []).filter((a) => a !== routed);
    if (self && operands[0] === 'explore') operands = operands.slice(1);
    if (operands.length > 0) {
      throw new UsageError(
        `unexpected argument '${operands[0]}': explore takes no query; ` +
        `use --match <glob> to find files, --search <keyword> to search code, or --path <dir> to pick a root`
      );
    }
    if (routed) options = { ...options, path: [routed, ...(options.path ?? [])] };

    // One mode per run; combining --search with --stats would drop one.
    const keywords = options.search ?? [];
    if (keywords.some((k) => k === '')) throw new UsageError('--search needs a non-empty keyword');
    const searching = keywords.length > 0;
    if (searching && options.stats) throw new UsageError('--search and --stats are exclusive: pick one');

  const paths = (options.path && options.path.length > 0 ? options.path : [process.cwd()])
      .map(resolvePath)
      .filter(Boolean) as string[];

    // Validate all paths exist
    for (const p of paths) {
      if (!fs.existsSync(p)) {
        throw new NotFoundError(`Path does not exist: ${terminalSafe(p)}`);
      }
    }

    // Scan all paths and collect files, keeping each one's path under its root
    const scanned: { abs: string; rel: string; root: string }[] = [];
    for (const p of paths) {
      // A file as the path is that one file (matched by its name), if the
      // scanner would have listed it: never `.git`, ignored or unsupported files.
      if (fs.statSync(p).isFile()) {
        const why = FileScanner.skipReason(p);
        if (why) Logger.warn(`skipped ${terminalSafe(p)}: it ${why}; explore only reads files the scanner lists`);
        else scanned.push({ abs: p, rel: path.basename(p), root: path.dirname(p) });
        continue;
      }
      const scanner = new FileScanner(p);
      for (const f of scanner.scan()) scanned.push({ abs: path.join(p, f), rel: f.split(path.sep).join('/'), root: p });
    }
    let entries = scanned;

    // Filter by type if specified
    if (options.type && options.type.length > 0) {
      const exts = options.type.map((t: string) => t.startsWith('.') ? t : `.${t}`);
      entries = entries.filter(e => exts.includes(path.extname(e.abs)));
    }

    // --match narrows the file set; --search and --stats then work on that set.
    const matching = options.match && options.match.length > 0;
    if (matching) {
      assertPatternLengths(options.match!, '--match');
      const matches = compileMatchers(options.match!);
      entries = entries.filter(e => matches(e.rel));
    }

    const files = entries.map(e => e.abs);
    // Reads stay inside each file's root, regular files only, within the size cap.
    const rootOf = new Map(entries.map(e => [e.abs, e.root]));
    const readText = (file: string): string => readTextSafe(rootOf.get(file) ?? path.dirname(file), file);

    // Find files by pattern, against the path under each explore root
    if (matching && !searching && !options.stats) {
      Logger.info(`Found ${files.length} file(s) matching pattern(s):\n`);
      await render<MatchRow>(cmd, files.map((f) => ({ path: f })), matchText, columns('path'));
      return;
    }

    // Search for keyword in code
    if (searching) {
      Logger.info(`Searching for ${keywords.length} keyword(s) in ${files.length} files...\n`);

      const rows: SearchRow[] = [];
      const fileSet = new Set<string>();

      for (const file of files) {
        try {
          const content = readText(file);
          const lines = content.split('\n');

          lines.forEach((line, idx) => {
            keywords.forEach((keyword: string) => {
              if (line.toLowerCase().includes(keyword.toLowerCase())) {
                rows.push({ file, line: idx + 1, keyword, content: line.trim() });
                fileSet.add(file);
              }
            });
          });
        } catch (error) {
          // Skip files that can't be read or are refused (tallied for the exit notice)
        }
      }

      if (rows.length === 0) {
        Logger.warn(`No matches found for keyword(s): ${keywords.map(terminalSafe).join(', ')}`);
      } else {
        Logger.success(`Found matches in ${fileSet.size} file(s):\n`);
      }
      await render<SearchRow>(cmd, rows, searchText, columns('file', 'line', 'keyword', 'content'));
      return;
    }

    // Show statistics
    if (options.stats) {
      const byExt = new Map<string, StatsRow>();

      files.forEach(file => {
        const ext = path.extname(file);
        let row = byExt.get(ext);
        if (!row) byExt.set(ext, (row = { type: ext, files: 0, lines: 0 }));
        row.files++;

        try {
          const content = readText(file);
          row.lines += content.split('\n').length;
        } catch (error) {
          // Skip files that can't be read or are refused (tallied for the exit notice)
        }
      });

      Logger.info('Codebase Statistics:\n');
      const rows = [...byExt.values()].sort((a, b) => b.files - a.files);
      await render<StatsRow>(cmd, rows, statsText, columns('type', 'files', 'lines'));
      return;
    }

    // Default: list all files
    Logger.info(`Found ${files.length} file(s):\n`);

    // Group by extension, largest group first
    const byExt = groupBy(files, (f) => path.extname(f));
    const rows: ListRow[] = [...byExt.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .flatMap(([ext, list]) => list.map((f) => ({ type: ext, path: f })));
    await render<ListRow>(cmd, rows, listText, columns('type', 'path'));
};
