import { execFileNoThrow, ExecFileResult } from '../../utils/execFileNoThrow';
import { UsageError } from '../error/types';

export interface GitBranch {
  name: string;
  sha: string;
  committerDate: string;
}

export interface ListCommitsOptions {
  query?: string;
  since?: string;
  until?: string;
  author?: string;
  ref?: string;
  page?: number;
  perPage?: number;
  includeTotalCount?: boolean;
  includeRefs?: boolean;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  refs?: string[];
}

export interface ListCommitsResult {
  commits: GitCommit[];
  page: number;
  perPage: number;
  hasMore: boolean;
  totalCount?: number;
}

export type DiffFileStatus = 'A' | 'M' | 'D' | 'R';

export interface DiffLineRange {
  start: number;
  end: number;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: DiffFileStatus;
  changedLines: DiffLineRange[];
  patch: string;
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
}

function runGit(root: string, args: string[]): Promise<ExecFileResult> {
  return execFileNoThrow('git', ['-C', root, '-c', 'core.quotepath=false', ...args]);
}

function assertSafeRef(ref: string, label = 'ref'): void {
  if (ref.startsWith('-')) {
    throw new UsageError(`Invalid git ${label} '${ref}': refs cannot start with '-'`);
  }
}

/** Check whether `root` is inside a git working tree. */
export async function isGitRepo(root: string): Promise<boolean> {
  const res = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  return res.status === 0 && res.stdout.trim() === 'true';
}

/** Return the full HEAD commit SHA, or `null` when unavailable. */
export async function getHeadSha(root: string): Promise<string | null> {
  const res = await runGit(root, ['rev-parse', 'HEAD']);
  if (res.status !== 0) return null;
  const sha = res.stdout.trim();
  return sha.length > 0 ? sha : null;
}

/** List local and remote branches sorted by most recent committer date. */
export async function listBranches(root: string): Promise<GitBranch[]> {
  const res = await runGit(root, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%00%(objectname:short)%00%(committerdate:iso-strict)',
    'refs/heads',
    'refs/remotes',
  ]);
  if (res.status !== 0 || !res.stdout) return [];

  const branches: GitBranch[] = [];
  for (const rawLine of res.stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) continue;
    const [name, sha, committerDate] = line.split('\0');
    if (name && sha && committerDate) {
      branches.push({ name, sha, committerDate });
    }
  }
  return branches;
}

/** List paginated commits with optional filters, ref decorations, and total count. */
export async function listCommits(
  root: string,
  opts: ListCommitsOptions = {}
): Promise<ListCommitsResult> {
  const ref = opts.ref ?? 'HEAD';
  assertSafeRef(ref, 'ref');

  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.min(100, Math.max(1, Math.floor(opts.perPage ?? 50)));
  const includeTotalCount = opts.includeTotalCount ?? false;
  const includeRefs = opts.includeRefs ?? false;

  const filterArgs: string[] = [];
  if (opts.query) filterArgs.push(`--grep=${opts.query}`);
  if (opts.since) filterArgs.push(`--since=${opts.since}`);
  if (opts.until) filterArgs.push(`--until=${opts.until}`);
  if (opts.author) filterArgs.push(`--author=${opts.author}`);

  const format = includeRefs
    ? '%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%D'
    : '%H%x00%h%x00%an%x00%ae%x00%aI%x00%s';

  const skip = (page - 1) * perPage;
  const res = await runGit(root, [
    'log',
    ...filterArgs,
    `--skip=${skip}`,
    `--max-count=${perPage + 1}`,
    `--format=${format}`,
    ref,
    '--',
  ]);

  if (res.status !== 0) {
    return {
      commits: [],
      page,
      perPage,
      hasMore: false,
      ...(includeTotalCount ? { totalCount: 0 } : {}),
    };
  }

  const rawLines = res.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  const hasMore = rawLines.length > perPage;
  const pageLines = rawLines.slice(0, perPage);

  const commits: GitCommit[] = pageLines.map((line) => {
    const parts = line.split('\0');
    const commit: GitCommit = {
      sha: parts[0] ?? '',
      shortSha: parts[1] ?? '',
      authorName: parts[2] ?? '',
      authorEmail: parts[3] ?? '',
      authorDate: parts[4] ?? '',
      subject: parts[5] ?? '',
    };
    if (includeRefs) {
      const rawRefs = parts[6] ?? '';
      commit.refs = rawRefs
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
    }
    return commit;
  });

  if (!includeTotalCount) {
    return { commits, page, perPage, hasMore };
  }

  const countRes = await runGit(root, ['rev-list', '--count', ...filterArgs, ref, '--']);
  const totalCount =
    countRes.status === 0 ? Number.parseInt(countRes.stdout.trim(), 10) || 0 : commits.length;

  return { commits, page, perPage, hasMore, totalCount };
}

/**
 * Prefixes a `diff --git` header uses for its two sides: `a/… b/…` normally,
 * but `c/… w/…` (commit/worktree), `i/…`, `o/…` with `diff.mnemonicPrefix`,
 * and none at all with `diff.noprefix`. Read from the header so the body
 * lines (`---` / `+++`) are matched with the same prefixes git chose.
 */
function diffPrefixes(headerLine: string): { old: string; new: string } {
  const rest = headerLine.slice('diff --git '.length);
  const match = /^([^\s/]+)\/(.*) ([^\s/]+)\/(.*)$/.exec(rest);
  if (match && match[2].length > 0 && match[4].length > 0) {
    return { old: `${match[1]}/`, new: `${match[3]}/` };
  }
  return { old: 'a/', new: 'b/' };
}

function extractFallbackDiffPath(headerLine: string, prefixes: { old: string; new: string }): string {
  const rest = headerLine.slice('diff --git '.length);
  const { old: oldPrefix, new: newPrefix } = prefixes;
  const mid = (rest.length - 1) / 2;
  if (
    Number.isInteger(mid) &&
    rest.startsWith(oldPrefix) &&
    rest.slice(mid, mid + newPrefix.length + 1) === ` ${newPrefix}` &&
    rest.slice(oldPrefix.length, mid) === rest.slice(mid + newPrefix.length + 1)
  ) {
    return rest.slice(oldPrefix.length, mid);
  }
  const idx = rest.lastIndexOf(` ${newPrefix}`);
  return idx >= 0 ? rest.slice(idx + newPrefix.length + 1) : rest;
}

function parseUnifiedDiff(output: string): DiffFile[] {
  const lines = output.split('\n');
  const files: DiffFile[] = [];

  let currentLines: string[] = [];
  let path = '';
  let oldPath: string | undefined;
  let status: DiffFileStatus = 'M';
  let changedLines: DiffLineRange[] = [];
  let inSection = false;
  let seenHunk = false;
  let prefixes = { old: 'a/', new: 'b/' };

  const flush = (): void => {
    if (!inSection) return;
    const resolvedPath = path || extractFallbackDiffPath(currentLines[0] ?? '', prefixes);
    const patch = currentLines.join('\n').replace(/\n+$/, '');
    const entry: DiffFile = {
      path: resolvedPath,
      status,
      changedLines,
      patch,
    };
    if (status === 'R' && oldPath) {
      entry.oldPath = oldPath;
    }
    files.push(entry);
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      flush();
      inSection = true;
      seenHunk = false;
      currentLines = [line];
      path = '';
      oldPath = undefined;
      status = 'M';
      changedLines = [];
      prefixes = diffPrefixes(line);
      continue;
    }

    if (!inSection) continue;
    currentLines.push(line);

    if (line.startsWith('@@ ')) {
      seenHunk = true;
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (match) {
        const start = Number.parseInt(match[1], 10);
        const count = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
        if (count > 0) {
          changedLines.push({ start, end: start + count - 1 });
        }
      }
      continue;
    }

    if (seenHunk) continue;

    if (line.startsWith('new file mode ')) {
      status = 'A';
    } else if (line.startsWith('deleted file mode ')) {
      status = 'D';
    } else if (line.startsWith('rename from ')) {
      status = 'R';
      oldPath = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) {
      status = 'R';
      path = line.slice('rename to '.length);
    } else if (line.startsWith(`+++ ${prefixes.new}`) && !path) {
      path = line.slice(4 + prefixes.new.length);
    } else if (line.startsWith(`--- ${prefixes.old}`) && !path && status === 'D') {
      path = line.slice(4 + prefixes.old.length);
    }
  }

  flush();
  return files;
}

/**
 * Compute per-file diff entries between `base` and `head`.
 * Pass `base === 'WORKING'` to diff staged and unstaged working tree edits against `HEAD`.
 */
export async function getDiff(
  root: string,
  base: string,
  head = 'HEAD',
  paths?: string[]
): Promise<DiffFile[]> {
  assertSafeRef(base, 'base');
  assertSafeRef(head, 'head');

  const rangeArg = base === 'WORKING' ? 'HEAD' : `${base}..${head}`;
  const args = ['diff', '--unified=0', '-M', rangeArg, '--', ...(paths ?? [])];
  const res = await runGit(root, args);
  if (res.status !== 0 || !res.stdout) return [];

  return parseUnifiedDiff(res.stdout);
}

function parsePorcelainBlame(output: string): BlameLine[] {
  const entries: BlameLine[] = [];
  const metaBySha = new Map<string, { author: string; date: string }>();

  let currentSha = '';
  let currentLine = 0;
  let currentAuthor = '';
  let currentDate = '';

  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line && !currentSha) continue;

    if (line.startsWith('\t')) {
      if (currentSha && currentLine > 0) {
        const cached = metaBySha.get(currentSha);
        const author = currentAuthor || cached?.author || '';
        const date = currentDate || cached?.date || '';
        metaBySha.set(currentSha, { author, date });
        entries.push({ line: currentLine, sha: currentSha, author, date });
      }
      currentSha = '';
      currentLine = 0;
      currentAuthor = '';
      currentDate = '';
      continue;
    }

    const headerMatch = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
    if (headerMatch) {
      currentSha = headerMatch[1];
      currentLine = Number.parseInt(headerMatch[2], 10);
      const cached = metaBySha.get(currentSha);
      currentAuthor = cached?.author ?? '';
      currentDate = cached?.date ?? '';
      continue;
    }

    if (line.startsWith('author ')) {
      currentAuthor = line.slice('author '.length);
    } else if (line.startsWith('author-time ')) {
      const epochSec = Number.parseInt(line.slice('author-time '.length), 10);
      if (!Number.isNaN(epochSec)) {
        currentDate = new Date(epochSec * 1000).toISOString();
      }
    }
  }

  return entries;
}

/** Return per-line blame metadata for `relPath`, optionally at `ref`. */
export async function getFileBlame(
  root: string,
  relPath: string,
  ref?: string
): Promise<BlameLine[]> {
  if (ref !== undefined) assertSafeRef(ref, 'ref');

  const args =
    ref !== undefined
      ? ['blame', '--porcelain', ref, '--', relPath]
      : ['blame', '--porcelain', '--', relPath];

  const res = await runGit(root, args);
  if (res.status !== 0 || !res.stdout) return [];

  return parsePorcelainBlame(res.stdout);
}

/** Count commits touching each file within the last `sinceDays` days. */
export async function getFileChurn(
  root: string,
  sinceDays = 90
): Promise<Map<string, number>> {
  const days = Math.max(0, Math.floor(sinceDays));
  const res = await runGit(root, [
    'log',
    `--since=${days}.days`,
    '--name-only',
    '--pretty=format:',
  ]);

  const counts = new Map<string, number>();
  if (res.status !== 0 || !res.stdout) return counts;

  for (const rawLine of res.stdout.split('\n')) {
    const file = rawLine.replace(/\r$/, '');
    if (!file) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}
