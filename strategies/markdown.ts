// strategies/markdown.ts
import { Strategy, StrategyContext, FileMetadata } from '../src/lib/strategy/types';
import { execFileNoThrow } from '../src/utils/execFileNoThrow';
import { resolveLinkTarget } from '../src/lib/markdown/links';
import { parseMarkdownDocument } from '../src/lib/markdown/parser';
import { FileScanner } from '../src/lib/scanner';
import { isSupportedFallbackFile } from '../src/lib/parser/linguist-map';
import { ParserManager } from '../src/lib/parser/manager';
import { extractFallbackTags } from '../src/lib/parser/ctags-fallback';
import { getDiff, isGitRepo } from '../src/lib/git';
import * as path from 'path';
import * as fs from 'fs';

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

/** Return the resolved existing file path for a code ref, or `null` if not found. */
function resolveCodeRefPath(ref: string, docFile: string, scanRoot: string, repoRoot: string): string | null {
  const bases = [path.dirname(docFile), scanRoot, repoRoot];
  const candidates = path.isAbsolute(ref) ? [ref] : bases.map(b => path.join(b, ref));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function countFileLines(content: string): number {
  if (content === '') return 0;
  const parts = content.split('\n');
  return content.endsWith('\n') ? parts.length - 1 : parts.length;
}

const MARKDOWN_EXT_RE = /\.(md|mdx|markdown)$/i;

/** Resolve a markdown link target to a project-relative POSIX path (and optional anchor). */
function resolveProjectRelativeLink(
  rawTarget: string,
  docFile: string,
  projectRoot: string
): { relPath: string; anchor?: string } | null {
  const absDoc = path.isAbsolute(docFile) ? docFile : path.resolve(projectRoot, docFile);
  const res = resolveLinkTarget(rawTarget, absDoc, projectRoot);
  if (res.kind !== 'file') return null;
  const relPath = path.relative(projectRoot, res.path).split(path.sep).join('/');
  return res.anchor !== undefined ? { relPath, anchor: res.anchor } : { relPath };
}

export default class MarkdownStrategy implements Strategy {
  name = 'markdown';
  description = 'Analyze markdown docs: TOC, cross-references, orphans, coverage, broken links';
  version = '0.1.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
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

    const content = await ctx.readFile(file);
    const parsed = parseMarkdownDocument(content);

    const tags: string[] = parsed.headings.map(h => `${file}::${h.text}`);
    const metadata: Record<string, any> = {
      sections: parsed.headings.map(h => ({
        title: h.text,
        depth: h.level,
        line: h.line,
        slug: h.slug,
        file,
      })),
      codeBlocks: parsed.codeBlocks.map(b => ({
        language: b.language,
        code: b.code,
        line: b.line,
        file,
      })),
      links: [] as any[],
      codeReferences: [] as any[],
    };

    for (const { text, target: url } of parsed.links) {
      const resolved = resolveProjectRelativeLink(url, absolutePath, projectRoot);
      if (!resolved) continue;

      metadata.links.push({
        text,
        url: resolved.relPath,
        original: url,
        ...(resolved.anchor !== undefined ? { anchor: resolved.anchor } : {}),
        file,
      });
    }

    for (const ref of parsed.codeRefs) {
      metadata.codeReferences.push({
        path: ref.path,
        ...(ref.line !== undefined ? { line: ref.line } : {}),
        ...(ref.lineEnd !== undefined ? { lineEnd: ref.lineEnd } : {}),
        ...(ref.symbol ? { symbol: ref.symbol } : {}),
        ...(ref.description ? { description: ref.description } : {}),
        documentedIn: file,
      });
    }

    for (const cite of parsed.citations) {
      metadata.codeReferences.push({
        path: cite.path,
        ...(cite.lineStart !== undefined ? { line: cite.lineStart } : {}),
        ...(cite.lineEnd !== undefined ? { lineEnd: cite.lineEnd } : {}),
        ...(cite.sha ? { sha: cite.sha } : {}),
        raw: cite.raw,
        documentedIn: file,
      });
    }

    return {
      tags,
      exports: [],
      imports: [],
      metadata,
    };
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
        const projectRoot = ctx.getProjectRoot();
        const files = await ctx.findFiles({ extension: '.md' });
        const graph = new Map<string, string[]>();

        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'markdown');
          if (!metadata?.links) continue;

          const targets = metadata.links
            .map((link: any) => resolveProjectRelativeLink(link.original ?? link.url, file, projectRoot)?.relPath)
            .filter((rel: string | undefined): rel is string => !!rel && MARKDOWN_EXT_RE.test(rel));

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
        const projectRoot = ctx.getProjectRoot();
        const files = await ctx.findFiles({ extension: '.md' });
        const linkedFiles = new Set<string>();

        // Collect all linked files (excluding self-links)
        for (const file of files) {
          const metadata = ctx.getMetadata(file, 'markdown');
          if (!metadata?.links) continue;
          const selfRel = file.split(path.sep).join('/');

          for (const link of metadata.links) {
            const resolved = resolveProjectRelativeLink(link.original ?? link.url, file, projectRoot);
            if (!resolved) continue;
            if (MARKDOWN_EXT_RE.test(resolved.relPath) && resolved.relPath !== selfRel) {
              linkedFiles.add(resolved.relPath);
            }
          }
        }

        // Find orphans
        const orphans = files.filter(f => !linkedFiles.has(f.split(path.sep).join('/')));

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
        const projectRoot = ctx.getProjectRoot();
        const repoRoot = findRepoRoot(projectRoot);
        const scanner = new FileScanner(projectRoot);
        const sourceFiles = scanner.scan(
          FileScanner.supportedExtensions(),
          (relPath) => isSupportedFallbackFile(relPath)
        );
        const sourceSet = new Set(sourceFiles);
        const docFiles = await ctx.findFiles({ extension: '.md' });

        const documented = new Set<string>();

        // Check which source files are referenced in docs
        for (const doc of docFiles) {
          const metadata = ctx.getMetadata(doc, 'markdown');
          if (!metadata?.codeReferences) continue;

          const absDoc = path.resolve(projectRoot, doc);
          for (const ref of metadata.codeReferences) {
            if (!isPathShaped(ref.path)) continue;
            const resolved = resolveCodeRefPath(ref.path, absDoc, projectRoot, repoRoot);
            if (!resolved) continue;
            const relToProject = path.relative(projectRoot, resolved).split(path.sep).join('/');
            if (sourceSet.has(relToProject)) {
              documented.add(relToProject);
            }
          }
        }

        const documentedFiles = sourceFiles.filter(f => documented.has(f));
        const undocumented = sourceFiles.filter(f => !documented.has(f));

        return {
          total: sourceFiles.length,
          documented: documentedFiles.length,
          undocumented: undocumented.length,
          coverage: sourceFiles.length > 0
            ? (documentedFiles.length / sourceFiles.length) * 100
            : 0,
          files: {
            documented: documentedFiles,
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
        const inGitRepo = await isGitRepo(repoRoot);
        const parserManager = new ParserManager(repoRoot);

        const fileCache = new Map<string, { content: string; lineCount: number }>();
        const tagCache = new Map<string, Set<string>>();
        const shaExistsCache = new Map<string, boolean>();

        const readCachedFile = (absPath: string): { content: string; lineCount: number } => {
          let cached = fileCache.get(absPath);
          if (!cached) {
            const content = fs.readFileSync(absPath, 'utf8');
            cached = { content, lineCount: countFileLines(content) };
            fileCache.set(absPath, cached);
          }
          return cached;
        };

        const getSymbolNames = async (absPath: string, content: string): Promise<Set<string>> => {
          let cached = tagCache.get(absPath);
          if (!cached) {
            const relToRepo = path.relative(repoRoot, absPath).split(path.sep).join('/');
            let tags = (await parserManager.parse(relToRepo, content)).tags;
            if (tags.length === 0) {
              tags = await extractFallbackTags(repoRoot, relToRepo, content);
            }
            cached = new Set(tags.map(t => t.name));
            tagCache.set(absPath, cached);
          }
          return cached;
        };

        const commitExists = async (sha: string): Promise<boolean> => {
          let cached = shaExistsCache.get(sha);
          if (cached === undefined) {
            const res = await execFileNoThrow('git', ['-C', repoRoot, 'cat-file', '-e', `${sha}^{commit}`]);
            cached = res.status === 0;
            shaExistsCache.set(sha, cached);
          }
          return cached;
        };

        for (const doc of docFiles) {
          const metadata = ctx.getMetadata(doc, 'markdown');

          // Check markdown links
          if (metadata?.links) {
            for (const link of metadata.links) {
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

          // Check code references & structured @file citations
          if (metadata?.codeReferences) {
            for (const ref of metadata.codeReferences) {
              if (!isPathShaped(ref.path)) continue;

              const resolvedPath = resolveCodeRefPath(
                ref.path,
                path.resolve(projectRoot, doc),
                projectRoot,
                repoRoot
              );
              if (!resolvedPath) {
                stale.push({
                  doc,
                  reference: ref.path,
                  reason: 'code_path_not_found',
                  type: 'code_path_reference'
                });
                continue;
              }

              const { content, lineCount } = readCachedFile(resolvedPath);

              if (ref.line !== undefined) {
                const lineEnd = ref.lineEnd ?? ref.line;
                if (ref.line < 1 || ref.line > lineCount || lineEnd < ref.line || lineEnd > lineCount) {
                  stale.push({
                    doc,
                    reference: ref.path,
                    line: ref.line,
                    ...(ref.lineEnd !== undefined ? { lineEnd: ref.lineEnd } : {}),
                    reason: 'line_out_of_range',
                    type: 'code_path_reference'
                  });
                }
              }

              if (ref.symbol) {
                const symbolNames = await getSymbolNames(resolvedPath, content);
                const shortSym = ref.symbol.includes('.') ? ref.symbol.split('.').pop()! : ref.symbol;
                if (!symbolNames.has(ref.symbol) && !symbolNames.has(shortSym)) {
                  stale.push({
                    doc,
                    reference: ref.path,
                    symbol: ref.symbol,
                    reason: 'symbol_not_found',
                    type: 'code_path_reference'
                  });
                }
              }

              if (ref.sha && inGitRepo) {
                const hasSha = await commitExists(ref.sha);
                if (!hasSha) {
                  stale.push({
                    doc,
                    reference: ref.path,
                    sha: ref.sha,
                    reason: 'pinned_sha_missing',
                    type: 'code_path_reference'
                  });
                } else {
                  const relToRepo = path.relative(repoRoot, resolvedPath).split(path.sep).join('/');
                  const diffs = await getDiff(repoRoot, ref.sha, 'HEAD', [relToRepo]);
                  if (diffs.length > 0) {
                    let changed = false;
                    if (ref.line !== undefined) {
                      const citeStart = ref.line;
                      const citeEnd = ref.lineEnd ?? ref.line;
                      changed = diffs.some(d =>
                        d.status === 'D' ||
                        d.changedLines.some(r => r.start <= citeEnd && r.end >= citeStart)
                      );
                    } else {
                      changed = true;
                    }

                    if (changed) {
                      stale.push({
                        doc,
                        reference: ref.path,
                        sha: ref.sha,
                        ...(ref.line !== undefined ? { line: ref.line } : {}),
                        ...(ref.lineEnd !== undefined ? { lineEnd: ref.lineEnd } : {}),
                        reason: 'code_changed_since_sha',
                        type: 'code_path_reference'
                      });
                    }
                  }
                }
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
