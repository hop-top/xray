import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { getGrammar, isLanguageEnabled, packForExtension, recordSkipped } from './grammars';

interface LanguageConfig {
  grammar: any;
  tagsQuery: string;
  importsQuery?: string;
}

// Grammars load lazily (see grammars.ts); resolved configs are cached per extension.
const resolved = new Map<string, LanguageConfig>();
// Custom queries (from config) survive until the grammar is first loaded.
const queryOverrides = new Map<string, string>();

// Helper to load queries
function loadQuery(name: string): string {
  const p = path.join(__dirname, 'queries', name);
  if (fs.existsSync(p)) {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch (err: any) {
      Logger.warn(`Failed to load query file ${name}: ${err.message}`);
      return '';
    }
  }
  return '';
}

/**
 * Config for a file extension, or undefined when the extension is unknown,
 * the language is not enabled, or its grammar is not installed. In the
 * missing-grammar case the skip is recorded so the run can emit a single
 * warning per language (see flushSkippedWarnings).
 */
export function getLanguageConfig(ext: string): LanguageConfig | undefined {
  const pack = packForExtension(ext);
  if (!pack || !isLanguageEnabled(pack.name)) return undefined;

  const hit = resolved.get(ext);
  if (hit && getGrammar(pack.name).ok) return hit;

  const status = getGrammar(pack.name);
  if (!status.ok) {
    resolved.delete(ext);
    recordSkipped(pack.name, ext);
    return undefined;
  }

  // Note: we reuse tagsQuery for importsQuery for now as we added import captures to the same files
  const query = loadQuery(pack.query);
  const config: LanguageConfig = {
    grammar: status.grammar,
    tagsQuery: queryOverrides.get(ext) ?? query,
    importsQuery: query,
  };
  resolved.set(ext, config);
  return config;
}

export function updateLanguageQuery(ext: string, query: string): void {
  if (!packForExtension(ext)) {
    Logger.warn(`Warning: Cannot update query for unknown extension '${ext}'`);
    return;
  }

  if (!looksLikeTreeSitterQuery(query)) {
    Logger.warn(`Warning: Custom query for '${ext}' does not look like a tree-sitter query (no @capture); keeping default.`);
    return;
  }

  queryOverrides.set(ext, query);
  const config = resolved.get(ext);
  if (config) config.tagsQuery = query;
}

// Cheap structural sniff: a usable tree-sitter query must contain `@capture`
// patterns outside of string literals. Source files in every supported
// language fail this (a stray `"user@example.com"` is rejected because the
// quoted string is stripped first). We deliberately avoid invoking the native
// Parser.Query constructor for validation: it throws on many malformed inputs
// but segfaults on some pathological ones (e.g. raw Go source), which no JS
// try/catch can recover from.
function looksLikeTreeSitterQuery(query: string): boolean {
  if (!query || query.length === 0) return false;
  const stripped = query
    // Strip line comments — tree-sitter query (`;`), C-style (`//`).
    .replace(/;[^\n]*/g, '')
    .replace(/\/\/[^\n]*/g, '')
    // Strip block comments (covers Go/JS/Java/...).
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Strip quoted strings so embedded `@`s in source files don't count.
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`[^`]*`/g, '``');
  return stripped.includes('(') && /@[a-zA-Z_][\w.]*/.test(stripped);
}
