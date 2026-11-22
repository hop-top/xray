import { execFileNoThrow } from '../../utils/execFileNoThrow';
import { Tag } from './types';

let ctagsProbePromise: Promise<boolean> | null = null;

/**
 * Reset the cached Universal Ctags availability probe (primarily for tests).
 */
export function resetCtagsProbeCache(): void {
  ctagsProbePromise = null;
}

/**
 * Probe once per process whether Universal Ctags with JSON output is available.
 */
export async function hasUniversalCtags(): Promise<boolean> {
  if (!ctagsProbePromise) {
    ctagsProbePromise = (async () => {
      const res = await execFileNoThrow('ctags', ['--list-features']);
      if (res.status !== 0) return false;
      return /\bjson\b/.test(res.stdout);
    })();
  }
  return ctagsProbePromise;
}

const REGEX_DECL_RE =
  /^\s*(export\s+)?(fn|func|function|def|class|struct|enum|interface|type|message|service|resource)\s+([A-Za-z_]\w*)/;

const KEYWORD_KIND_MAP: Record<string, string> = {
  fn: 'function',
  func: 'function',
  function: 'function',
  def: 'function',
  class: 'class',
  struct: 'struct',
  enum: 'enum',
  interface: 'interface',
  type: 'type',
  message: 'message',
  service: 'service',
  resource: 'resource',
};

interface CtagsJsonEntry {
  _type?: string;
  name?: string;
  kind?: string;
  line?: number;
  signature?: string;
}

function parseCtagsNdjson(stdout: string, relPath: string): Tag[] {
  const tags: Tag[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let entry: CtagsJsonEntry;
    try {
      entry = JSON.parse(line) as CtagsJsonEntry;
    } catch {
      continue;
    }
    if (entry._type && entry._type !== 'tag') continue;
    if (!entry.name) continue;
    tags.push({
      file: relPath,
      name: entry.name,
      kind: entry.kind || 'symbol',
      line: typeof entry.line === 'number' && entry.line > 0 ? entry.line - 1 : 0,
      col: 0,
      ...(entry.signature ? { signature: entry.signature } : {}),
      source: 'ctags',
    });
  }
  return tags;
}

function extractRegexTags(relPath: string, content: string): Tag[] {
  const tags: Tag[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = REGEX_DECL_RE.exec(lines[i]);
    if (!match) continue;
    const keyword = match[2];
    const name = match[3];
    tags.push({
      file: relPath,
      name,
      kind: KEYWORD_KIND_MAP[keyword] || keyword,
      line: i,
      col: 0,
      source: 'regex',
    });
  }
  return tags;
}

/**
 * Extract symbol tags for a file without a tree-sitter grammar using
 * Universal Ctags JSON output when available, or a conservative regex fallback.
 */
export async function extractFallbackTags(
  absPath: string,
  relPath: string,
  content: string
): Promise<Tag[]> {
  if (await hasUniversalCtags()) {
    const res = await execFileNoThrow('ctags', [
      '--output-format=json',
      '--fields=+nKS',
      '-f',
      '-',
      absPath,
    ]);
    if (res.status === 0) {
      return parseCtagsNdjson(res.stdout, relPath);
    }
  }
  return extractRegexTags(relPath, content);
}
