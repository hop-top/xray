import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { LlmClient } from '../src/lib/llm/client';
import { runHandbookLlmPipeline } from '../src/lib/handbook/llm-pipeline';
import { parseFrontmatter } from '../src/lib/handbook/generator';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('@hop-top/kit/sqlstore') as {
  open: (p: string) => { get<T>(key: string): T | null; close(): void };
};

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'xray');

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface MockServerHandle {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

async function startMockLlmServer(opts?: {
  inputTokens?: number;
  outputTokens?: number;
}): Promise<MockServerHandle> {
  const requests: RecordedRequest[] = [];
  const inputTokens = opts?.inputTokens ?? 100;
  const outputTokens = opts?.outputTokens ?? 50;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body,
      });

      const userContent = JSON.stringify(body.messages ?? body);
      let replyText = 'Mock architectural summary.';
      if (userContent.includes('Discovery') || userContent.includes('outline')) {
        replyText = '## Architectural Outline\n\n- auth: authentication\n- api: HTTP routes\n- db: persistence';
      } else if (userContent.includes('Overview') || userContent.includes('Synthesize')) {
        replyText = '# Architectural Handbook\n\nSynthesized overview across subsystems.';
      } else {
        replyText = '## Subsystem Summary\n\nHandles core module responsibilities.';
      }

      res.setHeader('Content-Type', 'application/json');
      if ((req.url ?? '').includes('/messages')) {
        res.end(
          JSON.stringify({
            id: 'msg_mock',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: replyText }],
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          })
        );
        return;
      }

      res.end(
        JSON.stringify({
          id: 'chatcmpl_mock',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: replyText },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind mock LLM server');
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function createFixtureRepo(): {
  sandbox: string;
  repoDir: string;
  homeDir: string;
  dbPath: string;
  headSha: string;
  env: NodeJS.ProcessEnv;
  git: (args: string[]) => string;
} {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-handbook-llm-')));
  const repoDir = path.join(sandbox, 'repo');
  const homeDir = path.join(sandbox, 'home');
  const dbPath = path.join(sandbox, 'state', 'handbook.db');

  fs.mkdirSync(path.join(repoDir, 'src', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src', 'api'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src', 'db'), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify({ name: 'llm-handbook-fixture', version: '1.0.0' }, null, 2)
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'db', 'store.ts'),
    [
      'export function findRecord(id: string): { id: string } {',
      '  return { id };',
      '}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'auth', 'token.ts'),
    [
      'export function verifyToken(token: string): boolean {',
      '  return token.length > 0;',
      '}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(repoDir, 'src', 'api', 'routes.ts'),
    [
      "import { verifyToken } from '../auth/token';",
      "import { findRecord } from '../db/store';",
      '',
      'export function handleRequest(token: string, id: string): string {',
      '  if (!verifyToken(token)) return "denied";',
      '  return findRecord(id).id;',
      '}',
      '',
    ].join('\n')
  );

  const env: NodeJS.ProcessEnv = {
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
    const r = spawnSync('git', args, { cwd: repoDir, env, encoding: 'utf-8' });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    }
    return r.stdout.trim();
  };

  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  git(['add', '.']);
  git(['commit', '-m', 'initial']);
  const headSha = git(['rev-parse', 'HEAD']);

  return { sandbox, repoDir, homeDir, dbPath, headSha, env, git };
}

function runCliAsync(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('handbook LLM pipeline', () => {
  let server: MockServerHandle;
  let fixture: ReturnType<typeof createFixtureRepo>;

  beforeEach(async () => {
    server = await startMockLlmServer();
    fixture = createFixtureRepo();
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(fixture.sandbox, { recursive: true, force: true });
  });

  it('rejects --offline mode immediately without making network calls', async () => {
    await expect(
      runHandbookLlmPipeline({
        root: fixture.repoDir,
        offline: true,
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test-secret',
        baseUrl: `${server.baseUrl}/v1`,
        dbPath: fixture.dbPath,
      })
    ).rejects.toThrow(/LLM features are disabled in --offline mode/);

    expect(server.requests).toHaveLength(0);

    const cliRes = spawnSync(
      process.execPath,
      [BIN, '--offline', '-C', fixture.repoDir, 'handbook', '--llm'],
      {
        cwd: fixture.repoDir,
        env: {
          ...fixture.env,
          XRAY_LLM_PROVIDER: 'openai',
          XRAY_LLM_MODEL: 'gpt-4o',
          XRAY_LLM_API_KEY: 'sk-test-secret',
          XRAY_LLM_BASE_URL: `${server.baseUrl}/v1`,
        },
        encoding: 'utf-8',
      }
    );
    expect(cliRes.status).not.toBe(0);
    expect(`${cliRes.stdout}${cliRes.stderr}`).toContain('LLM features are disabled in --offline mode');
    expect(server.requests).toHaveLength(0);
  });

  it('executes 3-stage pipeline, preserves @file citations, enforces --max-tokens/--max-cost with SQLite spend persistence, and supports Anthropic prompt caching', async () => {
    // 1. Full 3-stage pipeline: Discovery -> 3x Survey -> Overview = 5 calls
    const result = await runHandbookLlmPipeline({
      root: fixture.repoDir,
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-super-secret-key',
      baseUrl: `${server.baseUrl}/v1`,
      dbPath: fixture.dbPath,
    });

    expect(result.budgetStopped).toBe(false);
    expect(server.requests).toHaveLength(5);
    expect(server.requests[0].url).toBe('/v1/chat/completions');

    const handbookDir = path.join(fixture.repoDir, '.xray', 'handbook');
    const readme = fs.readFileSync(path.join(handbookDir, 'README.md'), 'utf-8');
    const readmeFm = parseFrontmatter(readme);
    expect(readmeFm.generator).toBe('llm');
    expect(readmeFm.model).toBe('gpt-4o');
    expect(readmeFm.lastUpdatedCommit).toBe(fixture.headSha);
    expect(readme).not.toContain('sk-super-secret-key');

    const authPage = fs.readFileSync(path.join(handbookDir, 'auth.md'), 'utf-8');
    const authFm = parseFrontmatter(authPage);
    expect(authFm.generator).toBe('llm');
    expect(authFm.model).toBe('gpt-4o');
    expect(authPage).toContain(`@file:src/auth/token.ts:1@${fixture.headSha}`);

    // 2. Anthropic adapter with prompt caching header
    const anthropicClient = new LlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-ant-secret',
      baseUrl: `${server.baseUrl}/v1`,
    });
    const antRes = await anthropicClient.complete({
      system: 'You are an architect.',
      messages: [{ role: 'user', content: 'Summarize.' }],
    });
    expect(antRes.usage.inputTokens).toBe(100);
    expect(antRes.usage.outputTokens).toBe(50);
    const lastReq = server.requests[server.requests.length - 1];
    expect(lastReq.url).toBe('/v1/messages');
    expect(lastReq.headers['anthropic-beta']).toContain('prompt-caching');
    expect(lastReq.headers['x-api-key']).toBe('sk-ant-secret');

    // 3. --max-tokens early stop + SQLite spend persistence
    server.requests.length = 0;
    const tokenRes = await runHandbookLlmPipeline({
      root: fixture.repoDir,
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test-key',
      baseUrl: `${server.baseUrl}/v1`,
      dbPath: fixture.dbPath,
      maxTokens: 250,
    });

    expect(tokenRes.budgetStopped).toBe(true);
    expect(server.requests.length).toBe(2);

    const store = open(fixture.dbPath);
    try {
      const saved = store.get<{
        runs: Array<{
          status: string;
          totalTokens: number;
          totalCostUsd: number;
          steps: Array<{ stage: string }>;
        }>;
      }>('handbook:runs');
      expect(saved).not.toBeNull();
      expect(saved!.runs.length).toBeGreaterThanOrEqual(2);
      const latest = saved!.runs[saved!.runs.length - 1];
      expect(latest.status).toBe('budget_stopped');
      expect(latest.totalTokens).toBe(300);
      expect(latest.totalCostUsd).toBeGreaterThan(0);
      expect(latest.steps).toHaveLength(2);
    } finally {
      store.close();
    }

    // 4. --max-cost early stop
    server.requests.length = 0;
    const costRes = await runHandbookLlmPipeline({
      root: fixture.repoDir,
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test-key',
      baseUrl: `${server.baseUrl}/v1`,
      dbPath: fixture.dbPath,
      maxCost: 0.0001,
    });

    expect(costRes.budgetStopped).toBe(true);
    expect(server.requests.length).toBe(1);
  });

  it('refreshes only the 1 changed subsystem out of 3 in --delta mode via CLI', async () => {
    const cliEnv: NodeJS.ProcessEnv = {
      ...fixture.env,
      XRAY_LLM_PROVIDER: 'openai',
      XRAY_LLM_MODEL: 'gpt-4o',
      XRAY_LLM_API_KEY: 'sk-cli-secret',
      XRAY_LLM_BASE_URL: `${server.baseUrl}/v1`,
    };

    const first = await runCliAsync(
      ['-C', fixture.repoDir, 'handbook', '--llm'],
      fixture.repoDir,
      cliEnv
    );
    expect(first.status).toBe(0);
    expect(server.requests).toHaveLength(5);

    const handbookDir = path.join(fixture.repoDir, '.xray', 'handbook');
    const apiBefore = fs.readFileSync(path.join(handbookDir, 'api.md'), 'utf-8');
    const dbBefore = fs.readFileSync(path.join(handbookDir, 'db.md'), 'utf-8');

    // Modify ONLY src/auth/token.ts and commit
    fs.writeFileSync(
      path.join(fixture.repoDir, 'src', 'auth', 'token.ts'),
      [
        'export function verifyToken(token: string): boolean {',
        '  return token.startsWith("v2_");',
        '}',
        '',
      ].join('\n')
    );
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'update auth token check']);
    const secondSha = fixture.git(['rev-parse', 'HEAD']);

    server.requests.length = 0;

    const delta = await runCliAsync(
      ['-C', fixture.repoDir, 'handbook', '--llm', '--delta', '--format', 'json'],
      fixture.repoDir,
      cliEnv
    );
    expect(delta.status).toBe(0);

    const parsed = JSON.parse(delta.stdout) as { delta: boolean; updatedSubsystems: string[] };
    expect(parsed.delta).toBe(true);
    expect(parsed.updatedSubsystems).toEqual(['auth']);
    // 1 Survey (auth) + 1 Overview (README.md) = 2 calls
    expect(server.requests).toHaveLength(2);

    const authAfter = fs.readFileSync(path.join(handbookDir, 'auth.md'), 'utf-8');
    const readmeAfter = fs.readFileSync(path.join(handbookDir, 'README.md'), 'utf-8');
    expect(parseFrontmatter(authAfter).lastUpdatedCommit).toBe(secondSha);
    expect(parseFrontmatter(authAfter).model).toBe('gpt-4o');
    expect(parseFrontmatter(readmeAfter).lastUpdatedCommit).toBe(secondSha);
    expect(parseFrontmatter(readmeAfter).model).toBe('gpt-4o');

    // Unchanged subsystems remain untouched
    expect(fs.readFileSync(path.join(handbookDir, 'api.md'), 'utf-8')).toBe(apiBefore);
    expect(fs.readFileSync(path.join(handbookDir, 'db.md'), 'utf-8')).toBe(dbBefore);
  });
});
