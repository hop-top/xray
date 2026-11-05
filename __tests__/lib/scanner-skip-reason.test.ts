import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileScanner } from '../../src/lib/scanner';

describe('FileScanner.skipReason treats file names as data', () => {
  let repo: string;
  const names = ['$(touch PWNED).ts', '`touch PWNED2`.ts', '-n.ts', '"; touch PWNED3; ".ts'];

  beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-skip-')));
    spawnSync('git', ['init', '-q'], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'src'));
    for (const n of names) fs.writeFileSync(path.join(repo, 'src', n), 'export const a = 1;\n');
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it.each(names)('%s: judged normally, runs nothing', (n) => {
    expect(FileScanner.skipReason(path.join(repo, 'src', n))).toBeNull();
    for (const marker of ['PWNED', 'PWNED2', 'PWNED3']) {
      expect(fs.existsSync(path.join(repo, 'src', marker))).toBe(false);
    }
  });

  it('a leading dash is not taken as an option: ignored names are still found', () => {
    fs.writeFileSync(path.join(repo, '.gitignore'), '-n.ts\n');
    expect(FileScanner.skipReason(path.join(repo, 'src', '-n.ts'))).toMatch(/ignored/);
  });
});
