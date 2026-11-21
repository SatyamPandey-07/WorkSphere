"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, Loader2, MapPin, AlertCircle, Clock } from "lucide-react";
import { useVenueSearch, VenueSearchResult } from "@/hooks/useVenueSearch";
import { ShortcutTooltip } from "./ui/ShortcutTooltip";
import {
  clearVenueSearchHistory,
  loadVenueSearchHistory,
  removeVenueSearchQuery,
  saveVenueSearchQuery,
  VENUE_SEARCH_HISTORY_EVENT,
} from "@/lib/venueSearchHistory";

export interface SearchBarProps {
  placeholder?: string;
  onSelect?: (venue: VenueSearchResult) => void;
  onSearch?: (query: string) => void;
  className?: string;
  /** Wait this long after the last keystroke before searching (default: 300ms). Enter searches at once. */
  debounceMs?: number;
  /** Shortest trimmed query that is sent to the server (default: 2). An empty query resets the search. */
  minQueryLength?: number;
  initialQuery?: string;
  autoFocus?: boolean;
  showAmenityPills?: boolean;
  syncWithUrl?: boolean;
}

/**
 * Trims leading and trailing whitespace from venue search queries.
 */
export function trimSearchQuery(query: string): string {
  return typeof query === "string" ? query.trim() : "";
}

/**
 * Validates if query is non-empty and not purely whitespace.
 */
export function isValidSearchQuery(query: string): boolean {
  return typeof query === "string" && query.trim().length > 0;
}

/**
 * SearchBar component with automated whitespace sanitation, debouncing,
 * and pure-whitespace form validation feedback.
 */
export function SearchBar({
  placeholder = "Search venues by name, address, or tag...",
  onSelect,
  onSearch,
  className = "",
  debounceMs = 300,
  minQueryLength = 2,
  initialQuery = "",
  autoFocus = false,
  syncWithUrl = true,
}: SearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [shortcutKey, setShortcutKey] = useState("Ctrl+K");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  // Hooks must run unconditionally on every render (rules of hooks). Unit
  // tests get these from the next/navigation mock in jest.setup.js.
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const {
    query,
    setQuery,
    venues,
    suggestedQuery,
    isLoading,
    isDebouncing,
    clear,
    search,
  } = useVenueSearch({ initialQuery, debounceMs, minQueryLength });

  useEffect(() => {
    setRecentSearches(loadVenueSearchHistory());

    const syncHistory = () => setRecentSearches(loadVenueSearchHistory());
    window.addEventListener(VENUE_SEARCH_HISTORY_EVENT, syncHistory);
    window.addEventListener("storage", syncHistory);
    return () => {
      window.removeEventListener(VENUE_SEARCH_HISTORY_EVENT, syncHistory);
      window.removeEventListener("storage", syncHistory);
    };
  }, []);

  // Detect OS for shortcut display badge (⌘K on macOS, Ctrl+K elsewhere)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isMac = /Mac|iPod|iPhone|iPad/i.test(navigator.userAgent);
      setShortcutKey(isMac ? "⌘K" : "Ctrl+K");
    }
  }, []);

  // Listen for global Ctrl+K / Cmd+K to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const updateUrlQuery = useCallback(
    (trimmedQuery: string) => {
      if (!syncWithUrl || !router || !pathname) return;
      try {
        const params = new URLSearchParams(
          searchParams ? searchParams.toString() : "",
        );
        if (trimmedQuery) {
          params.set("q", trimmedQuery);
          params.delete("query");
        } else {
          params.delete("q");
          params.delete("query");
        }
        const qs = params.toString();
        const target = `${pathname}${qs ? `?${qs}` : ""}`;
        const navigate = (router.replace || router.push)?.bind(router);
        if (navigate) {
          navigate(target, { scroll: false });
        }
      } catch {
        // Safe navigation guard
      }
    },
    [syncWithUrl, router, pathname, searchParams],
  );

  const handleSearchSubmit = useCallback(
    (rawQuery?: string) => {
      const target = typeof rawQuery === "string" ? rawQuery : query;
      const trimmed = trimSearchQuery(target);

      if (target.length > 0 && trimmed.length === 0) {
        setValidationError("Search query cannot be only whitespace.");
        clear();
        onSearch?.("");
        updateUrlQuery("");
        setIsOpen(false);
        return;
      }

      setValidationError(null);

      if (!trimmed) {
        clear();
        onSearch?.("");
        updateUrlQuery("");
        setIsOpen(false);
        return;
      }

      const updatedHistory = saveVenueSearchQuery(trimmed);
      setRecentSearches(updatedHistory);
      onSearch?.(trimmed);
      updateUrlQuery(trimmed);
      void search(trimmed);
    },
    [query, clear, onSearch, updateUrlQuery, search],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    cursorRef.current = {
      start: e.target.selectionStart,
      end: e.target.selectionEnd,
    };

    // If input consists purely of spaces (length > 0 but trimmed is empty)
    if (rawVal.length > 0 && rawVal.trim().length === 0) {
      setValidationError("Search query cannot be only whitespace.");
    } else {
      setValidationError(null);
    }

    setQuery(rawVal);
    setIsOpen(true);

    // Auto-trigger trimmed search if onSearch provided
    const trimmed = trimSearchQuery(rawVal);
    if (trimmed) {
      onSearch?.(trimmed);
    }
  };

  const handleSelectVenue = (venue: VenueSearchResult) => {
    cursorRef.current = { start: null, end: null };
    const trimmedName = trimSearchQuery(venue.name);
    setQuery(trimmedName);
    setValidationError(null);
    setIsOpen(false);
    onSelect?.(venue);
    onSearch?.(trimmedName);
    updateUrlQuery(trimmedName);
  };

  const handleSelectSuggestion = () => {
    if (!suggestedQuery) return;
    const updatedHistory = saveVenueSearchQuery(suggestedQuery);
    setRecentSearches(updatedHistory);
    setQuery(suggestedQuery);
    onSearch?.(suggestedQuery);
    updateUrlQuery(suggestedQuery);
    setIsOpen(true);
  };

  const handleSelectRecentSearch = (term: string) => {
    const updatedHistory = saveVenueSearchQuery(term);
    setRecentSearches(updatedHistory);
    setActiveHistoryIndex(-1);
    setQuery(term);
    setValidationError(null);
    onSearch?.(term);
    updateUrlQuery(term);
    setIsOpen(false);
    void search(term);
  };

  const handleRemoveRecentSearch = (
    term: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const updatedHistory = removeVenueSearchQuery(term);
    setRecentSearches(updatedHistory);
    setActiveHistoryIndex(-1);
  };

  const handleClearRecentSearches = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    clearVenueSearchHistory();
    setRecentSearches([]);
    setActiveHistoryIndex(-1);
  };

  const handleClear = (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    cursorRef.current = { start: null, end: null };
    setValidationError(null);
    clear();
    onSearch?.("");
    updateUrlQuery("");
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const showHistory =
      isOpen && query.trim().length === 0 && recentSearches.length > 0;

    if (showHistory && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const direction = e.key === "ArrowDown" ? 1 : -1;
      setActiveHistoryIndex((current) => {
        if (direction === 1) {
          return current === -1 ? 0 : (current + 1) % recentSearches.length;
        }
        return current === -1
          ? recentSearches.length - 1
          : (current - 1 + recentSearches.length) % recentSearches.length;
      });
    } else if (showHistory && e.key === "Enter" && activeHistoryIndex >= 0) {
      e.preventDefault();
      handleSelectRecentSearch(recentSearches[activeHistoryIndex]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSearchSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (isOpen && query.trim().length === 0) {
        setActiveHistoryIndex(-1);
        setIsOpen(false);
      } else {
        handleClear();
      }
      inputRef.current?.blur();
    }
  };

  const showHistoryPanel = isOpen && query.trim().length === 0;

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${className}`}
      data-testid="search-bar"
    >
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          data-testid="search-bar-input"
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            setActiveHistoryIndex(-1);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          role="combobox"
          aria-autocomplete="list"
          aria-label={placeholder}
          aria-expanded={showHistoryPanel || (isOpen && venues.length > 0)}
          aria-controls={
            showHistoryPanel
              ? "search-bar-history-list"
              : "search-bar-results-list"
          }
          className={`w-full pl-10 pr-16 py-2.5 bg-zinc-100 dark:bg-zinc-800/80 border rounded-xl text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none transition-all shadow-sm ${
            validationError
              ? "border-red-400 dark:border-red-500 focus:ring-2 focus:ring-red-400"
              : "border-zinc-200 dark:border-zinc-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          }`}
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-auto">
          {isDebouncing && !isLoading && (
            <span
              data-testid="search-bar-typing-indicator"
              aria-hidden="true"
              className="flex items-center gap-0.5"
            >
              <span className="h-1 w-1 rounded-full bg-zinc-400 animate-pulse" />
              <span className="h-1 w-1 rounded-full bg-zinc-400 animate-pulse [animation-delay:150ms]" />
              <span className="h-1 w-1 rounded-full bg-zinc-400 animate-pulse [animation-delay:300ms]" />
            </span>
          )}
          {isLoading && (
            <Loader2
              data-testid="search-bar-loader"
              className="w-4 h-4 text-blue-500 animate-spin"
            />
          )}
          {query.length === 0 && (
            <ShortcutTooltip
              content="Press Ctrl+K / ⌘K to search anywhere"
              shortcut="K"
              position="bottom"
            >
              <kbd
                data-testid="search-bar-shortcut-badge"
                title="Press Ctrl+K / ⌘K to search anywhere"
                onClick={() => inputRef.current?.focus()}
                className="hidden md:inline-flex items-center border border-zinc-700 bg-zinc-800/80 text-zinc-400 text-[10px] font-mono px-1.5 py-0.5 rounded cursor-pointer hover:bg-zinc-700/80 transition-colors select-none shrink-0"
              >
                {shortcutKey}
              </kbd>
            </ShortcutTooltip>
          )}
          {query.length > 0 && (
            <button
              type="button"
              data-testid="search-bar-clear-btn"
              onClick={handleClear}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              aria-label="Clear search query"
              className="p-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Pure whitespace validation feedback message */}
      {validationError && (
        <div
          data-testid="search-validation-error"
          className="mt-1 flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 font-medium px-1"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {showHistoryPanel && (
        <div
          id="search-bar-history-list"
          data-testid="search-bar-history"
          role="region"
          aria-label="Recent venue searches"
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Recent searches
            </span>
            {recentSearches.length > 0 && (
              <button
                type="button"
                data-testid="search-history-clear"
                onMouseDown={handleClearRecentSearches}
                onClick={handleClearRecentSearches}
                className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-600"
              >
                Clear all
              </button>
            )}
          </div>
          {recentSearches.length === 0 ? (
            <p
              data-testid="search-history-empty"
              className="px-1 py-2 text-sm text-zinc-500 dark:text-zinc-400"
            >
              No recent searches
            </p>
          ) : (
            <ul className="space-y-1" aria-label="Recent search terms">
              {recentSearches.map((term, index) => (
                <li
                  key={term}
                  className={`flex items-center rounded-lg transition-colors ${
                    activeHistoryIndex === index
                      ? "bg-blue-50 dark:bg-blue-950/40"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  <button
                    type="button"
                    data-testid={`search-history-term-${index}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelectRecentSearch(term)}
                    className="flex min-w-0 flex-1 items-center gap-2 truncate px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                    {term}
                  </button>
                  <button
                    type="button"
                    data-testid={`search-history-remove-${index}`}
                    aria-label={`Remove ${term} from recent searches`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => handleRemoveRecentSearch(term, event)}
                    className="mr-1 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isOpen && venues.length === 0 && suggestedQuery && (
        <div
          role="status"
          data-testid="search-bar-suggestion"
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300 shadow-xl"
        >
          Did you mean:{" "}
          <button
            type="button"
            onClick={handleSelectSuggestion}
            className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2"
          >
            {suggestedQuery}
          </button>
          ?
        </div>
      )}

      {isOpen && venues.length > 0 && (
        <ul
          id="search-bar-results-list"
          data-testid="search-bar-results"
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl py-1 divide-y divide-zinc-100 dark:divide-zinc-800/60"
        >
          {venues.map((venue) => (
            <li
              key={venue.id}
              role="option"
              aria-selected={false}
              tabIndex={0}
              onClick={() => handleSelectVenue(venue)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectVenue(venue);
                }
              }}
              className="px-4 py-2.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {venue.name}
                </div>
                {venue.address && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-zinc-400" />
                    <span className="truncate">{venue.address}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {venue.fuzzyMatched === true && (
                  <span
                    data-testid="search-bar-fuzzy-badge"
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                  >
                    Fuzzy match suggestion
                  </span>
                )}
                {venue.category && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    {venue.category}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
