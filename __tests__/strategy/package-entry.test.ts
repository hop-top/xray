import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StrategyLoader, resolvePackageEntry, readStrategyPackage } from '../../src/lib/strategy/loader';

describe('strategy package entry', () => {
  let root: string;
  let cwd: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-entry-')));
    cwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const pkg = (dir: string, entry: unknown, files: Record<string, string> = { 's.yml': 'name: inside\nversion: 1.0.0\n' }) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: path.basename(dir), version: '1.0.0', 'xray-strategy': { name: 'inside', entry },
    }));
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
    return dir;
  };

  test('accepts an entry inside the package', () => {
    const dir = pkg(path.join(root, 'p'), 's.yml');
    expect(resolvePackageEntry(dir, 's.yml')).toBe(path.join(dir, 's.yml'));
    expect(readStrategyPackage(dir)).toMatchObject({ strategyName: 'inside', version: '1.0.0', declarative: true });
  });

  test.each([
    ['parent traversal', '../outside.yml'],
    ['nested traversal', 'a/../../outside.yml'],
    ['absolute path', '/etc/hosts'],
    ['the package directory itself', '.'],
    ['empty', ''],
    ['not a string', 42],
  ])('rejects %s', (_l, entry) => {
    const dir = pkg(path.join(root, 'p'), entry);
    fs.writeFileSync(path.join(root, 'outside.yml'), 'name: outside\nversion: 1.0.0\n');
    expect(() => resolvePackageEntry(dir, entry)).toThrow();
  });

  test('rejects a symlink that points out of the package', () => {
    const dir = pkg(path.join(root, 'p'), 'link.yml');
    fs.writeFileSync(path.join(root, 'outside.yml'), 'name: outside\nversion: 1.0.0\n');
    fs.symlinkSync(path.join(root, 'outside.yml'), path.join(dir, 'link.yml'));
    expect(() => resolvePackageEntry(dir, 'link.yml')).toThrow(/outside the package/);
  });

  test('rejects a missing entry file', () => {
    const dir = pkg(path.join(root, 'p'), 'nope.yml');
    expect(() => resolvePackageEntry(dir, 'nope.yml')).toThrow(/does not exist/);
  });

  test('discovery does not load an entry that escapes the package', async () => {
    const project = path.join(root, 'project');
    pkg(path.join(project, 'node_modules', 'xray-strategy-esc'), '../../../outside.yml');
    fs.writeFileSync(path.join(root, 'outside.yml'), 'name: outside\nversion: 1.0.0\n');
    pkg(path.join(project, 'node_modules', 'xray-strategy-ok'), 's.yml');
    process.chdir(project);
    process.env.XDG_DATA_HOME = path.join(root, 'xdg');
    const names = (await new StrategyLoader().discoverStrategies()).map(s => s.name);
    expect(names).toContain('inside');
    expect(names).not.toContain('outside');
  });
});
