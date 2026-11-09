/**
 * Markdown formatter for `Question[]`.
 *
 * Pure function. Takes the output of `generateQuestions` plus the scan
 * root and produces a human-readable markdown block. Each question is
 * rendered as:
 *
 *   ### <question>
 *   **Why:** <why>
 *   **How to investigate:** <how>
 *   - [src/foo.ts:42](src/foo.ts#L42)
 *
 * Anchor links are built relative to `opts.root` so they land as valid
 * repo-root-relative paths when dropped into a markdown file inside the
 * project. Markdown metacharacters in interpolated symbol labels are
 * escaped via `escapeMarkdown` so labels containing `` ` ``, `[`, `]`,
 * `|`, or `\` cannot break the surrounding template.
 *
 * Not exported from `questions.ts` to keep that file under the 500-LOC
 * ceiling recommended for plugin modules.
 */

import * as path from 'path';
import type { Question, QuestionAnchor } from './questions';

export interface FormatQuestionsOptions {
  /** Scan root — used to build repo-root-relative anchor links. */
  root: string;
}

/**
 * Escape markdown metacharacters that can break the surrounding
 * template when a symbol label is interpolated verbatim.
 *
 * Characters covered (spec §Risks R3):
 *   - Backtick        — breaks inline code spans
 *   - Square brackets — break link syntax
 *   - Pipe            — breaks table rows (future-proofing)
 *   - Backslash       — the escape character itself
 *
 * Order matters: backslash MUST be escaped first so later
 * replacements don't double-escape the backslashes they introduce.
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\|/g, '\\|');
}

/**
 * Build a repo-root-relative markdown link for an anchor. Always
 * returns a link — when the anchor file falls outside `root`,
 * `relativeTo` falls back to the basename (so absolute paths don't
 * leak), and the link href + label both use that basename.
 */
function anchorLink(anchor: QuestionAnchor, root: string): string {
  const relative = relativeTo(anchor.file, root);
  const label =
    anchor.line !== undefined ? `${relative}:${anchor.line}` : relative;
  const href =
    anchor.line !== undefined ? `${relative}#L${anchor.line}` : relative;
  return `[${escapeMarkdown(label)}](${href})`;
}

/**
 * Strip `root` prefix from `file` and return a forward-slash path so
 * the result works as a markdown link regardless of the host OS.
 * Falls back to the original path when `file` is not under `root`
 * (e.g. absolute path passed through unchanged).
 */
function relativeTo(file: string, root: string): string {
  if (!root) return toPosix(file);
  // If already relative, just normalise slashes.
  if (!path.isAbsolute(file)) return toPosix(file);
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    // Outside root — fall back to the basename to avoid leaking the
    // absolute path into the output.
    return toPosix(path.basename(file));
  }
  return toPosix(rel);
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Format a `Question[]` as markdown. Returns an empty string for an
 * empty input so callers can append conditionally without checking
 * length.
 */
export function formatQuestionsMarkdown(
  questions: Question[],
  opts: FormatQuestionsOptions
): string {
  if (questions.length === 0) return '';

  const lines: string[] = [];
  for (const q of questions) {
    lines.push(`### ${q.question}`);
    lines.push('');
    lines.push(`**Why:** ${q.why}`);
    lines.push('');
    lines.push(`**How to investigate:** ${q.howToInvestigate}`);
    if (q.anchors && q.anchors.length > 0) {
      lines.push('');
      for (const a of q.anchors) {
        lines.push(`- ${anchorLink(a, opts.root)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}
