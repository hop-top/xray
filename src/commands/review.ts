import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import { UsageError } from '../lib/error/types';
import type { Cfg, Dfg } from '../lib/flow/types';
import { getDiff, isGitRepo, type DiffFile } from '../lib/git';
import { LlmClient, type LlmProvider } from '../lib/llm/client';
import { capOutputBytes } from '../lib/output-guardrails';
import { ParserManager } from '../lib/parser/manager';
import { computeImpactFromSeeds, resolveChangedSymbols } from '../lib/query/impact';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';
import { StrategyContextImpl } from '../lib/strategy/context';
import { StrategyLoader } from '../lib/strategy/loader';
import { Xray } from '../lib/xray';
import type { TagNodeAttributes } from '../types/graph';
import { execFileNoThrow } from '../utils/execFileNoThrow';
import { declareEffect } from './side-effect';

export interface ReviewCommandOptions {
  base?: string;
  head?: string;
  llm?: boolean;
  path?: string;
  config?: string;
  offline?: boolean;
  format?: string;
}

export interface ReviewFinding {
  severity: 'info' | 'warning' | 'error';
  category?: 'impact' | 'complexity' | 'docs' | 'diff';
  file: string;
  line: number;
  title: string;
  detail: string;
}

export interface ComplexityDelta {
  file: string;
  symbol: string;
  line: number;
  baseCyclomatic: number;
  headCyclomatic: number;
  cyclomaticDelta: number;
  cfgNodesDelta: number;
  cfgEdgesDelta: number;
  dfgDefsDelta: number;
  dfgEdgesDelta: number;
}

export interface ReviewResult {
  mode: 'deterministic' | 'llm';
  base: string;
  head: string;
  findings: ReviewFinding[];
  summary: {
    changedFiles: number;
    impactedCallers: number;
    complexityDeltas: number;
    staleDocs: number;
  };
  complexity?: ComplexityDelta[];
  model?: string;
  provider?: LlmProvider;
  totalTokens?: number;
  totalCostUsd?: number;
}

interface FlowMetrics {
  cyclomatic: number;
  cfgNodes: number;
  cfgEdges: number;
  dfgDefs: number;
  dfgEdges: number;
}

function measureFlow(cfg?: Cfg, dfg?: Dfg): FlowMetrics {
  const cfgNodes = cfg?.nodes.length ?? 0;
  const cfgEdges = cfg?.edges.length ?? 0;
  const cyclomatic = cfgNodes > 0 ? Math.max(1, cfgEdges - cfgNodes + 2) : 1;
  return {
    cyclomatic,
    cfgNodes,
    cfgEdges,
    dfgDefs: dfg?.nodes.length ?? 0,
    dfgEdges: dfg?.edges.length ?? 0,
  };
}

async function computeComplexityDeltas(
  root: string,
  base: string,
  diffFiles: DiffFile[],
  graph: any
): Promise<ComplexityDelta[]> {
  const parser = new ParserManager(root);
  const deltas: ComplexityDelta[] = [];

  for (const diff of diffFiles) {
    if (diff.status === 'D') continue;
    const relPath = diff.path.replace(/\\/g, '/');

    const baseMetricsByName = new Map<string, FlowMetrics>();
    if (diff.status !== 'A' && base !== 'WORKING') {
      const showRes = await execFileNoThrow('git', ['-C', root, 'show', `${base}:${relPath}`]);
      if (showRes.status === 0 && showRes.stdout) {
        try {
          const parsedBase = await parser.parse(relPath, showRes.stdout, false, 'none', true, true);
          for (const tag of parsedBase.tags) {
            if (tag.cfg || tag.dfg) {
              baseMetricsByName.set(tag.name, measureFlow(tag.cfg, tag.dfg));
            }
          }
        } catch {
          // Skip unparseable base files
        }
      }
    }

    if (!graph.hasNode(relPath)) continue;
    graph.forEachOutEdge(
      relPath,
      (_e: string, eAttrs: any, _s: string, _t: string, _sa: any, tAttrs: TagNodeAttributes) => {
        if (eAttrs?.type !== 'defines' || tAttrs?.type !== 'tag') return;
        if (!tAttrs.cfg && !tAttrs.dfg) return;

        const tagStart = typeof tAttrs.line === 'number' ? tAttrs.line + 1 : 1;
        const tagEnd = typeof tAttrs.endLine === 'number' ? tAttrs.endLine + 1 : tagStart;
        const touched =
          diff.changedLines.length === 0 ||
          diff.changedLines.some((r) => r.start <= tagEnd && r.end >= tagStart);
        if (!touched) return;

        const headM = measureFlow(tAttrs.cfg, tAttrs.dfg);
        const baseM = baseMetricsByName.get(tAttrs.label) ?? {
          cyclomatic: 1,
          cfgNodes: 0,
          cfgEdges: 0,
          dfgDefs: 0,
          dfgEdges: 0,
        };

        const cyclomaticDelta = headM.cyclomatic - baseM.cyclomatic;
        const cfgNodesDelta = headM.cfgNodes - baseM.cfgNodes;
        const cfgEdgesDelta = headM.cfgEdges - baseM.cfgEdges;
        const dfgDefsDelta = headM.dfgDefs - baseM.dfgDefs;
        const dfgEdgesDelta = headM.dfgEdges - baseM.dfgEdges;

        if (cyclomaticDelta !== 0 || cfgNodesDelta !== 0 || dfgDefsDelta !== 0) {
          deltas.push({
            file: relPath,
            symbol: tAttrs.label,
            line: tagStart,
            baseCyclomatic: baseM.cyclomatic,
            headCyclomatic: headM.cyclomatic,
            cyclomaticDelta,
            cfgNodesDelta,
            cfgEdgesDelta,
            dfgDefsDelta,
            dfgEdgesDelta,
          });
        }
      }
    );
  }

  return deltas;
}

async function runMarkdownStale(root: string): Promise<Array<Record<string, any>>> {
  try {
    const loader = new StrategyLoader();
    const strategies = await loader.discoverStrategies();
    const md = strategies.find((s) => s.name === 'markdown');
    const staleCmd = md?.commands?.stale;
    if (!md || !staleCmd) return [];
    const ctx = new StrategyContextImpl(root);
    if (md.analyze) {
      const docFiles = await ctx.findFiles({ extension: '.md' });
      for (const doc of docFiles) {
        const result = await md.analyze(doc, ctx);
        if (result?.metadata) {
          ctx.setMetadata(doc, 'markdown', result.metadata);
        }
      }
    }
    const res = await staleCmd.handler(ctx, {});
    return Array.isArray(res?.stale) ? res.stale : [];
  } catch {
    return [];
  }
}

function parseLlmFindings(rawText: string): ReviewFinding[] {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { findings?: unknown };
    if (!Array.isArray(parsed?.findings)) return [];
    return parsed.findings
      .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
      .map((f) => {
        const sev = f.severity === 'error' || f.severity === 'warning' ? f.severity : 'info';
        return {
          severity: sev,
          file: typeof f.file === 'string' ? f.file : '.',
          line: typeof f.line === 'number' && Number.isFinite(f.line) ? f.line : 1,
          title: typeof f.title === 'string' ? f.title : 'Review finding',
          detail: typeof f.detail === 'string' ? f.detail : '',
        };
      });
  } catch {
    return [
      {
        severity: 'info',
        file: '.',
        line: 1,
        title: 'LLM Review Summary',
        detail: rawText.trim(),
      },
    ];
  }
}

export async function runReview(options: {
  root: string;
  base: string;
  head?: string;
  llm?: boolean;
  offline?: boolean;
  configPath?: string;
}): Promise<ReviewResult> {
  const base = options.base?.trim();
  if (!base) {
    throw new UsageError('--base <ref> is required');
  }
  const head = options.head?.trim() || 'HEAD';
  const root = fs.realpathSync(path.resolve(options.root));

  let client: LlmClient | null = null;
  if (options.llm) {
    client = new LlmClient({
      offline: options.offline,
      configPath: options.configPath,
      root,
    });
  }

  if (!(await isGitRepo(root))) {
    throw new UsageError(`Directory "${root}" is not a git repository`);
  }

  const diffFiles = await getDiff(root, base, head);

  const xray = new Xray({
    path: root,
    configPath: options.configPath,
    chunked: false,
    features: { cf: true, df: true },
  });

  let complexity: ComplexityDelta[] = [];
  let impactedCallers = 0;
  let impactMatches: Array<{ name: string; file?: string; line?: number }> = [];
  let impactNodes: Array<{ name: string; file?: string; line?: number; depth: number }> = [];

  try {
    const { graph } = await xray.buildGraph();
    const { symbolIds } = resolveChangedSymbols(graph, diffFiles);
    if (symbolIds.length > 0) {
      const impact = computeImpactFromSeeds(graph, symbolIds, `${base}..${head}`);
      impactedCallers = impact.counts.callers;
      impactMatches = impact.symbol.matches.map((m) => ({
        name: m.name,
        file: m.file,
        line: m.line !== undefined ? m.line + 1 : 1,
      }));
      impactNodes = impact.nodes.map((n) => ({
        name: n.name,
        file: n.file,
        line: n.line !== undefined ? n.line + 1 : 1,
        depth: n.depth,
      }));
    }
    complexity = await computeComplexityDeltas(root, base, diffFiles, graph);
  } finally {
    xray.close();
  }

  const staleItems = await runMarkdownStale(root);
  const findings: ReviewFinding[] = [];

  if (impactMatches.length > 0) {
    const callerList = impactNodes
      .slice(0, 8)
      .map((n) => `${n.name} (${n.file ?? '?'}:${n.line ?? 1}, depth ${n.depth})`)
      .join(', ');
    for (const match of impactMatches) {
      findings.push({
        severity: impactedCallers >= 5 ? 'warning' : 'info',
        category: 'impact',
        file: match.file ?? '.',
        line: match.line ?? 1,
        title: `Modified symbol ${match.name} has ${impactedCallers} transitive caller(s)`,
        detail:
          impactedCallers > 0
            ? `Callers: ${callerList}`
            : 'No callers found in repository graph.',
      });
    }
  }

  for (const delta of complexity) {
    if (delta.cyclomaticDelta > 0 || delta.cfgNodesDelta > 0 || delta.dfgDefsDelta > 0) {
      findings.push({
        severity: delta.cyclomaticDelta >= 3 || delta.cfgNodesDelta >= 5 ? 'warning' : 'info',
        category: 'complexity',
        file: delta.file,
        line: delta.line,
        title: `Complexity delta in ${delta.symbol} (cyclomatic ${delta.cyclomaticDelta >= 0 ? '+' : ''}${delta.cyclomaticDelta})`,
        detail: `CFG nodes ${delta.cfgNodesDelta >= 0 ? '+' : ''}${delta.cfgNodesDelta}, CFG edges ${delta.cfgEdgesDelta >= 0 ? '+' : ''}${delta.cfgEdgesDelta}, DFG defs ${delta.dfgDefsDelta >= 0 ? '+' : ''}${delta.dfgDefsDelta}, DFG edges ${delta.dfgEdgesDelta >= 0 ? '+' : ''}${delta.dfgEdgesDelta}.`,
      });
    }
  }

  for (const item of staleItems) {
    findings.push({
      severity: 'warning',
      category: 'docs',
      file: String(item.doc ?? '.'),
      line: typeof item.line === 'number' ? item.line : 1,
      title: `Stale markdown reference (${String(item.reason ?? 'unknown')})`,
      detail: `Target: ${String(item.link ?? item.reference ?? item.target ?? '')}`,
    });
  }

  const summary = {
    changedFiles: diffFiles.length,
    impactedCallers,
    complexityDeltas: complexity.length,
    staleDocs: staleItems.length,
  };

  if (client) {
    const bundle = capOutputBytes(
      JSON.stringify(
        {
          base,
          head,
          summary,
          diffFiles: diffFiles.map((d) => ({
            path: d.path,
            status: d.status,
            changedLines: d.changedLines,
            patch: d.patch,
          })),
          impact: { matches: impactMatches, callers: impactNodes },
          complexity,
          staleDocs: staleItems,
        },
        null,
        2
      ),
      64_000
    ).text;

    const response = await client.complete({
      system:
        'You are a code reviewer. Analyze the provided diff, blast-radius impact, CFG/DFG complexity deltas, and stale documentation checks. Respond ONLY with valid JSON matching { "findings": Array<{ "severity": "info"|"warning"|"error", "file": string, "line": number, "title": string, "detail": string }> }.',
      messages: [{ role: 'user', content: bundle }],
    });

    return {
      mode: 'llm',
      base,
      head,
      findings: parseLlmFindings(response.text),
      summary,
      complexity,
      model: client.model,
      provider: client.provider,
      totalTokens: response.usage.inputTokens + response.usage.outputTokens,
      totalCostUsd: response.costUsd,
    };
  }

  return {
    mode: 'deterministic',
    base,
    head,
    findings,
    summary,
    complexity,
  };
}

function renderReviewText(result: ReviewResult): string {
  const lines: string[] = [
    `Review (${result.mode}) ${result.base}..${result.head}`,
    `Changed files: ${result.summary.changedFiles}, Impacted callers: ${result.summary.impactedCallers}, Complexity deltas: ${result.summary.complexityDeltas}, Stale docs: ${result.summary.staleDocs}`,
    '',
  ];

  if (result.findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const f of result.findings) {
      const cat = f.category ? `[${f.category}] ` : '';
      lines.push(`[${f.severity.toUpperCase()}] ${cat}${f.file}:${f.line} — ${f.title}`);
      if (f.detail) {
        lines.push(`  ${f.detail}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

export function registerReviewCommand(program: Command): Command {
  const cmd = addResultFormat(
    program
      .command('review')
      .description('Review a git diff deterministically (impact, CFG/DFG delta, stale docs) or with --llm')
      .requiredOption('--base <ref>', 'Base git ref to diff against')
      .option('--head <ref>', 'Head git ref to diff up to', 'HEAD')
      .option('--llm', 'Synthesize review findings with BYOK LLM')
      .option('-p, --path <dir>', 'Project root directory (defaults to current working directory)')
  ).action(async (opts: ReviewCommandOptions, command: Command) => {
    assertResultFormat(command);
    const globals = command.optsWithGlobals() as ReviewCommandOptions;
    const root = path.resolve(opts.path ?? process.cwd());

    const result = await runReview({
      root,
      base: opts.base ?? '',
      head: opts.head ?? 'HEAD',
      llm: Boolean(opts.llm),
      offline: Boolean(globals.offline ?? opts.offline),
      configPath: globals.config ?? opts.config,
    });

    emitResult(command, result, () => {
      process.stdout.write(renderReviewText(result));
    });
  });

  return declareEffect(cmd, 'read', 'yes');
}
