export const VENUE_SEARCH_HISTORY_KEY = "ws-recent-searches";
export const VENUE_SEARCH_HISTORY_LIMIT = 5;
export const VENUE_SEARCH_HISTORY_EVENT = "worksphere:venue-search-history";

export function normalizeVenueSearchQuery(query: string): string {
  return typeof query === "string" ? query.trim() : "";
}

export function loadVenueSearchHistory(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(VENUE_SEARCH_HISTORY_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return trimVenueSearchHistory(parsed);
  } catch {
    return [];
  }
}

export function saveVenueSearchQuery(query: string): string[] {
  const normalized = normalizeVenueSearchQuery(query);
  if (!normalized) return loadVenueSearchHistory();

  const history = loadVenueSearchHistory();
  const updated = [
    normalized,
    ...history.filter(
      (item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase(),
    ),
  ].slice(0, VENUE_SEARCH_HISTORY_LIMIT);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        VENUE_SEARCH_HISTORY_KEY,
        JSON.stringify(updated),
      );
    } catch {
      // Search remains usable when storage is unavailable.
    }
    notifyVenueSearchHistoryChanged();
  }

  return updated;
}

export function removeVenueSearchQuery(query: string): string[] {
  const normalized = normalizeVenueSearchQuery(query);
  const updated = loadVenueSearchHistory().filter(
    (item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase(),
  );

  if (typeof window !== "undefined") {
    try {
      if (updated.length === 0) {
        window.localStorage.removeItem(VENUE_SEARCH_HISTORY_KEY);
      } else {
        window.localStorage.setItem(
          VENUE_SEARCH_HISTORY_KEY,
          JSON.stringify(updated),
        );
      }
    } catch {
      // Keep the in-memory UI result even if persistence is unavailable.
    }
    notifyVenueSearchHistoryChanged();
  }

  return updated;
}

export function clearVenueSearchHistory(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(VENUE_SEARCH_HISTORY_KEY);
    } catch {
      // Clearing in one mounted component still clears its local UI state.
    }
    notifyVenueSearchHistoryChanged();
  }
}

export function notifyVenueSearchHistoryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VENUE_SEARCH_HISTORY_EVENT));
}

export function trimVenueSearchHistory(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;

    const normalized = normalizeVenueSearchQuery(value);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
    if (result.length === VENUE_SEARCH_HISTORY_LIMIT) break;
  }

  return result;
}
