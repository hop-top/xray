import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import { MAX_FILE_BYTES, resetSkips } from '../../src/lib/safe-read';

const posix = process.platform !== 'win32';
let base: string;
let root: string;
let ctx: StrategyContextImpl;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-ctx-safe-')));
  root = path.join(base, 'root');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outside.md'), '# OUTSIDE\n');
  fs.writeFileSync(path.join(root, 'docs', 'real.md'), '# INSIDE\n');
  fs.symlinkSync('docs/real.md', path.join(root, 'in.md'));
  fs.symlinkSync(path.join(base, 'outside.md'), path.join(root, 'out.md'));
  fs.writeFileSync(path.join(root, 'huge.md'), '');
  fs.truncateSync(path.join(root, 'huge.md'), MAX_FILE_BYTES + 1);
  if (posix) {
    fs.symlinkSync('/dev/zero', path.join(root, 'zero.md'));
    spawnSync('mkfifo', [path.join(root, 'pipe.md')]);
  }
  ctx = new StrategyContextImpl(root);
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
beforeEach(() => resetSkips());

const hostile = ['out.md', 'huge.md', ...(posix ? ['zero.md', 'pipe.md'] : [])];

describe('StrategyContext.readFile', () => {
  it('reads a file and an in-root link', async () => {
    await expect(ctx.readFile('docs/real.md')).resolves.toBe('# INSIDE\n');
    await expect(ctx.readFile('in.md')).resolves.toBe('# INSIDE\n');
    await expect(ctx.readFile(path.join(root, 'in.md'))).resolves.toBe('# INSIDE\n');
  });

  it.each(hostile)('rejects %s without reading it', async (f) => {
    await expect(ctx.readFile(f)).rejects.toThrow(/refusing to read/);
  });

  it('rejects an absolute path outside the root', async () => {
    await expect(ctx.readFile(path.join(base, 'outside.md'))).rejects.toThrow(/refusing to read/);
  });
});

describe('StrategyContext file discovery', () => {
  const safe = ['docs/real.md', 'in.md', 'huge.md'];

  it('findFiles returns safe entries only', async () => {
    const found = (await ctx.findFiles({ extension: '.md' })).filter((f) => f !== 'huge.md');
    expect(found.sort()).toEqual(['docs/real.md', 'in.md']);
  });

  it('globFiles returns safe entries only', () => {
    const found = ctx.globFiles('**/*.md');
    for (const f of ['out.md', ...(posix ? ['zero.md', 'pipe.md'] : [])]) expect(found).not.toContain(f);
    for (const f of safe) expect(found).toContain(f);
  });

  it('hasFiles does not count a hostile entry', () => {
    expect(ctx.hasFiles('out.md')).toBe(false);
    expect(ctx.hasFiles('in.md')).toBe(true);
    if (posix) {
      expect(ctx.hasFiles('zero.md')).toBe(false);
      expect(ctx.hasFiles('pipe.md')).toBe(false);
    }
  });
});
