import { execFileSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { runAskLoop } from '../src/lib/agent/ask-loop';

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'xray');

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface MockStepReply {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

interface MockServerHandle {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

async function startMockOpenAiServer(
  handler: (reqIndex: number, body: Record<string, unknown>) => MockStepReply
): Promise<MockServerHandle> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const idx = requests.length;
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body,
      });

      const reply = handler(idx, body);
      const message: Record<string, unknown> = {
        role: 'assistant',
        content: reply.text ?? '',
      };
      if (reply.toolCalls && reply.toolCalls.length > 0) {
        message.tool_calls = reply.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: `chatcmpl_mock_${idx}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message,
              finish_reason: reply.toolCalls?.length ? 'tool_calls' : 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 40,
            total_tokens: 140,
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
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function runCliAsync(
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [BIN, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function createFixtureGitRepo(): {
  sandbox: string;
  repoDir: string;
  baseSha: string;
  headSha: string;
  git: (args: string[]) => string;
} {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-ask-review-')));
  const repoDir = path.join(sandbox, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: repoDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    }).trim();

  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);

  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'src', 'core.ts'),
    [
      'export function computeScore(x: number): number {',
      '  return x + 1;',
      '}',
      '',
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'src', 'caller.ts'),
    [
      "import { computeScore } from './core';",
      '',
      'export function runJob(): number {',
      '  return computeScore(41);',
      '}',
      '',
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    [
      '# Project',
      '',
      'See [core](src/core.ts) and [missing](src/does-not-exist.ts).',
      '',
    ].join('\n'),
    'utf-8'
  );

  git(['add', '.']);
  git(['commit', '-m', 'initial commit']);
  const baseSha = git(['rev-parse', 'HEAD']);

  // Feature branch with increased complexity in computeScore
  git(['checkout', '-b', 'feat/complex-score']);
  fs.writeFileSync(
    path.join(repoDir, 'src', 'core.ts'),
    [
      'export function computeScore(x: number): number {',
      '  let total = 0;',
      '  if (x > 0) {',
      '    for (let i = 0; i < x; i++) {',
      '      if (i % 2 === 0) {',
      '        total += i;',
      '      } else {',
      '        total -= 1;',
      '      }',
      '    }',
      '  } else if (x < 0) {',
      '    total = -x;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n'),
    'utf-8'
  );

  git(['add', '.']);
  git(['commit', '-m', 'increase computeScore complexity']);
  const headSha = git(['rev-parse', 'HEAD']);

  return { sandbox, repoDir, baseSha, headSha, git };
}

describe('xray ask and ask-loop', () => {
  const sandboxes: string[] = [];

  afterEach(() => {
    while (sandboxes.length > 0) {
      const dir = sandboxes.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('executes multi-step tool loop, validates citations, and writes --out transcript', async () => {
    const { sandbox, repoDir, headSha } = createFixtureGitRepo();
    sandboxes.push(sandbox);

    const server = await startMockOpenAiServer((step) => {
      if (step === 0) {
        return {
          toolCalls: [
            { id: 'tc_1', name: 'explore', arguments: { match: ['src/*.ts'] } },
          ],
        };
      }
      if (step === 1) {
        return {
          toolCalls: [
            { id: 'tc_2', name: 'read_file', arguments: { path: 'src/core.ts', startLine: 1, endLine: 15 } },
            { id: 'tc_3', name: 'impact', arguments: { symbol: 'computeScore' } },
          ],
        };
      }
      return {
        text: [
          `\`computeScore\` is defined at @file:src/core.ts:1@${headSha} and called by \`runJob\`.`,
          `Bogus reference: @file:src/missing.ts:99@deadbeef.`,
        ].join('\n'),
      };
    });

    try {
      const outPath = path.join(sandbox, 'transcript.md');
      const result = await runAskLoop({
        root: repoDir,
        question: 'How does computeScore work and what calls it?',
        maxSteps: 12,
        outFile: outPath,
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
      });

      expect(server.requests.length).toBe(3);
      expect(result.partial).toBe(false);
      expect(result.stepsUsed).toBe(3);
      expect(result.citations.length).toBe(2);

      const validCite = result.citations.find((c) => c.path === 'src/core.ts');
      const invalidCite = result.citations.find((c) => c.path === 'src/missing.ts');
      expect(validCite?.verified).toBe(true);
      expect(invalidCite?.verified).toBe(false);
      expect(result.unverifiedCitations.length).toBe(1);
      expect(result.answer).toContain('Unverified Citations');

      expect(fs.existsSync(outPath)).toBe(true);
      const saved = fs.readFileSync(outPath, 'utf-8');
      expect(saved).toContain('How does computeScore work');
      expect(saved).toContain('src/core.ts');
      expect(saved).toContain('Unverified Citations');
    } finally {
      await server.close();
    }
  });

  test('enforces --max-steps cap and returns partial summary', async () => {
    const { sandbox, repoDir } = createFixtureGitRepo();
    sandboxes.push(sandbox);

    const server = await startMockOpenAiServer((step) => ({
      text: `Step ${step + 1} still investigating.`,
      toolCalls: [
        { id: `tc_${step}`, name: 'explore', arguments: { match: ['**/*.ts'] } },
      ],
    }));

    try {
      const result = await runAskLoop({
        root: repoDir,
        question: 'Keep exploring',
        maxSteps: 2,
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
      });

      expect(server.requests.length).toBe(2);
      expect(result.partial).toBe(true);
      expect(result.stepsUsed).toBe(2);
      expect(result.answer.toLowerCase()).toContain('partial');
    } finally {
      await server.close();
    }
  });

  test('rejects --offline mode without calling LLM', async () => {
    const { sandbox, repoDir } = createFixtureGitRepo();
    sandboxes.push(sandbox);

    const server = await startMockOpenAiServer(() => ({ text: 'Should not reach here' }));
    try {
      await expect(
        runAskLoop({
          root: repoDir,
          question: 'Test offline',
          offline: true,
          provider: 'openai',
          apiKey: 'test-key',
          baseUrl: server.baseUrl,
        })
      ).rejects.toThrow(/offline/i);
      expect(server.requests.length).toBe(0);

      const cliRes = spawnSync(
        'node',
        [BIN, 'ask', 'Test offline', '-p', repoDir, '--offline'],
        {
          encoding: 'utf-8',
          env: {
            ...process.env,
            XRAY_LLM_API_KEY: 'test-key',
            XRAY_LLM_BASE_URL: server.baseUrl,
          },
        }
      );
      expect(cliRes.status).toBe(2);
      expect(server.requests.length).toBe(0);
    } finally {
      await server.close();
    }
  });
});

describe('xray review', () => {
  const sandboxes: string[] = [];

  afterEach(() => {
    while (sandboxes.length > 0) {
      const dir = sandboxes.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runs deterministic offline review without an API key (impact + CFG/DFG delta + markdown stale)', () => {
    const { sandbox, repoDir } = createFixtureGitRepo();
    sandboxes.push(sandbox);

    const env = { ...process.env };
    delete env.XRAY_LLM_API_KEY;

    const jsonRes = spawnSync(
      'node',
      [BIN, 'review', '--since', 'main', '--head', 'HEAD', '-p', repoDir, '--format', 'json'],
      { encoding: 'utf-8', env }
    );
    expect(jsonRes.status).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.base).toBe('main');
    expect(parsed.head).toBe('HEAD');
    expect(parsed.mode).toBe('deterministic');
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.findings.length).toBeGreaterThan(0);

    const categories = new Set(parsed.findings.map((f: any) => f.category));
    expect(categories.has('impact')).toBe(true);
    expect(categories.has('complexity')).toBe(true);
    expect(categories.has('docs')).toBe(true);

    const textRes = spawnSync(
      'node',
      [BIN, 'review', '--since', 'main', '--head', 'HEAD', '-p', repoDir, '--format', 'text'],
      { encoding: 'utf-8', env }
    );
    expect(textRes.status).toBe(0);
    expect(textRes.stdout).toContain('computeScore');
  });

  test('supports --llm mode and blocks --llm under --offline', async () => {
    const { sandbox, repoDir } = createFixtureGitRepo();
    sandboxes.push(sandbox);

    const server = await startMockOpenAiServer(() => ({
      text: JSON.stringify({
        findings: [
          {
            severity: 'warning',
            file: 'src/core.ts',
            line: 3,
            title: 'Increased branching in computeScore',
            detail: 'Cyclomatic complexity increased significantly; consider extracting helper.',
          },
        ],
      }),
    }));

    try {
      const env = {
        ...process.env,
        XRAY_LLM_PROVIDER: 'openai',
        XRAY_LLM_API_KEY: 'test-key',
        XRAY_LLM_BASE_URL: server.baseUrl,
      };

      const offlineRes = await runCliAsync(
        ['review', '--since', 'main', '--llm', '--offline', '-p', repoDir],
        env
      );
      expect(offlineRes.status).toBe(2);
      expect(server.requests.length).toBe(0);

      const llmRes = await runCliAsync(
        ['review', '--since', 'main', '--llm', '--format', 'json', '-p', repoDir],
        env
      );
      expect(llmRes.status).toBe(0);
      expect(server.requests.length).toBe(1);
      const parsed = JSON.parse(llmRes.stdout);
      expect(parsed.mode).toBe('llm');
      expect(parsed.findings.length).toBe(1);
      expect(parsed.findings[0].title).toContain('Increased branching');
    } finally {
      await server.close();
    }
  });
});
