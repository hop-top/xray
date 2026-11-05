import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
