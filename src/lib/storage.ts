/**
 * Where xray keeps its own files: never in the project it analyses.
 *
 * Per-project files live under the user cache / state dir, keyed by the
 * project root, so two projects with the same basename never share an
 * entry. XDG_CACHE_HOME / XDG_STATE_HOME win (the kit resolves them).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
const xdg = require('@hop-top/kit/xdg') as {
  cacheDir: (tool: string) => string;
  stateDir: (tool: string) => string;
};

/**
 * Stable key for a project root: 16 hex chars of sha256 of its real path
 * (symlinked spellings of one directory share an entry; a root that does
 * not exist yet falls back to the resolved path).
 */
export function projectKey(projectRoot: string): string {
  const abs = path.resolve(projectRoot);
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    /* not created yet */
  }
  return crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
}

/** Absolute `<base>/xray` dir, or undefined when the platform dir is unusable or relative. */
function absoluteDir(pick: (tool: string) => string): string | undefined {
  try {
    const dir = pick('xray');
    // XDG: a relative path is invalid (and would land under the cwd).
    return path.isAbsolute(dir) ? dir : undefined;
  } catch {
    return undefined;
  }
}

/** `<cache dir>/<...segments>`, or undefined when no usable cache dir exists. */
export function cachePath(...segments: string[]): string | undefined {
  const base = absoluteDir(xdg.cacheDir);
  return base ? path.join(base, ...segments) : undefined;
}

/** `<state dir>/<...segments>`, or undefined when no usable state dir exists. */
export function statePath(...segments: string[]): string | undefined {
  const base = absoluteDir(xdg.stateDir);
  return base ? path.join(base, ...segments) : undefined;
}

/** SQLite analysis cache for a project; undefined when there is no usable cache dir. */
export function projectCacheDbPath(projectRoot: string): string | undefined {
  return cachePath('projects', projectKey(projectRoot), 'xray_cache.db');
}

/** Telemetry sink for a project; undefined when there is no usable state dir. */
export function projectTelemetryPath(projectRoot: string): string | undefined {
  return statePath('telemetry', projectKey(projectRoot), 'telemetry.json');
}

const IS_WIN = process.platform === 'win32';
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const DIRECTORY = fs.constants.O_DIRECTORY ?? 0;

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

/**
 * Directory the trust walk starts below: the parent of the xray cache / state
 * dir that contains `dir` (the XDG base, which the user chose and which may be
 * shared), else the parent of `dir` itself.
 */
function trustRoot(dir: string): string {
  for (const pick of [xdg.cacheDir, xdg.stateDir]) {
    const base = absoluteDir(pick);
    if (!base) continue;
    const rel = path.relative(base, dir);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return path.dirname(base);
  }
  return path.dirname(dir);
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Create `dir` private to the user: mode 0700, owned by `uid` (default: the
 * current user; unchecked where the platform has no uids). An existing loose
 * directory is tightened. Returns false, never throws, when the directory
 * cannot be made private.
 *
 * Every component below `root` (default: the XDG base holding the xray dir,
 * else the parent of `dir`) is created with mode 0700 and then opened
 * O_NOFOLLOW: a symlink, a non-directory, a directory owned by someone else
 * or one writable by group/other (unless sticky) is refused, so a planted
 * entry in a shared XDG dir is never followed into. The leaf is tightened
 * with fchmod on the opened fd, never by path. `root` itself is trusted (the
 * user chose it). Where the platform has no uids or symlink-safe opens
 * (Windows) this is a plain mkdir + directory check.
 */
export function ensurePrivateDir(dir: string, uid: number | undefined = currentUid(), root?: string): boolean {
  try {
    const target = path.resolve(dir);
    if (IS_WIN) {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      return fs.lstatSync(target).isDirectory();
    }
    const base = path.resolve(root ?? trustRoot(target));
    const rel = path.relative(base, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    const parts = rel === '' ? [] : rel.split(path.sep);
    let cur = realpathOrSelf(base);
    fs.mkdirSync(cur, { recursive: true, mode: 0o700 });
    if (parts.length === 0) parts.push(''); // the root is the leaf: check it in place
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        cur = path.join(cur, parts[i]);
        try {
          fs.mkdirSync(cur, { mode: 0o700 });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false;
        }
      }
      const fd = fs.openSync(cur, fs.constants.O_RDONLY | DIRECTORY | NOFOLLOW);
      try {
        const st = fs.fstatSync(fd);
        if (!st.isDirectory()) return false;
        if (uid !== undefined && st.uid !== uid) return false;
        const leaf = i === parts.length - 1;
        if (leaf) {
          fs.fchmodSync(fd, 0o700);
        } else if ((st.mode & 0o022) !== 0 && (st.mode & 0o1000) === 0) {
          return false;
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** fd-based 0600 on an existing regular file we own; no symlink is followed. */
function tightenFile(file: string, create: boolean): boolean {
  const flags = fs.constants.O_RDWR | NOFOLLOW;
  let fd: number | undefined;
  try {
    if (create) {
      try {
        fd = fs.openSync(file, flags | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false;
      }
    }
    if (fd === undefined) {
      try {
        fd = fs.openSync(file, flags);
      } catch (err) {
        // A sidecar that does not exist is fine; a symlink (ELOOP) is not.
        return !create && (err as NodeJS.ErrnoException).code === 'ENOENT';
      }
    }
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return false;
    const uid = currentUid();
    if (uid !== undefined && st.uid !== uid) return false;
    fs.fchmodSync(fd, 0o600);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Make `file` (and its `-wal` / `-shm` sidecars, when present) readable by
 * the user only: mode 0600. The file is created empty first if missing
 * (O_EXCL, so it never exists with looser permissions), and a SQLite db
 * opened later gives its sidecars the same mode. Each is opened O_NOFOLLOW
 * and checked on the fd (regular file, ours) before fchmod: a planted
 * symlink is refused, never followed or chmod-ed by path. False, never
 * throws, when that fails.
 */
export function ensurePrivateFile(file: string): boolean {
  if (IS_WIN) {
    try {
      fs.closeSync(fs.openSync(file, 'a', 0o600));
      return true;
    } catch {
      return false;
    }
  }
  return tightenFile(file, true) && tightenFile(`${file}-wal`, false) && tightenFile(`${file}-shm`, false);
}

/**
 * Path to open the project's SQLite cache at, its directory private (0700)
 * and the db 0600. Falls back to an in-memory db (uncached run, nothing
 * written) when there is no usable cache dir or it cannot be made private
 * (not ours, chmod refused); a dir that is private but not writable fails at
 * open, which the cache turns into the same in-memory run.
 */
export function openCacheDbPath(projectRoot: string, uid?: number): string {
  const file = projectCacheDbPath(projectRoot);
  if (!file) return ':memory:';
  if (!ensurePrivateDir(path.dirname(file), uid) || !ensurePrivateFile(file)) {
    Logger.warn(
      `Cache directory ${path.dirname(file)} is unusable (cannot be made private to this user); ` +
      'running without persistent cache.'
    );
    return ':memory:';
  }
  return file;
}
