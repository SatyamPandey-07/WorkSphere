"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, Loader2, MapPin, AlertCircle } from "lucide-react";
import { useVenueSearch, VenueSearchResult } from "@/hooks/useVenueSearch";

export interface SearchBarProps {
  placeholder?: string;
  onSelect?: (venue: VenueSearchResult) => void;
  onSearch?: (query: string) => void;
  className?: string;
  debounceMs?: number;
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
  debounceMs = 250,
  initialQuery = "",
  autoFocus = false,
  syncWithUrl = true,
}: SearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [shortcutKey, setShortcutKey] = useState("Ctrl+K");
  const [validationError, setValidationError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  // Navigation hooks with fallback for unit test environments
  let router: any = null;
  let searchParams: any = null;
  let pathname: any = null;
  try {
    router = useRouter();
    searchParams = useSearchParams();
    pathname = usePathname();
  } catch {
    // Graceful fallback
  }

  const {
    query,
    setQuery,
    venues,
    suggestedQuery,
    isLoading,
    clear,
    search,
  } = useVenueSearch({ initialQuery, debounceMs });

  // Detect OS for shortcut display badge (⌘K on macOS, Ctrl+K elsewhere)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isMac = /Mac|iPod|iPhone|iPad/.test(
        navigator.platform || navigator.userAgent,
      );
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
    setQuery(suggestedQuery);
    onSearch?.(suggestedQuery);
    updateUrlQuery(suggestedQuery);
    setIsOpen(true);
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
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClear();
      inputRef.current?.blur();
    }
  };

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
            if (query.trim().length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          role="combobox"
          aria-autocomplete="list"
          aria-label={placeholder}
          aria-expanded={isOpen && venues.length > 0}
          aria-controls="search-bar-results-list"
          className={`w-full pl-10 pr-16 py-2.5 bg-zinc-100 dark:bg-zinc-800/80 border rounded-xl text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none transition-all shadow-sm ${
            validationError
              ? "border-red-400 dark:border-red-500 focus:ring-2 focus:ring-red-400"
              : "border-zinc-200 dark:border-zinc-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          }`}
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-auto">
          {isLoading && (
            <Loader2
              data-testid="search-bar-loader"
              className="w-4 h-4 text-blue-500 animate-spin"
            />
          )}
          {query.length === 0 && (
            <kbd
              data-testid="search-bar-shortcut-badge"
              onClick={() => inputRef.current?.focus()}
              className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 bg-zinc-200/60 dark:bg-zinc-700/60 border border-zinc-300/60 dark:border-zinc-600/60 rounded cursor-pointer hover:bg-zinc-300/60 dark:hover:bg-zinc-600/60 transition-colors select-none shrink-0"
            >
              {shortcutKey}
            </kbd>
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
              {venue.category && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  {venue.category}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
