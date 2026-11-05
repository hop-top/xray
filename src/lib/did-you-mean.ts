/** Levenshtein-1 nearest neighbour for did-you-mean. Cheap and good enough. */
export function nearestMatch(input: string, candidates: string[]): string | null {
  let best: { name: string; d: number } | null = null;
  for (const c of candidates) {
    const d = editDistance(input, c);
    if (best === null || d < best.d) best = { name: c, d };
  }
  // Tolerance: short tokens (<=6 chars) → 2 edits (catches typos like
  // 'mpa' vs 'map' which Levenshtein scores at 2). Longer tokens →
  // length/4.
  const tol = input.length <= 6 ? 2 : Math.floor(input.length / 4);
  return best && best.d <= Math.max(1, tol) ? best.name : null;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
