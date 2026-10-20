import { Command } from 'commander';
import * as path from 'path';
import { execSync } from 'child_process';
import { globSync } from 'glob';
import chalk from 'chalk';
import { Logger } from '../lib/logger';
import { loadConfig } from '../lib/config';
import {
  BUNDLES,
  LANGUAGE_PACKS,
  LanguagePack,
  UnknownLanguageError,
  expandSelection,
  getGrammar,
  managedDir,
} from '../lib/parser/grammars';
import { NpmRunner, defaultNpmRunner, installCommand, installPacks, isManaged, removePacks } from '../lib/parser/lang-install';

export interface LangRow {
  language: string;
  module: string;
  extensions: string[];
  status: 'installed' | 'not-installed' | 'broken';
  source?: string;
  files: number;
  selected: boolean;
}

/** Count repo files per language by extension (git-aware, falls back to a glob). */
function countFiles(root: string): Map<string, number> {
  const counts = new Map<string, number>();
  let files: string[];
  try {
    files = execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8', stdio: 'pipe' })
      .split('\n').filter(Boolean);
  } catch {
    files = globSync('**/*', { cwd: root, nodir: true, ignore: ['**/node_modules/**', '.git/**'] });
  }
  for (const f of files) {
    const ext = path.extname(f);
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return counts;
}

export function collectRows(root: string): LangRow[] {
  const counts = countFiles(root);
  const selection = loadConfig(undefined, root)?.languages;
  const selected = new Set(selection && selection.length ? expandSelection(selection).map(p => p.name) : []);
  return LANGUAGE_PACKS.map(p => {
    const s = getGrammar(p.name);
    return {
      language: p.name,
      module: p.module,
      extensions: p.extensions,
      status: s.ok ? 'installed' : s.reason === 'broken' ? 'broken' : 'not-installed',
      source: s.source,
      files: p.extensions.reduce((n, e) => n + (counts.get(e) ?? 0), 0),
      selected: selected.has(p.name),
    } as LangRow;
  });
}

function parseSelection(names: string[]): LanguagePack[] | undefined {
  try {
    return expandSelection(names);
  } catch (e) {
    if (e instanceof UnknownLanguageError) {
      Logger.error(e.message);
      process.exitCode = 1;
      return undefined;
    }
    throw e;
  }
}

export function registerLangCommand(run: NpmRunner = defaultNpmRunner): Command {
  const lang = new Command('lang').description('Manage language packs (tree-sitter grammars)');

  lang
    .command('list')
    .description('List language packs, install status, and files of each language in this repo')
    .option('-p, --path <path>', 'Repository to inspect', process.cwd())
    .option('--json', 'Output JSON')
    .action((opts: { path: string; json?: boolean }) => {
      const rows = collectRows(path.resolve(opts.path));
      if (opts.json) {
        Logger.output(JSON.stringify({ languages: rows, bundles: BUNDLES, managedDir: managedDir() }, null, 2));
        return;
      }
      Logger.output(chalk.cyan('\nLanguage packs:\n'));
      for (const r of rows) {
        const mark = r.status === 'installed' ? chalk.green('installed    ') : r.status === 'broken' ? chalk.red('broken       ') : chalk.yellow('not installed');
        const where = r.source ? chalk.gray(` (${r.source})`) : '';
        const repo = r.files ? chalk.gray(`  ${r.files} file${r.files === 1 ? '' : 's'} here`) : '';
        const sel = r.selected ? chalk.cyan('  [configured]') : '';
        Logger.output(`  ${r.language.padEnd(11)} ${mark}${where}  ${r.extensions.join(' ')}${repo}${sel}`);
      }
      Logger.output(chalk.cyan('\nBundles:\n'));
      for (const [name, langs] of Object.entries(BUNDLES)) {
        Logger.output(`  ${name.padEnd(11)} ${langs.join(', ')}`);
      }
      const missingHere = rows.filter(r => r.status !== 'installed' && r.files > 0);
      if (missingHere.length) {
        Logger.output(chalk.yellow(`\nThis repo has files in languages without a grammar: run \`xray lang add ${missingHere.map(r => r.language).join(' ')}\``));
      }
      Logger.output(chalk.gray(`\nManaged dir: ${managedDir()}\n`));
    });

  lang
    .command('add <names...>')
    .description('Install language packs (language names or bundles: web, go, systems, jvm, scripting, full)')
    .option('--dry-run', 'Print the npm command without running it')
    .action((names: string[], opts: { dryRun?: boolean }) => {
      const packs = parseSelection(names);
      if (!packs) return;
      const todo = packs.filter(p => !getGrammar(p.name).ok);
      for (const p of packs) {
        if (!todo.includes(p)) Logger.info(`${p.name}: already installed (${getGrammar(p.name).source})`);
      }
      if (todo.length === 0) return;
      if (opts.dryRun) {
        Logger.output(`npm ${installCommand(todo).join(' ')}   (in ${managedDir()})`);
        return;
      }
      Logger.info(`Installing ${todo.map(p => p.name).join(', ')} into ${managedDir()} (native build only if no prebuilt binary)...`);
      const out = installPacks(todo, run);
      for (const s of out.statuses) {
        if (s.ok) Logger.success(`${s.language}: installed`);
        else Logger.error(`${s.language}: ${s.reason === 'broken' ? `failed to load (${s.error})` : 'not installed'}`);
      }
      if (!out.ok) process.exitCode = 1;
    });

  lang
    .command('remove <names...>')
    .alias('rm')
    .description('Remove language packs from the xray-managed dir')
    .action((names: string[]) => {
      const packs = parseSelection(names);
      if (!packs) return;
      const managed = packs.filter(p => isManaged(p));
      for (const p of packs) {
        if (!managed.includes(p)) {
          const s = getGrammar(p.name);
          Logger.info(s.ok
            ? `${p.name}: not managed by xray (provided by ${s.source} install); not touching it`
            : `${p.name}: not installed`);
        }
      }
      if (managed.length === 0) return;
      const out = removePacks(managed, run);
      for (const p of managed) {
        const s = getGrammar(p.name);
        if (s.ok) Logger.warn(`${p.name}: removed from managed dir, still provided by ${s.source} install`);
        else Logger.success(`${p.name}: removed`);
      }
      if (!out.ok) process.exitCode = 1;
    });

  return lang;
}
