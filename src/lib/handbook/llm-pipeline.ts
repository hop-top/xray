import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TransientError, UsageError } from '../error/types';
import { getDiff } from '../git';
import { LlmClient, type LlmProvider } from '../llm/client';
import { capOutputBytes, truncateLine, windowSlice } from '../output-guardrails';
import { ensurePrivateDir, projectCacheDbPath } from '../storage';
import {
  analyzeHandbook,
  checkOverwriteGuard,
  parseFrontmatter,
  renderReadme,
  renderSubsystemPage,
  type SubsystemInfo,
} from './generator';

interface SqlStore {
  put(key: string, value: unknown): void;
  get<T>(key: string): T | null;
  close(): void;
}

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { open } = require('@hop-top/kit/sqlstore') as { open: (p: string) => SqlStore };

const HANDBOOK_RUNS_KEY = 'handbook:runs';
const MAX_EXCERPT_BYTES = 16_000;
const MAX_PROMPT_BYTES = 32_000;
const BACKOFF_FAILURE_THRESHOLD = 3;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 3_600_000;

export interface HandbookStepRecord {
  stage: 'discovery' | 'survey' | 'overview';
  subsystem?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  status: 'ok' | 'error';
  error?: string;
  timestamp: string;
}

export interface HandbookRunRecord {
  runId: string;
  mode: 'full' | 'delta';
  model: string;
  provider: LlmProvider;
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'completed' | 'budget_stopped' | 'failed';
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  failureCount: number;
  steps: HandbookStepRecord[];
  stoppedReason?: string;
}

export interface HandbookRunsState {
  runs: HandbookRunRecord[];
  consecutiveFullFailures: number;
  lastFailureAt?: string;
}

export interface HandbookLlmOptions {
  root: string;
  outputDir?: string;
  confirm?: boolean;
  configPath?: string;
  offline?: boolean;
  delta?: boolean;
  maxTokens?: number;
  maxCost?: number;
  provider?: LlmProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dbPath?: string;
}

export interface HandbookLlmResult {
  outputDir: string;
  files: string[];
  subsystems: number;
  updatedSubsystems: string[];
  lastUpdatedAt: string;
  lastUpdatedCommit: string;
  delta: boolean;
  budgetStopped: boolean;
  stoppedReason?: string;
  totalTokens: number;
  totalCostUsd: number;
  model: string;
  provider: LlmProvider;
}

function openRunsStore(root: string, explicitDbPath?: string): SqlStore {
  const target = explicitDbPath ?? projectCacheDbPath(root) ?? ':memory:';
  if (target !== ':memory:') {
    ensurePrivateDir(path.dirname(target));
  }
  return open(target);
}

function loadRunsState(store: SqlStore): HandbookRunsState {
  const existing = store.get<HandbookRunsState>(HANDBOOK_RUNS_KEY);
  if (existing && Array.isArray(existing.runs)) {
    return existing;
  }
  return { runs: [], consecutiveFullFailures: 0 };
}

function saveRunsState(store: SqlStore, state: HandbookRunsState): void {
  store.put(HANDBOOK_RUNS_KEY, state);
}

function assertNotBackedOff(state: HandbookRunsState, isDelta: boolean): void {
  if (isDelta || state.consecutiveFullFailures < BACKOFF_FAILURE_THRESHOLD || !state.lastFailureAt) {
    return;
  }
  const lastMs = Date.parse(state.lastFailureAt);
  if (Number.isNaN(lastMs)) return;
  const exponent = state.consecutiveFullFailures - BACKOFF_FAILURE_THRESHOLD;
  const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, exponent), BACKOFF_MAX_MS);
  const elapsed = Date.now() - lastMs;
  if (elapsed < backoffMs) {
    const remainingSec = Math.ceil((backoffMs - elapsed) / 1000);
    throw new TransientError(
      `Handbook LLM full scan is in backoff after ${state.consecutiveFullFailures} consecutive failures; retry in ${remainingSec}s or use --delta.`
    );
  }
}

function buildLlmFrontmatter(meta: {
  lastUpdatedAt: string;
  lastUpdatedCommit: string;
  subsystem: string;
  model: string;
}): string {
  return [
    '---',
    `lastUpdatedAt: ${meta.lastUpdatedAt}`,
    `lastUpdatedCommit: ${meta.lastUpdatedCommit}`,
    'generator: llm',
    `model: ${meta.model}`,
    `subsystem: ${meta.subsystem}`,
    '---',
    '',
  ].join('\n');
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '');
}

function extractSymbolExcerpts(root: string, sub: SubsystemInfo): string {
  const windowed = windowSlice(sub.topSymbols, { offset: 0, limit: 8, maxLimit: 8 });
  const parts: string[] = [];

  for (const sym of windowed.items) {
    const abs = path.resolve(root, sym.file);
    if (!fs.existsSync(abs)) continue;
    let lines: string[];
    try {
      lines = fs.readFileSync(abs, 'utf-8').split(/\r?\n/);
    } catch {
      continue;
    }
    const startIdx = Math.max(0, (sym.line || 1) - 1);
    const endIdx = Math.min(lines.length, startIdx + 12);
    const snippet = lines
      .slice(startIdx, endIdx)
      .map((line, i) => `${startIdx + i + 1}: ${truncateLine(line, 180).text}`)
      .join('\n');
    parts.push(`### ${sym.name} (${sym.kind}) — ${sym.file}:${sym.line}\n\`\`\`\n${snippet}\n\`\`\``);
  }

  return capOutputBytes(parts.join('\n\n'), MAX_EXCERPT_BYTES).text;
}

function isBudgetExceeded(
  run: HandbookRunRecord,
  maxTokens?: number,
  maxCost?: number
): string | undefined {
  if (maxTokens !== undefined && run.totalTokens >= maxTokens) {
    return `Token budget reached (${run.totalTokens} >= ${maxTokens})`;
  }
  if (maxCost !== undefined && run.totalCostUsd >= maxCost) {
    return `Cost budget reached ($${run.totalCostUsd.toFixed(6)} >= $${maxCost})`;
  }
  return undefined;
}

function readExistingCommit(outputDir: string, subsystems: SubsystemInfo[]): string | undefined {
  const candidates = [
    path.join(outputDir, 'README.md'),
    ...subsystems.map((s) => path.join(outputDir, `${s.slug}.md`)),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const fm = parseFrontmatter(fs.readFileSync(filePath, 'utf-8'));
      if (fm.lastUpdatedCommit && fm.lastUpdatedCommit !== 'working-tree') {
        return fm.lastUpdatedCommit;
      }
    } catch {
      // ignore unreadable file
    }
  }
  return undefined;
}

function composeSubsystemMarkdown(
  sub: SubsystemInfo,
  prose: string,
  deterministicPage: string,
  meta: { lastUpdatedAt: string; lastUpdatedCommit: string; model: string }
): string {
  const detBody = stripFrontmatter(deterministicPage).trim();
  const cleanProse = prose.trim();
  return [
    buildLlmFrontmatter({
      lastUpdatedAt: meta.lastUpdatedAt,
      lastUpdatedCommit: meta.lastUpdatedCommit,
      subsystem: sub.slug,
      model: meta.model,
    }),
    `# Subsystem: ${sub.name}`,
    '',
    '[Back to overview](./README.md)',
    '',
    cleanProse,
    '',
    '---',
    '',
    '## Verified Citations & Deterministic Reference',
    '',
    detBody,
    '',
  ].join('\n');
}

function composeOverviewMarkdown(
  prose: string,
  deterministicReadme: string,
  meta: { lastUpdatedAt: string; lastUpdatedCommit: string; model: string }
): string {
  const detBody = stripFrontmatter(deterministicReadme).trim();
  const cleanProse = prose.trim();
  return [
    buildLlmFrontmatter({
      lastUpdatedAt: meta.lastUpdatedAt,
      lastUpdatedCommit: meta.lastUpdatedCommit,
      subsystem: 'overview',
      model: meta.model,
    }),
    cleanProse,
    '',
    '---',
    '',
    detBody,
    '',
  ].join('\n');
}

export async function runHandbookLlmPipeline(
  options: HandbookLlmOptions
): Promise<HandbookLlmResult> {
  // Reject --offline before touching disk or building graphs.
  const client = new LlmClient({
    offline: options.offline,
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    configPath: options.configPath,
    root: options.root,
  });

  if (options.maxTokens !== undefined && (!Number.isFinite(options.maxTokens) || options.maxTokens <= 0)) {
    throw new UsageError('--max-tokens must be a positive number');
  }
  if (options.maxCost !== undefined && (!Number.isFinite(options.maxCost) || options.maxCost <= 0)) {
    throw new UsageError('--max-cost must be a positive number');
  }

  const root = path.resolve(options.root);
  const outputDir = path.resolve(root, options.outputDir ?? path.join('.xray', 'handbook'));
  checkOverwriteGuard(outputDir, options.confirm === true);

  const store = openRunsStore(root, options.dbPath);
  const state = loadRunsState(store);

  try {
    assertNotBackedOff(state, options.delta === true);

    const analysis = await analyzeHandbook({
      root,
      outputDir,
      configPath: options.configPath,
    });

    const { headSha, lastUpdatedAt, lastUpdatedCommit, subsystems, matrix, detected } = analysis;
    const meta = { lastUpdatedAt, lastUpdatedCommit };

    let isDelta = options.delta === true;
    let targetSubsystems: SubsystemInfo[] = subsystems;
    const baselineCommit = isDelta ? readExistingCommit(outputDir, subsystems) : undefined;

    if (isDelta && baselineCommit) {
      const diffs = await getDiff(root, baselineCommit, 'HEAD');
      const changedPaths = new Set<string>();
      for (const d of diffs) {
        if (d.path) changedPaths.add(d.path);
        if (d.oldPath) changedPaths.add(d.oldPath);
      }
      targetSubsystems = subsystems.filter(
        (sub) =>
          sub.files.some((f) => changedPaths.has(f)) ||
          !fs.existsSync(path.join(outputDir, `${sub.slug}.md`))
      );
    } else if (isDelta && !baselineCommit) {
      // No prior committed handbook exists: fall back to full pipeline.
      isDelta = false;
    }

    const nowIso = new Date().toISOString();
    const run: HandbookRunRecord = {
      runId: crypto.randomUUID(),
      mode: isDelta ? 'delta' : 'full',
      model: client.model,
      provider: client.provider,
      startedAt: nowIso,
      updatedAt: nowIso,
      status: 'running',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      failureCount: 0,
      steps: [],
    };
    state.runs.push(run);
    saveRunsState(store, state);

    fs.mkdirSync(outputDir, { recursive: true });
    const deterministicReadme = renderReadme(subsystems, matrix, detected, meta);
    const writtenFiles: string[] = [];

    if (!isDelta) {
      fs.writeFileSync(path.join(outputDir, 'README.md'), deterministicReadme, 'utf-8');
      for (const sub of subsystems) {
        fs.writeFileSync(
          path.join(outputDir, `${sub.slug}.md`),
          renderSubsystemPage(sub, headSha, meta),
          'utf-8'
        );
      }
    }

    const recordStep = (
      stage: HandbookStepRecord['stage'],
      subsystem: string | undefined,
      inputTokens: number,
      outputTokens: number,
      costUsd: number,
      status: 'ok' | 'error',
      error?: string
    ): void => {
      const total = inputTokens + outputTokens;
      run.steps.push({
        stage,
        ...(subsystem ? { subsystem } : {}),
        inputTokens,
        outputTokens,
        totalTokens: total,
        costUsd,
        status,
        ...(error ? { error } : {}),
        timestamp: new Date().toISOString(),
      });
      run.totalInputTokens += inputTokens;
      run.totalOutputTokens += outputTokens;
      run.totalTokens += total;
      run.totalCostUsd += costUsd;
      if (status === 'error') {
        run.failureCount += 1;
      }
      run.updatedAt = new Date().toISOString();
      saveRunsState(store, state);
    };

    const callStage = async (
      stage: HandbookStepRecord['stage'],
      subsystem: string | undefined,
      systemPrompt: string,
      userPrompt: string
    ): Promise<string> => {
      try {
        const boundedPrompt = capOutputBytes(userPrompt, MAX_PROMPT_BYTES).text;
        const res = await client.complete({
          system: systemPrompt,
          messages: [{ role: 'user', content: boundedPrompt }],
        });
        recordStep(
          stage,
          subsystem,
          res.usage.inputTokens,
          res.usage.outputTokens,
          res.costUsd,
          'ok'
        );
        return res.text;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordStep(stage, subsystem, 0, 0, 0, 'error', message);
        run.status = 'failed';
        run.stoppedReason = message;
        if (!isDelta) {
          state.consecutiveFullFailures += 1;
          state.lastFailureAt = new Date().toISOString();
        }
        saveRunsState(store, state);
        throw err;
      }
    };

    const finishBudgetStop = (reason: string): HandbookLlmResult => {
      run.status = 'budget_stopped';
      run.stoppedReason = reason;
      run.updatedAt = new Date().toISOString();
      saveRunsState(store, state);
      return {
        outputDir,
        files: writtenFiles,
        subsystems: subsystems.length,
        updatedSubsystems: writtenFiles
          .map((f) => path.basename(f, '.md'))
          .filter((s) => s !== 'README'),
        lastUpdatedAt,
        lastUpdatedCommit,
        delta: isDelta,
        budgetStopped: true,
        stoppedReason: reason,
        totalTokens: run.totalTokens,
        totalCostUsd: run.totalCostUsd,
        model: client.model,
        provider: client.provider,
      };
    };

    // Short-circuit delta runs when no subsystems changed.
    if (isDelta && targetSubsystems.length === 0) {
      run.status = 'completed';
      run.updatedAt = new Date().toISOString();
      saveRunsState(store, state);
      return {
        outputDir,
        files: [],
        subsystems: subsystems.length,
        updatedSubsystems: [],
        lastUpdatedAt,
        lastUpdatedCommit,
        delta: true,
        budgetStopped: false,
        totalTokens: 0,
        totalCostUsd: 0,
        model: client.model,
        provider: client.provider,
      };
    }

    // Stage 1: Discovery (full mode only)
    let discoveryOutline = '';
    if (!isDelta) {
      const strategyList =
        detected.length > 0
          ? detected.map((d) => `- ${d.name} (${d.version})`).join('\n')
          : 'None detected';
      discoveryOutline = await callStage(
        'discovery',
        undefined,
        'You are a software architect producing a concise codebase discovery outline.',
        `Discovery stage: summarize the architectural outline from this README and detected stack.\n\n## Detected Stack\n${strategyList}\n\n${deterministicReadme}`
      );
      const stopped = isBudgetExceeded(run, options.maxTokens, options.maxCost);
      if (stopped) return finishBudgetStop(stopped);
    }

    // Stage 2: Survey (per target subsystem)
    const updatedSubsystems: string[] = [];
    for (const sub of targetSubsystems) {
      const stoppedBefore = isBudgetExceeded(run, options.maxTokens, options.maxCost);
      if (stoppedBefore) return finishBudgetStop(stoppedBefore);

      const detPage = renderSubsystemPage(sub, headSha, meta);
      const excerpts = extractSymbolExcerpts(root, sub);
      const surveyPrompt = [
        `Survey subsystem "${sub.name}" (${sub.slug}).`,
        'Write concise architectural prose explaining its responsibilities, public contract, and dependencies.',
        'Preserve verified @file: citations where referenced.',
        discoveryOutline ? `\n## Discovery Outline\n${truncateLine(discoveryOutline, 1500).text}` : '',
        `\n## Deterministic Sheet\n${detPage}`,
        excerpts ? `\n## Symbol Excerpts\n${excerpts}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const prose = await callStage(
        'survey',
        sub.slug,
        'You are a software architect writing accurate subsystem handbook documentation.',
        surveyPrompt
      );

      const subPath = path.join(outputDir, `${sub.slug}.md`);
      fs.writeFileSync(
        subPath,
        composeSubsystemMarkdown(sub, prose, detPage, {
          ...meta,
          model: client.model,
        }),
        'utf-8'
      );
      writtenFiles.push(subPath);
      updatedSubsystems.push(sub.slug);

      const stoppedAfter = isBudgetExceeded(run, options.maxTokens, options.maxCost);
      if (stoppedAfter) return finishBudgetStop(stoppedAfter);
    }

    // Stage 3: Overview (root README.md synthesis)
    const stoppedBeforeOverview = isBudgetExceeded(run, options.maxTokens, options.maxCost);
    if (stoppedBeforeOverview) return finishBudgetStop(stoppedBeforeOverview);

    const subsystemSummaries = subsystems
      .map((s) => {
        const p = path.join(outputDir, `${s.slug}.md`);
        const content = fs.existsSync(p) ? stripFrontmatter(fs.readFileSync(p, 'utf-8')) : '';
        return `### ${s.name} (${s.slug}.md)\n${truncateLine(content.replace(/\s+/g, ' ').trim(), 400).text}`;
      })
      .join('\n\n');

    const overviewProse = await callStage(
      'overview',
      undefined,
      'You are a software architect synthesizing a top-level architectural handbook README.',
      `Overview stage: Synthesize the root README.md architectural overview across all subsystems.\n\n${deterministicReadme}\n\n## Subsystem Summaries\n${subsystemSummaries}`
    );

    const readmePath = path.join(outputDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      composeOverviewMarkdown(overviewProse, deterministicReadme, {
        ...meta,
        model: client.model,
      }),
      'utf-8'
    );
    writtenFiles.unshift(readmePath);

    run.status = 'completed';
    run.updatedAt = new Date().toISOString();
    if (!isDelta) {
      state.consecutiveFullFailures = 0;
    }
    saveRunsState(store, state);

    return {
      outputDir,
      files: writtenFiles,
      subsystems: subsystems.length,
      updatedSubsystems,
      lastUpdatedAt,
      lastUpdatedCommit,
      delta: isDelta,
      budgetStopped: false,
      totalTokens: run.totalTokens,
      totalCostUsd: run.totalCostUsd,
      model: client.model,
      provider: client.provider,
    };
  } finally {
    store.close();
  }
}
