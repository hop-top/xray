import * as fs from 'fs';
import { readTextSafe } from './safe-read';
import * as path from 'path';
import { RankedNode, isRankedTagNode } from '../types/graph';
import { ChunkMetadata } from './renderer/chunked-renderer';

export interface ShareSummaryOptions {
  projectPath: string;
  outputPath: string;
  rootChunk?: string;
  chunked: boolean;
  metadata?: ChunkMetadata[];
  rankedNodes: RankedNode[];
  graph?: { order?: number; size?: number };
  command?: string;
  detectedStrategies?: string[];
  tokenLimit?: number;
}

export interface SharePathOptions {
  outputPath: string;
  projectPath: string;
  shareOption?: boolean | string;
  pathIndex?: number;
  totalPaths?: number;
}

export const resolveShareOutputPath = (options: SharePathOptions): string => {
  if (typeof options.shareOption === 'string' && options.shareOption.trim().length > 0) {
    return path.isAbsolute(options.shareOption)
      ? options.shareOption
      : path.resolve(process.cwd(), options.shareOption);
  }

  const parsed = path.parse(options.outputPath);
  const totalPaths = options.totalPaths ?? 1;
  const projectSlug = toSlug(path.basename(options.projectPath));

  let suffix = '';
  if (totalPaths > 1) {
    if (projectSlug) {
      suffix = `.${projectSlug}`;
    } else if (typeof options.pathIndex === 'number') {
      suffix = `.path${options.pathIndex + 1}`;
    }
  }

  const filename = `${parsed.name}${suffix}.share.md`;
  return path.join(parsed.dir, filename);
};

export const buildShareSummary = (options: ShareSummaryOptions): string => {
  const projectName = getProjectName(options.projectPath);
  const generatedAt = new Date().toISOString();
  const outputDisplay = options.outputPath === '-' ? 'stdout' : toDisplayPath(options.outputPath, options.projectPath);
  const rootChunkDisplay = options.rootChunk ? toDisplayPath(options.rootChunk, options.projectPath) : undefined;

  const fileNodes = options.rankedNodes.filter(node => node.attributes?.type === 'file');
  const tagNodes = options.rankedNodes.filter(node => node.attributes?.type === 'tag');

  const topFiles = fileNodes
    .slice(0, 5)
    .map(node => `\`${node.id}\``)
    .join(', ') || '(none)';

  const topTags = tagNodes
    .slice(0, 5)
    .map(node => {
      const label = node.attributes?.label || node.id;
      const file = isRankedTagNode(node) ? node.attributes.file : undefined;
      return file ? `\`${label}\` (${file})` : `\`${label}\``;
    })
    .join(', ') || '(none)';

  const nodeCount = typeof options.graph?.order === 'number'
    ? options.graph.order
    : fileNodes.length + tagNodes.length;
  const edgeCount = typeof options.graph?.size === 'number' ? options.graph.size : undefined;

  const lines: string[] = [];
  lines.push('# Xray Code Map Snapshot');
  lines.push('');
  lines.push(`Project: ${projectName}`);
  lines.push(`Generated: ${generatedAt}`);
  if (options.command) {
    lines.push(`Command: \`${options.command}\``);
  }
  lines.push(`Output: \`${outputDisplay}\``);
  if (rootChunkDisplay) {
    lines.push(`Root chunk: \`${rootChunkDisplay}\``);
  }
  if (options.detectedStrategies && options.detectedStrategies.length > 0) {
    lines.push(`Detected strategies: ${options.detectedStrategies.join(', ')}`);
  }
  lines.push('');
  lines.push('## Highlights');
  lines.push(`- Files: ${fileNodes.length}, Tags: ${tagNodes.length}, Nodes: ${nodeCount}${edgeCount !== undefined ? `, Edges: ${edgeCount}` : ''}`);
  lines.push(`- Top files: ${topFiles}`);
  lines.push(`- Top tags: ${topTags}`);

  if (options.chunked && options.metadata) {
    const totalTokens = options.metadata.reduce((sum, entry) => sum + entry.tokenCount, 0);
    const tokenLimit = options.tokenLimit ?? 4096;
    lines.push(`- Chunks: ${options.metadata.length}, Token limit: ${tokenLimit}, Tokens: ${Math.round(totalTokens)}`);
  }

  lines.push('');
  lines.push('Generated with xray. Install: `npm i -g xray`');
  lines.push('');

  return lines.join('\n');
};

const getProjectName = (projectPath: string): string => {
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const content = readTextSafe(projectPath, 'package.json');
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name && typeof pkg.name === 'string') {
        return pkg.name;
      }
    }
  } catch {
    // Ignore malformed package.json or read errors
  }

  return path.basename(projectPath);
};

const toDisplayPath = (filePath: string, projectPath: string): string => {
  try {
    const relative = path.relative(projectPath, filePath);
    if (!relative || relative.startsWith('..')) {
      return filePath;
    }
    return relative;
  } catch {
    return filePath;
  }
};

const toSlug = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};
