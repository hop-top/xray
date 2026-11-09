import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../src/lib/logger';
import {
  projectKey, projectCacheDbPath, projectTelemetryPath, openCacheDbPath,
  ensurePrivateDir, ensurePrivateFile,
} from '../../src/lib/storage';

describe('storage locations', () => {
  const saved = { cache: process.env.XDG_CACHE_HOME, state: process.env.XDG_STATE_HOME };
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-storage-'));
  });
  afterEach(() => {
    for (const [k, v] of [['XDG_CACHE_HOME', saved.cache], ['XDG_STATE_HOME', saved.state]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('XDG_CACHE_HOME wins for the cache db; XDG_STATE_HOME for telemetry', () => {
    process.env.XDG_CACHE_HOME = path.join(tmp, 'c');
    process.env.XDG_STATE_HOME = path.join(tmp, 's');
    const key = projectKey(tmp);
    expect(projectCacheDbPath(tmp)).toBe(path.join(tmp, 'c', 'xray', 'projects', key, 'xray_cache.db'));
    expect(projectTelemetryPath(tmp)).toBe(path.join(tmp, 's', 'xray', 'telemetry', key, 'telemetry.json'));
  });

  it('key is stable and differs for same-basename roots', () => {
    const a = path.join(tmp, 'one', 'app');
    const b = path.join(tmp, 'two', 'app');
    expect(projectKey(a)).toBe(projectKey(a));
    expect(projectKey(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(projectKey(a)).not.toBe(projectKey(b));
  });

  it('a symlinked spelling of a root shares its key', () => {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    const link = path.join(tmp, 'link');
    fs.symlinkSync(real, link);
    expect(projectKey(link)).toBe(projectKey(real));
  });

  it('a relative XDG dir is unusable: no path, in-memory db, nothing created under the cwd', () => {
    process.env.XDG_CACHE_HOME = 'relative-cache';
    process.env.XDG_STATE_HOME = 'relative-state';
    expect(projectCacheDbPath(tmp)).toBeUndefined();
    expect(projectTelemetryPath(tmp)).toBeUndefined();
    expect(openCacheDbPath(tmp)).toBe(':memory:');
    expect(fs.existsSync(path.resolve('relative-cache'))).toBe(false);
  });

  it('openCacheDbPath creates the parent dir; an unwritable cache dir degrades to memory', () => {
    process.env.XDG_CACHE_HOME = path.join(tmp, 'c');
    const file = openCacheDbPath(tmp);
    expect(file).toBe(projectCacheDbPath(tmp));
    expect(fs.existsSync(path.dirname(file))).toBe(true);

    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, 'x');
    process.env.XDG_CACHE_HOME = blocker;
    expect(openCacheDbPath(tmp)).toBe(':memory:');
  });

  (process.platform === 'win32' ? describe.skip : describe)('private dirs and files', () => {
    const mode = (p: string) => fs.statSync(p).mode & 0o777;

    it('ensurePrivateDir creates 0700 (parents too) and tightens a loose dir', () => {
      const leaf = path.join(tmp, 'a', 'b');
      expect(ensurePrivateDir(leaf)).toBe(true);
      expect(mode(leaf)).toBe(0o700);
      fs.chmodSync(leaf, 0o755);
      expect(ensurePrivateDir(leaf)).toBe(true);
      expect(mode(leaf)).toBe(0o700);
    });

    it('ensurePrivateDir refuses a directory owned by someone else (uid injected: a real foreign owner cannot be faked)', () => {
      const dir = path.join(tmp, 'theirs');
      fs.mkdirSync(dir, { mode: 0o755 });
      const mine = process.getuid!();
      expect(ensurePrivateDir(dir, mine + 1)).toBe(false);
      expect(mode(dir)).toBe(0o755); // untouched
    });

    it('ensurePrivateDir refuses a file or a symlink in its place', () => {
      const file = path.join(tmp, 'file');
      fs.writeFileSync(file, 'x');
      expect(ensurePrivateDir(file)).toBe(false);
      const real = path.join(tmp, 'real');
      fs.mkdirSync(real);
      const link = path.join(tmp, 'link');
      fs.symlinkSync(real, link);
      expect(ensurePrivateDir(link)).toBe(false);
    });

    it('ensurePrivateFile makes the file and existing sidecars 0600', () => {
      const f = path.join(tmp, 'x.db');
      expect(ensurePrivateFile(f)).toBe(true);
      expect(mode(f)).toBe(0o600);
      fs.writeFileSync(`${f}-wal`, '');
      fs.chmodSync(`${f}-wal`, 0o644);
      fs.chmodSync(f, 0o644);
      expect(ensurePrivateFile(f)).toBe(true);
      expect(mode(f)).toBe(0o600);
      expect(mode(`${f}-wal`)).toBe(0o600);
    });

    it('openCacheDbPath falls back to memory when the cache dir is not ours', () => {
      process.env.XDG_CACHE_HOME = path.join(tmp, 'c');
      const dir = path.dirname(projectCacheDbPath(tmp)!);
      fs.mkdirSync(dir, { recursive: true });
      expect(openCacheDbPath(tmp, process.getuid!() + 1)).toBe(':memory:');
      expect(fs.existsSync(projectCacheDbPath(tmp)!)).toBe(false);
    });
  });
});

(process.platform === 'win32' ? describe.skip : describe)('hostile shared XDG dir', () => {
  const saved = { cache: process.env.XDG_CACHE_HOME, state: process.env.XDG_STATE_HOME };
  const mode = (p: string) => fs.statSync(p).mode & 0o777;
  let tmp: string;
  let outside: string;
  let sentinel: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hostile-')));
    outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    sentinel = path.join(outside, 'sentinel');
    fs.writeFileSync(sentinel, 'secret');
    fs.chmodSync(sentinel, 0o644);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [k, v] of [['XDG_CACHE_HOME', saved.cache], ['XDG_STATE_HOME', saved.state]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('ensurePrivateFile does not follow a planted symlink: target neither chmod-ed nor written', () => {
    const f = path.join(tmp, 'x.db');
    fs.symlinkSync(sentinel, f);
    expect(ensurePrivateFile(f)).toBe(false);
    expect(mode(sentinel)).toBe(0o644);
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('secret');
  });

  it('ensurePrivateFile does not follow a symlinked -wal sidecar', () => {
    const f = path.join(tmp, 'x.db');
    fs.symlinkSync(sentinel, `${f}-wal`);
    expect(ensurePrivateFile(f)).toBe(false);
    expect(mode(sentinel)).toBe(0o644);
  });

  it('ensurePrivateFile refuses a non-regular file in its place', () => {
    const f = path.join(tmp, 'adir');
    fs.mkdirSync(f);
    expect(ensurePrivateFile(f)).toBe(false);
  });

  it('ensurePrivateDir refuses a symlinked ancestor below the root and creates nothing through it', () => {
    const root = path.join(tmp, 'shared');
    fs.mkdirSync(root);
    fs.symlinkSync(outside, path.join(root, 'xray'));
    expect(ensurePrivateDir(path.join(root, 'xray', 'projects', 'k'), undefined, root)).toBe(false);
    expect(fs.readdirSync(outside)).toEqual(['sentinel']);
    expect(mode(outside)).not.toBe(0o700);
  });

  it('ensurePrivateDir refuses a group/other-writable ancestor below the root unless sticky', () => {
    const root = path.join(tmp, 'shared');
    fs.mkdirSync(root);
    const mid = path.join(root, 'xray');
    fs.mkdirSync(mid);
    fs.chmodSync(mid, 0o777);
    expect(ensurePrivateDir(path.join(mid, 'k'), undefined, root)).toBe(false);
    expect(fs.existsSync(path.join(mid, 'k'))).toBe(false);
    fs.chmodSync(mid, 0o1777);
    expect(ensurePrivateDir(path.join(mid, 'k'), undefined, root)).toBe(true);
  });

  it('ensurePrivateDir refuses an ancestor owned by someone else (uid injected)', () => {
    const root = path.join(tmp, 'shared');
    fs.mkdirSync(path.join(root, 'xray'), { recursive: true });
    expect(ensurePrivateDir(path.join(root, 'xray', 'k'), process.getuid!() + 1, root)).toBe(false);
  });

  it('a planted symlink under a shared XDG_CACHE_HOME: in-memory db, one warning, nothing created outside', () => {
    const shared = path.join(tmp, 'shared');
    fs.mkdirSync(shared);
    fs.symlinkSync(outside, path.join(shared, 'xray'));
    process.env.XDG_CACHE_HOME = shared;
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(openCacheDbPath(tmp)).toBe(':memory:');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(outside)).toEqual(['sentinel']);
  });

  it('a planted db symlink under XDG_CACHE_HOME: in-memory db, target untouched', () => {
    process.env.XDG_CACHE_HOME = path.join(tmp, 'c');
    const db = projectCacheDbPath(tmp)!;
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.symlinkSync(sentinel, db);
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(openCacheDbPath(tmp)).toBe(':memory:');
    expect(mode(sentinel)).toBe(0o644);
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('secret');
  });
});
