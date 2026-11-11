import { execFileSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOOK = path.resolve(__dirname, '..', 'hooks/pre-commit');
const gitBin = path.dirname(execFileSync('which', ['git']).toString().trim());
const SYS_PATH = ['/usr/bin', '/bin', gitBin].join(':');

// Stub xray: maps what it SEES (src/a.ts), writes odd names, a cache db and a
// git-ignored file, and can hang (to be killed), fail, or delete a map.
const STUB = `#!/bin/bash
echo "$PWD :: $*" >> "$XSTUB_LOG"
mkdir -p maps
{ echo "map of src/a.ts:"; cat src/a.ts; } > maps/root.md
printf x > "maps/odd name.md"
printf y > "maps/-dash.md"
printf z > ignored.out
printf c > .xray_cache.db
[ -n "\${XSTUB_RM:-}" ] && rm -f maps/stale.md
if [ -n "\${XSTUB_HANG:-}" ] && [ ! -e "$XSTUB_HANG" ]; then echo $$ > "$XSTUB_HANG"; exec sleep 30; fi
[ -n "\${XSTUB_FAIL:-}" ] && exit 3
exit 0
`;

let tmp: string;
let repo: string;
let bin: string;
let log: string;

const baseEnv = (): NodeJS.ProcessEnv => ({
  PATH: `${bin}:${SYS_PATH}`,
  HOME: tmp,
  XDG_CONFIG_HOME: tmp,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  XSTUB_LOG: log,
});
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...baseEnv(), PATH: SYS_PATH } });
const write = (rel: string, body: string, cwd = repo) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), body);
};
const read = (rel: string, cwd = repo) => fs.readFileSync(path.join(cwd, rel), 'utf8');
const runHook = (cwd = repo, extra: Record<string, string> = {}) =>
  spawnSync(HOOK, [], { cwd, encoding: 'utf8', env: { ...baseEnv(), ...extra } });
const snapshot = (cwd = repo) => ({
  status: git(cwd, 'status', '--porcelain', '-uall', '-z'),
  stash: git(cwd, 'stash', 'list'),
  index: git(cwd, 'ls-files', '-s', '-z'),
});

// Run the hook with the stub hung mid-map. The hook runs in its own process
// group so the whole tree (hook, its subshell, the stub) can be signalled as
// one, like a terminal does. Signalling only the hook orphans the subshell,
// whose `|| xray map` fallback then respawns the stub; if the test's tmp dir
// (and the marker that makes the stub hang only once) is already gone, that
// second stub hangs for 30s and outlives the suite.
async function hangHook(cwd: string, marker: string) {
  const child = spawn(HOOK, [], {
    cwd,
    env: { ...baseEnv(), XSTUB_HANG: marker },
    stdio: 'ignore',
    detached: true,
  });
  const closed = new Promise(res => child.on('close', res));
  for (let i = 0; i < 200 && !fs.existsSync(marker); i++) await new Promise(r => setTimeout(r, 50));
  expect(fs.existsSync(marker)).toBe(true);
  const killGroup = async (sig: NodeJS.Signals) => {
    process.kill(-child.pid!, sig);
    await closed;
  };
  return { killGroup };
}

function initRepo(dir: string, commit: boolean) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  write('.xrayrc.json', '{}\n', dir);
  write('.gitignore', 'ignored.out\n.xray_cache.db\n', dir);
  write('src/a.ts', 'v1\n', dir);
  write('other.txt', 'o1\n', dir);
  git(dir, 'add', '.xrayrc.json', '.gitignore', 'src/a.ts', 'other.txt');
  if (commit) git(dir, 'commit', '-q', '-m', 'init');
}

const OUTPUTS = ['maps/-dash.md', 'maps/odd name.md', 'maps/root.md'];
const cachedNames = (cwd = repo) => git(cwd, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean).sort();

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hook-')));
  repo = path.join(tmp, 'repo');
  bin = path.join(tmp, 'bin');
  log = path.join(tmp, 'xray.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'xray'), STUB, { mode: 0o755 });
  initRepo(repo, true);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('hooks/pre-commit: maps the index, touches nothing else', () => {
  test('stages only the outputs; dirty and untracked work stays; maps reflect staged content', () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    write('src/a.ts', 'unstaged-on-top\n'); // partially staged file
    write('other.txt', 'dirty\n');
    write('.env.secret', 'SECRET\n');
    write('-weird.ts', 'untracked\n');

    const r = runHook();
    expect(r.status).toBe(0);

    // maps built from the index, not the working tree
    expect(read('maps/root.md')).toBe('map of src/a.ts:\nstaged\n');
    expect(git(repo, 'show', ':maps/root.md')).toBe('map of src/a.ts:\nstaged\n');
    // exactly the outputs plus the user's own staged file
    expect(cachedNames()).toEqual(['src/a.ts', ...OUTPUTS].sort());
    // user work intact and unstaged
    expect(read('src/a.ts')).toBe('unstaged-on-top\n');
    expect(read('other.txt')).toBe('dirty\n');
    expect(read('.env.secret')).toBe('SECRET\n');
    const status = git(repo, 'status', '--porcelain', '-uall');
    expect(status).toContain('MM src/a.ts');
    expect(status).toContain(' M other.txt');
    expect(status).toContain('?? .env.secret');
    expect(status).toContain('?? -weird.ts');
    // never the cache db or ignored output
    expect(fs.existsSync(path.join(repo, 'ignored.out'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.xray_cache.db'))).toBe(false);
    expect(git(repo, 'stash', 'list')).toBe('');
    // runs inside the work dir, not the repo
    expect(fs.readFileSync(log, 'utf8')).toContain('xray-precommit');
    // work dir cleaned up
    expect(fs.existsSync(path.join(repo, '.git', 'xray-precommit'))).toBe(false);
  });

  test('already-up-to-date maps leave the index alone', () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    expect(runHook().status).toBe(0);
    git(repo, 'commit', '-q', '-m', 'with maps');
    write('src/b.ts', 'unrelated\n'); // staged change the stub's maps do not depend on
    git(repo, 'add', 'src/b.ts');
    const before = snapshot();
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('up to date');
    expect(snapshot()).toEqual(before);
  });

  test('kill -KILL midway loses nothing; next run recovers', async () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    write('other.txt', 'dirty\n');
    write('.env.secret', 'SECRET\n');
    const before = snapshot();
    const marker = path.join(tmp, 'stub.pid');

    const hung = await hangHook(repo, marker);
    await hung.killGroup('SIGKILL');

    expect(snapshot()).toEqual(before);
    expect(read('other.txt')).toBe('dirty\n');
    expect(read('.env.secret')).toBe('SECRET\n');
    expect(fs.existsSync(path.join(repo, 'maps'))).toBe(false);
    // only scratch is left behind, and only under the git dir
    expect(fs.existsSync(path.join(repo, '.git', 'xray-precommit'))).toBe(true);

    const r = runHook();
    expect(r.status).toBe(0);
    expect(cachedNames()).toEqual(['src/a.ts', ...OUTPUTS].sort());
    expect(read('other.txt')).toBe('dirty\n');
    expect(fs.existsSync(path.join(repo, '.git', 'xray-precommit'))).toBe(false);
  });

  test('SIGTERM cleans the work dir and changes nothing', async () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    const before = snapshot();
    const marker = path.join(tmp, 'stub.pid');
    const hung = await hangHook(repo, marker);
    // a terminal sends the signal to the whole group: hook and xray
    await hung.killGroup('SIGTERM');
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(path.join(repo, '.git', 'xray-precommit'))).toBe(false);
  });

  test('repo with no commits: stages outputs, never the secret', () => {
    const fresh = path.join(tmp, 'fresh');
    initRepo(fresh, false);
    write('.env.secret', 'SECRET\n', fresh);
    const r = runHook(fresh);
    expect(r.status).toBe(0);
    expect(cachedNames(fresh)).toEqual(
      ['.gitignore', '.xrayrc.json', 'other.txt', 'src/a.ts', ...OUTPUTS].sort(),
    );
    expect(git(fresh, 'status', '--porcelain')).toContain('?? .env.secret');
  });

  test('hop-style worktree (.git is a file)', () => {
    const wt = path.join(tmp, 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
    expect(fs.statSync(path.join(wt, '.git')).isFile()).toBe(true);
    write('src/a.ts', 'wt-staged\n', wt);
    git(wt, 'add', 'src/a.ts');
    write('other.txt', 'dirty\n', wt);
    write('.env.secret', 'SECRET\n', wt);
    const r = runHook(wt);
    expect(r.status).toBe(0);
    expect(cachedNames(wt)).toEqual(['src/a.ts', ...OUTPUTS].sort());
    expect(read('maps/root.md', wt)).toBe('map of src/a.ts:\nwt-staged\n');
    expect(git(wt, 'status', '--porcelain')).toContain('?? .env.secret');
    const gd = git(wt, 'rev-parse', '--absolute-git-dir').trim();
    expect(fs.existsSync(path.join(gd, 'xray-precommit'))).toBe(false);
    // main checkout untouched
    expect(fs.existsSync(path.join(repo, 'maps'))).toBe(false);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
  });

  test('symlinks are exported as links and submodules as empty dirs; the working tree is not read', () => {
    fs.symlinkSync('src/a.ts', path.join(repo, 'link'));
    git(repo, 'add', 'link');
    git(repo, 'update-index', '--add', '--cacheinfo', `160000,${git(repo, 'rev-parse', 'HEAD').trim()},sub`);
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    write('untracked-in-tree.txt', 'u\n');
    fs.writeFileSync(
      path.join(bin, 'xray'),
      '#!/bin/bash\nmkdir -p maps\necho "link=$(readlink link) sub=$(ls -A sub | wc -l | tr -d \' \') untracked=$([ -e untracked-in-tree.txt ] && echo yes || echo no)" > maps/shape.md\n',
      { mode: 0o755 },
    );
    expect(runHook().status).toBe(0);
    expect(read('maps/shape.md')).toBe('link=src/a.ts sub=0 untracked=no\n');
    expect(git(repo, 'ls-files', '-s', 'sub')).toContain('160000');
  });

  test('uses the git dir of the worktree for scratch space', async () => {
    const wt = path.join(tmp, 'wt2');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat2', wt);
    write('src/a.ts', 'w\n', wt);
    git(wt, 'add', 'src/a.ts');
    const marker = path.join(tmp, 'stub.pid');
    const hung = await hangHook(wt, marker);
    const gd = git(wt, 'rev-parse', '--absolute-git-dir').trim();
    expect(fs.existsSync(path.join(gd, 'xray-precommit', 'tree', 'src', 'a.ts'))).toBe(true);
    await hung.killGroup('SIGKILL');
  });

  test('unstaged edits to a generated file stop the commit and are kept', () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    write('maps/root.md', 'old map\n');
    git(repo, 'add', '-f', 'maps/root.md');
    git(repo, 'commit', '-q', '-m', 'map');
    write('src/a.ts', 'staged2\n');
    git(repo, 'add', 'src/a.ts');
    write('maps/root.md', 'hand edit\n'); // unstaged, differs from index and from new map
    const before = snapshot();
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('maps/root.md');
    expect(read('maps/root.md')).toBe('hand edit\n');
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(path.join(repo, 'maps', '-dash.md'))).toBe(false);
  });

  test('a working copy already equal to the new map is staged, not a conflict', () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    write('maps/root.md', 'old\n');
    git(repo, 'add', '-f', 'maps/root.md');
    git(repo, 'commit', '-q', '-m', 'map');
    write('src/a.ts', 'next\n');
    git(repo, 'add', 'src/a.ts');
    write('maps/root.md', 'map of src/a.ts:\nnext\n'); // someone already ran xray on this content
    expect(runHook().status).toBe(0);
    expect(git(repo, 'show', ':maps/root.md')).toBe('map of src/a.ts:\nnext\n');
  });

  test('a map xray deletes is deleted and the deletion is staged', () => {
    write('maps/stale.md', 'stale\n');
    git(repo, 'add', '-f', 'maps/stale.md');
    git(repo, 'commit', '-q', '-m', 'stale');
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    expect(runHook(repo, { XSTUB_RM: '1' }).status).toBe(0);
    expect(fs.existsSync(path.join(repo, 'maps/stale.md'))).toBe(false);
    expect(git(repo, 'diff', '--cached', '--name-status')).toContain('D\tmaps/stale.md');
  });

  test('untracked config is not used: hook skips and says so', () => {
    git(repo, 'rm', '-q', '--cached', '.xrayrc.json');
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('.xrayrc.json is not tracked');
    expect(fs.existsSync(log)).toBe(false);
    expect(cachedNames()).toEqual(['.xrayrc.json', 'src/a.ts']); // only the user's own staging
  });

  test('xray failure aborts the commit', () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    const r = runHook(repo, { XSTUB_FAIL: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('map failed');
    expect(cachedNames()).toEqual(['src/a.ts']);
  });

  test('does not enable project strategies on its own', () => {
    write('src/a.ts', 'staged\n');
    git(repo, 'add', 'src/a.ts');
    fs.writeFileSync(path.join(bin, 'xray'), '#!/bin/bash\necho "${XRAY_ALLOW_PROJECT_STRATEGIES:-unset}" > "$XSTUB_LOG"\n', { mode: 0o755 });
    expect(runHook().status).toBe(0);
    expect(fs.readFileSync(log, 'utf8').trim()).toBe('unset');
    fs.writeFileSync(log, '');
    runHook(repo, { XRAY_ALLOW_PROJECT_STRATEGIES: '1' });
    expect(fs.readFileSync(log, 'utf8').trim()).toBe('1');
  });

  test('hook source: no stash, no add -A, no push', () => {
    const src = fs.readFileSync(HOOK, 'utf8').replace(/^\s*#.*$/gm, '');
    expect(src).not.toMatch(/git\s+stash/);
    expect(src).not.toMatch(/\badd\s+(-A\b|\.(\s|$))/);
    expect(src).not.toMatch(/git\s+push/);
  });
});
