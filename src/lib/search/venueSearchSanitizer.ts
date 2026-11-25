/**
 * Venue Search Sanitizer & Amenity Autocorrect (#9612)
 *
 * Implements Levenshtein/Damerau-Levenshtein distance fuzzy matching
 * for venue amenity search queries to prevent zero-result drop-offs.
 */

export const DEFAULT_VENUE_AMENITIES: readonly string[] = [
  "wifi",
  "ergonomic chair",
  "outlet",
  "power outlet",
  "quiet zone",
  "standing desk",
  "phone booth",
  "monitor",
  "whiteboard",
  "meeting room",
  "coffee",
  "projector",
  "printer",
  "high-speed internet",
  "lounge",
] as const;

export const VENUE_AMENITIES = DEFAULT_VENUE_AMENITIES;

/**
 * Calculates the Damerau-Levenshtein distance between two strings,
 * accounting for insertions, deletions, substitutions, and transpositions.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (typeof a !== "string" || typeof b !== "string") return Infinity;
  const s = a.toLowerCase().trim();
  const t = b.toLowerCase().trim();
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;
  if (s === t) return 0;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let min = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );

      // Adjacent character transposition
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        min = Math.min(min, dp[i - 2][j - 2] + cost);
      }

      dp[i][j] = min;
    }
  }

  return dp[m][n];
}

export const damerauLevenshteinDistance = levenshteinDistance;

/**
 * Returns top matching amenity keywords when a search query is within edit distance threshold (default 2).
 * Excludes exact matches and queries shorter than 2 characters.
 */
export function getAmenitySuggestions(
  query: string,
  candidates: readonly string[] = DEFAULT_VENUE_AMENITIES,
  maxDistance = 2,
  limit = 3,
): string[] {
  if (typeof query !== "string") return [];
  const cleanQuery = query
    .toLowerCase()
    .trim()
    .replace(/^[^\w]+|[^\w]+$/g, "");
  if (cleanQuery.length < 2) return [];

  // If already an exact match to one of the candidates, no autocorrect suggestion needed
  if (candidates.some((c) => c.toLowerCase() === cleanQuery)) {
    return [];
  }

  const matches: { candidate: string; distance: number }[] = [];

  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase();
    let distance = levenshteinDistance(cleanQuery, lowerCandidate);

    // 1. If candidate is multi-word and query is single word (e.g. "ergonmic" -> "ergonomic chair")
    if (distance > maxDistance && lowerCandidate.includes(" ")) {
      const words = lowerCandidate.split(/\s+/);
      for (const word of words) {
        const wordDist = levenshteinDistance(cleanQuery, word);
        if (wordDist <= maxDistance && wordDist < distance) {
          distance = wordDist;
        }
      }
    }

    // 2. If query has multiple words and candidate is single/multi-word (e.g. "fast wifii" -> "wifi")
    if (distance > maxDistance && cleanQuery.includes(" ")) {
      const queryWords = cleanQuery.split(/\s+/);
      for (const qWord of queryWords) {
        if (qWord.length >= 2) {
          const qDist = levenshteinDistance(qWord, lowerCandidate);
          if (qDist <= maxDistance && qDist < distance) {
            distance = qDist;
          }
        }
      }
    }

    if (distance <= maxDistance) {
      matches.push({ candidate, distance });
    }
  }

  // Sort primarily by closest distance, then candidate length, then alphabetically
  matches.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    if (a.candidate.length !== b.candidate.length) {
      return a.candidate.length - b.candidate.length;
    }
    return a.candidate.localeCompare(b.candidate);
  });

  const seen = new Set<string>();
  const results: string[] = [];
  for (const match of matches) {
    if (!seen.has(match.candidate)) {
      seen.add(match.candidate);
      results.push(match.candidate);
      if (results.length >= limit) {
        break;
      }
    }
  }

  return results;
}

/**
 * Convenience helper returning the single best amenity suggestion or null.
 */
export function getFuzzyAmenitySuggestion(
  query: string,
  candidates: readonly string[] = DEFAULT_VENUE_AMENITIES,
  maxDistance = 2,
): string | null {
  const suggestions = getAmenitySuggestions(query, candidates, maxDistance, 1);
  return suggestions[0] ?? null;
}

/**
 * Sanitizes and normalizes a venue search query string.
 */
export function sanitizeVenueSearchQuery(query: unknown): string {
  if (typeof query !== "string") return "";
  return query
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, 100);
}
