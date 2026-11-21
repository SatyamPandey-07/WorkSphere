export const DEFAULT_VENUE_CATEGORIES = [
  'Coworking Space',
  'Library',
  'Cafe',
  'Meeting Room',
  'Quiet Zone',
  'Phone Booth',
  'Event Space',
  'Lounge',
];

export function damerauLevenshteinDistance(a: string, b: string): number {
  const s = a.toLowerCase().trim();
  const t = b.toLowerCase().trim();
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let best = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );

      if (
        i > 1 &&
        j > 1 &&
        s[i - 1] === t[j - 2] &&
        s[i - 2] === t[j - 1]
      ) {
        best = Math.min(best, dp[i - 2][j - 2] + cost);
      }

      dp[i][j] = best;
    }
  }

  return dp[m][n];
}

export function getFuzzyCategorySuggestion(
  query: string,
  candidates: readonly string[] = DEFAULT_VENUE_CATEGORIES,
  maxDistance = 3
): string | null {
  const cleaned = query.trim().toLowerCase();
  if (cleaned.length < 2) return null;

  const exactOrPrefix = candidates.find(
    (c) =>
      c.toLowerCase() === cleaned ||
      c.toLowerCase().startsWith(cleaned)
  );
  if (exactOrPrefix) return null;

  let bestCandidate: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase();
    const firstWord = lowerCandidate.split(/\s+/)[0] ?? lowerCandidate;

    const fullDist = damerauLevenshteinDistance(cleaned, lowerCandidate);
    const wordDist = damerauLevenshteinDistance(cleaned, firstWord);
    const distance = Math.min(fullDist, wordDist);

    const allowedThreshold =
      cleaned.length <= 3
        ? 1
        : Math.min(maxDistance, Math.max(2, Math.floor(lowerCandidate.length * 0.45)));

    if (distance <= allowedThreshold && distance < bestScore) {
      bestScore = distance;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}