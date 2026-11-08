import { Command } from 'commander';
import { declareEffect, emitPlan, previewing } from './side-effect';
import * as path from 'path';
import { gitListFiles } from '../lib/scanner';
import { globSync } from 'glob';
import { styles } from '../lib/tui';
import { bindFlag, staticValues } from './completion';
import { Logger } from '../lib/logger';
import { reportFailure } from '../lib/error/report';
import { EXIT_USAGE, UsageError } from '../lib/error/types';
import { loadConfig } from '../lib/config';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';
import {
  BUNDLES,
  LANGUAGE_PACKS,
  LanguagePack,
  UnknownLanguageError,
  expandSelection,
  getGrammar,
  managedDir,
} from '../lib/parser/grammars';
import { NpmRunner, defaultNpmRunner, installCommand, installPacks, isManaged, removeCommand, removePacks } from '../lib/parser/lang-install';
import { terminalSafe } from '../lib/terminal-safe';

export interface LangRow {
  language: string;
  module: string;
  extensions: string[];
  status: 'installed' | 'not-installed' | 'broken';
  source?: string;
  files: number;
  /** Repo file count per extension (only extensions present). */
  byExtension: Record<string, number>;
  selected: boolean;
}

/** A language with files in the repo whose grammar is not usable. */
export interface DetectedNotInstalled {
  language: string;
  files: number;
  extensions: Record<string, number>;
  status: 'not-installed' | 'broken';
}

/** Count repo files per language by extension (git-aware, falls back to a glob). */
function countFiles(root: string): Map<string, number> {
  const counts = new Map<string, number>();
  let files: string[];
  try {
    files = gitListFiles(root);
  } catch {
    files = globSync('**/*', { cwd: root, nodir: true, ignore: ['**/node_modules/**', '.git/**'] });
  }
  for (const f of files) {
    const ext = path.extname(f);
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return counts;
}

/** `configPath` (root `--config`) replaces config discovery from `root`. */
export function collectRows(root: string, configPath?: string): LangRow[] {
  const counts = countFiles(root);
  const selection = loadConfig(configPath, root)?.languages;
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
      byExtension: Object.fromEntries(p.extensions.filter(e => counts.get(e)).map(e => [e, counts.get(e)!])),
      selected: selected.has(p.name),
    } as LangRow;
  });
}

/** Languages present in the repo without a usable grammar, most files first. */
export function detectedNotInstalled(rows: LangRow[]): DetectedNotInstalled[] {
  return rows
    .filter(r => r.status !== 'installed' && r.files > 0)
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language))
    .map(r => ({
      language: r.language,
      files: r.files,
      extensions: r.byExtension,
      status: r.status as DetectedNotInstalled['status'],
    }));
}

const installHint = (d: DetectedNotInstalled[]): string | null =>
  d.length ? `xray lang add ${d.map(x => x.language).join(' ')}` : null;

function parseSelection(names: string[]): LanguagePack[] | undefined {
  try {
    return expandSelection(names);
  } catch (e) {
    if (e instanceof UnknownLanguageError) {
      reportFailure(new UsageError(e.message), () => Logger.error(e.message));
      process.exitCode = EXIT_USAGE;
      return undefined;
    }
    throw e;
  }
}

export function registerLangCommand(run: NpmRunner = defaultNpmRunner): Command {
  const lang = new Command('lang').description('Manage language packs (tree-sitter grammars)');

  const list = declareEffect(lang
    .command('list')
    .description('List language packs, install status, and files of each language in this repo')
    .option('-p, --path <path>', 'Repository to inspect (default: current directory)')
    .option('--format <fmt>', 'Output format: text (default) or json')
    .option('--json', 'Alias of --format json')
    .action((opts: { path?: string; json?: boolean; format?: string; config?: string }) => {
      const fmt = (opts.format ?? (opts.json ? 'json' : 'text')).toLowerCase();
      if (fmt !== 'text' && fmt !== 'json') {
        throw new UsageError(`invalid --format '${opts.format}' (expected one of: text, json)`);
      }
      const rows = collectRows(path.resolve(opts.path ?? '.'), opts.config);
      const detected = detectedNotInstalled(rows);
      if (fmt === 'json') {
        Logger.output(JSON.stringify({
          languages: rows,
          detectedNotInstalled: detected,
          install: installHint(detected),
          bundles: BUNDLES,
          managedDir: managedDir(),
        }, null, 2));
        return;
      }
      Logger.output(styles().accent('\nLanguage packs:\n'));
      for (const r of rows) {
        const mark = r.status === 'installed' ? styles().success('installed    ') : r.status === 'broken' ? styles().error('broken       ') : styles().warn('not installed');
        const where = r.source ? styles().muted(` (${terminalSafe(String(r.source))})`) : '';
        const repo = r.files ? styles().muted(`  ${r.files} file${r.files === 1 ? '' : 's'} here`) : '';
        const sel = r.selected ? styles().accent('  [configured]') : '';
        Logger.output(`  ${r.language.padEnd(11)} ${mark}${where}  ${terminalSafe(r.extensions.join(' '))}${repo}${sel}`);
      }
      Logger.output(styles().accent('\nBundles:\n'));
      for (const [name, langs] of Object.entries(BUNDLES)) {
        Logger.output(`  ${name.padEnd(11)} ${terminalSafe(langs.join(', '))}`);
      }
      if (detected.length) {
        Logger.output(styles().warn('\nDetected in this repo, not installed:\n'));
        for (const d of detected) {
          const exts = terminalSafe(Object.keys(d.extensions).join(', '));
          const broken = d.status === 'broken' ? styles().error('  (installed, fails to load)') : '';
          Logger.output(`  ${d.language.padEnd(11)} ${d.files} file${d.files === 1 ? '' : 's'} (${exts})${broken}`);
        }
        Logger.output(`\nInstall with: ${terminalSafe(String(installHint(detected)))}`);
      }
      Logger.output(styles().muted(`\nManaged dir: ${terminalSafe(managedDir())}\n`));
    }), 'read', 'yes');
  bindFlag(list, 'format', staticValues('text', 'json'));

  declareEffect(addResultFormat(lang
    .command('add <names...>')
    .description('Install language packs (language names or bundles: web, go, systems, jvm, scripting, full)')
    .option('--dry-run', 'Print what would be installed (the npm command) without running it'))
    .action((names: string[], opts: { dryRun?: boolean }, cmd: Command) => {
      assertResultFormat(cmd);
      const packs = parseSelection(names);
      if (!packs) return;
      const todo = packs.filter(p => !getGrammar(p.name).ok);
      for (const p of packs) {
        if (!todo.includes(p)) Logger.info(`${p.name}: already installed (${getGrammar(p.name).source})`);
      }
      if (previewing(cmd, opts.dryRun)) {
        emitPlan(cmd, todo.map(p => ({
          kind: 'install',
          target: `npm:${p.module}@${p.range}`,
          reversible: true,
          detail: `in ${managedDir()}`,
        })), { args: { npm: `npm ${installCommand(todo).join(' ')}`, cwd: managedDir() } });
        return;
      }
      if (todo.length === 0) {
        emitResult(cmd, {
          action: 'add',
          ok: true,
          dir: managedDir(),
          languages: packs.map(p => ({ language: p.name, status: 'already-installed', source: getGrammar(p.name).source })),
        }, () => {});
        return;
      }
      Logger.info(`Installing ${todo.map(p => p.name).join(', ')} into ${managedDir()} (native build only if no prebuilt binary)...`);
      const out = installPacks(todo, run);
      const languages: Array<Record<string, unknown>> = packs.filter(p => !todo.includes(p))
        .map(p => ({ language: p.name, status: 'already-installed', source: getGrammar(p.name).source }));
      for (const s of out.statuses) {
        languages.push({
          language: s.language,
          status: s.ok ? 'installed' : s.check && !s.check.ok ? 'incompatible' : 'failed',
          ...(s.ok ? { source: s.source } : { error: s.check && !s.check.ok ? s.check.error : s.error ?? 'not installed' }),
        });
        if (s.ok) Logger.success(`${s.language}: installed`);
        else if (s.check && !s.check.ok) {
          const ts = s.check.treeSitter ? ` ${s.check.treeSitter}` : '';
          Logger.error(`${s.language}: installed but not usable with xray's tree-sitter${ts} (${s.check.error})`);
          Logger.info(`${s.language}: ${s.module}${s.version ? `@${s.version}` : ''} is not compatible with the tree-sitter bundled in xray; install another release in ${out.dir}, or run \`xray lang remove ${s.language}\``);
        }
        else Logger.error(`${s.language}: ${s.reason === 'broken' ? `failed to load (${s.error})` : 'not installed'}`);
      }
      emitResult(cmd, { action: 'add', ok: out.ok, dir: out.dir, languages }, () => {});
      if (!out.ok) process.exitCode = 1;
    }), 'write-local', 'yes');

  declareEffect(addResultFormat(lang
    .command('remove <names...>')
    .alias('rm')
    .description('Remove language packs from the xray-managed dir'))
    .action((names: string[], _opts: unknown, cmd: Command) => {
      assertResultFormat(cmd);
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
      if (previewing(cmd)) {
        emitPlan(cmd, managed.map(p => ({
          kind: 'delete',
          target: `npm:${p.module}`,
          reversible: true,
          detail: `from ${managedDir()}`,
        })), { args: { npm: `npm ${removeCommand(managed).join(' ')}`, cwd: managedDir() } });
        return;
      }
      const skipped = packs.filter(p => !managed.includes(p))
        .map(p => ({ language: p.name, status: getGrammar(p.name).ok ? 'not-managed' : 'not-installed' }));
      if (managed.length === 0) {
        emitResult(cmd, { action: 'remove', ok: true, dir: managedDir(), languages: skipped }, () => {});
        return;
      }
      const out = removePacks(managed, run);
      const languages: Array<Record<string, unknown>> = [...skipped];
      for (const p of managed) {
        const s = getGrammar(p.name);
        if (s.ok) Logger.warn(`${p.name}: removed from managed dir, still provided by ${s.source} install`);
        else Logger.success(`${p.name}: removed`);
        languages.push(out.ok
          ? { language: p.name, status: s.ok ? 'removed-still-provided' : 'removed', ...(s.ok ? { source: s.source } : {}) }
          : { language: p.name, status: 'failed' });
      }
      emitResult(cmd, { action: 'remove', ok: out.ok, dir: out.dir, languages }, () => {});
      if (!out.ok) process.exitCode = 1;
    }), 'write-local', 'yes');

  return lang;
}
