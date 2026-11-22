"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RECENT_SEARCHES_STORAGE_KEY,
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from "@/lib/recentSearches";

/**
 * Recent searches backed by localStorage. Starts empty and loads after mount so
 * server and client markup match, then follows changes made in other tabs.
 */
export function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(getRecentSearches());

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === RECENT_SEARCHES_STORAGE_KEY) {
        setRecent(getRecentSearches());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback((query: string) => setRecent(addRecentSearch(query)), []);
  const remove = useCallback((query: string) => setRecent(removeRecentSearch(query)), []);
  const clear = useCallback(() => setRecent(clearRecentSearches()), []);

  return { recent, add, remove, clear };
}
