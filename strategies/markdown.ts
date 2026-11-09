// strategies/markdown.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import { execFileNoThrow } from '../src/utils/execFileNoThrow';
import { Logger } from '../src/lib/logger';
import { mdqInstallHint } from '../src/utils/mdqInstall';
import { extractMarkdownLinks, resolveLinkTarget } from '../src/lib/markdown/links';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// mdq JSON structure types
interface MdqDocument {
  items: Array<{
    document: Array<MdqElement>;
  }>;
}

interface MdqSection {
  section: {
    depth: number;
    title: string;
    body: Array<MdqElement>;
  };
}

interface MdqParagraph {
  paragraph: string;
}

interface MdqCodeBlock {
  code_block: {
    language?: string;
    code: string;
  };
}

interface MdqList {
  list: {
    tight: boolean;
    items: Array<{ item: string }>;
  };
}

type MdqElement = MdqSection | MdqParagraph | MdqCodeBlock | MdqList;

const DEFAULT_MDQ_TIMEOUT_MS = 30_000;

/**
 * Run mdq on `input` (fed on stdin, then closed, so it cannot block waiting
 * for more) with a hard timeout that kills the child.
 */
function runMdq(args: string[], input: string): Promise<{ status: number; stdout: string; stderr: string }> {
  const timeoutMs = Number(process.env.XRAY_MDQ_TIMEOUT_MS) || DEFAULT_MDQ_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn('mdq', args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    // The document goes in on stdin: mdq never opens a project path itself,
    // so a FIFO, device or link out of the root cannot reach it.
    child.stdin.on('error', () => { /* mdq exited before reading it all */ });
    child.stdin.end(input);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (status: number, extraErr = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr: stderr + extraErr });
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(124, `mdq timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(127, String(err)));
    child.on('close', (code) => finish(code ?? 1));
  });
}

/** An inline-code mention that looks like a file path: no spaces, globs, or URL schemes. */
function isPathShaped(ref: string): boolean {
  return /^[\w@.\-/]+$/.test(ref) && !ref.endsWith('/');
}

/** Nearest ancestor of `from` (inclusive) holding a `.git` entry; else `from`. */
function findRepoRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

/** True if a mentioned path exists relative to the doc's dir, the scan root, or the repo root. */
function resolveCodeRef(ref: string, docFile: string, scanRoot: string, repoRoot: string): boolean {
  const bases = [path.dirname(docFile), scanRoot, repoRoot];
  const candidates = path.isAbsolute(ref) ? [ref] : bases.map(b => path.join(b, ref));
  return candidates.some(c => fs.existsSync(c));
}

export default class MarkdownStrategy implements Strategy {
  name = 'markdown';
  description = 'Analyze markdown docs: TOC, cross-references, orphans, coverage, broken links';
  version = '0.1.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    // Check if mdq is available
    try {
      const result = await execFileNoThrow('which', ['mdq']);
      if (result.status !== 0) {
        Logger.info(`mdq not found; markdown strategy disabled. ${mdqInstallHint()}`);
        return false;
      }
    } catch {
      Logger.info(`mdq not found; markdown strategy disabled. ${mdqInstallHint()}`);
      return false;
    }

    // Check if project has markdown files
    return ctx.hasFiles('**/*.md') || ctx.hasFiles('**/*.mdx');
  }

  fileTypes(): string[] {
    return ['.md', '.mdx', '.markdown'];
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    const projectRoot = ctx.getProjectRoot();
    const absolutePath = path.isAbsolute(file) ? file : path.join(projectRoot, file);

    // Verify file exists
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    // One guarded read (regular file inside the root, size cap); the same
    // text feeds mdq and the line mapping below.
    const content = await ctx.readFile(file);

    // Parse markdown with mdq (SAFE - no shell injection)
    // First positional of mdq is a SELECTOR (empty = whole document); the document is on stdin.
    const result = await runMdq(['--output', 'json', ''], content);

    if (result.status !== 0) {
      throw new Error(`mdq failed: ${result.stderr}`);
    }

    let doc: MdqDocument;
    try {
      doc = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`Failed to parse mdq output: ${error}`);
    }

    // Extract structure
    const tags: string[] = [];
    const metadata: Record<string, any> = {
      sections: [],
      codeBlocks: [],
      links: [],
      codeReferences: []
    };

    // Traverse document structure
    this.traverseDocument(doc, content, tags, metadata, file);

    return {
      tags,
      exports: [],
      imports: [],
      metadata
    };
  }

  /**
   * Recursively traverse mdq document structure
   */
  private traverseDocument(
    doc: MdqDocument,
    content: string,
    tags: string[],
    metadata: Record<string, any>,
    file: string
  ): void {
    const lines = content.split('\n');

    // Extract headings and map to line numbers
    for (const item of doc.items) {
      if (!item.document) continue;

      for (const element of item.document) {
        this.processElement(element, lines, tags, metadata, file, 0);
      }
    }

    // Extract links and code references from content
    this.extractLinks(content, metadata, file);
    this.extractCodeReferences(content, metadata, file);
  }

  /**
   * Process a single mdq element
   */
  private processElement(
    element: MdqElement,
    lines: string[],
    tags: string[],
    metadata: Record<string, any>,
    file: string,
    depth: number
  ): void {
    if ('section' in element) {
      const section = element.section;

      // Find line number for this heading
      const headingLine = this.findHeadingLine(lines, section.title, section.depth);

      tags.push(`${file}::${section.title}`);

      metadata.sections.push({
        title: section.title,
        depth: section.depth,
        line: headingLine,
        file
      });

      // Process body recursively
      for (const bodyElement of section.body) {
        this.processElement(bodyElement, lines, tags, metadata, file, depth + 1);
      }
    } else if ('code_block' in element) {
      const codeBlock = element.code_block;

      metadata.codeBlocks.push({
        language: codeBlock.language || 'text',
        code: codeBlock.code,
        file
      });
    }
  }

  /**
   * Find line number of a heading in source
   */
  private findHeadingLine(lines: string[], title: string, depth: number): number {
    const headingPrefix = '#'.repeat(depth);
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${headingPrefix}\\s+${escapedTitle}`);

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        return i + 1; // 1-indexed
      }
    }

    return 0;
  }

  /**
   * Extract markdown links
   */
  private extractLinks(content: string, metadata: Record<string, any>, file: string): void {
    // Prose only: links inside fenced or inline code are examples, not links.
    for (const { text, target: url } of extractMarkdownLinks(content)) {
      // Skip external URLs
      if (url.startsWith('http://') || url.startsWith('https://')) {
        continue;
      }

      // Resolve relative links
      if (url.startsWith('./') || url.startsWith('../')) {
        const fileDir = path.dirname(file);
        const resolved = path.normalize(path.join(fileDir, url));
        metadata.links.push({
          text,
          url: resolved,
          original: url,
          file
        });
      } else if (!url.startsWith('#')) {
        // Internal link (absolute path or same dir)
        metadata.links.push({
          text,
          url,
          original: url,
          file
        });
      }
    }
  }

  /**
   * Extract inline code references like `src/file.ts:123`
   */
  private extractCodeReferences(content: string, metadata: Record<string, any>, file: string): void {
    // Match `path/to/file.ext` or `path/to/file.ext:123`
    const codeRefRegex = /`([^`]+\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|sh)(?::\d+)?)`/g;
    let match;

    while ((match = codeRefRegex.exec(content)) !== null) {
      const [_, ref] = match;
      const lineMatch = ref.match(/^(.*?)(?::(\d+))?$/)!;
      const [, codePath, lineNum] = lineMatch;

      metadata.codeReferences.push({
        path: codePath,
        line: lineNum ? parseInt(lineNum) : undefined,
        documentedIn: file
      });
    }

    // Also match link-style code references: [text](./src/file.ts)
    const linkCodeRegex = /\[([^\]]+)\]\(([^)]+\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|sh))\)/g;

    while ((match = linkCodeRegex.exec(content)) !== null) {
      const [_, text, codePath] = match;

      // Skip if already captured as a code ref
      const alreadyCaptured = metadata.codeReferences.some(
        (r: any) => r.path === codePath
      );

      if (!alreadyCaptured) {
        metadata.codeReferences.push({
          path: codePath,
          description: text,
          documentedIn: file
        });
      }
    }
  }

  commands = {
    'toc': {
      description: 'Generate table of contents for markdown files',
      options: {
        'depth': 'Maximum heading depth (default: 3)'
      },
      async handler(ctx: StrategyContext, opts?: any): Promise<any> {
        const files = await ctx.findFiles({ extension: '.md' });
        const maxDepth = parseInt(opts?.depth || '3');

        const toc: any[] = [];

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'markdown');
          if (!metadata?.sections) continue;

          const sections = metadata.sections.filter(
            (s: any) => s.depth <= maxDepth
          );

          if (sections.length > 0) {
            toc.push({
              file,
              sections
            });
          }
        }

        // Format as markdown
        let output = '# Table of Contents\n\n';

        for (const { file, sections } of toc) {
          output += `## ${file}\n\n`;

          for (const section of sections) {
            const indent = '  '.repeat(section.depth - 1);
            output += `${indent}- [${section.title}](${file}:L${section.line})\n`;
          }

          output += '\n';
        }

        return output;
      }
    },

    'refs': {
      description: 'Show cross-references between markdown files',
      async handler(ctx: StrategyContext): Promise<any> {
        const files = await ctx.findFiles({ extension: '.md' });
        const graph = new Map<string, string[]>();

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'markdown');
          if (!metadata?.links) continue;

          const targets = metadata.links
            .filter((link: any) => link.url.endsWith('.md'))
            .map((link: any) => link.url);

          if (targets.length > 0) {
            graph.set(file, targets);
          }
        }

        // Format output
        let output = '# Markdown Cross-References\n\n';

        for (const [source, targets] of graph.entries()) {
          output += `${source}\n`;
          for (const target of targets) {
            output += `  → ${target}\n`;
          }
          output += '\n';
        }

        return output;
      }
    },

    'orphans': {
      description: 'Find markdown files with no incoming links',
      async handler(ctx: StrategyContext): Promise<any> {
        const files = await ctx.findFiles({ extension: '.md' });
        const linkedFiles = new Set<string>();

        // Collect all linked files
        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'markdown');
          if (!metadata?.links) continue;

          metadata.links.forEach((link: any) => {
            if (link.url.endsWith('.md')) {
              linkedFiles.add(link.url);
            }
          });
        }

        // Find orphans
        const orphans = files.filter(f => !linkedFiles.has(f));

        return {
          orphans,
          count: orphans.length,
          percentage: files.length > 0 ? (orphans.length / files.length) * 100 : 0
        };
      }
    },

    'code-refs': {
      description: 'Find code references in markdown files',
      async handler(ctx: StrategyContext): Promise<any> {
        const files = await ctx.findFiles({ extension: '.md' });
        const codeRefs = new Map<string, Array<{ doc: string; line?: number }>>();

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'markdown');
          if (!metadata?.codeReferences) continue;

          for (const ref of metadata.codeReferences) {
            if (!codeRefs.has(ref.path)) {
              codeRefs.set(ref.path, []);
            }

            codeRefs.get(ref.path)!.push({
              doc: file,
              line: ref.line
            });
          }
        }

        // Format output
        let output = '# Code References in Documentation\n\n';

        for (const [codePath, refs] of codeRefs.entries()) {
          output += `## ${codePath}\n\n`;
          output += `Referenced in ${refs.length} document(s):\n\n`;

          for (const ref of refs) {
            if (ref.line) {
              output += `- ${ref.doc} (refers to line ${ref.line})\n`;
            } else {
              output += `- ${ref.doc}\n`;
            }
          }

          output += '\n';
        }

        return output;
      }
    },

    'coverage': {
      description: 'Show documentation coverage for source files',
      async handler(ctx: StrategyContext): Promise<any> {
        // Find all source files
        const sourceFiles = await ctx.findFiles({ extension: '.ts' });
        const docFiles = await ctx.findFiles({ extension: '.md' });

        const documented = new Set<string>();

        // Check which source files are referenced in docs
        for (const doc of docFiles) {
          const metadata = ctx.getMetadata(doc, 'markdown');
          if (!metadata?.codeReferences) continue;

          metadata.codeReferences.forEach((ref: any) => {
            documented.add(ref.path);
          });
        }

        const undocumented = sourceFiles.filter(f => !documented.has(f));

        return {
          total: sourceFiles.length,
          documented: documented.size,
          undocumented: undocumented.length,
          coverage: sourceFiles.length > 0
            ? (documented.size / sourceFiles.length) * 100
            : 0,
          files: {
            documented: Array.from(documented),
            undocumented
          }
        };
      }
    },

    'stale': {
      description: 'Find broken links and references in markdown files',
      async handler(ctx: StrategyContext): Promise<any> {
        const docFiles = await ctx.findFiles({ extension: '.md' });
        const projectRoot = ctx.getProjectRoot();
        const stale: any[] = [];
        const repoRoot = findRepoRoot(projectRoot);

        for (const doc of docFiles) {
          const metadata = ctx.getMetadata(doc, 'markdown');

          // Check markdown links
          if (metadata?.links) {
            for (const link of metadata.links) {
              // Resolve against the linking doc (bare, ./, ../) or the
              // scan root (/x); #anchor and ?query never reach the fs.
              const target = resolveLinkTarget(
                link.original ?? link.url,
                path.resolve(projectRoot, doc),
                projectRoot
              );
              if (target.kind !== 'file') continue;

              if (!fs.existsSync(target.path)) {
                stale.push({
                  doc,
                  link: link.original,
                  target: path.relative(projectRoot, target.path).split(path.sep).join('/'),
                  reason: 'target_not_found',
                  type: 'markdown_link'
                });
              }
            }
          }

          // Check code references
          if (metadata?.codeReferences) {
            for (const ref of metadata.codeReferences) {
              if (!isPathShaped(ref.path)) continue;

              if (!resolveCodeRef(ref.path, path.resolve(projectRoot, doc), projectRoot, repoRoot)) {
                stale.push({
                  doc,
                  reference: ref.path,
                  reason: 'code_path_not_found',
                  type: 'code_path_reference'
                });
              } else if (ref.line) {
                // TODO: Check if line/symbol exists in file
                // Would require parsing the code file
              }
            }
          }
        }

        return {
          stale,
          count: stale.length
        };
      }
    }
  };
}
