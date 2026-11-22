import * as fs from 'fs';
import * as path from 'path';
import { handleExploreAction, type ExploreCapture } from '../../commands/explore';
import { impactFromSerialized } from '../../commands/impact';
import { queryFromSerialized } from '../../commands/query';
import type { ExploreCommandOptions } from '../../types/command-options';
import { isWithin } from '../confine';
import { NotFoundError, UsageError } from '../error/types';
import { execFileNoThrow } from '../../utils/execFileNoThrow';
import { getHeadSha, isGitRepo } from '../git';
import { analyzeHandbook, listHandbookPages, readHandbookPage } from '../handbook/generator';
import { LlmClient, type LlmMessage, type LlmProvider, type LlmToolCall } from '../llm/client';
import { buildPrimitiveDirectTools, type DirectToolDef } from '../mcp/tools';
import { WarmWorkspaceManager } from '../mcp/workspace';
import { capOutputBytes } from '../output-guardrails';
import { SkillRegistry } from '../skills/registry';

export const DEFAULT_MAX_STEPS = 12;
const DEFAULT_MAX_TOOL_OUTPUT_BYTES = 64_000;

export interface AskToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface AskLoopOptions {
  root: string;
  question: string;
  maxSteps?: number;
  outFile?: string;
  offline?: boolean;
  configPath?: string;
  provider?: LlmProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxToolOutputBytes?: number;
}

export interface AskStepTrace {
  step: number;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    output: string;
    truncated: boolean;
  }>;
}

export interface VerifiedCitation {
  raw: string;
  path: string;
  line: number;
  endLine?: number;
  sha?: string;
  verified: boolean;
  reason?: string;
}

export interface AskLoopResult {
  question: string;
  answer: string;
  partial: boolean;
  stepsUsed: number;
  maxSteps: number;
  totalTokens: number;
  totalCostUsd: number;
  model: string;
  provider: LlmProvider;
  citations: VerifiedCitation[];
  unverifiedCitations: VerifiedCitation[];
  steps: AskStepTrace[];
  outFile?: string;
}

function parseMaxSteps(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_STEPS;
  if (!Number.isInteger(raw) || raw < 1) {
    throw new UsageError(`Invalid --max-steps '${raw}' (expected a positive integer)`);
  }
  return raw;
}

function formatToolResult(raw: string, maxBytes: number): { text: string; truncated: boolean } {
  const capped = capOutputBytes(raw, maxBytes);
  if (!capped.truncated) return capped;
  return {
    text: `${capped.text}\n... [truncated to ${maxBytes} bytes]`,
    truncated: true,
  };
}

/**
 * Build read-only tool definitions wrapping `WarmWorkspaceManager` for the ask loop.
 */
export function buildAskTools(
  workspace: WarmWorkspaceManager,
  root: string,
  configPath?: string
): Map<string, AskToolDefinition> {
  const primitives: Map<string, DirectToolDef> = buildPrimitiveDirectTools(workspace);
  const tools = new Map<string, AskToolDefinition>();

  tools.set('map', {
    name: 'map',
    description: 'Return top ranked symbols and graph summary for the repository.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max ranked nodes to return (default 50).' },
        lens: { type: 'string', description: 'Optional lens name.' },
        scope: { type: 'string', description: 'Optional scope name.' },
      },
    },
    execute: async (args) => {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(200, Math.floor(args.limit)) : 50;
      const warm = await workspace.getGraph(root, {
        configPath,
        lens: typeof args.lens === 'string' ? args.lens : undefined,
        scope: typeof args.scope === 'string' ? args.scope : undefined,
      });
      const ranked = warm.rankedNodes.slice(0, limit).map((n) => ({
        id: n.id,
        rank: n.rank,
        type: n.attributes.type,
        label: n.attributes.label,
      }));
      return JSON.stringify(
        {
          nodeCount: warm.serialized.nodes.length,
          edgeCount: warm.serialized.edges.length,
          coverage: warm.coverage,
          topRanked: ranked,
        },
        null,
        2
      );
    },
  });

  tools.set('explore', {
    name: 'explore',
    description: 'Find files by glob (--match) or search code by keyword (--search).',
    parameters: {
      type: 'object',
      properties: {
        match: { type: 'array', items: { type: 'string' }, description: 'Glob patterns to match.' },
        search: { type: 'array', items: { type: 'string' }, description: 'Keywords to search.' },
        type: { type: 'array', items: { type: 'string' }, description: 'File extensions/types.' },
        stats: { type: 'boolean', description: 'Return summary statistics only.' },
      },
    },
    execute: async (args) => {
      const toList = (v: unknown): string[] =>
        Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? [v] : [];
      const options = {
        path: [root],
        match: toList(args.match),
        search: toList(args.search),
        type: toList(args.type),
        stats: args.stats === true,
      } as ExploreCommandOptions;
      const capture: ExploreCapture = {
        mute: true,
        indexFor: (r) => workspace.getTrigramIndex(r),
      };
      await handleExploreAction(options, undefined, capture);
      const outcome = capture.outcome;
      if (!outcome) return JSON.stringify({ rows: [] });
      return JSON.stringify({ rows: outcome.rows }, null, 2);
    },
  });

  tools.set('impact', {
    name: 'impact',
    description: 'Compute transitive callers (blast radius) of a symbol.',
    parameters: {
      type: 'object',
      required: ['symbol'],
      properties: {
        symbol: { type: 'string', description: 'Symbol name or pattern.' },
        depth: { type: 'number', description: 'Max caller depth (default 3).' },
        strict: { type: 'boolean', description: 'Follow EXTRACTED edges only.' },
      },
    },
    execute: async (args) => {
      const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : '';
      if (!symbol) {
        throw new UsageError('impact tool requires "symbol" argument');
      }
      const warm = await workspace.getGraph(root, { configPath });
      const res = await impactFromSerialized(warm.serialized, symbol, {
        depth: args.depth !== undefined ? String(args.depth) : undefined,
        strict: args.strict === true,
      });
      return JSON.stringify(res, null, 2);
    },
  });

  tools.set('query', {
    name: 'query',
    description: 'Run a call-graph query such as "calls(fn)" or "callers(fn)".',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Query expression.' },
      },
    },
    execute: async (args) => {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      if (!q) {
        throw new UsageError('query tool requires "query" argument');
      }
      const warm = await workspace.getGraph(root, { configPath });
      const res = queryFromSerialized(warm.serialized, q, {});
      return JSON.stringify(res, null, 2);
    },
  });

  const readFileDef = primitives.get('read_file');
  if (readFileDef) {
    tools.set('read_file', {
      name: 'read_file',
      description: readFileDef.description,
      parameters: { type: 'object', properties: readFileDef.properties, required: readFileDef.required },
      execute: async (args) => {
        const res = await readFileDef.invoke(args);
        return res.stdout;
      },
    });
  }

  tools.set('handbook', {
    name: 'handbook',
    description: 'Read generated architectural handbook pages or compute an in-memory structural overview.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Optional handbook page slug to read.' },
      },
    },
    execute: async (args) => {
      const handbookDir = path.join(root, '.xray', 'handbook');
      const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
      if (slug) {
        const page = readHandbookPage(handbookDir, slug);
        if (page) return page;
      }
      const pages = listHandbookPages(handbookDir);
      if (pages.length > 0 && !slug) {
        return JSON.stringify({ pages }, null, 2);
      }
      const analysis = await analyzeHandbook({ root, configPath });
      return JSON.stringify(
        {
          subsystems: analysis.subsystems.map((s) => ({
            slug: s.slug,
            name: s.name,
            fileCount: s.files.length,
            topHub: s.topHub,
            topSymbols: s.topSymbols.slice(0, 5),
          })),
        },
        null,
        2
      );
    },
  });

  const getDiffDef = primitives.get('get_diff');
  if (getDiffDef) {
    tools.set('get_diff', {
      name: 'get_diff',
      description: getDiffDef.description,
      parameters: { type: 'object', properties: getDiffDef.properties, required: getDiffDef.required },
      execute: async (args) => {
        const res = await getDiffDef.invoke(args);
        return res.stdout;
      },
    });
  }

  return tools;
}

const CITATION_RE = /@file:([^\s:`'")\]]+):(\d+)(?:-(\d+))?(?:@([0-9a-fA-F]{4,40}))?/g;

/**
 * Verify every `@file:<path>:<line>@<sha>` citation against repository files and HEAD.
 */
export async function verifyCitations(root: string, text: string): Promise<VerifiedCitation[]> {
  const realRoot = fs.realpathSync(root);
  const inGit = await isGitRepo(realRoot);
  const headSha = inGit ? await getHeadSha(realRoot) : null;
  const results: VerifiedCitation[] = [];
  const lineCountCache = new Map<string, number>();
  const shaCache = new Map<string, boolean>();

  for (const match of text.matchAll(CITATION_RE)) {
    const raw = match[0];
    const relPath = match[1];
    const line = Number.parseInt(match[2], 10);
    const endLine = match[3] ? Number.parseInt(match[3], 10) : undefined;
    const sha = match[4];

    const absCandidate = path.resolve(realRoot, relPath);
    if (!isWithin(realRoot, absCandidate)) {
      results.push({ raw, path: relPath, line, endLine, sha, verified: false, reason: 'path_outside_root' });
      continue;
    }

    if (!fs.existsSync(absCandidate) || !fs.statSync(absCandidate).isFile()) {
      results.push({ raw, path: relPath, line, endLine, sha, verified: false, reason: 'file_not_found' });
      continue;
    }

    let totalLines = lineCountCache.get(absCandidate);
    if (totalLines === undefined) {
      const content = fs.readFileSync(absCandidate, 'utf-8');
      totalLines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
      lineCountCache.set(absCandidate, totalLines);
    }

    const effectiveEnd = endLine ?? line;
    if (line < 1 || line > totalLines || effectiveEnd < line || effectiveEnd > totalLines) {
      results.push({ raw, path: relPath, line, endLine, sha, verified: false, reason: 'line_out_of_range' });
      continue;
    }

    if (sha) {
      if (!headSha) {
        results.push({ raw, path: relPath, line, endLine, sha, verified: false, reason: 'no_git_head' });
        continue;
      }
      if (!headSha.toLowerCase().startsWith(sha.toLowerCase())) {
        let exists = shaCache.get(sha);
        if (exists === undefined) {
          const check = await execFileNoThrow('git', ['-C', realRoot, 'cat-file', '-e', `${sha}^{commit}`]);
          exists = check.status === 0;
          shaCache.set(sha, exists);
        }
        results.push({
          raw,
          path: relPath,
          line,
          endLine,
          sha,
          verified: false,
          reason: exists ? 'sha_not_head' : 'sha_not_found',
        });
        continue;
      }
    }

    results.push({ raw, path: relPath, line, endLine, sha, verified: true });
  }

  return results;
}

function buildSystemPrompt(tools: Map<string, AskToolDefinition>, headSha: string | null): string {
  const toolSpecs = [...tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  return [
    'You are xray ask, a read-only codebase Q&A assistant.',
    'Use the available tools to inspect the repository before answering.',
    `Cite file evidence using @file:<relative-path>:<line>@${headSha ?? '<sha>'} format.`,
    'Only cite files, lines, and symbols you directly observed in tool outputs.',
    '',
    'Available read-only tools:',
    JSON.stringify(toolSpecs, null, 2),
  ].join('\n');
}

function formatTranscriptMarkdown(result: Omit<AskLoopResult, 'outFile'>): string {
  const lines: string[] = [
    '# xray ask Transcript',
    '',
    `- **Model:** ${result.provider}/${result.model}`,
    `- **Steps:** ${result.stepsUsed}/${result.maxSteps}${result.partial ? ' (partial)' : ''}`,
    `- **Tokens:** ${result.totalTokens}`,
    `- **Estimated Cost (USD):** $${result.totalCostUsd.toFixed(6)}`,
    '',
    '## Question',
    '',
    result.question,
    '',
  ];

  if (result.steps.length > 0) {
    lines.push('## Tool Steps', '');
    for (const step of result.steps) {
      lines.push(`### Step ${step.step}`, '');
      for (const tc of step.toolCalls) {
        lines.push(`- **${tc.name}** \`${JSON.stringify(tc.arguments)}\`${tc.truncated ? ' _(truncated)_' : ''}`);
      }
      lines.push('');
    }
  }

  lines.push('## Answer', '', result.answer, '');

  if (result.citations.length > 0) {
    lines.push('## Citation Verification', '');
    for (const c of result.citations) {
      lines.push(`- ${c.verified ? 'VERIFIED' : `UNVERIFIED (${c.reason})`}: \`${c.raw}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Run the bounded multi-step read-only Q&A loop against an LLM provider.
 */
export async function runAskLoop(options: AskLoopOptions): Promise<AskLoopResult> {
  const rawQuestion = options.question?.trim();
  if (!rawQuestion) {
    throw new UsageError('A non-empty <question> is required');
  }

  const maxSteps = parseMaxSteps(options.maxSteps);
  const maxToolOutputBytes = options.maxToolOutputBytes ?? DEFAULT_MAX_TOOL_OUTPUT_BYTES;
  const root = fs.realpathSync(path.resolve(options.root));

  let question = rawQuestion;
  let skillPrefix: string | null = null;
  const slashMatch = rawQuestion.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (slashMatch) {
    const slug = slashMatch[1];
    const registry = new SkillRegistry(root, { configPath: options.configPath });
    const skill = registry.read(slug);
    if (!skill) {
      throw new NotFoundError(`Skill not found: ${slug}`);
    }
    skillPrefix = `# Skill: ${skill.name} (${skill.slug})\n${skill.body}`;
    const remainder = (slashMatch[2] ?? '').trim();
    question = remainder || `Apply skill "${skill.name}" (${skill.slug}).`;
  }

  const client = new LlmClient({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    offline: options.offline,
    configPath: options.configPath,
    root,
  });

  const workspace = new WarmWorkspaceManager(root, options.configPath ?? null);
  try {
    const tools = buildAskTools(workspace, root, options.configPath);
    const headSha = (await isGitRepo(root)) ? await getHeadSha(root) : null;
    const baseSystem = buildSystemPrompt(tools, headSha);
    const system = skillPrefix ? `${skillPrefix}\n\n${baseSystem}` : baseSystem;

    const messages: LlmMessage[] = [{ role: 'user', content: question }];
    const steps: AskStepTrace[] = [];
    let totalTokens = 0;
    let totalCostUsd = 0;
    let stepsUsed = 0;
    let partial = false;
    let rawAnswer = '';

    for (let step = 1; step <= maxSteps; step++) {
      stepsUsed = step;
      const response = await client.complete({ system, messages });
      totalTokens += response.usage.inputTokens + response.usage.outputTokens;
      totalCostUsd += response.costUsd;

      const toolCalls: LlmToolCall[] = response.toolCalls ?? [];
      if (toolCalls.length === 0) {
        rawAnswer = response.text.trim();
        break;
      }

      if (step === maxSteps) {
        partial = true;
        const lastNote = response.text.trim();
        rawAnswer = [
          `Partial summary (reached --max-steps ${maxSteps} before final answer):`,
          lastNote || `Stopped after ${steps.length} tool step(s).`,
        ].join('\n\n');
        break;
      }

      const stepTrace: AskStepTrace = { step, toolCalls: [] };
      const resultBlocks: string[] = [];

      for (const tc of toolCalls) {
        const tool = tools.get(tc.name);
        let rawOutput: string;
        if (!tool) {
          rawOutput = JSON.stringify({ error: `Unknown tool '${tc.name}'` });
        } else {
          try {
            rawOutput = await tool.execute(tc.arguments ?? {});
          } catch (err) {
            rawOutput = JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const capped = formatToolResult(rawOutput, maxToolOutputBytes);
        stepTrace.toolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments ?? {},
          output: capped.text,
          truncated: capped.truncated,
        });
        resultBlocks.push(`Tool "${tc.name}" (${tc.id}) result:\n${capped.text}`);
      }

      steps.push(stepTrace);
      messages.push({
        role: 'assistant',
        content: response.text.trim() || JSON.stringify(toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }))),
      });
      messages.push({
        role: 'user',
        content: resultBlocks.join('\n\n'),
      });
    }

    const citations = await verifyCitations(root, rawAnswer);
    const unverifiedCitations = citations.filter((c) => !c.verified);

    let finalAnswer = rawAnswer;
    if (unverifiedCitations.length > 0) {
      const warnings = unverifiedCitations.map((c) => `- \`${c.raw}\` (${c.reason})`);
      finalAnswer = `${rawAnswer}\n\n## Unverified Citations\n\n${warnings.join('\n')}`;
    }

    const result: AskLoopResult = {
      question,
      answer: finalAnswer,
      partial,
      stepsUsed,
      maxSteps,
      totalTokens,
      totalCostUsd,
      model: client.model,
      provider: client.provider,
      citations,
      unverifiedCitations,
      steps,
    };

    if (options.outFile) {
      const outPath = path.resolve(root, options.outFile);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, formatTranscriptMarkdown(result), 'utf-8');
      result.outFile = outPath;
    }

    return result;
  } finally {
    workspace.close();
  }
}
