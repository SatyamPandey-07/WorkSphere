"use client";

import React, { useState, useRef, useEffect } from "react";
import { Search, X, Loader2, MapPin } from "lucide-react";
import { useVenueSearch, VenueSearchResult } from "@/hooks/useVenueSearch";

export interface SearchBarProps {
  placeholder?: string;
  onSelect?: (venue: VenueSearchResult) => void;
  className?: string;
  debounceMs?: number;
  initialQuery?: string;
  autoFocus?: boolean;
}

/**
 * Reusable SearchBar component with 300ms input debounce and AbortController (#3513)
 * Cancels stale in-flight requests and avoids race conditions on fast typing.
 */
export function SearchBar({
  placeholder = "Search venues by name, address, or tag...",
  onSelect,
  className = "",
  debounceMs = 300,
  initialQuery = "",
  autoFocus = false,
}: SearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    query,
    setQuery,
    venues,
    isLoading,
    clear,
  } = useVenueSearch({
    initialQuery,
    debounceMs,
  });

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

  const handleSelectVenue = (venue: VenueSearchResult) => {
    setQuery(venue.name);
    setIsOpen(false);
    onSelect?.(venue);
  };

  const handleClear = () => {
    clear();
    setIsOpen(false);
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
          type="text"
          data-testid="search-bar-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (query.trim().length > 0) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label={placeholder}
          aria-expanded={isOpen && venues.length > 0}
          className="w-full pl-10 pr-10 py-2.5 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {isLoading && (
            <Loader2
              data-testid="search-bar-loader"
              className="w-4 h-4 text-blue-500 animate-spin"
            />
          )}
          {query.length > 0 && (
            <button
              type="button"
              data-testid="search-bar-clear-btn"
              onClick={handleClear}
              aria-label="Clear search query"
              className="p-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {isOpen && venues.length > 0 && (
        <ul
          data-testid="search-bar-results"
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl py-1 divide-y divide-zinc-100 dark:divide-zinc-800/60"
        >
          {venues.map((venue) => (
            <li
              key={venue.id}
              role="option"
              aria-selected={false}
              onClick={() => handleSelectVenue(venue)}
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
