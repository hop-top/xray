import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerCoreCommands } from '../src/commands/registration/core';
import { runAskLoop } from '../src/lib/agent/ask-loop';
import { UsageError } from '../src/lib/error/types';
import { createXrayBridge, defaultEntry } from '../src/lib/mcp/server';
import { SkillRegistry } from '../src/lib/skills/registry';

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'xray');

function buildTestProgram(): Command {
  const prog = new Command('xray');
  registerCoreCommands(prog);
  return prog;
}

async function startMockOpenAiServer(): Promise<{
  baseUrl: string;
  requests: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}> {
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'chatcmpl_mock_0',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Skill applied.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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

describe('SkillRegistry, CLI, MCP, and ask /<slug> expansion', () => {
  let sandbox: string;
  let repo: string;
  let outside: string;

  beforeAll(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-skills-')));
    repo = path.join(sandbox, 'repo');
    outside = path.join(sandbox, 'outside');

    fs.mkdirSync(path.join(repo, '.xray', 'skills', 'arch-review'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'team-skills', 'sec-audit'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const ok = true;\n');

    fs.writeFileSync(
      path.join(repo, '.xrayrc.json'),
      JSON.stringify({
        paths: ['src'],
        skills: {
          dirs: ['./team-skills'],
        },
      })
    );

    fs.writeFileSync(
      path.join(repo, '.xray', 'skills', 'arch-review', 'SKILL.md'),
      [
        '---',
        'name: Architecture Review',
        'description: Review module boundaries and dependencies.',
        'triggers:',
        '  - review architecture',
        '  - check boundaries',
        '---',
        'Always inspect import edges and rank hotspots first.',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(repo, 'team-skills', 'sec-audit', 'SKILL.md'),
      [
        '---',
        'name: Security Audit',
        'description: Check confinement and input validation.',
        '---',
        'Verify every user-supplied path is confined with isWithin.',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(outside, 'secret.md'),
      '---\nname: Secret\ndescription: Outside\n---\nLeak\n'
    );
  });

  afterAll(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('discovers skills from .xray/skills and .xrayrc.json#skills.dirs', () => {
    const registry = new SkillRegistry(repo);
    const list = registry.list();
    expect(list.map((s) => s.slug)).toEqual(['arch-review', 'sec-audit']);
    expect(list[0]).toMatchObject({
      slug: 'arch-review',
      name: 'Architecture Review',
      description: 'Review module boundaries and dependencies.',
      triggers: ['review architecture', 'check boundaries'],
    });
    expect(list[1]).toMatchObject({
      slug: 'sec-audit',
      name: 'Security Audit',
      description: 'Check confinement and input validation.',
    });

    const doc = registry.read('arch-review');
    expect(doc).not.toBeNull();
    expect(doc?.body).toContain('Always inspect import edges and rank hotspots first.');
  });

  it('throws UsageError for invalid slugs and path traversal', () => {
    const registry = new SkillRegistry(repo);
    expect(() => registry.read('../etc')).toThrow(UsageError);
    expect(() => registry.read('a/b')).toThrow(UsageError);
    expect(() => registry.read('InvalidUpper')).toThrow(UsageError);
    expect(() => registry.read('')).toThrow(UsageError);
  });

  it('throws UsageError when skills.dirs escapes the project root', () => {
    const badRepo = path.join(sandbox, 'bad-repo');
    fs.mkdirSync(badRepo, { recursive: true });
    fs.writeFileSync(
      path.join(badRepo, '.xrayrc.json'),
      JSON.stringify({ skills: { dirs: ['../outside'] } })
    );
    const registry = new SkillRegistry(badRepo);
    expect(() => registry.list()).toThrow(UsageError);
  });

  it('supports xray skill list and xray skill show via CLI', () => {
    const listJson = spawnSync(
      process.execPath,
      [BIN, '-C', repo, 'skill', 'list', '--format', 'json'],
      { encoding: 'utf-8' }
    );
    expect(listJson.status).toBe(0);
    const parsed = JSON.parse(listJson.stdout) as Array<{ slug: string; name: string }>;
    expect(parsed.map((s) => s.slug)).toEqual(['arch-review', 'sec-audit']);

    const listTable = spawnSync(
      process.execPath,
      [BIN, '-C', repo, 'skill', 'list', '--format', 'table'],
      { encoding: 'utf-8' }
    );
    expect(listTable.status).toBe(0);
    expect(listTable.stdout).toContain('arch-review');
    expect(listTable.stdout).toContain('sec-audit');

    const showRes = spawnSync(
      process.execPath,
      [BIN, '-C', repo, 'skill', 'show', 'arch-review'],
      { encoding: 'utf-8' }
    );
    expect(showRes.status).toBe(0);
    expect(showRes.stdout).toContain('Always inspect import edges and rank hotspots first.');

    const badShow = spawnSync(
      process.execPath,
      [BIN, '-C', repo, 'skill', 'show', '../etc'],
      { encoding: 'utf-8' }
    );
    expect(badShow.status).toBe(2);
  });

  it('exposes list_skills and read_skill via MCP directTools', async () => {
    const bridge = createXrayBridge(buildTestProgram(), {
      serverRoot: repo,
      serverConfig: path.join(repo, '.xrayrc.json'),
      entry: defaultEntry(),
      timeoutMs: 10000,
    });

    const leafNames = bridge.leaves().map((l) => l.path.join('.'));
    expect(leafNames).toContain('list_skills');
    expect(leafNames).toContain('read_skill');

    const listRes = await bridge.invoke({ path: ['list_skills'], flags: {} });
    expect(listRes.exitCode).toBe(0);
    const listData = JSON.parse(listRes.stdout) as { skills: Array<{ slug: string }> };
    expect(listData.skills.map((s) => s.slug)).toEqual(['arch-review', 'sec-audit']);

    const readRes = await bridge.invoke({
      path: ['read_skill'],
      flags: { slug: 'sec-audit' },
    });
    expect(readRes.exitCode).toBe(0);
    expect(readRes.stdout).toContain('Verify every user-supplied path is confined with isWithin.');

    const badRead = await bridge.invoke({
      path: ['read_skill'],
      flags: { slug: '../etc' },
    });
    expect(badRead.exitCode).toBe(2);
  });

  it('expands leading /<slug> in runAskLoop and prepends skill body to system prompt', async () => {
    const server = await startMockOpenAiServer();
    try {
      const res = await runAskLoop({
        root: repo,
        question: '/arch-review How is src/index.ts structured?',
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        maxSteps: 3,
      });

      expect(res.answer).toBe('Skill applied.');
      expect(server.requests.length).toBe(1);
      const msgs = server.requests[0].messages as Array<{ role: string; content: string }>;
      const systemMsg = msgs.find((m) => m.role === 'system');
      expect(systemMsg?.content).toContain('Always inspect import edges and rank hotspots first.');
      const userMsg = msgs.find((m) => m.role === 'user');
      expect(userMsg?.content).toBe('How is src/index.ts structured?');

      await expect(
        runAskLoop({
          root: repo,
          question: '/../etc leak',
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'test-key',
          baseUrl: server.baseUrl,
        })
      ).rejects.toThrow(UsageError);
    } finally {
      await server.close();
    }
  });
});
