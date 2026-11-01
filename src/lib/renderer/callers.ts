/**
 * Cross-file "used by" caller selection shared by the map and chunked
 * renderers.
 *
 * `calls` edges carry a confidence: EXTRACTED (resolved via same file,
 * same directory or an imported file) or INFERRED (global name-match
 * fallback). EXTRACTED callers are listed first; INFERRED callers are
 * flagged, capped separately and the remainder summarised so a common
 * name (`close`, `cleanup`, ...) cannot flood a symbol's caller list.
 * Edges without a confidence are treated as EXTRACTED, matching the
 * serializer's backfill for pre-confidence graphs.
 */

import { Confidence } from '../../types/graph';

export interface CrossFileCaller {
  file: string;
  /** 1-indexed start line. */
  line: number;
  /** 1-indexed end line (falls back to `line`). */
  endLine: number;
  label: string;
  inferred: boolean;
}

export interface CrossFileCallers {
  /** EXTRACTED callers first, then INFERRED ones, each already capped. */
  callers: CrossFileCaller[];
  /** INFERRED callers dropped by the cap. */
  inferredOverflow: number;
}

/** Max EXTRACTED callers listed per symbol. */
export const MAX_EXTRACTED_CALLERS = 3;
/** Max INFERRED callers listed per symbol; the rest become `+N inferred`. */
export const MAX_INFERRED_CALLERS = 3;

interface GraphLike {
  inEdges(node: string): string[];
  source(edge: string): string;
  getEdgeAttributes(edge: string): { confidence?: unknown };
}

export function collectCrossFileCallers(
  graph: GraphLike,
  tagId: string,
  tagFile: string,
  getNodeAttributes: (nodeId: string) => any
): CrossFileCallers {
  const extracted: CrossFileCaller[] = [];
  const inferred: CrossFileCaller[] = [];
  let inferredTotal = 0;

  for (const edge of graph.inEdges(tagId)) {
    const attrs = getNodeAttributes(graph.source(edge));
    if (!attrs || attrs.type !== 'tag' || attrs.file === tagFile) continue;

    const isInferred = graph.getEdgeAttributes(edge).confidence === Confidence.INFERRED;
    if (isInferred) {
      inferredTotal += 1;
      if (inferred.length >= MAX_INFERRED_CALLERS) continue;
    } else if (extracted.length >= MAX_EXTRACTED_CALLERS) {
      continue;
    }

    const caller: CrossFileCaller = {
      file: attrs.file,
      line: attrs.line + 1,
      endLine: attrs.endLine ? attrs.endLine + 1 : attrs.line + 1,
      label: attrs.label,
      inferred: isInferred,
    };
    (isInferred ? inferred : extracted).push(caller);
  }

  return {
    callers: [...extracted, ...inferred],
    inferredOverflow: inferredTotal - inferred.length,
  };
}

/**
 * Render caller lines. `link` formats the `[file:Lnn]...` part; the
 * ` (inferred)` suffix and `+N inferred` summary are shared.
 */
export function formatCallerLines(
  result: CrossFileCallers,
  link: (caller: CrossFileCaller) => string
): string[] {
  const lines = result.callers.map(
    (c) => `│       → used by: ${link(c)}${c.inferred ? ' (inferred)' : ''}`
  );
  if (result.inferredOverflow > 0) {
    lines.push(`│       → +${result.inferredOverflow} inferred`);
  }
  return lines;
}
