import * as fs from 'fs';
import * as path from 'path';
import type { Store as KitStore } from '@hop-top/kit/dist/sqlstore';
import { UsageError } from '../error/types';
import { Logger } from '../logger';
import { truncateLine, windowSlice } from '../output-guardrails';
import { MAX_FILE_BYTES, readTextSafe } from '../safe-read';
import { cachePath, ensurePrivateDir, ensurePrivateFile, projectKey } from '../storage';

export const MAX_INDEX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_UNIQUE_TRIGRAMS = 20_000;
export const DEFAULT_SEARCH_LIMIT = 100;
export const MAX_SEARCH_LIMIT = 500;
export const MAX_LINE_CHARS = 500;

interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface DatabaseHandle {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}

interface Store {
  db(): DatabaseHandle;
  close(): void;
}

// require() because tsconfig moduleResolution is 'node' (legacy), which does
// not honor @hop-top/kit's `exports` map. Runtime resolution does.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('@hop-top/kit/sqlstore') as {
  open: (path: string, opts?: { ttl?: number; migrateSql?: string }) => Store & Pick<KitStore, 'close'>;
};

const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS files_meta (
  rel_path TEXT PRIMARY KEY,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  skipped TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
  rel_path UNINDEXED,
  content,
  tokenize="trigram"
);
`;

export type SyncEntry = string | { abs: string; rel: string };

export interface SyncResult {
  indexed: number;
  unchanged: number;
  skipped: number;
  removed: number;
}

export interface TrigramSearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  offset?: number;
  limit?: number;
  allowedRelPaths?: ReadonlySet<string>;
}

export interface TrigramSearchMatch {
  file: string;
  relPath: string;
  line: number;
  keyword: string;
  content: string;
}

export interface TrigramSearchResult {
  matches: TrigramSearchMatch[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  candidateFiles: number;
  usedFts: boolean;
}

interface FileMetaRow {
  rel_path: string;
  mtime_ms: number;
  size: number;
  skipped: string | null;
}

function normalizeRel(rel: string): string {
  return rel.split(path.sep).join('/');
}

/**
 * Returns true if `content` contains more than `cap` unique 3-char substrings.
 */
export function exceedsTrigramCap(content: string, cap = MAX_UNIQUE_TRIGRAMS): boolean {
  if (content.length < 3) return false;
  const seen = new Set<string>();
  for (let i = 0; i <= content.length - 3; i++) {
    seen.add(content.slice(i, i + 3));
    if (seen.size > cap) return true;
  }
  return false;
}

function splitTopLevelAlternation(pattern: string): string[] {
  const branches: string[] = [];
  let start = 0;
  let escaped = false;
  let inClass = false;
  let classStart = false;
  let parenDepth = 0;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (classStart && ch === '^') {
        continue;
      }
      if (ch === ']' && !classStart) {
        inClass = false;
      }
      classStart = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      classStart = true;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth--;
      continue;
    }
    if (ch === '|' && parenDepth === 0) {
      branches.push(pattern.slice(start, i));
      start = i + 1;
    }
  }
  branches.push(pattern.slice(start));
  return branches;
}

type QuantifierKind = 'none' | 'optional' | 'repeat' | 'exact-one';

function readQuantifier(pattern: string, pos: number): { kind: QuantifierKind; nextPos: number } {
  if (pos >= pattern.length) return { kind: 'none', nextPos: pos };
  const ch = pattern[pos];
  let kind: QuantifierKind = 'none';
  let end = pos;

  if (ch === '?' || ch === '*') {
    kind = 'optional';
    end = pos + 1;
  } else if (ch === '+') {
    kind = 'repeat';
    end = pos + 1;
  } else if (ch === '{') {
    const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(pos));
    if (m) {
      const min = parseInt(m[1], 10);
      const hasComma = m[2] !== undefined;
      const max = hasComma && m[2] !== '' ? parseInt(m[2], 10) : undefined;
      if (min === 0) {
        kind = 'optional';
      } else if (!hasComma && min === 1) {
        kind = 'exact-one';
      } else if (hasComma && max === 1 && min === 1) {
        kind = 'exact-one';
      } else {
        kind = 'repeat';
      }
      end = pos + m[0].length;
    }
  }

  if (kind !== 'none' && end < pattern.length && (pattern[end] === '?' || pattern[end] === '+')) {
    end++;
  }
  return { kind, nextPos: end };
}

function skipCharClass(pattern: string, pos: number): number {
  let i = pos + 1;
  let first = true;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      first = false;
      continue;
    }
    if (first && ch === '^') {
      i++;
      continue;
    }
    if (ch === ']' && !first) {
      return i + 1;
    }
    first = false;
    i++;
  }
  return pattern.length;
}

function skipGroup(pattern: string, pos: number): number {
  let depth = 0;
  let i = pos;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      i = skipCharClass(pattern, i);
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return pattern.length;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  v: '\v',
};

const NON_LITERAL_ESCAPES = new Set([
  'd', 'D', 'w', 'W', 's', 'S', 'b', 'B', 'p', 'P', 'k', 'x', 'u', 'c',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);

function extractLongestRequiredLiteral(branch: string): string | null {
  let best = '';
  let current = '';
  let i = 0;

  const commit = () => {
    if (current.length > best.length) best = current;
  };

  while (i < branch.length) {
    const ch = branch[i];
    let literalChar: string | null = null;
    let atomEnd = i + 1;

    if (ch === '\\') {
      if (i + 1 >= branch.length) break;
      const esc = branch[i + 1];
      atomEnd = i + 2;
      if (esc in SIMPLE_ESCAPES) {
        literalChar = SIMPLE_ESCAPES[esc];
      } else if (!NON_LITERAL_ESCAPES.has(esc)) {
        literalChar = esc;
      }
    } else if (ch === '[') {
      atomEnd = skipCharClass(branch, i);
    } else if (ch === '(') {
      atomEnd = skipGroup(branch, i);
    } else if (ch === '.' || ch === '^' || ch === '$') {
      atomEnd = i + 1;
    } else if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      const q = readQuantifier(branch, i);
      atomEnd = Math.max(i + 1, q.nextPos);
      current = '';
      i = atomEnd;
      continue;
    } else {
      literalChar = ch;
    }

    const q = ch === '^' || ch === '$'
      ? { kind: 'none' as QuantifierKind, nextPos: atomEnd }
      : readQuantifier(branch, atomEnd);

    if (literalChar === null || q.kind === 'optional') {
      current = '';
    } else if (q.kind === 'repeat') {
      current += literalChar;
      commit();
      current = '';
    } else {
      current += literalChar;
      commit();
    }

    i = q.nextPos;
  }

  return best.length >= 3 ? best : null;
}

/**
 * Extract one required literal of length >= 3 from every top-level `|` branch
 * of a regex. Returns `null` if any branch lacks a required >= 3-char literal.
 */
export function extractBranchLiterals(pattern: string): string[] | null {
  if (!pattern) return null;
  const branches = splitTopLevelAlternation(pattern);
  if (branches.length === 0) return null;

  const literals: string[] = [];
  const seen = new Set<string>();
  for (const branch of branches) {
    const lit = extractLongestRequiredLiteral(branch);
    if (!lit) return null;
    if (!seen.has(lit)) {
      seen.add(lit);
      literals.push(lit);
    }
  }
  return literals;
}

function escapeFtsPhrase(literal: string): string {
  return `"${literal.replace(/"/g, '""')}"`;
}

export function openSearchDbPath(root: string): string {
  const dbFile = cachePath('search', `${projectKey(root)}.db`);
  if (!dbFile) return ':memory:';
  if (!ensurePrivateDir(path.dirname(dbFile)) || !ensurePrivateFile(dbFile)) {
    Logger.warn(
      `Search index directory ${path.dirname(dbFile)} is unusable (cannot be made private to this user); ` +
      'running with in-memory search index.'
    );
    return ':memory:';
  }
  return dbFile;
}

export class TrigramIndex {
  private readonly root: string;
  private readonly store: Store;
  private readonly db: DatabaseHandle;

  constructor(root: string, dbPathOverride?: string) {
    this.root = path.resolve(root);
    const targetPath = dbPathOverride ?? openSearchDbPath(this.root);
    this.store = TrigramIndex.openStore(targetPath);
    this.db = this.store.db();
  }

  private static openStore(dbPath: string): Store {
    try {
      return open(dbPath, { migrateSql: MIGRATE_SQL });
    } catch (err) {
      Logger.warn(
        `Search index at ${dbPath} unusable (${(err as Error).message}); running with in-memory search index.`
      );
      return open(':memory:', { migrateSql: MIGRATE_SQL });
    }
  }

  close(): void {
    this.store.close();
  }

  sync(root: string, entries: readonly SyncEntry[]): SyncResult {
    const resolvedRoot = path.resolve(root);
    const normalized = entries.map((e) => {
      if (typeof e === 'string') {
        const rel = normalizeRel(e);
        return { abs: path.resolve(resolvedRoot, e), rel };
      }
      return { abs: e.abs, rel: normalizeRel(e.rel) };
    });

    const existingRows = this.db
      .prepare('SELECT rel_path, mtime_ms, size, skipped FROM files_meta')
      .all() as FileMetaRow[];
    const metaMap = new Map<string, FileMetaRow>(existingRows.map((r) => [r.rel_path, r]));
    const currentSet = new Set<string>(normalized.map((e) => e.rel));

    const toDeleteFts: string[] = [];
    const toDeleteMeta: string[] = [];
    const toUpsertMeta: Array<{ rel: string; mtimeMs: number; size: number; skipped: string | null }> = [];
    const toInsertFts: Array<{ rel: string; content: string }> = [];

    let indexed = 0;
    let unchanged = 0;
    let skipped = 0;
    let removed = 0;

    for (const rel of metaMap.keys()) {
      if (!currentSet.has(rel)) {
        toDeleteMeta.push(rel);
        toDeleteFts.push(rel);
        removed++;
      }
    }

    for (const entry of normalized) {
      let st: fs.Stats;
      try {
        st = fs.statSync(entry.abs);
      } catch {
        continue;
      }

      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        try {
          readTextSafe(resolvedRoot, entry.abs);
        } catch {
          // safe-read tallies the refused file for the single exit notice
        }
        continue;
      }

      const prev = metaMap.get(entry.rel);
      if (prev && prev.mtime_ms === st.mtimeMs && prev.size === st.size) {
        unchanged++;
        continue;
      }

      if (st.size > MAX_INDEX_FILE_BYTES) {
        if (prev && prev.skipped === null) toDeleteFts.push(entry.rel);
        toUpsertMeta.push({ rel: entry.rel, mtimeMs: st.mtimeMs, size: st.size, skipped: 'too-large' });
        skipped++;
        continue;
      }

      let content: string;
      try {
        content = readTextSafe(resolvedRoot, entry.abs);
      } catch {
        continue;
      }

      if (exceedsTrigramCap(content)) {
        if (prev && prev.skipped === null) toDeleteFts.push(entry.rel);
        toUpsertMeta.push({ rel: entry.rel, mtimeMs: st.mtimeMs, size: st.size, skipped: 'too-many-trigrams' });
        skipped++;
        continue;
      }

      if (prev && prev.skipped === null) {
        toDeleteFts.push(entry.rel);
      }
      toUpsertMeta.push({ rel: entry.rel, mtimeMs: st.mtimeMs, size: st.size, skipped: null });
      toInsertFts.push({ rel: entry.rel, content });
      indexed++;
    }

    if (toDeleteMeta.length > 0 || toDeleteFts.length > 0 || toUpsertMeta.length > 0) {
      const delMetaStmt = this.db.prepare('DELETE FROM files_meta WHERE rel_path = ?');
      const delFtsStmt = this.db.prepare('DELETE FROM code_fts WHERE rel_path = ?');
      const upsertMetaStmt = this.db.prepare(
        'INSERT OR REPLACE INTO files_meta (rel_path, mtime_ms, size, skipped) VALUES (?, ?, ?, ?)'
      );
      const insFtsStmt = this.db.prepare('INSERT INTO code_fts (rel_path, content) VALUES (?, ?)');

      this.db.transaction(() => {
        for (const rel of toDeleteFts) delFtsStmt.run(rel);
        for (const rel of toDeleteMeta) delMetaStmt.run(rel);
        for (const row of toUpsertMeta) upsertMetaStmt.run(row.rel, row.mtimeMs, row.size, row.skipped);
        for (const row of toInsertFts) insFtsStmt.run(row.rel, row.content);
      })();
    }

    return { indexed, unchanged, skipped, removed };
  }

  search(pattern: string, opts: TrigramSearchOptions = {}): TrigramSearchResult {
    const regexMode = opts.regex === true;
    const caseSensitive = opts.caseSensitive === true;

    let matcher: RegExp | null = null;
    if (regexMode) {
      try {
        matcher = new RegExp(pattern, caseSensitive ? '' : 'i');
      } catch (err) {
        throw new UsageError(`Invalid regex pattern '${pattern}': ${(err as Error).message}`);
      }
    }

    const literals = regexMode
      ? extractBranchLiterals(pattern)
      : (pattern.length >= 3 ? [pattern] : null);

    let candidates: string[];
    let usedFts = false;

    if (literals && literals.length > 0) {
      usedFts = true;
      const sql = literals
        .map(() => 'SELECT rel_path FROM code_fts WHERE code_fts MATCH ?')
        .join(' UNION ');
      const rows = this.db.prepare(sql).all(...literals.map(escapeFtsPhrase)) as Array<{ rel_path: string }>;
      candidates = rows.map((r) => r.rel_path);
    } else {
      const rows = this.db
        .prepare('SELECT rel_path FROM files_meta WHERE skipped IS NULL')
        .all() as Array<{ rel_path: string }>;
      candidates = rows.map((r) => r.rel_path);
    }

    if (opts.allowedRelPaths) {
      const allowed = opts.allowedRelPaths;
      candidates = candidates.filter((rel) => allowed.has(rel));
    }
    candidates.sort();

    const needleLower = caseSensitive ? pattern : pattern.toLowerCase();
    const allMatches: TrigramSearchMatch[] = [];

    for (const rel of candidates) {
      const abs = path.resolve(this.root, rel);
      let content: string;
      try {
        content = readTextSafe(this.root, abs);
      } catch {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hit = matcher
          ? matcher.test(line)
          : (caseSensitive ? line.includes(pattern) : line.toLowerCase().includes(needleLower));
        if (hit) {
          allMatches.push({
            file: abs,
            relPath: rel,
            line: i + 1,
            keyword: pattern,
            content: truncateLine(line.trim(), MAX_LINE_CHARS).text,
          });
        }
      }
    }

    const sliced = windowSlice(allMatches, {
      offset: opts.offset ?? 0,
      limit: opts.limit ?? DEFAULT_SEARCH_LIMIT,
      maxLimit: MAX_SEARCH_LIMIT,
    });

    return {
      matches: sliced.items,
      total: sliced.total,
      offset: sliced.offset,
      limit: sliced.limit,
      hasMore: sliced.hasMore,
      candidateFiles: candidates.length,
      usedFts,
    };
  }
}
