import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerCoreCommands } from '../src/commands/registration/core';
import { createXrayMcpHandler } from '../src/lib/mcp/server';
import { TrigramIndex } from '../src/lib/search/trigram-index';

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'xray');

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env,
    encoding: 'utf-8',
  });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function createFixtureRepo(): { repoDir: string; homeDir: string; headSha: string; env: NodeJS.ProcessEnv } {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-handbook-')));
  const repoDir = path.join(sandbox, 'repo');
  const homeDir = path.join(sandbox, 'home');
  fs.mkdirSync(path.join(repoDir, 'src', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src', 'crypto'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src', 'api'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src', 'users'), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify(
      {
        name: 'handbook-fixture',
        version: '1.0.0',
        dependencies: {
          express: '^4.18.0',
        },
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'crypto', 'hash.ts'),
    [
      'export function hashSecret(input: string): string {',
      '  return `hashed:${input}`;',
      '}',
      '',
      'export function compareHash(raw: string, digest: string): boolean {',
      '  return hashSecret(raw) === digest;',
      '}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'auth', 'token.ts'),
    [
      "import { hashSecret, compareHash } from '../crypto/hash';",
      '',
      'export function signToken(userId: string): string {',
      '  return hashSecret(userId);',
      '}',
      '',
      'export function verifyToken(userId: string, token: string): boolean {',
      '  return compareHash(userId, token);',
      '}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'auth', 'middleware.ts'),
    [
      "import { verifyToken } from './token';",
      '',
      'export function requireAuth(userId: string, token: string): boolean {',
      '  return verifyToken(userId, token);',
      '}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'users', 'store.ts'),
    [
      "import { hashSecret } from '../crypto/hash';",
      '',
      'export interface UserRecord {',
      '  id: string;',
      '  secretHash: string;',
      '}',
      '',
      'export function createUser(id: string, secret: string): UserRecord {',
      '  return { id, secretHash: hashSecret(secret) };',
      '}',
      '',
      'export function getUser(id: string): UserRecord {',
      '  return { id, secretHash: hashSecret(id) };',
      '}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'api', 'routes.ts'),
    [
      "import { requireAuth } from '../auth/middleware';",
      "import { getUser } from '../users/store';",
      '',
      'export function handleUserRequest(userId: string, token: string): string {',
      '  if (!requireAuth(userId, token)) {',
      "    return 'unauthorized';",
      '  }',
      '  const user = getUser(userId);',
      '  return user.id;',
      '}',
      '',
    ].join('\n')
  );

  const gitEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    XDG_CACHE_HOME: path.join(homeDir, '.cache'),
    XDG_DATA_HOME: path.join(homeDir, '.local', 'share'),
    XDG_STATE_HOME: path.join(homeDir, '.local', 'state'),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    XRAY_NO_TELEMETRY: '1',
  };

  const git = (args: string[]) => {
    const r = spawnSync('git', args, { cwd: repoDir, env: gitEnv, encoding: 'utf-8' });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    }
    return r.stdout.trim();
  };

  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  git(['add', '.']);
  git(['commit', '-m', 'initial fixture']);
  const headSha = git(['rev-parse', 'HEAD']);

  return { repoDir, homeDir, headSha, env: gitEnv };
}

describe('xray handbook generator', () => {
  let repoDir: string;
  let headSha: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    const fixture = createFixtureRepo();
    repoDir = fixture.repoDir;
    headSha = fixture.headSha;
    env = fixture.env;
  });

  afterAll(() => {
    fs.rmSync(path.dirname(repoDir), { recursive: true, force: true });
  });

  it('generates deterministic handbook pages with frontmatter and valid citations', () => {
    const first = runCli(['-C', repoDir, 'handbook'], repoDir, env);
    expect(first.status).toBe(0);

    const handbookDir = path.join(repoDir, '.xray', 'handbook');
    expect(fs.existsSync(path.join(handbookDir, 'README.md'))).toBe(true);

    const files = fs.readdirSync(handbookDir).filter((f) => f.endsWith('.md')).sort();
    expect(files.length).toBeGreaterThanOrEqual(2);

    const firstContents = new Map<string, string>();
    for (const file of files) {
      const content = fs.readFileSync(path.join(handbookDir, file), 'utf-8');
      firstContents.set(file, content);
      expect(content).toMatch(/^---\n[\s\S]*?\n---\n/);
      expect(content).toContain(`lastUpdatedCommit: ${headSha}`);
      expect(content).toContain('generator: deterministic');
      expect(content).toMatch(/lastUpdatedAt: \d{4}-\d{2}-\d{2}T/);
      expect(content).toContain('subsystem:');
    }

    const readme = firstContents.get('README.md')!;
    expect(readme).toContain('Detected Stack');
    expect(readme).toContain('Subsystems');
    expect(readme).toContain('Dependency Matrix');

    const subsystemFiles = files.filter((f) => f !== 'README.md');
    expect(subsystemFiles.length).toBeGreaterThan(0);
    const hasCitation = subsystemFiles.some((f) =>
      firstContents.get(f)!.includes(`@${headSha}`) && /@file:[^\s`]+:\d+@/.test(firstContents.get(f)!)
    );
    expect(hasCitation).toBe(true);

    // Second run must be byte-for-byte identical.
    const second = runCli(['-C', repoDir, 'handbook'], repoDir, env);
    expect(second.status).toBe(0);
    for (const file of files) {
      const content = fs.readFileSync(path.join(handbookDir, file), 'utf-8');
      expect(content).toBe(firstContents.get(file));
    }

    // Citations and links must pass `xray markdown stale` with 0 errors.
    const staleRes = runCli(['-C', repoDir, 'markdown', 'stale', '--format', 'json'], repoDir, env);
    expect(staleRes.status).toBe(0);
    const staleJson = JSON.parse(staleRes.stdout);
    expect(staleJson.count).toBe(0);
    expect(staleJson.stale).toEqual([]);
  });

  it('refuses to overwrite hand-written files lacking generator frontmatter without --confirm=yes', () => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-handbook-guard-'));
    try {
      const customFile = path.join(customDir, 'README.md');
      fs.writeFileSync(customFile, '# Hand-written docs\nDo not clobber.\n');

      const refused = runCli(['-C', repoDir, 'handbook', '--output', customDir], repoDir, env);
      expect(refused.status).not.toBe(0);
      expect(fs.readFileSync(customFile, 'utf-8')).toBe('# Hand-written docs\nDo not clobber.\n');

      const confirmed = runCli(['-C', repoDir, 'handbook', '--output', customDir, '--confirm=yes'], repoDir, env);
      expect(confirmed.status).toBe(0);
      expect(fs.readFileSync(customFile, 'utf-8')).toContain('generator: deterministic');
    } finally {
      fs.rmSync(customDir, { recursive: true, force: true });
    }
  });

  it('indexes handbook markdown in TrigramIndex under handbook/ and searches it via explore --search', () => {
    const index = new TrigramIndex(repoDir, ':memory:');
    try {
      index.sync(repoDir, ['src/api/routes.ts']);
      const res = index.search('Dependency Matrix');
      expect(res.matches.length).toBeGreaterThan(0);
      expect(res.matches.some((m) => m.relPath === 'handbook/README.md')).toBe(true);
    } finally {
      index.close();
    }

    const exploreRes = runCli(
      ['-C', repoDir, 'explore', '--search', 'Dependency Matrix', '--format', 'json'],
      repoDir,
      env
    );
    expect(exploreRes.status).toBe(0);
    const rows = JSON.parse(exploreRes.stdout) as Array<{ file: string }>;
    expect(rows.some((r) => r.file.includes('handbook/README.md'))).toBe(true);
  });

  it('exposes read-only handbook MCP directTool with list and read actions', async () => {
    const program = new Command('xray');
    registerCoreCommands(program);
    const handler = createXrayMcpHandler(program, {
      serverRoot: repoDir,
      serverConfig: null,
      entry: path.join(ROOT, 'dist', 'index.js'),
      timeoutMs: 10000,
      version: '0.1.0',
    });

    const listResp = await handler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'handbook', arguments: { action: 'list' } },
      }),
    });
    const listBody = JSON.parse(listResp.body ?? '{}');
    expect(listBody.error).toBeUndefined();
    const listText = listBody.result.content[0].text as string;
    const parsedList = JSON.parse(listText);
    expect(parsedList.pages.some((p: { slug: string }) => p.slug === 'README')).toBe(true);

    const readResp = await handler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'handbook', arguments: { action: 'read', slug: 'README' } },
      }),
    });
    const readBody = JSON.parse(readResp.body ?? '{}');
    expect(readBody.error).toBeUndefined();
    const readText = readBody.result.content[0].text as string;
    expect(readText).toContain('generator: deterministic');
    expect(readText).toContain('Detected Stack');
  });
});
