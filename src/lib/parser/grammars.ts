/**
 * Language packs: catalog of tree-sitter grammars xray can use, plus the
 * lazy, failure-tolerant resolver for them.
 *
 * Grammars are NOT hard dependencies. Each one is resolved on first use,
 * inside try/catch, from (in order):
 *   1. xray's own install (or anything hoisted next to it)
 *   2. the xray-managed dir populated by `xray lang add` (see managedDir())
 *   3. (opt-in only, XRAY_ALLOW_PROJECT_GRAMMARS=1) the current project's node_modules
 *
 * This module must stay import-side-effect free: it never loads a grammar
 * (or `tree-sitter`) at import time.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { Logger, LogLevel } from '../logger';
import { isMachineFormat } from '../output-format';
import { NotFoundError, UsageError } from '../error/types';
import { terminalSafe } from '../terminal-safe';

export interface LanguagePack {
  /** Canonical language name (what `xray lang add <name>` takes). */
  name: string;
  /** npm package providing the grammar. */
  module: string;
  /** Semver range xray is tested against (kept in sync with package.json). */
  range: string;
  /** Property of the module holding the grammar (e.g. php -> `php`). */
  exportKey?: string;
  /** Per-extension override of `exportKey` (e.g. `.tsx` -> `tsx`: JSX needs the tsx grammar). */
  extensionExports?: Record<string, string>;
  /** File extensions (with dot) parsed with this grammar. */
  extensions: string[];
  /** Query file under src/lib/parser/queries. */
  query: string;
  /** Alternative spellings accepted on the CLI / in config. */
  aliases?: string[];
}

export const LANGUAGE_PACKS: LanguagePack[] = [
  { name: 'typescript', module: 'tree-sitter-typescript', range: '^0.23.2', exportKey: 'typescript', extensionExports: { '.tsx': 'tsx' }, extensions: ['.ts', '.tsx', '.mts', '.cts'], query: 'typescript.scm', aliases: ['ts'] },
  { name: 'javascript', module: 'tree-sitter-javascript', range: '^0.25.0', extensions: ['.js', '.jsx', '.mjs', '.cjs'], query: 'javascript.scm', aliases: ['js'] },
  { name: 'python', module: 'tree-sitter-python', range: '^0.25.0', extensions: ['.py'], query: 'python.scm', aliases: ['py'] },
  { name: 'java', module: 'tree-sitter-java', range: '^0.23.5', extensions: ['.java'], query: 'java.scm' },
  { name: 'csharp', module: 'tree-sitter-c-sharp', range: '0.23.1', extensions: ['.cs'], query: 'c_sharp.scm', aliases: ['c-sharp', 'cs'] },
  { name: 'cpp', module: 'tree-sitter-cpp', range: '^0.23.4', extensions: ['.cpp', '.hpp'], query: 'cpp.scm', aliases: ['c++'] },
  { name: 'c', module: 'tree-sitter-c', range: '^0.24.1', extensions: ['.c', '.h'], query: 'c.scm' },
  { name: 'go', module: 'tree-sitter-go', range: '^0.25.0', extensions: ['.go'], query: 'go.scm', aliases: ['golang'] },
  { name: 'rust', module: 'tree-sitter-rust', range: '^0.24.0', extensions: ['.rs'], query: 'rust.scm', aliases: ['rs'] },
  { name: 'php', module: 'tree-sitter-php', range: '^0.24.2', exportKey: 'php', extensions: ['.php'], query: 'php.scm' },
  { name: 'ruby', module: 'tree-sitter-ruby', range: '^0.23.1', extensions: ['.rb'], query: 'ruby.scm', aliases: ['rb'] },
  { name: 'bash', module: 'tree-sitter-bash', range: '^0.25.1', extensions: ['.sh', '.bash'], query: 'bash.scm', aliases: ['sh'] },
  { name: 'swift', module: 'tree-sitter-swift', range: '^0.7.1', extensions: ['.swift'], query: 'swift.scm' },
  { name: 'kotlin', module: 'tree-sitter-kotlin', range: '^0.3.8', extensions: ['.kt'], query: 'kotlin.scm', aliases: ['kt'] },
  { name: 'scala', module: 'tree-sitter-scala', range: '^0.24.0', extensions: ['.scala'], query: 'scala.scm' },
  { name: 'elixir', module: 'tree-sitter-elixir', range: '^0.3.4', extensions: ['.ex', '.exs'], query: 'elixir.scm' },
  { name: 'haskell', module: 'tree-sitter-haskell', range: '^0.23.1', extensions: ['.hs'], query: 'haskell.scm', aliases: ['hs'] },
];

/** Named groups of languages. `full` is every pack. */
export const BUNDLES: Record<string, string[]> = {
  web: ['typescript', 'javascript'],
  go: ['go'],
  systems: ['c', 'cpp', 'rust', 'go'],
  jvm: ['java', 'kotlin', 'scala'],
  scripting: ['python', 'ruby', 'php', 'bash'],
  full: LANGUAGE_PACKS.map(p => p.name),
};

const byName = new Map<string, LanguagePack>();
const byExt = new Map<string, LanguagePack>();
for (const p of LANGUAGE_PACKS) {
  byName.set(p.name, p);
  for (const a of p.aliases ?? []) byName.set(a, p);
  for (const e of p.extensions) byExt.set(e, p);
}

export function getPack(name: string): LanguagePack | undefined {
  return byName.get(name.toLowerCase());
}

export function packForExtension(ext: string): LanguagePack | undefined {
  return byExt.get(ext);
}

export function knownExtensions(): string[] {
  return Array.from(byExt.keys());
}

export class UnknownLanguageError extends UsageError {
  readonly requested: string;
  constructor(requested: string) {
    super(
      `Unknown language or bundle '${requested}'. ` +
      `Languages: ${LANGUAGE_PACKS.map(p => p.name).join(', ')}. ` +
      `Bundles: ${Object.keys(BUNDLES).join(', ')}.`
    );
    this.requested = requested;
    this.name = 'UnknownLanguageError';
  }
}

/** Expand language / bundle names into a de-duplicated list of packs. Throws on unknown names. */
export function expandSelection(names: string[]): LanguagePack[] {
  const out = new Map<string, LanguagePack>();
  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    const bundle = BUNDLES[key];
    if (bundle) {
      for (const n of bundle) out.set(n, byName.get(n)!);
      continue;
    }
    const pack = byName.get(key);
    if (!pack) throw new UnknownLanguageError(raw);
    out.set(pack.name, pack);
  }
  return Array.from(out.values());
}

// ---------------------------------------------------------------------------
// Managed dir (target of `xray lang add`)
// ---------------------------------------------------------------------------

/**
 * Directory holding grammars installed by `xray lang add`.
 * $XRAY_LANG_DIR overrides; otherwise <XDG_DATA_HOME or platform data home>/xray/lang.
 */
export function managedDir(): string {
  if (process.env.XRAY_LANG_DIR) return process.env.XRAY_LANG_DIR;
  const home = os.homedir();
  const dataHome =
    process.env.XDG_DATA_HOME ||
    (os.platform() === 'darwin'
      ? path.join(home, 'Library/Application Support')
      : os.platform() === 'win32'
        ? process.env.APPDATA || path.join(home, 'AppData/Roaming')
        : path.join(home, '.local/share'));
  return path.join(dataHome, 'xray/lang');
}

// ---------------------------------------------------------------------------
// Lazy resolution
// ---------------------------------------------------------------------------

export type GrammarSource = 'xray' | 'managed' | 'project';

export interface GrammarStatus {
  language: string;
  module: string;
  ok: boolean;
  /** Grammar object to hand to `parser.setLanguage` (set when ok). */
  grammar?: any;
  /** The raw required module (set when ok), for callers needing other exports (e.g. tsx). */
  moduleExports?: any;
  source?: GrammarSource;
  /** `version` from the loaded module's package.json (set when ok and readable). */
  version?: string;
  /** missing = not installed; broken = installed but failed to load; blocked = XRAY_LANG_BLOCK. */
  reason?: 'missing' | 'broken' | 'blocked';
  error?: string;
  /**
   * Result of the post-install compatibility check (`xray lang add`): the
   * grammar loaded, then `setLanguage` + a small parse ran against xray's own
   * tree-sitter. Absent when no check ran. On failure `ok` is false and
   * `reason` is 'broken'.
   */
  check?: { ok: boolean; error?: string; treeSitter?: string };
}

const cache = new Map<string, GrammarStatus>();

function isNotFound(err: any, mod: string): boolean {
  return err && err.code === 'MODULE_NOT_FOUND' && typeof err.message === 'string' && err.message.includes(`'${mod}'`);
}

function blockedLanguages(): Set<string> {
  const raw = process.env.XRAY_LANG_BLOCK;
  if (!raw) return new Set();
  // Testing / debugging aid: pretend these grammars are not installed.
  return new Set(raw.split(',').map(s => getPack(s.trim())?.name).filter((s): s is string => !!s));
}

/**
 * Require from the managed dir. Never issues a bare-specifier lookup for a
 * package that is not on disk: Node (>= 24) remembers a failed lookup under an
 * existing node_modules, so a grammar installed later in the same process
 * (`xray lang add` probes, installs, probes again) would stay unresolvable.
 */
function loadManaged(spec: string): any {
  const dir = managedDir();
  if (!fs.existsSync(path.join(dir, 'node_modules', ...spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1)))) {
    throw Object.assign(new Error(`Cannot find module '${spec}'`), { code: 'MODULE_NOT_FOUND' });
  }
  return createRequire(path.join(dir, 'noop.js'))(spec);
}

/**
 * Resolution roots. SECURITY: the scanned repo's node_modules is an untrusted
 * search path (loading a grammar executes native/JS code), so it is consulted
 * only when the user opts in via the XRAY_ALLOW_PROJECT_GRAMMARS env var -
 * never via repo-local config. The managed dir is only redirectable by
 * XRAY_LANG_DIR / XDG_DATA_HOME (user environment), never by repo files.
 */
function candidates(mod: string): Array<{ source: GrammarSource; load: (spec?: string) => any }> {
  const list: Array<{ source: GrammarSource; load: (spec?: string) => any }> = [
    { source: 'xray', load: (spec = mod) => require(spec) },
    { source: 'managed', load: (spec = mod) => loadManaged(spec) },
  ];
  if (process.env.XRAY_ALLOW_PROJECT_GRAMMARS === '1') {
    list.push({
      source: 'project',
      load: (spec = mod) => {
        const from = path.join(process.cwd(), 'noop.js');
        const resolved = createRequire(from).resolve(spec);
        if (spec === mod) Logger.warn(`loading grammar from project path ${terminalSafe(resolved)} (XRAY_ALLOW_PROJECT_GRAMMARS=1)`);
        return createRequire(from)(spec);
      },
    });
  }
  return list;
}

/** Resolve (and cache) the grammar for a language. Never throws. */
export function getGrammar(language: string): GrammarStatus {
  const pack = getPack(language);
  const name = pack?.name ?? language;
  const hit = cache.get(name);
  if (hit) return hit;

  let status: GrammarStatus;
  if (!pack) {
    status = { language: name, module: '', ok: false, reason: 'missing', error: 'unknown language' };
  } else if (blockedLanguages().has(pack.name)) {
    status = { language: name, module: pack.module, ok: false, reason: 'blocked', error: 'blocked via XRAY_LANG_BLOCK' };
  } else {
    status = { language: name, module: pack.module, ok: false, reason: 'missing' };
    for (const c of candidates(pack.module)) {
      try {
        const mod = c.load();
        const grammar = pack.exportKey ? mod[pack.exportKey] : mod;
        if (!grammar) throw new Error(`module '${pack.module}' has no export '${pack.exportKey}'`);
        status = { language: name, module: pack.module, ok: true, grammar, moduleExports: mod, source: c.source };
        try {
          const v = c.load(`${pack.module}/package.json`)?.version;
          if (typeof v === 'string') status.version = v;
        } catch {
          // version is informational; a package without a readable package.json still loads
        }
        break;
      } catch (err: any) {
        if (!isNotFound(err, pack.module)) {
          // Present but unusable (e.g. native binding failed): remember, keep looking.
          status = { language: name, module: pack.module, ok: false, reason: 'broken', error: String(err?.message ?? err).split('\n')[0] };
        }
      }
    }
  }
  cache.set(name, status);
  return status;
}

/**
 * Grammar object for a file extension of a loaded pack: the pack's
 * `extensionExports` entry when present (`.tsx` -> tsx), else its default.
 */
export function grammarForExtension(status: GrammarStatus, ext: string): any {
  if (!status.ok) return undefined;
  const key = getPack(status.language)?.extensionExports?.[ext];
  return key ? status.moduleExports?.[key] ?? status.grammar : status.grammar;
}

export function isGrammarAvailable(language: string): boolean {
  return getGrammar(language).ok;
}

export class MissingGrammarError extends NotFoundError {
  readonly language: string;
  readonly status?: GrammarStatus;
  constructor(language: string, status?: GrammarStatus) {
    super(
      status?.reason === 'broken'
        ? `Grammar for '${language}' failed to load (${status.error}). Try \`xray lang add ${language}\`.`
        : `Grammar for '${language}' is not installed. Run \`xray lang add ${language}\`.`
    );
    this.language = language;
    this.status = status;
    this.name = 'MissingGrammarError';
  }
}

/**
 * For strategies / other code needing the raw grammar module (e.g. the `tsx`
 * export of tree-sitter-typescript). Throws MissingGrammarError when absent.
 */
export function requireGrammarModule(language: string): any {
  const s = getGrammar(language);
  if (!s.ok) throw new MissingGrammarError(language, s);
  return s.moduleExports;
}

/** Forget cached resolutions (after `lang add|remove`, and in tests). */
export function resetGrammarCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Per-run state: language selection + skipped-file accounting
// ---------------------------------------------------------------------------

let enabled: Set<string> | undefined;
const skipped = new Map<string, { byExt: Map<string, number>; files: string[] }>();

/** Sample paths listed per language in the verbose detail. */
const SAMPLE_PATHS = 3;

/**
 * Restrict parsing to these languages/bundles (undefined or empty = auto: any
 * language whose grammar is installed). Listed languages are *required*:
 * throws MissingGrammarError if one cannot be loaded.
 */
export function beginLanguageRun(selection?: string[]): void {
  skipped.clear();
  if (!selection || selection.length === 0) {
    enabled = undefined;
    return;
  }
  const packs = expandSelection(selection);
  enabled = new Set(packs.map(p => p.name));
  for (const p of packs) {
    const s = getGrammar(p.name);
    if (!s.ok) throw new MissingGrammarError(p.name, s);
  }
}

export function isLanguageEnabled(language: string): boolean {
  return !enabled || enabled.has(language);
}

/** True when a file with this extension is a known language we cannot parse right now. */
export function isUnavailable(ext: string): boolean {
  const pack = packForExtension(ext);
  if (!pack) return false;
  return !isLanguageEnabled(pack.name) || !getGrammar(pack.name).ok;
}

export function recordSkipped(language: string, ext: string, file?: string): void {
  const entry = skipped.get(language) ?? { byExt: new Map<string, number>(), files: [] };
  entry.byExt.set(ext, (entry.byExt.get(ext) ?? 0) + 1);
  if (file) entry.files.push(file);
  skipped.set(language, entry);
}

export interface SkippedSummary {
  language: string;
  count: number;
  extensions: string[];
  /** File count per extension. */
  byExtension: Record<string, number>;
  /** Up to SAMPLE_PATHS skipped paths (sorted). */
  samples: string[];
  reason: 'missing' | 'broken' | 'blocked';
  message: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** One-line hint for languages whose grammar is not installed. */
export function missingGrammarHint(missing: Array<Pick<SkippedSummary, 'language' | 'count' | 'byExtension'>>): string {
  const total = missing.reduce((n, s) => n + s.count, 0);
  const parts = missing.flatMap(s =>
    Object.entries(s.byExtension).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([ext, n]) => `${n} ${ext}`)
  );
  const what = total === 1 ? 'file without an installed grammar' : 'files without installed grammars';
  return `found ${parts.join(', ')} ${what} — install with: xray lang add ${missing.map(s => s.language).join(' ')}`;
}

export interface ReportOptions {
  /** Output format of the run; machine formats (json, csv, ...) keep the hint quiet unless verbose. */
  format?: string;
}

/**
 * Report files skipped during the run, then reset. Nothing is installed.
 *
 * - Grammar not installed: ONE aggregated INFO hint, shown for human formats,
 *   hidden for machine formats unless verbose; with verbose, per-language
 *   counts and sample paths at debug level. --quiet (log level error) hides it.
 * - Grammar installed but failing to load: one warning per language.
 *
 * Returns the summaries as data either way.
 */
export function reportSkippedLanguages(opts: ReportOptions = {}): SkippedSummary[] {
  const out: SkippedSummary[] = [];
  for (const [language, { byExt, files }] of skipped) {
    const s = getGrammar(language);
    if (s.ok) continue;
    const extensions = Array.from(byExt.keys()).sort();
    const count = Array.from(byExt.values()).reduce((n, c) => n + c, 0);
    const reason = s.reason ?? 'missing';
    const exts = extensions.join('/');
    const message =
      reason === 'broken'
        ? `skipping ${count} ${exts} ${plural(count, 'file', 'files')}: grammar failed to load (${s.error}) — try \`xray lang add ${language}\``
        : `${count} ${exts} ${plural(count, 'file', 'files')}: grammar not installed — run \`xray lang add ${language}\``;
    out.push({
      language,
      count,
      extensions,
      byExtension: Object.fromEntries(byExt),
      samples: [...files].sort().slice(0, SAMPLE_PATHS),
      reason,
      message,
    });
  }
  skipped.clear();
  out.sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));

  for (const s of out) if (s.reason === 'broken') Logger.warn(s.message);

  const missing = out.filter(s => s.reason !== 'broken');
  if (missing.length === 0) return out;
  const verbose = Logger.getLevel() >= LogLevel.DEBUG;
  if (verbose || !isMachineFormat(opts.format)) Logger.info(missingGrammarHint(missing));
  if (verbose) {
    for (const s of missing) {
      const more = s.count > s.samples.length ? ', …' : '';
      const eg = s.samples.length ? ` — e.g. ${s.samples.join(', ')}${more}` : '';
      Logger.debug(`  ${s.language}: ${s.count} ${plural(s.count, 'file', 'files')} (${s.extensions.join(', ')})${eg}`);
    }
  }
  return out;
}
