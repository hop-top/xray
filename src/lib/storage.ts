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

/**
 * Create `dir` (and parents) private to the user: mode 0700, owned by `uid`
 * (default: the current user; unchecked where the platform has no uids).
 * An existing loose directory is tightened. Returns false, never throws,
 * when the directory cannot be made private (not a real directory, owned by
 * someone else, chmod refused).
 */
export function ensurePrivateDir(dir: string, uid: number | undefined = currentUid()): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (!st.isDirectory()) return false;
    if (uid !== undefined && st.uid !== uid) return false;
    fs.chmodSync(dir, 0o700);
    return true;
  } catch {
    return false;
  }
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

/**
 * Make `file` (and its `-wal` / `-shm` sidecars, when present) readable by
 * the user only: mode 0600. The file is created empty first if missing, so
 * it never exists with looser permissions, and a SQLite db opened later
 * gives its sidecars the same mode. False, never throws, when that fails.
 */
export function ensurePrivateFile(file: string): boolean {
  try {
    fs.closeSync(fs.openSync(file, 'a', 0o600));
    for (const f of [file, `${file}-wal`, `${file}-shm`]) {
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    }
    return true;
  } catch {
    return false;
  }
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
