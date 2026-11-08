/**
 * Safe reads of project files.
 *
 * A project is untrusted input: a path inside it can be a symlink to
 * `/dev/zero` or to a file outside the root, a FIFO that blocks `open`
 * forever, or a multi-gigabyte file. Everything that reads a project file
 * on behalf of a scan or a strategy goes through this module, which only
 * ever opens a regular file whose realpath is inside the project root and
 * whose size is within `MAX_FILE_BYTES`.
 *
 * Refused files are tallied; one notice with counts is written to stderr
 * when the process exits (see `reportSkips`), never one line per file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

/**
 * Per-file read cap: 16 MiB. The scanner and parser have no file cap of
 * their own (the parser only bounds per-function flow source, 256 KiB); this
 * reuses the 16 MiB output cap of the Go strategy's process runner
 * (`runProcess`), far above any hand-written source file.
 */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

export type SkipReason = 'not-regular' | 'outside-root' | 'too-large';

const REASON_TEXT: Record<SkipReason, string> = {
  'not-regular': 'not a regular file',
  'outside-root': 'resolving outside the project root',
  'too-large': `over ${MAX_FILE_BYTES / (1024 * 1024)} MiB`,
};

/** A file refused by the guard (not a read error: the file was never opened, or not read in full). */
export class UnsafeFileError extends Error {
  readonly code = 'EXRAY_UNSAFE_FILE';
  constructor(readonly reason: SkipReason, readonly file: string) {
    super(`refusing to read ${file}: ${REASON_TEXT[reason]}`);
    this.name = 'UnsafeFileError';
  }
}

// --- skip tally ------------------------------------------------------------

const skipped = new Map<SkipReason, Set<string>>();
let exitHook = false;

/** Record a refused file; deduplicated by path so repeated globs do not inflate counts. */
export function noteSkip(reason: SkipReason, file: string): void {
  // Dependency trees are never analysed; do not warn about their links.
  if (file.split(/[\\/]/).includes('node_modules')) return;
  let set = skipped.get(reason);
  if (!set) skipped.set(reason, (set = new Set()));
  set.add(file);
  if (!exitHook) {
    exitHook = true;
    process.once('exit', reportSkips);
  }
}

/** Write the single skip notice (if any file was refused) and reset the tally. */
export function reportSkips(): void {
  if (skipped.size === 0) return;
  const parts: string[] = [];
  let total = 0;
  for (const [reason, set] of skipped) {
    total += set.size;
    parts.push(`${set.size} ${REASON_TEXT[reason]}`);
  }
  skipped.clear();
  Logger.warn(`skipped ${total} unsafe file(s): ${parts.join(', ')}`);
}

/** Test hook: forget tallied skips without reporting. */
export function resetSkips(): void {
  skipped.clear();
}

// --- guards ----------------------------------------------------------------

const realRoots = new Map<string, string>();

function realRoot(root: string): string {
  let r = realRoots.get(root);
  if (r === undefined) {
    r = fs.realpathSync(root);
    realRoots.set(root, r);
  }
  return r;
}

function inside(rootReal: string, real: string): boolean {
  const rel = path.relative(rootReal, real);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Open `file` (absolute, or relative to `root`) only if it is a regular
 * file inside `root`; return its fd. The checks run on the resolved path and
 * again on the open descriptor, so a path swapped for a FIFO between check
 * and open cannot block (O_NONBLOCK) or be read.
 */
function openGuarded(root: string, file: string): { fd: number; size: number } {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const rootReal = realRoot(root);
  const real = fs.realpathSync(abs); // ENOENT etc. propagate unchanged
  if (!inside(rootReal, real)) throw new UnsafeFileError('outside-root', file);
  if (!fs.statSync(real).isFile()) throw new UnsafeFileError('not-regular', file);
  const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new UnsafeFileError('not-regular', file);
    if (st.size > MAX_FILE_BYTES) throw new UnsafeFileError('too-large', file);
    return { fd, size: st.size };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

/**
 * Read a project file as bytes. Throws `UnsafeFileError` (and tallies it)
 * for a non-regular file, a path resolving outside `root`, or a file over
 * `MAX_FILE_BYTES`; other errors (ENOENT, EACCES, ...) propagate as-is.
 */
export function readFileSafe(root: string, file: string): Buffer {
  let opened: { fd: number; size: number };
  try {
    opened = openGuarded(root, file);
  } catch (err) {
    if (err instanceof UnsafeFileError) noteSkip(err.reason, file);
    throw err;
  }
  const { fd } = opened;
  try {
    // Read to EOF, bounded by the cap: the size from fstat can be stale.
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.allocUnsafe(Math.min(1 << 20, MAX_FILE_BYTES + 1 - total));
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_FILE_BYTES) {
        noteSkip('too-large', file);
        throw new UnsafeFileError('too-large', file);
      }
      chunks.push(n === buf.length ? buf : buf.subarray(0, n));
    }
    return Buffer.concat(chunks, total);
  } finally {
    fs.closeSync(fd);
  }
}

/** `readFileSafe` decoded as UTF-8. */
export function readTextSafe(root: string, file: string): string {
  return readFileSafe(root, file).toString('utf-8');
}

/** Per-root cache of directories known to resolve inside the root. */
const dirVerdicts = new Map<string, Map<string, boolean>>();

function dirInside(root: string, dir: string): boolean {
  let m = dirVerdicts.get(root);
  if (!m) dirVerdicts.set(root, (m = new Map()));
  let v = m.get(dir);
  if (v === undefined) {
    try {
      v = inside(realRoot(root), fs.realpathSync(dir));
    } catch {
      v = false;
    }
    m.set(dir, v);
  }
  return v;
}

/**
 * Whether a path matched by a glob under `root` (relative to it, or
 * absolute) may be handed to a strategy: its directory resolves inside the
 * root, it is not a FIFO / socket / device, and a symlink only when it
 * resolves inside the root to a file or directory. Refusals are tallied.
 */
export function isSafeEntry(root: string, rel: string): boolean {
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!dirInside(root, path.dirname(abs))) {
    noteSkip('outside-root', rel);
    return false;
  }
  try {
    const st = fs.lstatSync(abs);
    if (st.isFile() || st.isDirectory()) return true;
    if (st.isSymbolicLink()) {
      const real = fs.realpathSync(abs);
      if (!inside(realRoot(root), real)) {
        noteSkip('outside-root', rel);
        return false;
      }
      const target = fs.statSync(real);
      if (target.isFile() || target.isDirectory()) return true;
    }
    noteSkip('not-regular', rel);
    return false;
  } catch {
    // Dangling link or vanished entry: nothing to read.
    return false;
  }
}
