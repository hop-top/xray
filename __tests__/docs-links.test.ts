import * as fs from 'fs';
import * as path from 'path';

// Every relative Markdown link in the shipped docs resolves to a file, and
// every `#anchor` matches a heading slug (GitHub rules) in the target.

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const isMd = (f: string) => f.endsWith('.md');
const isReadme = (f: string) => path.basename(f) === 'README.md';

const files = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'AGENTS.md'),
  ...walk(path.join(ROOT, 'docs'), isMd),
  ...walk(path.join(ROOT, 'skills'), isMd),
  ...walk(path.join(ROOT, 'hooks'), isReadme),
].filter(f => fs.existsSync(f));

/** Lines outside fenced code blocks, inline code removed. */
function proseLines(text: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
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

/** GitHub heading slug: lowercase, drop punctuation except `-`/`_`, spaces → `-`. */
function slugify(heading: string): string {
  // Code spans are literal text (`<x>` stays); outside them drop inline HTML.
  const text = heading
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part.replace(/`/g, '') : part.replace(/<[^>]+>/g, '')))
    .join('');
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/\*/g, '')                      // emphasis markers
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const anchorCache = new Map<string, Set<string>>();

function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let fence: string | null = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    for (const m of line.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(m[1]);
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!h) continue;
    const base = slugify(h[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

interface Link { line: number; target: string }

function linksOf(file: string): Link[] {
  const links: Link[] = [];
  proseLines(fs.readFileSync(file, 'utf8')).forEach((line, i) => {
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ line: i + 1, target: m[1] });
    }
    const ref = line.match(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/);
    if (ref) links.push({ line: i + 1, target: ref[1] });
  });
  return links;
}

function brokenLinks(file: string): string[] {
  const broken: string[] = [];
  for (const { line, target } of linksOf(file)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, …
    const [rawPath, anchor] = target.split('#', 2);
    const p = decodeURIComponent(rawPath);
    const dest = p === '' ? file : path.resolve(path.dirname(file), p);
    const where = `L${line} ${target}`;
    if (p.startsWith('/')) { broken.push(`${where} (absolute path)`); continue; }
    if (!fs.existsSync(dest)) { broken.push(`${where} (no such file)`); continue; }
    if (anchor === undefined || anchor === '') continue;
    if (!dest.endsWith('.md') || fs.statSync(dest).isDirectory()) continue;
    if (!anchorsOf(dest).has(decodeURIComponent(anchor).toLowerCase())) {
      broken.push(`${where} (no heading #${anchor})`);
    }
  }
  return broken;
}

describe('slugify follows GitHub heading slugs', () => {
  test.each([
    ['Quick Start', 'quick-start'],
    ['`xray impact` — callers', 'xray-impact--callers'],
    ['What\'s new? (v2.0)', 'whats-new-v20'],
    ['snake_case & kebab-case', 'snake_case--kebab-case'],
    ['[Link](x.md) text', 'link-text'],
    ['`xray <strategy> <command>`', 'xray-strategy-command'],
    ['Setup <sup>beta</sup>', 'setup-beta'],
  ])('%s → %s', (h, slug) => expect(slugify(h)).toBe(slug));

  test('duplicate headings get -1, -2 suffixes', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'docs-links-'));
    const f = path.join(tmp, 'dup.md');
    fs.writeFileSync(f, '# Usage\n## Usage\n```\n# Usage\n```\n### Usage\n');
    try {
      expect([...anchorsOf(f)]).toEqual(['usage', 'usage-1', 'usage-2']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('docs links resolve', () => {
  test.each(files.map(f => [path.relative(ROOT, f), f]))('%s', (_n, f) => {
    expect(brokenLinks(f)).toEqual([]);
  });
});
