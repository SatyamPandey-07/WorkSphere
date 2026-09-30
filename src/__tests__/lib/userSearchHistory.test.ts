/**
 * Tests for user search history management.
 */

interface SearchHistoryEntry {
  query: string;
  searchedAt: number;
  resultsCount: number;
}

function addToHistory(
  history: SearchHistoryEntry[],
  entry: SearchHistoryEntry,
  maxEntries = 20
): SearchHistoryEntry[] {
  const filtered = history.filter(
    (e) => e.query.toLowerCase() !== entry.query.toLowerCase()
  );
  return [entry, ...filtered].slice(0, maxEntries);
}

function recentSearches(
  history: SearchHistoryEntry[],
  limit: number
): SearchHistoryEntry[] {
  return [...history].sort((a, b) => b.searchedAt - a.searchedAt).slice(0, limit);
}

function clearHistory(history: SearchHistoryEntry[]): SearchHistoryEntry[] {
  return [];
}

function topSearchTerms(
  history: SearchHistoryEntry[],
  limit: number
): string[] {
  const counts: Record<string, number> = {};
  for (const e of history) {
    const q = e.query.toLowerCase();
    counts[q] = (counts[q] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([q]) => q);
}

const NOW = 1_700_000_000_000;
const HISTORY: SearchHistoryEntry[] = [
  { query: "coworking",     searchedAt: NOW - 3000, resultsCount: 10 },
  { query: "café downtown", searchedAt: NOW - 2000, resultsCount: 5  },
  { query: "coworking",     searchedAt: NOW - 1000, resultsCount: 8  },
];

describe("User search history", () => {
  it("addToHistory: adds to front", () => {
    const newEntry: SearchHistoryEntry = { query: "library", searchedAt: NOW, resultsCount: 3 };
    const updated = addToHistory(HISTORY, newEntry);
    expect(updated[0].query).toBe("library");
  });

  it("addToHistory: deduplicates same query", () => {
    const dup: SearchHistoryEntry = { query: "coworking", searchedAt: NOW, resultsCount: 12 };
    const updated = addToHistory(HISTORY, dup);
    const count = updated.filter((e) => e.query.toLowerCase() === "coworking").length;
    expect(count).toBe(1);
  });

  it("addToHistory: respects max entries", () => {
    const entries: SearchHistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      query: `q${i}`, searchedAt: NOW - i * 1000, resultsCount: 1,
    }));
    const newEntry: SearchHistoryEntry = { query: "new", searchedAt: NOW + 1, resultsCount: 1 };
    expect(addToHistory(entries, newEntry, 20)).toHaveLength(20);
  });

  it("recentSearches: most recent first", () => {
    const recent = recentSearches(HISTORY, 2);
    expect(recent[0].searchedAt).toBeGreaterThan(recent[1].searchedAt);
  });

  it("clearHistory: returns empty array", () => {
    expect(clearHistory(HISTORY)).toHaveLength(0);
  });

  it("topSearchTerms: coworking appears most", () => {
    const top = topSearchTerms(HISTORY, 1);
    expect(top[0]).toBe("coworking");
  });
});
