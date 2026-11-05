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
 *
 * Patterns can come from a cloned repo's config, so matching must not
 * backtrack: each pattern compiles to a token list and runs as a
 * state-set simulation, O(pattern length x path length) worst case.
 * A class range written backwards (`[z-a]`) is empty rather than an error.
 */

type Range = readonly [number, number];

type Token =
  | { k: 'lit'; c: string } // one character, case-folded
  | { k: 'any' } //            `?`: one non-`/` character
  | { k: 'set'; ranges: Range[]; neg: boolean } // `[...]`: any character, `/` included
  | { k: 'star' } //           `*`: non-`/` run, possibly empty
  | { k: 'deep' } //           `**`: any run, possibly empty
  | { k: 'open' } //           `**/` entry: no input, either skips the group or enters it
  | { k: 'dirs' }; //          `**/` body: any run, left through a `/`

/** Case-insensitive canonical form of one UTF-16 unit (ES `Canonicalize`, non-unicode mode). */
function fold(c: string): string {
  const u = c.toUpperCase();
  if (u.length !== 1) return c;
  return c.charCodeAt(0) >= 128 && u.charCodeAt(0) < 128 ? c : u;
}

/** Sorted, merged ranges; a reversed range contributes nothing. */
function parseClass(body: string): Range[] {
  const raw: Range[] = [];
  for (let i = 0; i < body.length; i++) {
    const lo = body.charCodeAt(i);
    if (body[i + 1] === '-' && i + 2 < body.length) {
      const hi = body.charCodeAt(i + 2);
      if (lo <= hi) raw.push([lo, hi]);
      i += 2;
    } else {
      raw.push([lo, lo]);
    }
  }
  raw.sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) {
      if (r[1] > last[1]) out[out.length - 1] = [last[0], r[1]];
    } else {
      out.push(r);
    }
  }
  return out;
}

function inRanges(ranges: readonly Range[], code: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (code < r[0]) hi = mid - 1;
    else if (code > r[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

function setMatches(t: { ranges: Range[]; neg: boolean }, c: string): boolean {
  const code = c.charCodeAt(0);
  let hit = inRanges(t.ranges, code);
  if (!hit) {
    const lower = c.toLowerCase();
    const upper = c.toUpperCase();
    hit =
      (lower.length === 1 && inRanges(t.ranges, lower.charCodeAt(0))) ||
      (upper.length === 1 && inRanges(t.ranges, upper.charCodeAt(0)));
  }
  return hit !== t.neg;
}

/** Tokens for the glob `pat`. */
function tokenize(pat: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        while (pat[i + 1] === '*') i++;
        if (pat[i + 1] === '/') {
          out.push({ k: 'open' }, { k: 'dirs' }); // `**/`: zero or more directories
          i++;
        } else {
          out.push({ k: 'deep' });
        }
      } else {
        out.push({ k: 'star' });
      }
    } else if (c === '?') {
      out.push({ k: 'any' });
    } else if (c === '[') {
      const close = pat.indexOf(']', i + 2);
      if (close === -1) {
        out.push({ k: 'lit', c: '[' });
      } else {
        let body = pat.slice(i + 1, close);
        const neg = body[0] === '!' || body[0] === '^';
        if (neg) body = body.slice(1);
        out.push({ k: 'set', ranges: parseClass(body), neg });
        i = close;
      }
    } else {
      out.push({ k: 'lit', c: fold(c) });
    }
  }
  return out;
}


/**
 * Whole-string matcher over `tokens`. State `j` means "tokens[0..j) are
 * consumed"; the set of live states advances one character at a time, so
 * work is bounded by tokens x characters whatever the pattern looks like.
 */
function machine(tokens: Token[]): (s: string) => boolean {
  const m = tokens.length;
  let cur = new Uint8Array(m + 1);
  let next = new Uint8Array(m + 1);
  const close = (v: Uint8Array): void => {
    for (let j = 0; j < m; j++) {
      if (!v[j]) continue;
      const k = tokens[j].k;
      if (k === 'star' || k === 'deep') v[j + 1] = 1;
      else if (k === 'open') v[j + 1] = v[j + 2] = 1;
    }
  };
  return (s: string): boolean => {
    cur.fill(0);
    cur[0] = 1;
    close(cur);
    for (let p = 0; p < s.length; p++) {
      const ch = s[p];
      const slash = ch === '/';
      const folded = fold(ch);
      next.fill(0);
      let live = false;
      for (let j = 0; j < m; j++) {
        if (!cur[j]) continue;
        const t = tokens[j];
        switch (t.k) {
          case 'lit':
            if (t.c === folded) next[j + 1] = 1;
            break;
          case 'any':
            if (!slash) next[j + 1] = 1;
            break;
          case 'set':
            if (setMatches(t, ch)) next[j + 1] = 1;
            break;
          case 'star':
            if (!slash) next[j] = 1;
            break;
          case 'deep':
            next[j] = 1;
            break;
          case 'open':
            break;
          case 'dirs':
            next[j] = 1;
            if (slash) next[j + 1] = 1;
            break;
        }
      }
      close(next);
      for (let j = 0; j <= m; j++) if (next[j]) { live = true; break; }
      [cur, next] = [next, cur];
      if (!live) return false;
    }
    return cur[m] === 1;
  };
}

function compileOne(raw: string): ((relPath: string) => boolean) | null {
  let pat = raw.replace(/^(?:\.\/)+/, '');
  if (pat === '') return null;
  const rooted = pat.startsWith('/');
  if (rooted) pat = pat.replace(/^\/+/, '');
  if (pat.endsWith('/')) pat += '**';
  if (pat === '') return null;
  if (rooted || pat.includes('/')) return machine(tokenize(pat));
  // Basename at any depth: an optional directory prefix; within one
  // segment `**` is just `*`.
  return machine([{ k: 'open' }, { k: 'dirs' }, ...tokenize(pat.replace(/\*{2,}/g, '*'))]);
}

const compileAll = (patterns: string[]): Array<(relPath: string) => boolean> =>
  patterns.map(compileOne).filter((f): f is (relPath: string) => boolean => f !== null);

/**
 * Predicate over root-relative posix paths for the given `--match` values.
 */
export function compileMatchers(patterns: readonly string[]): (relPath: string) => boolean {
  const pos: string[] = [];
  const neg: string[] = [];
  for (const p of patterns) (p.startsWith('!') ? neg : pos).push(p.startsWith('!') ? p.slice(1) : p);
  const include = compileAll(pos);
  const exclude = compileAll(neg);
  const wantsAny = include.length > 0;
  return (relPath: string): boolean => {
    if (exclude.some((f) => f(relPath))) return false;
    return wantsAny ? include.some((f) => f(relPath)) : true;
  };
}
