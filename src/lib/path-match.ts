/**
 * File-path pattern matching for `--match`.
 *
 * Patterns are globs tested against a path relative to the scan root,
 * posix-separated, never the absolute path:
 *   - `*` matches within one path segment, `?` one non-`/` character,
 *     `[abc]` / `[!abc]` a character class, `**` any run including `/`
 *     (`**` followed by `/` also matches zero directories)
 *   - every other character is literal, `.` included
 *   - no `/` in the pattern: matches the basename at any depth
 *   - a `/` in the pattern: matches from the root (a leading `/` or `./`
 *     is dropped; a trailing `/` means everything under that directory)
 *   - case-insensitive, like the scanner's .gitignore handling
 * A `!` prefix excludes. Positive patterns are OR'd, excludes always win,
 * and with no positive pattern every path but the excluded ones matches.
 */

const escapeChar = (c: string): string => c.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

/** Regex source for the glob `pat`, to be anchored by the caller. */
function globSource(pat: string): string {
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        while (pat[i + 1] === '*') i++;
        if (pat[i + 1] === '/') {
          out += '(?:.*/)?'; // `**/`: zero or more directories
          i++;
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '[') {
      const close = pat.indexOf(']', i + 2);
      if (close === -1) {
        out += '\\[';
      } else {
        let body = pat.slice(i + 1, close);
        const neg = body[0] === '!' || body[0] === '^';
        if (neg) body = body.slice(1);
        out += `[${neg ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`;
        i = close;
      }
    } else {
      out += escapeChar(c);
    }
  }
  return out;
}

function compileOne(raw: string): RegExp | null {
  let pat = raw.replace(/^(?:\.\/)+/, '');
  if (pat === '') return null;
  const rooted = pat.startsWith('/');
  if (rooted) pat = pat.replace(/^\/+/, '');
  if (pat.endsWith('/')) pat += '**';
  if (pat === '') return null;
  if (rooted || pat.includes('/')) return new RegExp(`^${globSource(pat)}$`, 'i');
  // Basename at any depth; within one segment `**` is just `*`.
  return new RegExp(`(?:^|/)${globSource(pat.replace(/\*{2,}/g, '*'))}$`, 'i');
}

const asRegexes = (patterns: string[]): RegExp[] =>
  patterns.map(compileOne).filter((r): r is RegExp => r !== null);

/**
 * Predicate over root-relative posix paths for the given `--match` values.
 * Basename patterns carry no `/`, so the `(?:^|/)` prefix makes them match
 * the last segment only.
 */
export function compileMatchers(patterns: readonly string[]): (relPath: string) => boolean {
  const pos: string[] = [];
  const neg: string[] = [];
  for (const p of patterns) (p.startsWith('!') ? neg : pos).push(p.startsWith('!') ? p.slice(1) : p);
  const include = asRegexes(pos);
  const exclude = asRegexes(neg);
  const wantsAny = pos.some((p) => compileOne(p) !== null);
  return (relPath: string): boolean => {
    if (exclude.some((r) => r.test(relPath))) return false;
    return wantsAny ? include.some((r) => r.test(relPath)) : true;
  };
}
