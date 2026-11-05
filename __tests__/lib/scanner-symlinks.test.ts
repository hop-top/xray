import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileScanner } from '../../src/lib/scanner';

/** A tree with a tracked target, an ignored target, .env and an outside file, each linked as *.ts. */
function tree(git: boolean): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `xray-links-${git ? 'git' : 'fs'}-`)));
  if (git) spawnSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), 'secrets.ts\n');
  fs.writeFileSync(path.join(root, 'secrets.ts'), 'export const s = "S";\n');
  fs.writeFileSync(path.join(root, 'real.ts'), 'export const r = 1;\n');
  fs.writeFileSync(path.join(root, '.env'), 'T=1\n');
  fs.writeFileSync(path.join(path.dirname(root), `${path.basename(root)}-outside.ts`), 'x\n');
  fs.symlinkSync('secrets.ts', path.join(root, 'link-ignored.ts'));
  fs.symlinkSync('real.ts', path.join(root, 'link-tracked.ts'));
  fs.symlinkSync('.env', path.join(root, 'link-env.ts'));
  fs.symlinkSync(`../${path.basename(root)}-outside.ts`, path.join(root, 'link-out.ts'));
  if (git) spawnSync('git', ['add', '.gitignore', 'real.ts', 'link-ignored.ts', 'link-tracked.ts', 'link-env.ts', 'link-out.ts'], { cwd: root });
  return root;
}

describe.each([['git', true], ['non-git fallback', false]])('symlinks in a scan (%s)', (_n, git) => {
  let root: string;
  beforeAll(() => { root = tree(git as boolean); });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}-outside.ts`, { force: true });
  });

  it('keeps a link only when its target is a listed file', () => {
    const files = new FileScanner(root).scan();
    expect(files).toContain('real.ts');
    expect(files).toContain('link-tracked.ts');
    expect(files).not.toContain('secrets.ts');
    expect(files).not.toContain('link-ignored.ts');
    expect(files).not.toContain('link-env.ts');
    expect(files).not.toContain('link-out.ts');
  });

  it('skipReason agrees: a link to an ignored target is skipped', () => {
    expect(FileScanner.skipReason(path.join(root, 'link-ignored.ts'))).toMatch(/ignored/);
    expect(FileScanner.skipReason(path.join(root, 'link-tracked.ts'))).toBeNull();
    expect(FileScanner.skipReason(path.join(root, 'link-env.ts'))).toMatch(/unsupported/);
  });
});
