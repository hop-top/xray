// src/lib/markdown/parser.ts
import { extractMarkdownLinks, MarkdownLink, proseLines } from './links';
import { knownExtensions } from '../parser/grammars';
import { linguistExtensions } from '../parser/linguist-map';

export interface MarkdownHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface MarkdownCodeBlock {
  language: string;
  code: string;
  line: number;
}

export interface MarkdownCodeRef {
  path: string;
  line?: number;
  lineEnd?: number;
  symbol?: string;
  docLine: number;
  raw: string;
  description?: string;
}

export interface FileCitation {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  sha?: string;
  docLine: number;
  raw: string;
}

export interface ParsedMarkdownDocument {
  headings: MarkdownHeading[];
  links: MarkdownLink[];
  codeBlocks: MarkdownCodeBlock[];
  codeRefs: MarkdownCodeRef[];
  citations: FileCitation[];
}

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*(?:#+\s*)?$/;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const LINK_CODE_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const CITATION_RE = /@file:([^\s`'")\],;]+)/g;
const CITATION_BODY_RE = /^(.+?)(?::(\d+)(?:-(\d+))?)?(?:@([0-9a-fA-F]{4,40}))?$/;
const CODE_REF_BODY_RE = /^(.+?)(?::(\d+)(?:-(\d+))?)?(?:#([A-Za-z_.$][\w.$]*))?$/;

const EXTRA_CODE_EXTENSIONS = [
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp',
];

let cachedCodeExtensions: Set<string> | null = null;

function getCodeExtensions(): Set<string> {
  if (!cachedCodeExtensions) {
    cachedCodeExtensions = new Set<string>([
      ...knownExtensions(),
      ...linguistExtensions(),
      ...EXTRA_CODE_EXTENSIONS,
    ]);
  }
  return cachedCodeExtensions;
}

function hasCodeExtension(filePath: string): boolean {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const base = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return getCodeExtensions().has(base.slice(dot).toLowerCase());
}

/** GitHub-style heading slug. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function parseCodeRefCandidate(raw: string): Omit<MarkdownCodeRef, 'docLine' | 'raw' | 'description'> | null {
  if (raw.startsWith('@file:') || /^[a-z]+:\/\//i.test(raw)) return null;
  const match = CODE_REF_BODY_RE.exec(raw);
  if (!match) return null;

  const [, codePath, lineStartStr, lineEndStr, symbol] = match;
  if (!codePath || codePath.endsWith('/') || !hasCodeExtension(codePath)) return null;

  return {
    path: codePath,
    ...(lineStartStr ? { line: Number.parseInt(lineStartStr, 10) } : {}),
    ...(lineEndStr ? { lineEnd: Number.parseInt(lineEndStr, 10) } : {}),
    ...(symbol ? { symbol } : {}),
  };
}

/**
 * Parse a markdown document without external binaries, reusing `links.ts`
 * prose/fence rules for headings, code blocks, links, inline code refs,
 * and `@file:` citations.
 */
export function parseMarkdownDocument(content: string): ParsedMarkdownDocument {
  const lines = content.split('\n');
  const prose = proseLines(content);

  const headings: MarkdownHeading[] = [];
  const codeBlocks: MarkdownCodeBlock[] = [];
  const codeRefs: MarkdownCodeRef[] = [];
  const citations: FileCitation[] = [];

  let fenceChar: string | null = null;
  let blockLang = 'text';
  let blockStartLine = 0;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const fenceMatch = line.match(FENCE_RE);

    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (fenceChar === null) {
        fenceChar = markerChar;
        blockLang = fenceMatch[2].trim().split(/\s+/)[0] || 'text';
        blockStartLine = lineNum;
        blockLines = [];
      } else if (markerChar === fenceChar) {
        codeBlocks.push({
          language: blockLang,
          code: blockLines.join('\n'),
          line: blockStartLine,
        });
        fenceChar = null;
      } else {
        blockLines.push(line);
      }
      continue;
    }

    if (fenceChar !== null) {
      blockLines.push(line);
      continue;
    }

    // Outside fenced code blocks: extract headings.
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const text = headingMatch[2].trim();
      headings.push({
        level: headingMatch[1].length,
        text,
        slug: slugifyHeading(text),
        line: lineNum,
      });
    }

    // Extract inline code refs (`src/foo.ts`, `src/foo.ts:42`, `src/foo.ts#bar`).
    for (const m of line.matchAll(INLINE_CODE_RE)) {
      const candidate = parseCodeRefCandidate(m[1]);
      if (candidate) {
        codeRefs.push({
          ...candidate,
          docLine: lineNum,
          raw: m[1],
        });
      }
    }

    // Extract link-style code refs from prose ([text](src/file.ts)).
    const proseLine = prose[i] ?? '';
    for (const m of proseLine.matchAll(LINK_CODE_RE)) {
      const [, description, target] = m;
      const candidate = parseCodeRefCandidate(target);
      if (candidate) {
        const alreadyCaptured = codeRefs.some(
          r => r.path === candidate.path && r.docLine === lineNum
        );
        if (!alreadyCaptured) {
          codeRefs.push({
            ...candidate,
            docLine: lineNum,
            raw: target,
            description,
          });
        }
      }
    }

    // Extract structured @file:<relPath>[:<lineStart>[-<lineEnd>]][@<sha>] citations.
    for (const m of line.matchAll(CITATION_RE)) {
      const token = m[1].replace(/[.,;:!?]+$/, '');
      const bodyMatch = CITATION_BODY_RE.exec(token);
      if (!bodyMatch) continue;
      const [, relPath, lineStartStr, lineEndStr, sha] = bodyMatch;
      if (!relPath || relPath.endsWith('/')) continue;

      citations.push({
        path: relPath,
        ...(lineStartStr ? { lineStart: Number.parseInt(lineStartStr, 10) } : {}),
        ...(lineEndStr ? { lineEnd: Number.parseInt(lineEndStr, 10) } : {}),
        ...(sha ? { sha } : {}),
        docLine: lineNum,
        raw: `@file:${token}`,
      });
    }
  }

  // Close unclosed fence at EOF if present.
  if (fenceChar !== null) {
    codeBlocks.push({
      language: blockLang,
      code: blockLines.join('\n'),
      line: blockStartLine,
    });
  }

  return {
    headings,
    links: extractMarkdownLinks(content),
    codeBlocks,
    codeRefs,
    citations,
  };
}
