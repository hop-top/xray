// src/lib/markdown/links.ts
import * as path from 'path';

/** A link target as written, with its 1-based source line. */
export interface MarkdownLink {
  text: string;
  target: string;
  line: number;
}

/** Where a link target points once resolved. */
export type LinkResolution =
  | { kind: 'external' }
  | { kind: 'self'; anchor: string }
  | { kind: 'file'; path: string; anchor?: string };

const FENCE = /^\s*(`{3,}|~{3,})/;
const INLINE_LINK = /!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REF_DEF = /^\s*\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s|$)/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Lines outside fenced code blocks, inline code spans removed. */
export function proseLines(text: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const m = line.match(FENCE);
    if (m) {
      if (fence === null) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      out.push('');
      continue;
    }
    out.push(fence === null ? line.replace(/`+[^`]*`+/g, '') : '');
  }
  return out;
}

/** Inline (`[t](x)`, `![t](x)`) and reference-definition links in prose. */
export function extractMarkdownLinks(text: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  proseLines(text).forEach((line, i) => {
    for (const m of line.matchAll(INLINE_LINK)) {
      links.push({ text: m[1], target: m[2], line: i + 1 });
    }
    const ref = line.match(REF_DEF);
    if (ref) links.push({ text: ref[1], target: ref[2], line: i + 1 });
  });
  return links;
}

/**
 * Resolve a link target written in `fromFile`. Relative targets (bare,
 * `./`, `../`) resolve against the linking file's directory; `/x` against
 * `root`; anything with a URI scheme is external. `?query` and `#anchor`
 * are stripped from the path.
 */
export function resolveLinkTarget(target: string, fromFile: string, root: string): LinkResolution {
  if (SCHEME.test(target)) return { kind: 'external' };
  const hash = target.indexOf('#');
  const anchor = hash === -1 ? undefined : target.slice(hash + 1);
  let rawPath = hash === -1 ? target : target.slice(0, hash);
  const query = rawPath.indexOf('?');
  if (query !== -1) rawPath = rawPath.slice(0, query);

  let p: string;
  try {
    p = decodeURIComponent(rawPath);
  } catch {
    p = rawPath;
  }
  if (p === '') return { kind: 'self', anchor: anchor ?? '' };

  const resolved = p.startsWith('/')
    ? path.join(root, p)
    : path.resolve(path.dirname(fromFile), p);
  return anchor === undefined
    ? { kind: 'file', path: resolved }
    : { kind: 'file', path: resolved, anchor };
}
