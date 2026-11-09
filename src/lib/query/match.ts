/**
 * Symbol matching shared by query adapters and `xray impact`.
 *
 * A pattern containing `*` or `?` is a glob matched against the node id
 * and the label (`**` crosses `/`, `*` does not); otherwise the label or
 * the node id must equal the pattern exactly. Only `tag` nodes match.
 *
 * Security: patterns > 100 characters or with > 10 `*` are rejected;
 * matching is a linear state-set machine (src/lib/path-match.ts), so no
 * pattern can backtrack.
 */

import { compileSymbolGlob } from '../path-match';

/** Ids of every tag node matching `pattern`, in graph order. */
export function findNodes(pattern: string, graph: any): string[] {
  const results: string[] = [];
  const isPattern = pattern.includes('*') || pattern.includes('?');

  // Validate first: throws on a malicious pattern.
  if (isPattern) validatePattern(pattern);
  const glob = isPattern ? compileSymbolGlob(pattern) : null;

  graph.forEachNode((nodeId: string, attrs: any) => {
    if (attrs.type !== 'tag') return;

    if (glob) {
      if (glob(String(nodeId)) || glob(String(attrs.label))) {
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
