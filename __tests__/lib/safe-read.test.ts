import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../src/lib/logger';
import {
  MAX_FILE_BYTES, UnsafeFileError, isSafeEntry, readFileSafe, readTextSafe, reportSkips, resetSkips,
} from '../../src/lib/safe-read';

const posix = process.platform !== 'win32';
let base: string;
let root: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-safe-read-')));
  root = path.join(base, 'root');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outside.txt'), 'OUTSIDE');
  fs.writeFileSync(path.join(root, 'a.txt'), 'inside');
  fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'bee');
  fs.symlinkSync('a.txt', path.join(root, 'link-in.txt'));
  fs.symlinkSync('../sub/b.txt', path.join(root, 'sub', 'link-up.txt'));
  fs.symlinkSync(path.join(base, 'outside.txt'), path.join(root, 'link-out.txt'));
  fs.symlinkSync(base, path.join(root, 'dir-out'));
  fs.symlinkSync('missing.txt', path.join(root, 'dangling.txt'));
  if (posix) {
    fs.symlinkSync('/dev/zero', path.join(root, 'zero'));
    fs.symlinkSync('/proc/self/environ', path.join(root, 'proc-environ'));
    spawnSync('mkfifo', [path.join(root, 'fifo')]);
  }
  fs.writeFileSync(path.join(root, 'big.txt'), '');
  fs.truncateSync(path.join(root, 'big.txt'), MAX_FILE_BYTES + 1);
  fs.writeFileSync(path.join(root, 'cap.txt'), '');
  fs.truncateSync(path.join(root, 'cap.txt'), MAX_FILE_BYTES);
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
beforeEach(() => resetSkips());

const refusal = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof UnsafeFileError ? e.reason : `other:${(e as Error).message}`; }
  return undefined;
};

describe('readFileSafe', () => {
  it('reads a regular file, relative or absolute', () => {
    expect(readTextSafe(root, 'a.txt')).toBe('inside');
    expect(readTextSafe(root, path.join(root, 'sub', 'b.txt'))).toBe('bee');
  });

  it('follows a link that stays inside the root', () => {
    expect(readTextSafe(root, 'link-in.txt')).toBe('inside');
    expect(readTextSafe(root, 'sub/link-up.txt')).toBe('bee');
  });

  it('refuses a link out, a dir link out and an absolute path outside', () => {
    expect(refusal(() => readFileSafe(root, 'link-out.txt'))).toBe('outside-root');
    expect(refusal(() => readFileSafe(root, 'dir-out/outside.txt'))).toBe('outside-root');
    expect(refusal(() => readFileSafe(root, path.join(base, 'outside.txt')))).toBe('outside-root');
    expect(refusal(() => readFileSafe(root, '../outside.txt'))).toBe('outside-root');
  });

  it('refuses a directory', () => {
    expect(refusal(() => readFileSafe(root, 'sub'))).toBe('not-regular');
  });

  it('refuses a file over the cap, accepts one at the cap', () => {
    expect(refusal(() => readFileSafe(root, 'big.txt'))).toBe('too-large');
    expect(readFileSafe(root, 'cap.txt').length).toBe(MAX_FILE_BYTES);
  });

  it('passes ordinary errors through', () => {
    expect((() => { try { readFileSafe(root, 'nope.txt'); } catch (e: any) { return e.code; } })()).toBe('ENOENT');
    expect((() => { try { readFileSafe(root, 'dangling.txt'); } catch (e: any) { return e.code; } })()).toBe('ENOENT');
  });

  (posix ? describe : describe.skip)('special files', () => {
    it('refuses a FIFO without blocking', () => {
      expect(refusal(() => readFileSafe(root, 'fifo'))).toBe('not-regular');
    });
    it('refuses /dev/zero (resolves outside the root)', () => {
      expect(refusal(() => readFileSafe(root, 'zero'))).toBe('outside-root');
    });
    it('refuses a link into /proc (Linux; dangling elsewhere)', () => {
      const why = refusal(() => readFileSafe(root, 'proc-environ'));
      expect(why).toMatch(/^(outside-root|other:ENOENT)/);
    });
  });
});

describe('isSafeEntry', () => {
  it('admits files, directories and in-root links', () => {
    for (const f of ['a.txt', 'sub', 'link-in.txt', 'sub/link-up.txt']) expect(isSafeEntry(root, f)).toBe(true);
  });
  it('refuses links out, dangling links, and entries under a link out', () => {
    for (const f of ['link-out.txt', 'dir-out', 'dir-out/outside.txt', 'dangling.txt']) expect(isSafeEntry(root, f)).toBe(false);
  });
  (posix ? it : it.skip)('refuses a FIFO and a device link', () => {
    expect(isSafeEntry(root, 'fifo')).toBe(false);
    expect(isSafeEntry(root, 'zero')).toBe(false);
  });
});

describe('skip notice', () => {
  it('is one warning with counts, not one per file', () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    try {
      refusal(() => readFileSafe(root, 'link-out.txt'));
      refusal(() => readFileSafe(root, 'link-out.txt')); // same file twice: counted once
      refusal(() => readFileSafe(root, 'big.txt'));
      isSafeEntry(root, 'dir-out');
      reportSkips();
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0][0] as string;
      expect(msg).toMatch(/skipped 3 unsafe file/);
      expect(msg).toMatch(/2 resolving outside the project root/);
      expect(msg).toMatch(/1 over 16 MiB/);
      reportSkips();
      expect(warn).toHaveBeenCalledTimes(1); // reset after reporting
    } finally {
      warn.mockRestore();
    }
  });
  it('says nothing when nothing was refused', () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    try { readFileSafe(root, 'a.txt'); reportSkips(); expect(warn).not.toHaveBeenCalled(); } finally { warn.mockRestore(); }
  });
});
