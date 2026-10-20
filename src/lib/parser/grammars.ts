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
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { Logger } from '../logger';
import { NotFoundError, UsageError } from '../error/types';

export interface LanguagePack {
  /** Canonical language name (what `xray lang add <name>` takes). */
  name: string;
  /** npm package providing the grammar. */
  module: string;
  /** Semver range xray is tested against (kept in sync with package.json). */
  range: string;
  /** Property of the module holding the grammar (e.g. php -> `php`). */
  exportKey?: string;
  /** File extensions (with dot) parsed with this grammar. */
  extensions: string[];
  /** Query file under src/lib/parser/queries. */
  query: string;
  /** Alternative spellings accepted on the CLI / in config. */
  aliases?: string[];
}

export const LANGUAGE_PACKS: LanguagePack[] = [
  { name: 'typescript', module: 'tree-sitter-typescript', range: '^0.23.2', exportKey: 'typescript', extensions: ['.ts', '.tsx'], query: 'typescript.scm', aliases: ['ts'] },
  { name: 'javascript', module: 'tree-sitter-javascript', range: '^0.25.0', extensions: ['.js', '.jsx'], query: 'javascript.scm', aliases: ['js'] },
  { name: 'python', module: 'tree-sitter-python', range: '^0.25.0', extensions: ['.py'], query: 'python.scm', aliases: ['py'] },
  { name: 'java', module: 'tree-sitter-java', range: '^0.23.5', extensions: ['.java'], query: 'java.scm' },
  { name: 'csharp', module: 'tree-sitter-c-sharp', range: '~0.23.1', extensions: ['.cs'], query: 'c_sharp.scm', aliases: ['c-sharp', 'cs'] },
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
  /** missing = not installed; broken = installed but failed to load; blocked = XRAY_LANG_BLOCK. */
  reason?: 'missing' | 'broken' | 'blocked';
  error?: string;
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
 * Resolution roots. SECURITY: the scanned repo's node_modules is an untrusted
 * search path (loading a grammar executes native/JS code), so it is consulted
 * only when the user opts in via the XRAY_ALLOW_PROJECT_GRAMMARS env var -
 * never via repo-local config. The managed dir is only redirectable by
 * XRAY_LANG_DIR / XDG_DATA_HOME (user environment), never by repo files.
 */
function candidates(mod: string): Array<{ source: GrammarSource; load: () => any }> {
  const list: Array<{ source: GrammarSource; load: () => any }> = [
    { source: 'xray', load: () => require(mod) },
    { source: 'managed', load: () => createRequire(path.join(managedDir(), 'noop.js'))(mod) },
  ];
  if (process.env.XRAY_ALLOW_PROJECT_GRAMMARS === '1') {
    list.push({
      source: 'project',
      load: () => {
        const from = path.join(process.cwd(), 'noop.js');
        const resolved = createRequire(from).resolve(mod);
        Logger.warn(`loading grammar from project path ${resolved} (XRAY_ALLOW_PROJECT_GRAMMARS=1)`);
        return createRequire(from)(mod);
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
const skipped = new Map<string, { exts: Set<string>; count: number }>();

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

export function recordSkipped(language: string, ext: string): void {
  const entry = skipped.get(language) ?? { exts: new Set<string>(), count: 0 };
  entry.exts.add(ext);
  entry.count++;
  skipped.set(language, entry);
}

export interface SkippedSummary {
  language: string;
  count: number;
  extensions: string[];
  reason: 'missing' | 'broken' | 'blocked';
  message: string;
}

/** Emit one warning per language skipped during the run, then reset. */
export function flushSkippedWarnings(): SkippedSummary[] {
  const out: SkippedSummary[] = [];
  for (const [language, { exts, count }] of skipped) {
    const s = getGrammar(language);
    if (s.ok) continue;
    const extensions = Array.from(exts).sort();
    const what = `skipping ${count} ${extensions.join('/')} file${count === 1 ? '' : 's'}`;
    const message =
      s.reason === 'broken'
        ? `${what}: grammar failed to load (${s.error}) — try \`xray lang add ${language}\``
        : `${what}: grammar not installed — run \`xray lang add ${language}\``;
    out.push({ language, count, extensions, reason: s.reason ?? 'missing', message });
    Logger.warn(message);
  }
  skipped.clear();
  return out;
}
