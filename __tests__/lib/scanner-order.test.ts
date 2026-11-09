/**
 * Scan order must not depend on directory-entry order (macOS lists entries
 * sorted, Linux filesystems do not): ranking ties break by input order, so an
 * unstable scan makes `map` output differ from machine to machine.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as glob from 'glob';
import { FileScanner } from '../../src/lib/scanner';
import { Logger } from '../../src/lib/logger';

describe('FileScanner fallback (non-git) ordering', () => {
  let dir: string;
  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-scan-order-'));
    for (const f of ['b.ts', 'a.ts', 'sub/z.ts', 'sub/c.ts']) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), '');
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns files sorted regardless of the order the filesystem lists them', () => {
    const real = glob.globSync;
    // Simulate a filesystem that lists entries in reverse order.
    jest.spyOn(glob, 'globSync').mockImplementation(((...a: Parameters<typeof real>) =>
      (real(...a) as string[]).slice().sort().reverse()) as typeof real);
    expect(new FileScanner(dir).scan()).toEqual(['a.ts', 'b.ts', 'sub/c.ts', 'sub/z.ts']);
  });
});
