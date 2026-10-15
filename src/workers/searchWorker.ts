/**
 * searchWorker.ts
 *
 * Dedicated background Web Worker thread pool engine for client-side fuzzy venue search.
 * Offloads compute-heavy Levenshtein distance calculations and trigram matching from the
 * main UI thread to eliminate typing stutter and maintain 60 FPS in global search bars.
 */

export interface SearchableVenue {
  id: string;
  name: string;
  category?: string;
  address?: string;
  tags?: string[];
  city?: string;
  [key: string]: any;
}

export interface SearchResult extends SearchableVenue {
  score: number;
  matchType: "exact" | "prefix" | "substring" | "trigram" | "levenshtein";
}

export type SearchWorkerRequest =
  | {
      type: "INDEX";
      venues: SearchableVenue[];
      requestId?: string;
    }
  | {
      type: "SEARCH";
      query: string;
      venues?: SearchableVenue[];
      limit?: number;
      threshold?: number;
      requestId?: string;
    };

export type SearchWorkerResponse =
  | {
      type: "INDEXED";
      count: number;
      requestId?: string;
    }
  | {
      type: "RESULTS";
      results: SearchResult[];
      query: string;
      durationMs: number;
      requestId?: string;
    }
  | {
      type: "ERROR";
      error: string;
      requestId?: string;
    };

/**
 * Computes Levenshtein edit distance between strings a and b.
 */
export function levenshteinDistance(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();

  const m = s1.length;
  const n = s2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row dynamic programming
  const d: number[] = [];
  for (let j = 0; j <= n; j++) {
    d[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    d[0] = i;

    for (let j = 1; j <= n; j++) {
      const temp = d[j];
      if (s1[i - 1] === s2[j - 1]) {
        d[j] = prev;
      } else {
        d[j] = Math.min(prev + 1, d[j] + 1, d[j - 1] + 1);
      }
      prev = temp;
    }
  }

  return d[n];
}

/**
 * Normalizes Levenshtein distance to similarity score [0.0, 1.0].
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Generates character 3-grams (trigrams) from text.
 */
export function generateTrigrams(text: string): Set<string> {
  const normalized = `  ${text.toLowerCase().trim()}  `;
  const trigrams = new Set<string>();

  for (let i = 0; i < normalized.length - 2; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }

  return trigrams;
}

/**
 * Computes Sørensen–Dice trigram similarity coefficient between 0.0 and 1.0.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const triA = generateTrigrams(a);
  const triB = generateTrigrams(b);

  if (triA.size === 0 || triB.size === 0) return 0;

  let intersection = 0;
  triA.forEach((tri) => {
    if (triB.has(tri)) {
      intersection++;
    }
  });

  return (2 * intersection) / (triA.size + triB.size);
}

/**
 * Scores a venue against search query using fuzzy matching heuristics.
 */
export function scoreVenue(
  venue: SearchableVenue,
  rawQuery: string
): { score: number; matchType: SearchResult["matchType"] } {
  const q = rawQuery.toLowerCase().trim();
  if (!q) return { score: 1.0, matchType: "exact" };

  const name = venue.name.toLowerCase();
  const category = (venue.category || "").toLowerCase();
  const address = (venue.address || "").toLowerCase();
  const tags = (venue.tags || []).map((t) => t.toLowerCase()).join(" ");

  // 1. Exact match
  if (name === q) {
    return { score: 1.0, matchType: "exact" };
  }

  // 2. Prefix match
  if (name.startsWith(q)) {
    return { score: 0.95, matchType: "prefix" };
  }

  // 3. Substring match
  if (name.includes(q)) {
    return { score: 0.85, matchType: "substring" };
  }

  // Category or Tag exact/prefix match
  if (category.startsWith(q) || tags.includes(q)) {
    return { score: 0.8, matchType: "substring" };
  }

  // 4. Trigram similarity match
  const nameTri = trigramSimilarity(q, name);
  const catTri = trigramSimilarity(q, category);
  const tagTri = trigramSimilarity(q, tags);
  const addrTri = trigramSimilarity(q, address);
  const bestTri = Math.max(nameTri, catTri * 0.9, tagTri * 0.85, addrTri * 0.7);

  // 5. Levenshtein edit distance similarity
  const levName = levenshteinSimilarity(q, name);
  const levWords = name.split(/\s+/).map((w) => levenshteinSimilarity(q, w));
  const bestLevWord = Math.max(0, ...levWords);
  const bestLev = Math.max(levName, bestLevWord);

  const hybridScore = Math.max(bestTri * 0.7 + bestLev * 0.3, bestLev * 0.8);

  let matchType: SearchResult["matchType"] = "trigram";
  if (bestLev > bestTri) {
    matchType = "levenshtein";
  }

  return {
    score: Number(hybridScore.toFixed(3)),
    matchType,
  };
}

/**
 * Performs full fuzzy search over venue list.
 */
export function searchVenues(
  venues: SearchableVenue[],
  query: string,
  threshold: number = 0.25,
  limit: number = 20
): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return venues.slice(0, limit).map((v) => ({
      ...v,
      score: 1.0,
      matchType: "exact",
    }));
  }

  const results: SearchResult[] = [];

  for (const venue of venues) {
    const { score, matchType } = scoreVenue(venue, trimmed);
    if (score >= threshold) {
      results.push({
        ...venue,
        score,
        matchType,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

// In-worker cached venue index
let cachedVenues: SearchableVenue[] = [];

// Worker message listener
if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("message", (event: MessageEvent<SearchWorkerRequest>) => {
    const message = event.data;
    if (!message) return;

    const startTime = performance.now();

    try {
      switch (message.type) {
        case "INDEX": {
          cachedVenues = message.venues || [];
          const response: SearchWorkerResponse = {
            type: "INDEXED",
            count: cachedVenues.length,
            requestId: message.requestId,
          };
          self.postMessage(response);
          break;
        }

        case "SEARCH": {
          const targetVenues = message.venues || cachedVenues;
          const limit = message.limit ?? 20;
          const threshold = message.threshold ?? 0.25;

          const results = searchVenues(targetVenues, message.query, threshold, limit);
          const durationMs = Number((performance.now() - startTime).toFixed(2));

          const response: SearchWorkerResponse = {
            type: "RESULTS",
            results,
            query: message.query,
            durationMs,
            requestId: message.requestId,
          };
          self.postMessage(response);
          break;
        }
      }
    } catch (err: any) {
      const response: SearchWorkerResponse = {
        type: "ERROR",
        error: err?.message || "Search worker execution error",
        requestId: message.requestId,
      };
      self.postMessage(response);
    }
  });
}

export default searchVenues;
