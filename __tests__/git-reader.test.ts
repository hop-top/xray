import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { UsageError } from '../src/lib/error/types';
import {
  isGitRepo,
  getHeadSha,
  listBranches,
  listCommits,
  getDiff,
  getFileBlame,
  getFileChurn,
} from '../src/lib/git';

function gitExec(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Alice Tester',
      GIT_AUTHOR_EMAIL: 'alice@example.com',
      GIT_COMMITTER_NAME: 'Alice Tester',
      GIT_COMMITTER_EMAIL: 'alice@example.com',
    },
  }).trim();
}

describe('git-reader', () => {
  let tmpRoot: string;
  let repoDir: string;
  let nonGitDir: string;
  let emptyRepoDir: string;
  let commit1Sha: string;
  let commit2Sha: string;
  let commit3Sha: string;
  let commit4Sha: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-git-reader-'));
    repoDir = path.join(tmpRoot, 'repo');
    nonGitDir = path.join(tmpRoot, 'non-git');
    emptyRepoDir = path.join(tmpRoot, 'empty-repo');

    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(nonGitDir, { recursive: true });
    fs.mkdirSync(emptyRepoDir, { recursive: true });

    gitExec(emptyRepoDir, ['init']);

    gitExec(repoDir, ['init', '-b', 'main']);
    gitExec(repoDir, ['config', 'user.name', 'Alice Tester']);
    gitExec(repoDir, ['config', 'user.email', 'alice@example.com']);

    // Commit 1: initial files including one starting with '-' to verify '--' path guard
    fs.writeFileSync(path.join(repoDir, 'alpha.txt'), 'line1\nline2\nline3\n');
    fs.writeFileSync(path.join(repoDir, 'to-delete.txt'), 'bye\n');
    fs.writeFileSync(path.join(repoDir, '-dash.txt'), 'dash-one\n');
    gitExec(repoDir, ['add', '--', 'alpha.txt', 'to-delete.txt', '-dash.txt']);
    gitExec(repoDir, ['commit', '-m', 'chore: initial files']);
    commit1Sha = gitExec(repoDir, ['rev-parse', 'HEAD']);

    // Commit 2: modify alpha.txt, add beta.txt, delete to-delete.txt
    fs.writeFileSync(path.join(repoDir, 'alpha.txt'), 'line1\nline2-edited\nline3\nline4\n');
    fs.writeFileSync(path.join(repoDir, 'beta.txt'), 'beta1\nbeta2\n');
    fs.unlinkSync(path.join(repoDir, 'to-delete.txt'));
    gitExec(repoDir, ['add', '-A']);
    gitExec(repoDir, ['commit', '-m', 'feat: update alpha and add beta']);
    commit2Sha = gitExec(repoDir, ['rev-parse', 'HEAD']);

    // Commit 3: rename beta.txt -> gamma.txt (with high similarity for -M detection)
    fs.renameSync(path.join(repoDir, 'beta.txt'), path.join(repoDir, 'gamma.txt'));
    gitExec(repoDir, ['add', '-A']);
    gitExec(repoDir, ['commit', '-m', 'refactor: rename beta to gamma']);
    commit3Sha = gitExec(repoDir, ['rev-parse', 'HEAD']);

    // Commit 4 on a second branch 'feature', then switch back to 'main'
    gitExec(repoDir, ['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature-line\n');
    gitExec(repoDir, ['add', 'feature.txt']);
    gitExec(repoDir, ['commit', '-m', 'feat: add feature file']);
    commit4Sha = gitExec(repoDir, ['rev-parse', 'HEAD']);

    gitExec(repoDir, ['checkout', 'main']);
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('isGitRepo & getHeadSha', () => {
    it('detects git repos and non-git directories', async () => {
      await expect(isGitRepo(repoDir)).resolves.toBe(true);
      await expect(isGitRepo(nonGitDir)).resolves.toBe(false);
      await expect(isGitRepo(path.join(tmpRoot, 'does-not-exist'))).resolves.toBe(false);
    });

    it('returns HEAD sha for a repo with commits and null otherwise', async () => {
      const sha = await getHeadSha(repoDir);
      expect(sha).toBe(commit3Sha);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);

      await expect(getHeadSha(nonGitDir)).resolves.toBeNull();
      await expect(getHeadSha(emptyRepoDir)).resolves.toBeNull();
    });
  });

  describe('listBranches', () => {
    it('lists branches sorted by committer date with short sha and ISO date', async () => {
      const branches = await listBranches(repoDir);
      const names = branches.map((b) => b.name);
      expect(names).toContain('main');
      expect(names).toContain('feature');

      for (const b of branches) {
        expect(b.sha).toMatch(/^[0-9a-f]+$/);
        expect(Date.parse(b.committerDate)).not.toBeNaN();
      }
    });

    it('returns empty array for non-git dir', async () => {
      await expect(listBranches(nonGitDir)).resolves.toEqual([]);
    });
  });

  describe('listCommits', () => {
    it('paginates commits and omits totalCount and refs by default', async () => {
      const page1 = await listCommits(repoDir, { page: 1, perPage: 2 });
      expect(page1.commits).toHaveLength(2);
      expect(page1.page).toBe(1);
      expect(page1.perPage).toBe(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.totalCount).toBeUndefined();
      expect(page1.commits[0].sha).toBe(commit3Sha);
      expect(page1.commits[0].refs).toBeUndefined();
      expect(page1.commits[1].sha).toBe(commit2Sha);

      const page2 = await listCommits(repoDir, { page: 2, perPage: 2 });
      expect(page2.commits).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
      expect(page2.commits[0].sha).toBe(commit1Sha);
    });

    it('supports includeTotalCount, includeRefs, query, author, and ref', async () => {
      const res = await listCommits(repoDir, {
        ref: 'feature',
        query: 'feature file',
        author: 'Alice',
        includeTotalCount: true,
        includeRefs: true,
      });
      expect(res.totalCount).toBe(1);
      expect(res.commits).toHaveLength(1);
      expect(res.commits[0].sha).toBe(commit4Sha);
      expect(res.commits[0].refs).toEqual(expect.arrayContaining(['feature']));
    });

    it('returns empty result for non-git dir', async () => {
      const res = await listCommits(nonGitDir, { includeTotalCount: true });
      expect(res.commits).toEqual([]);
      expect(res.hasMore).toBe(false);
      expect(res.totalCount).toBe(0);
    });

    it('rejects refs starting with "-" with UsageError', async () => {
      await expect(listCommits(repoDir, { ref: '--exec=echo pwn' })).rejects.toThrow(UsageError);
    });
  });

  describe('getDiff', () => {
    it('parses A/M/D/R statuses, -M renames, and 1-based changedLines', async () => {
      const diff12 = await getDiff(repoDir, commit1Sha, commit2Sha);
      const alpha = diff12.find((f) => f.path === 'alpha.txt');
      const beta = diff12.find((f) => f.path === 'beta.txt');
      const deleted = diff12.find((f) => f.path === 'to-delete.txt');

      expect(alpha).toBeDefined();
      expect(alpha?.status).toBe('M');
      expect(alpha?.changedLines).toEqual([
        { start: 2, end: 2 },
        { start: 4, end: 4 },
      ]);
      expect(alpha?.patch).toContain('diff --git');

      expect(beta).toBeDefined();
      expect(beta?.status).toBe('A');
      expect(beta?.changedLines).toEqual([{ start: 1, end: 2 }]);

      expect(deleted).toBeDefined();
      expect(deleted?.status).toBe('D');
      expect(deleted?.changedLines).toEqual([]);

      const diff23 = await getDiff(repoDir, commit2Sha, commit3Sha);
      expect(diff23).toHaveLength(1);
      expect(diff23[0]).toMatchObject({
        path: 'gamma.txt',
        oldPath: 'beta.txt',
        status: 'R',
      });
    });

    it('captures staged and unstaged edits when base is WORKING', async () => {
      fs.writeFileSync(path.join(repoDir, '-dash.txt'), 'dash-one\ndash-staged\n');
      gitExec(repoDir, ['add', '--', '-dash.txt']);
      fs.writeFileSync(path.join(repoDir, 'alpha.txt'), 'line1\nline2-edited\nline3\nline4\nworking\n');

      try {
        const allWorking = await getDiff(repoDir, 'WORKING');
        expect(allWorking.map((d) => d.path).sort()).toEqual(['-dash.txt', 'alpha.txt']);

        const dashOnly = await getDiff(repoDir, 'WORKING', 'HEAD', ['-dash.txt']);
        expect(dashOnly).toHaveLength(1);
        expect(dashOnly[0].path).toBe('-dash.txt');
        expect(dashOnly[0].changedLines).toEqual([{ start: 2, end: 2 }]);
      } finally {
        gitExec(repoDir, ['reset', 'HEAD', '--', '-dash.txt']);
        gitExec(repoDir, ['checkout', '--', '-dash.txt', 'alpha.txt']);
      }
    });

    it('reads c/ w/ mnemonic prefixes (diff.mnemonicPrefix) like a/ b/', async () => {
      // A user with `diff.mnemonicPrefix=true` gets `c/file w/file` in commit diffs
      // and `a/file w/file` for staged worktree edits: paths must stay root-relative.
      gitExec(repoDir, ['config', 'diff.mnemonicPrefix', 'true']);
      try {
        const committed = await getDiff(repoDir, commit1Sha, commit2Sha);
        expect(committed.map((f) => f.path).sort()).toEqual(['alpha.txt', 'beta.txt', 'to-delete.txt']);
        expect(committed.find((f) => f.path === 'alpha.txt')?.changedLines).toEqual([
          { start: 2, end: 2 },
          { start: 4, end: 4 },
        ]);

        fs.writeFileSync(path.join(repoDir, 'alpha.txt'), 'line1\nline2-edited\nline3\nline4\nworking\n');
        const working = await getDiff(repoDir, 'WORKING');
        expect(working.map((f) => f.path)).toEqual(['alpha.txt']);
        expect(working[0].changedLines).toEqual([{ start: 5, end: 5 }]);
      } finally {
        gitExec(repoDir, ['config', '--unset', 'diff.mnemonicPrefix']);
        gitExec(repoDir, ['checkout', '--', 'alpha.txt']);
      }
    });

    it('returns empty array for non-git dir and rejects "-" refs', async () => {
      await expect(getDiff(nonGitDir, 'HEAD~1', 'HEAD')).resolves.toEqual([]);
      await expect(getDiff(repoDir, '--exec=evil', 'HEAD')).rejects.toThrow(UsageError);
      await expect(getDiff(repoDir, 'HEAD', '--output=/tmp/evil')).rejects.toThrow(UsageError);
    });
  });

  describe('getFileBlame', () => {
    it('parses porcelain blame with 1-based lines, sha, author, and ISO date', async () => {
      const blame = await getFileBlame(repoDir, 'alpha.txt');
      expect(blame).toHaveLength(4);
      expect(blame[0]).toMatchObject({ line: 1, sha: commit1Sha, author: 'Alice Tester' });
      expect(blame[1]).toMatchObject({ line: 2, sha: commit2Sha, author: 'Alice Tester' });
      expect(blame[2]).toMatchObject({ line: 3, sha: commit1Sha, author: 'Alice Tester' });
      expect(blame[3]).toMatchObject({ line: 4, sha: commit2Sha, author: 'Alice Tester' });
      for (const entry of blame) {
        expect(Date.parse(entry.date)).not.toBeNaN();
      }
    });

    it('supports optional ref and "--" path guard for dash-prefixed files', async () => {
      const blameAt1 = await getFileBlame(repoDir, 'alpha.txt', commit1Sha);
      expect(blameAt1).toHaveLength(3);

      const dashBlame = await getFileBlame(repoDir, '-dash.txt');
      expect(dashBlame).toHaveLength(1);
      expect(dashBlame[0].sha).toBe(commit1Sha);
    });

    it('returns empty array for non-git dir and rejects "-" refs', async () => {
      await expect(getFileBlame(nonGitDir, 'alpha.txt')).resolves.toEqual([]);
      await expect(getFileBlame(repoDir, 'alpha.txt', '--exec=evil')).rejects.toThrow(UsageError);
    });
  });

  describe('getFileChurn', () => {
    it('counts commits per file within sinceDays window', async () => {
      const churn = await getFileChurn(repoDir, 90);
      expect(churn.get('alpha.txt')).toBe(2);
      expect(churn.get('gamma.txt')).toBe(1);
      expect(churn.get('-dash.txt')).toBe(1);
    });

    it('returns empty Map for non-git dir', async () => {
      const churn = await getFileChurn(nonGitDir);
      expect(churn).toBeInstanceOf(Map);
      expect(churn.size).toBe(0);
    });
  });
});
