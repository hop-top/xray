/**
 * Symbol matching shared by query adapters and `xray impact`.
 *
 * A pattern containing `*` or `?` is a glob matched against the node id
 * and the label (`**` crosses `/`, `*` does not); otherwise the label or
 * the node id must equal the pattern exactly. Only `tag` nodes match.
 *
 * Security: patterns > 100 characters or with > 10 `*` are rejected
 * (ReDoS guard); every regex special character is escaped.
 */

/** Ids of every tag node matching `pattern`, in graph order. */
export function findNodes(pattern: string, graph: any): string[] {
  const results: string[] = [];
  const isPattern = pattern.includes('*') || pattern.includes('?');

  // Validate first: throws on a malicious pattern.
  if (isPattern) validatePattern(pattern);

  graph.forEachNode((nodeId: string, attrs: any) => {
    if (attrs.type !== 'tag') return;

    if (isPattern) {
      if (matchPattern(nodeId, pattern) || matchPattern(attrs.label, pattern)) {
        results.push(nodeId);
      }
    } else if (attrs.label === pattern || nodeId === pattern) {
      results.push(nodeId);
    }
  });

  return results;
}

function validatePattern(pattern: string): void {
  if (pattern.length > 100) {
    throw new Error(`Pattern too complex: ${pattern}`);
  }
  const wildcardCount = (pattern.match(/\*/g) || []).length;
  if (wildcardCount > 10) {
    throw new Error(`Pattern too complex: ${pattern}`);
  }
}

function matchPattern(str: string, pattern: string): boolean {
  // Glob -> regex, escaping everything except glob wildcards.
  let regexPattern = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];
    const nextChar = pattern[i + 1];

    if (char === '*' && nextChar === '*') {
      regexPattern += '.*';
      i += 2;
    } else if (char === '*') {
      regexPattern += '[^/]*';
      i += 1;
    } else if (char === '?') {
      regexPattern += '.';
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      regexPattern += '\\' + char;
      i += 1;
    } else {
      regexPattern += char;
      i += 1;
    }
  }

  const regex = new RegExp('^' + regexPattern + '$');

  try {
    return regex.test(str);
  } catch {
    // Catastrophic backtracking.
    throw new Error(`Pattern too complex: ${pattern}`);
  }
}
