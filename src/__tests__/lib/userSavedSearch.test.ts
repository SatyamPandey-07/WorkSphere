/**
 * Tests for user saved search management.
 */

interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
  notifyOnNew: boolean;
  createdAt: number;
  lastRunAt: number | null;
  resultCount: number;
}

function isSearchStale(
  search: SavedSearch,
  nowMs: number,
  staleMs = 7 * 86_400_000
): boolean {
  if (search.lastRunAt === null) return false;
  return nowMs - search.lastRunAt > staleMs;
}

function updateSearchResult(
  search: SavedSearch,
  resultCount: number,
  nowMs: number
): SavedSearch {
  return { ...search, resultCount, lastRunAt: nowMs };
}

function activeNotifications(searches: SavedSearch[]): SavedSearch[] {
  return searches.filter((s) => s.notifyOnNew && s.resultCount > 0);
}

function sortByRecentlyRun(searches: SavedSearch[]): SavedSearch[] {
  return [...searches].sort((a, b) => {
    const aTime = a.lastRunAt ?? 0;
    const bTime = b.lastRunAt ?? 0;
    return bTime - aTime;
  });
}

function renameSearch(search: SavedSearch, newName: string): SavedSearch {
  if (!newName.trim()) throw new Error("Name cannot be empty");
  return { ...search, name: newName.trim() };
}

const NOW = 1_700_000_000_000;
const SEARCHES: SavedSearch[] = [
  { id: "ss1", userId: "u1", name: "Quiet cafes",  query: "café quiet", filters: { minRating: 4 }, notifyOnNew: true,  createdAt: NOW - 7200_000, lastRunAt: NOW - 1000, resultCount: 5 },
  { id: "ss2", userId: "u1", name: "Downtown",     query: "downtown",   filters: {},              notifyOnNew: false, createdAt: NOW - 3600_000, lastRunAt: null,       resultCount: 0 },
  { id: "ss3", userId: "u1", name: "Old search",   query: "office",     filters: {},              notifyOnNew: true,  createdAt: NOW - 30*86_400_000, lastRunAt: NOW - 10*86_400_000, resultCount: 2 },
];

describe("User saved searches", () => {
  it("isSearchStale: run 10 days ago → stale", () => {
    expect(isSearchStale(SEARCHES[2], NOW)).toBe(true);
  });

  it("isSearchStale: run recently → not stale", () => {
    expect(isSearchStale(SEARCHES[0], NOW)).toBe(false);
  });

  it("isSearchStale: never run → false", () => {
    expect(isSearchStale(SEARCHES[1], NOW)).toBe(false);
  });

  it("updateSearchResult: updates count and lastRunAt", () => {
    const updated = updateSearchResult(SEARCHES[1], 10, NOW);
    expect(updated.resultCount).toBe(10);
    expect(updated.lastRunAt).toBe(NOW);
  });

  it("activeNotifications: notifyOnNew + resultCount > 0", () => {
    const active = activeNotifications(SEARCHES);
    expect(active.every((s) => s.notifyOnNew && s.resultCount > 0)).toBe(true);
  });

  it("sortByRecentlyRun: most recent first", () => {
    const sorted = sortByRecentlyRun(SEARCHES);
    expect(sorted[0].id).toBe("ss1");
  });

  it("sortByRecentlyRun: never run goes last", () => {
    const sorted = sortByRecentlyRun(SEARCHES);
    expect(sorted[sorted.length - 1].id).toBe("ss2");
  });

  it("renameSearch: updates name", () => {
    expect(renameSearch(SEARCHES[0], "New name").name).toBe("New name");
  });

  it("renameSearch: empty name throws", () => {
    expect(() => renameSearch(SEARCHES[0], "  ")).toThrow("Name cannot be empty");
  });
});
