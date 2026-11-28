/**
 * Recent venue searches kept in localStorage (#7731).
 * Most recent first, case-insensitive de-duplication, LRU eviction at 10 items.
 */
export const RECENT_SEARCHES_STORAGE_KEY = "worksphere:recent-searches";
export const MAX_RECENT_SEARCHES = 10;
/** Longer queries are not worth remembering and would bloat the dropdown. */
export const MAX_RECENT_SEARCH_LENGTH = 120;

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Access can throw in sandboxed iframes or when storage is blocked.
    return null;
  }
}

/** Trims and collapses inner whitespace. Returns "" for unusable queries. */
export function normalizeRecentSearch(query: unknown): string {
  if (typeof query !== "string") return "";
  const normalized = query.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_RECENT_SEARCH_LENGTH ? "" : normalized;
}

function sameQuery(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

function persist(list: string[]): string[] {
  const storage = getStorage();
  if (!storage) return list;
  try {
    if (list.length === 0) storage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
    else storage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota or privacy mode: keep working with the in-memory result.
  }
  return list;
}

/** Reads the stored list. Corrupt or foreign data is ignored, never thrown. */
export function getRecentSearches(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const result: string[] = [];
    for (const item of parsed) {
      const normalized = normalizeRecentSearch(item);
      if (normalized && !result.some((existing) => sameQuery(existing, normalized))) {
        result.push(normalized);
      }
      if (result.length >= MAX_RECENT_SEARCHES) break;
    }
    return result;
  } catch {
    return [];
  }
}

/** Puts a query at the front, drops older duplicates, evicts beyond the limit. */
export function addRecentSearch(query: string): string[] {
  const normalized = normalizeRecentSearch(query);
  if (!normalized) return getRecentSearches();
  const rest = getRecentSearches().filter((item) => !sameQuery(item, normalized));
  return persist([normalized, ...rest].slice(0, MAX_RECENT_SEARCHES));
}

export function removeRecentSearch(query: string): string[] {
  const normalized = normalizeRecentSearch(query);
  return persist(getRecentSearches().filter((item) => !sameQuery(item, normalized)));
}

export function clearRecentSearches(): string[] {
  return persist([]);
}
