import * as fs from 'fs';
import * as path from 'path';
import { Xray } from '../xray';
import { ClusteringPlugin } from '../plugins/clustering';
import { CLUSTER_SENTINEL } from '../graph/cluster';
import { SurpriseAnalyzerPlugin, getSurprises } from '../plugins/surprise-analyzer';
import { ScoredEdge } from '../graph/analyzer';
import { generateQuestions, Question } from '../graph/questions';
import { getHeadSha, isGitRepo } from '../git';
import { execFileNoThrow } from '../../utils/execFileNoThrow';
import { StrategyLoader } from '../strategy/loader';
import { StrategyDetector } from '../strategy/detector';
import { StrategyContextImpl } from '../strategy/context';
import { DetectedStrategy } from '../strategy/types';
import { UsageError } from '../error/types';
import { renderMermaid } from '../renderer/mermaid-renderer';
import {
  XrayGraph,
  RankedNode,
  NodeAttributes,
  TagNodeAttributes,
  EdgeAttributes,
} from '../../types/graph';

export interface GenerateHandbookOptions {
  root: string;
  outputDir?: string;
  confirm?: boolean;
  configPath?: string;
}

export interface HandbookPageMeta {
  slug: string;
  file: string;
  subsystem: string;
  generator: string;
  lastUpdatedAt: string;
  lastUpdatedCommit: string;
}

export interface GenerateHandbookResult {
  outputDir: string;
  files: string[];
  subsystems: number;
  lastUpdatedAt: string;
  lastUpdatedCommit: string;
}

export interface SubsystemInfo {
  slug: string;
  name: string;
  files: string[];
  entryFiles: string[];
  topSymbols: Array<{
    id: string;
    name: string;
    kind: string;
    file: string;
    line: number;
    signature?: string;
    rank: number;
  }>;
  topHub: string;
  inboundCallers: Array<{
    fromSubsystem: string;
    sourceLabel: string;
    sourceFile: string;
    sourceLine: number;
    targetLabel: string;
    targetFile: string;
    targetLine: number;
  }>;
  outboundDeps: Array<{
    toSubsystem: string;
    sourceLabel: string;
    sourceFile: string;
    sourceLine: number;
    targetLabel: string;
    targetFile: string;
    targetLine: number;
  }>;
  surprises: ScoredEdge[];
  questions: Question[];
}

const FRONTMATTER_GENERATOR_RE = /^---\r?\n[\s\S]*?\bgenerator:\s*\S+[\s\S]*?\r?\n---/;

function normalizeRel(root: string, filePath: string): string {
  const rel = path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath;
  return rel.split(path.sep).join('/');
}

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'subsystem';
}

function formatCitation(relPath: string, line: number, headSha: string | null): string {
  const safeLine = Number.isInteger(line) && line >= 1 ? line : 1;
  const shaSuffix = headSha ? `@${headSha}` : '';
  return `\`@file:${relPath}:${safeLine}${shaSuffix}\``;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function resolveLastUpdatedAt(root: string, headSha: string | null, files: string[]): Promise<string> {
  if (headSha && (await isGitRepo(root))) {
    const res = await execFileNoThrow('git', ['-C', root, 'show', '-s', '--format=%cI', headSha]);
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.trim();
    }
  }
  let maxMtime = 0;
  for (const rel of files) {
    try {
      const st = fs.statSync(path.resolve(root, rel));
      if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
    } catch {
      // ignore missing file
    }
  }
  return maxMtime > 0 ? new Date(maxMtime).toISOString() : new Date(0).toISOString();
}

function buildFrontmatter(meta: {
  lastUpdatedAt: string;
  lastUpdatedCommit: string;
  subsystem: string;
}): string {
  return [
    '---',
    `lastUpdatedAt: ${meta.lastUpdatedAt}`,
    `lastUpdatedCommit: ${meta.lastUpdatedCommit}`,
    'generator: deterministic',
    `subsystem: ${meta.subsystem}`,
    '---',
    '',
  ].join('\n');
}

export function checkOverwriteGuard(outputDir: string, confirm: boolean): void {
  if (!fs.existsSync(outputDir) || confirm) return;
  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  const unowned: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(outputDir, entry.name);
    let content = '';
    try {
      content = fs.readFileSync(full, 'utf-8');
    } catch {
      unowned.push(entry.name);
      continue;
    }
    if (!FRONTMATTER_GENERATOR_RE.test(content)) {
      unowned.push(entry.name);
    }
  }
  if (unowned.length > 0) {
    throw new UsageError(
      `Refusing to overwrite existing file(s) lacking generator frontmatter in ${outputDir}: ` +
        `${unowned.sort().join(', ')}. Re-run with --confirm=yes to overwrite.`
    );
  }
}

function directoryBucket(relFiles: string[]): Map<string, string> {
  const firstSegments = new Set<string>();
  for (const rel of relFiles) {
    const parts = rel.split('/');
    firstSegments.add(parts.length > 1 ? parts[0] : 'root');
  }
  // When all files live under a single top-level directory (e.g. `src/`),
  // descend one level so each module becomes its own subsystem.
  const singlePrefix = firstSegments.size === 1 ? [...firstSegments][0] : null;
  const useSecondLevel =
    singlePrefix !== null &&
    singlePrefix !== 'root' &&
    relFiles.some((r) => r.split('/').length > 2);

  const map = new Map<string, string>();
  for (const rel of relFiles) {
    const parts = rel.split('/');
    if (parts.length <= 1) {
      map.set(rel, 'root');
    } else if (useSecondLevel && parts[0] === singlePrefix && parts.length > 2) {
      map.set(rel, parts[1]);
    } else {
      map.set(rel, parts[0]);
    }
  }
  return map;
}

function partitionFiles(
  root: string,
  graph: XrayGraph
): { fileToSlug: Map<string, string>; slugToName: Map<string, string> } {
  const fileNodes: string[] = [];
  graph.forEachNode((nodeId, attrs) => {
    if ((attrs as NodeAttributes).type === 'file') {
      fileNodes.push(normalizeRel(root, nodeId));
    }
  });
  fileNodes.sort();

  const fileCommunities = new Map<string, number>();
  const distinctCommunities = new Set<number>();

  for (const rel of fileNodes) {
    const nodeAttrs = graph.hasNode(rel) ? (graph.getNodeAttributes(rel) as NodeAttributes) : undefined;
    let comm = typeof nodeAttrs?.community === 'number' ? nodeAttrs.community : CLUSTER_SENTINEL;
    if (comm === CLUSTER_SENTINEL && graph.hasNode(rel)) {
      const counts = new Map<number, number>();
      graph.forEachOutEdge(rel, (_e, eAttrs, _s, target) => {
        if ((eAttrs as EdgeAttributes).type === 'defines') {
          const tComm = graph.getNodeAttribute(target, 'community') as number | undefined;
          if (typeof tComm === 'number' && tComm !== CLUSTER_SENTINEL) {
            counts.set(tComm, (counts.get(tComm) ?? 0) + 1);
          }
        }
      });
      if (counts.size > 0) {
        comm = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      }
    }
    fileCommunities.set(rel, comm);
    if (comm !== CLUSTER_SENTINEL) distinctCommunities.add(comm);
  }

  const dirMap = directoryBucket(fileNodes);
  const fileToSlug = new Map<string, string>();
  const slugToName = new Map<string, string>();

  if (distinctCommunities.size >= 2) {
    const commFiles = new Map<number, string[]>();
    for (const rel of fileNodes) {
      const c = fileCommunities.get(rel) ?? CLUSTER_SENTINEL;
      const list = commFiles.get(c) ?? [];
      list.push(rel);
      commFiles.set(c, list);
    }

    const sortedComms = [...commFiles.keys()].sort((a, b) => a - b);
    const usedSlugs = new Set<string>();

    for (const c of sortedComms) {
      const files = commFiles.get(c)!;
      let baseName: string;
      if (c === CLUSTER_SENTINEL) {
        baseName = 'unclustered';
      } else {
        const dirCounts = new Map<string, number>();
        for (const f of files) {
          const d = dirMap.get(f) ?? 'root';
          dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
        }
        baseName = [...dirCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      }

      let slug = slugify(baseName);
      if (usedSlugs.has(slug)) {
        slug = slugify(`${baseName}-${c}`);
      }
      let counter = 2;
      while (usedSlugs.has(slug)) {
        slug = slugify(`${baseName}-${counter++}`);
      }
      usedSlugs.add(slug);
      slugToName.set(slug, slug === baseName ? baseName : `${baseName} (${c})`);
      for (const f of files) {
        fileToSlug.set(f, slug);
      }
    }
  } else {
    for (const rel of fileNodes) {
      const bucket = dirMap.get(rel) ?? 'root';
      const slug = slugify(bucket);
      slugToName.set(slug, bucket);
      fileToSlug.set(rel, slug);
    }
  }

  return { fileToSlug, slugToName };
}

function buildSubsystems(
  root: string,
  graph: XrayGraph,
  rankedNodes: RankedNode[],
  surprises: ScoredEdge[],
  questions: Question[]
): {
  subsystems: SubsystemInfo[];
  matrix: Map<string, Map<string, number>>;
} {
  const { fileToSlug, slugToName } = partitionFiles(root, graph);
  const rankByNode = new Map<string, number>(rankedNodes.map((r) => [r.id, r.rank]));

  const filesBySlug = new Map<string, string[]>();
  for (const [file, slug] of fileToSlug.entries()) {
    const list = filesBySlug.get(slug) ?? [];
    list.push(file);
    filesBySlug.set(slug, list);
  }

  const nodeSubsystem = (nodeId: string): string | undefined => {
    if (!graph.hasNode(nodeId)) return undefined;
    const attrs = graph.getNodeAttributes(nodeId) as NodeAttributes;
    const rel = attrs.type === 'file' ? normalizeRel(root, nodeId) : normalizeRel(root, attrs.file);
    return fileToSlug.get(rel);
  };

  const nodeLoc = (nodeId: string): { label: string; file: string; line: number } => {
    const attrs = graph.getNodeAttributes(nodeId) as NodeAttributes;
    if (attrs.type === 'file') {
      return { label: attrs.label, file: normalizeRel(root, nodeId), line: 1 };
    }
    const tag = attrs as TagNodeAttributes;
    return { label: tag.label, file: normalizeRel(root, tag.file), line: tag.line || 1 };
  };

  const matrix = new Map<string, Map<string, number>>();
  const inboundBySlug = new Map<string, SubsystemInfo['inboundCallers']>();
  const outboundBySlug = new Map<string, SubsystemInfo['outboundDeps']>();
  const intraInboundFiles = new Map<string, Set<string>>();

  for (const slug of slugToName.keys()) {
    matrix.set(slug, new Map());
    inboundBySlug.set(slug, []);
    outboundBySlug.set(slug, []);
    intraInboundFiles.set(slug, new Set());
  }

  graph.forEachEdge((_edgeId, eAttrs, source, target) => {
    const type = (eAttrs as EdgeAttributes).type;
    if (type !== 'calls' && type !== 'imports') return;
    const srcSub = nodeSubsystem(source);
    const tgtSub = nodeSubsystem(target);
    if (!srcSub || !tgtSub) return;

    const srcLoc = nodeLoc(source);
    const tgtLoc = nodeLoc(target);

    if (srcSub === tgtSub) {
      if (srcLoc.file !== tgtLoc.file) {
        intraInboundFiles.get(tgtSub)?.add(tgtLoc.file);
      }
      return;
    }

    const row = matrix.get(srcSub)!;
    row.set(tgtSub, (row.get(tgtSub) ?? 0) + 1);

    inboundBySlug.get(tgtSub)!.push({
      fromSubsystem: srcSub,
      sourceLabel: srcLoc.label,
      sourceFile: srcLoc.file,
      sourceLine: srcLoc.line,
      targetLabel: tgtLoc.label,
      targetFile: tgtLoc.file,
      targetLine: tgtLoc.line,
    });

    outboundBySlug.get(srcSub)!.push({
      toSubsystem: tgtSub,
      sourceLabel: srcLoc.label,
      sourceFile: srcLoc.file,
      sourceLine: srcLoc.line,
      targetLabel: tgtLoc.label,
      targetFile: tgtLoc.file,
      targetLine: tgtLoc.line,
    });
  });

  const subsystems: SubsystemInfo[] = [];
  for (const slug of [...slugToName.keys()].sort()) {
    const files = (filesBySlug.get(slug) ?? []).slice().sort();
    const intraTargets = intraInboundFiles.get(slug) ?? new Set<string>();
    const entryCandidates = files.filter((f) => !intraTargets.has(f));
    const entryFiles = (entryCandidates.length > 0 ? entryCandidates : files).slice();

    const tagNodes: SubsystemInfo['topSymbols'] = [];
    graph.forEachNode((nodeId, attrs) => {
      const nAttrs = attrs as NodeAttributes;
      if (nAttrs.type !== 'tag') return;
      const rel = normalizeRel(root, nAttrs.file);
      if (fileToSlug.get(rel) !== slug) return;
      tagNodes.push({
        id: nodeId,
        name: nAttrs.label,
        kind: nAttrs.kind,
        file: rel,
        line: nAttrs.line || 1,
        signature: nAttrs.signature,
        rank: rankByNode.get(nodeId) ?? 0,
      });
    });
    tagNodes.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
    const topSymbols = tagNodes.slice(0, 10);

    const topHub =
      topSymbols.length > 0
        ? topSymbols[0].name
        : files.length > 0
          ? files[0]
          : slug;

    const inboundCallers = (inboundBySlug.get(slug) ?? []).sort(
      (a, b) =>
        a.fromSubsystem.localeCompare(b.fromSubsystem) ||
        a.sourceFile.localeCompare(b.sourceFile) ||
        a.sourceLine - b.sourceLine ||
        a.targetLabel.localeCompare(b.targetLabel)
    );
    const outboundDeps = (outboundBySlug.get(slug) ?? []).sort(
      (a, b) =>
        a.toSubsystem.localeCompare(b.toSubsystem) ||
        a.sourceFile.localeCompare(b.sourceFile) ||
        a.sourceLine - b.sourceLine ||
        a.targetLabel.localeCompare(b.targetLabel)
    );

    const subSurprises = surprises
      .filter((s) => nodeSubsystem(s.source) === slug || nodeSubsystem(s.target) === slug)
      .sort((a, b) => b.score - a.score || a.edgeId.localeCompare(b.edgeId))
      .slice(0, 10);

    const fileSet = new Set(files);
    const subQuestions = questions.filter(
      (q) => q.anchors?.some((a) => fileSet.has(normalizeRel(root, a.file))) ?? false
    );

    subsystems.push({
      slug,
      name: slugToName.get(slug) ?? slug,
      files,
      entryFiles,
      topSymbols,
      topHub,
      inboundCallers,
      outboundDeps,
      surprises: subSurprises,
      questions: subQuestions,
    });
  }

  return { subsystems, matrix };
}

export function renderReadme(
  subsystems: SubsystemInfo[],
  matrix: Map<string, Map<string, number>>,
  detected: DetectedStrategy[],
  meta: { lastUpdatedAt: string; lastUpdatedCommit: string }
): string {
  const lines: string[] = [
    buildFrontmatter({ ...meta, subsystem: 'overview' }),
    '# Architectural Handbook',
    '',
    '## Detected Stack',
    '',
  ];

  if (detected.length === 0) {
    lines.push('No framework or stack strategies detected.', '');
  } else {
    const sorted = [...detected].sort((a, b) => a.name.localeCompare(b.name));
    lines.push('| Strategy | Version | Details |', '| --- | --- | --- |');
    for (const d of sorted) {
      const detail = typeof d.score === 'number' ? `score ${d.score.toFixed(2)}` : 'detected';
      lines.push(`| ${escapeCell(d.name)} | ${escapeCell(d.version)} | ${escapeCell(detail)} |`);
    }
    lines.push('');
  }

  lines.push('## Subsystems', '');
  if (subsystems.length === 0) {
    lines.push('No subsystems discovered.', '');
  } else {
    lines.push('| Subsystem | Files | Top Hub | Page |', '| --- | ---: | --- | --- |');
    for (const sub of subsystems) {
      lines.push(
        `| ${escapeCell(sub.name)} | ${sub.files.length} | \`${escapeCell(sub.topHub)}\` | [${sub.slug}.md](./${sub.slug}.md) |`
      );
    }
    lines.push('');
  }

  lines.push('## Cross-Subsystem Dependency Matrix', '');
  if (subsystems.length === 0) {
    lines.push('No cross-subsystem dependencies.', '');
  } else {
    const header = ['From \\ To', ...subsystems.map((s) => escapeCell(s.slug))];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${header.map(() => '---').join(' | ')} |`);
    for (const from of subsystems) {
      const row = matrix.get(from.slug);
      const cells = subsystems.map((to) => {
        if (from.slug === to.slug) return '-';
        const count = row?.get(to.slug) ?? 0;
        return String(count);
      });
      lines.push(`| ${escapeCell(from.slug)} | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function renderSubsystemPage(
  sub: SubsystemInfo,
  headSha: string | null,
  meta: { lastUpdatedAt: string; lastUpdatedCommit: string },
  architectureDiagram?: string
): string {
  const lines: string[] = [
    buildFrontmatter({ ...meta, subsystem: sub.slug }),
    `# Subsystem: ${sub.name}`,
    '',
    `[Back to overview](./README.md)`,
    '',
    '## Entry Files',
    '',
  ];

  for (const f of sub.entryFiles) {
    lines.push(`- ${formatCitation(f, 1, headSha)}`);
  }
  lines.push('');

  if (architectureDiagram) {
    lines.push('## Architecture', '', '```mermaid', architectureDiagram.trimEnd(), '```', '');
  }

  lines.push('## Top Symbols (PageRank)', '');
  if (sub.topSymbols.length === 0) {
    lines.push('No symbols extracted in this subsystem.', '');
  } else {
    lines.push('| Symbol | Kind | Signature | Citation |', '| --- | --- | --- | --- |');
    for (const sym of sub.topSymbols) {
      const sig = sym.signature ? `\`${escapeCell(sym.signature)}\`` : '-';
      lines.push(
        `| \`${escapeCell(sym.name)}\` | ${escapeCell(sym.kind)} | ${sig} | ${formatCitation(sym.file, sym.line, headSha)} |`
      );
    }
    lines.push('');
  }

  lines.push('## Inbound Cross-Subsystem Callers (Public Contract)', '');
  if (sub.inboundCallers.length === 0) {
    lines.push('No inbound cross-subsystem callers.', '');
  } else {
    for (const c of sub.inboundCallers) {
      lines.push(
        `- **${c.fromSubsystem}** \`${c.sourceLabel}\` (${formatCitation(c.sourceFile, c.sourceLine, headSha)}) -> \`${c.targetLabel}\` (${formatCitation(c.targetFile, c.targetLine, headSha)})`
      );
    }
    lines.push('');
  }

  lines.push('## Outbound Dependencies', '');
  if (sub.outboundDeps.length === 0) {
    lines.push('No outbound cross-subsystem dependencies.', '');
  } else {
    for (const d of sub.outboundDeps) {
      lines.push(
        `- \`${d.sourceLabel}\` (${formatCitation(d.sourceFile, d.sourceLine, headSha)}) -> **${d.toSubsystem}** \`${d.targetLabel}\` (${formatCitation(d.targetFile, d.targetLine, headSha)})`
      );
    }
    lines.push('');
  }

  lines.push('## Surprise Edges & Questions', '');
  if (sub.surprises.length === 0 && sub.questions.length === 0) {
    lines.push('No surprise edges or structural questions flagged.', '');
  } else {
    for (const s of sub.surprises) {
      const reasons = s.reasons.map((r) => `${r.code}: ${r.detail}`).join('; ');
      lines.push(`- \`${s.source}\` -> \`${s.target}\` (score ${s.score.toFixed(2)}): ${reasons}`);
    }
    for (const q of sub.questions) {
      lines.push(`- **${q.type}**: ${q.question} — ${q.why}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export interface HandbookAnalysisData {
  root: string;
  outputDir: string;
  headSha: string | null;
  lastUpdatedAt: string;
  lastUpdatedCommit: string;
  subsystems: SubsystemInfo[];
  matrix: Map<string, Map<string, number>>;
  detected: DetectedStrategy[];
}

export async function analyzeHandbook(opts: GenerateHandbookOptions): Promise<HandbookAnalysisData> {
  const root = path.resolve(opts.root);
  const outputDir = path.resolve(root, opts.outputDir ?? path.join('.xray', 'handbook'));

  const xray = new Xray({
    path: root,
    configPath: opts.configPath,
    chunked: false,
    features: { incs: true },
  });
  xray.use(new ClusteringPlugin());
  xray.use(new SurpriseAnalyzerPlugin({ topN: 50 }));

  const { rankedNodes, graph } = await xray.buildGraph();
  const surprises = getSurprises(xray);
  const questions = generateQuestions(graph, xray, { root, max: 20 });

  const loader = new StrategyLoader();
  const detector = new StrategyDetector(loader, new StrategyContextImpl(root));
  const detected = await detector.runDetection();

  const headSha = await getHeadSha(root);
  const lastUpdatedCommit = headSha ?? 'working-tree';

  const fileList: string[] = [];
  graph.forEachNode((nodeId, attrs) => {
    if ((attrs as NodeAttributes).type === 'file') {
      fileList.push(normalizeRel(root, nodeId));
    }
  });
  const lastUpdatedAt = await resolveLastUpdatedAt(root, headSha, fileList);
  const { subsystems, matrix } = buildSubsystems(root, graph, rankedNodes, surprises, questions);

  return {
    root,
    outputDir,
    headSha,
    lastUpdatedAt,
    lastUpdatedCommit,
    subsystems,
    matrix,
    detected,
  };
}

export async function generateHandbook(opts: GenerateHandbookOptions): Promise<GenerateHandbookResult> {
  const root = path.resolve(opts.root);
  const outputDir = path.resolve(root, opts.outputDir ?? path.join('.xray', 'handbook'));

  checkOverwriteGuard(outputDir, opts.confirm === true);

  const analysis = await analyzeHandbook({ ...opts, root, outputDir });
  const { headSha, lastUpdatedAt, lastUpdatedCommit, subsystems, matrix, detected } = analysis;
  const meta = { lastUpdatedAt, lastUpdatedCommit };

  fs.mkdirSync(outputDir, { recursive: true });

  const written: string[] = [];
  const readmePath = path.join(outputDir, 'README.md');
  fs.writeFileSync(readmePath, renderReadme(subsystems, matrix, detected, meta), 'utf-8');
  written.push(readmePath);

  for (const sub of subsystems) {
    const subPath = path.join(outputDir, `${sub.slug}.md`);
    const diagram = renderMermaid(graph, {
      view: 'architecture',
      root,
      files: sub.files,
      maxNodes: 30,
    });
    fs.writeFileSync(subPath, renderSubsystemPage(sub, headSha, meta, diagram), 'utf-8');
    written.push(subPath);
  }

  return {
    outputDir,
    files: written,
    subsystems: subsystems.length,
    lastUpdatedAt,
    lastUpdatedCommit,
  };
}

export function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export function listHandbookPages(handbookDir: string): HandbookPageMeta[] {
  if (!fs.existsSync(handbookDir)) return [];
  const files = fs
    .readdirSync(handbookDir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => {
      if (a === 'README.md') return -1;
      if (b === 'README.md') return 1;
      return a.localeCompare(b);
    });

  return files.map((file) => {
    const slug = file.replace(/\.md$/i, '');
    const content = fs.readFileSync(path.join(handbookDir, file), 'utf-8');
    const fm = parseFrontmatter(content);
    return {
      slug,
      file: `handbook/${file}`,
      subsystem: fm.subsystem ?? slug,
      generator: fm.generator ?? 'unknown',
      lastUpdatedAt: fm.lastUpdatedAt ?? '',
      lastUpdatedCommit: fm.lastUpdatedCommit ?? '',
    };
  });
}

export function readHandbookPage(handbookDir: string, slug: string): string | null {
  const clean = slug.replace(/\.md$/i, '').trim();
  if (!clean || !/^[a-zA-Z0-9._-]+$/.test(clean) || clean.includes('..')) {
    throw new UsageError(`Invalid handbook slug '${slug}'`);
  }
  const target = path.resolve(handbookDir, `${clean}.md`);
  const rel = path.relative(path.resolve(handbookDir), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new UsageError(`Invalid handbook slug '${slug}'`);
  }
  if (!fs.existsSync(target)) return null;
  return fs.readFileSync(target, 'utf-8');
}
