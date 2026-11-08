import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileScanner } from '../../src/lib/scanner';
import { resetSkips } from '../../src/lib/safe-read';

const posix = process.platform !== 'win32';

/** Tracked: a regular file, a FIFO, a link to /dev/zero and a link to a FIFO. */
function tree(git: boolean): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `xray-special-${git ? 'git' : 'fs'}-`)));
  if (git) spawnSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'real.ts'), 'export const r = 1;\n');
  spawnSync('mkfifo', [path.join(root, 'pipe.ts')]);
  fs.symlinkSync('/dev/zero', path.join(root, 'zero.ts'));
  fs.symlinkSync('pipe.ts', path.join(root, 'link-pipe.ts'));
  if (git) spawnSync('git', ['add', '-A'], { cwd: root });
  return root;
}

(posix ? describe.each : describe.skip.each)([['git', true], ['non-git fallback', false]])(
  'special files in a scan (%s)', (_n, git) => {
    let root: string;
    beforeAll(() => { root = tree(git as boolean); });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
    beforeEach(() => resetSkips());

    it('lists regular files only: no FIFO, device, or link to either', () => {
      expect(new FileScanner(root).scan()).toEqual(['real.ts']);
    });

    it('a FIFO as .gitignore does not block the constructor', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-fifo-ignore-'));
      try {
        spawnSync('mkfifo', [path.join(dir, '.gitignore')]);
        fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
        expect(new FileScanner(dir).scan()).toContain('a.ts');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
