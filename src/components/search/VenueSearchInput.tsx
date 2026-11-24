
import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_VENUE_AMENITIES,
  getAmenitySuggestions,
} from "../../lib/search/venueSearchSanitizer";

export interface VenueSearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  shortcutLabel?: string;
  showShortcutBadge?: boolean;
  hasZeroResults?: boolean;
  resultCount?: number;
  amenitiesList?: readonly string[];
  onSelectSuggestion?: (suggestion: string) => void;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  return (
    /mac|iphone|ipad|ipod/i.test(platform) ||
    /mac os x|macintosh/i.test(userAgent)
  );
}

export function useGlobalSearchShortcut(
  inputRef: React.RefObject<HTMLInputElement | null>,
  enabled = true,
): string {
  const [shortcutLabel, setShortcutLabel] = useState<string>("Ctrl+K");

  useEffect(() => {
    setShortcutLabel(isMacPlatform() ? "⌘K" : "Ctrl+K");
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { buildVenueSearchParams } from '@/lib/venues/searchQuery';

export const VENUE_SEARCH_HISTORY_STORAGE_KEY = 'worksphere:venue_search_history:v1';
export const MAX_VENUE_SEARCH_HISTORY = 8;

export interface VenueSearchInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onSelectQuery?: (query: string) => void;
  onQueryParamsChange?: (queryString: string) => void;
  activeAmenities?: string[];
  existingSearchParams?: string;
  storageKey?: string;
  placeholder?: string;
  className?: string;
}

export function normalizeSearchQuery(rawQuery: string): string {
  return rawQuery.trim().replace(/\s+/g, ' ');
}

export function deduplicateSearchHistory(
  existingHistory: string[],
  nextQuery: string,
  maxItems = MAX_VENUE_SEARCH_HISTORY
): string[] {
  const cleanQuery = normalizeSearchQuery(nextQuery);
  if (!cleanQuery) {
    return existingHistory
      .map((item) => normalizeSearchQuery(item))
      .filter((item) => item.length > 0)
      .slice(0, maxItems);
  }

  const normalizedKey = cleanQuery.toLowerCase();
  const dedupedExisting: string[] = [];
  const seenKeys = new Set<string>([normalizedKey]);

  for (const rawItem of existingHistory) {
    if (typeof rawItem !== 'string') continue;
    const cleanedItem = normalizeSearchQuery(rawItem);
    if (!cleanedItem) continue;
    const itemKey = cleanedItem.toLowerCase();
    if (!seenKeys.has(itemKey)) {
      seenKeys.add(itemKey);
      dedupedExisting.push(cleanedItem);
    }
  }

  return [cleanQuery, ...dedupedExisting].slice(0, maxItems);
}

export function loadVenueSearchHistory(
  storageKey = VENUE_SEARCH_HISTORY_STORAGE_KEY
): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return deduplicateSearchHistory(parsed, '');
  } catch {
    return [];
  }
}

export function saveVenueSearchHistory(
  items: string[],
  storageKey = VENUE_SEARCH_HISTORY_STORAGE_KEY
): void {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = deduplicateSearchHistory(items, '');
    window.localStorage.setItem(storageKey, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export const VenueSearchInput: React.FC<VenueSearchInputProps> = ({
  value: controlledValue,
  onChange,
  onSelectQuery,
  onQueryParamsChange,
  activeAmenities,
  existingSearchParams = '',
  storageKey = VENUE_SEARCH_HISTORY_STORAGE_KEY,
  placeholder = 'Search cafes, coworking spaces, neighborhoods...',
  className = '',
}) => {
  const [internalQuery, setInternalQuery] = useState(controlledValue ?? '');
  const [history, setHistory] = useState<string[]>(() => loadVenueSearchHistory(storageKey));
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const query = controlledValue !== undefined ? controlledValue : internalQuery;

  useEffect(() => {
    setHistory(loadVenueSearchHistory(storageKey));
  }, [storageKey]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const emitSearchParams = (term: string) => {
    if (!onQueryParamsChange) return;
    const params = buildVenueSearchParams(
      {
        q: term,
        amenities: activeAmenities,
      },
      existingSearchParams
    );
    onQueryParamsChange(params.toString());
  };


  const recordSearchQuery = (term: string): string => {
    const cleanQuery = normalizeSearchQuery(term);
    if (!cleanQuery) return '';
    const next = deduplicateSearchHistory(history, cleanQuery);
    setHistory(next);
    saveVenueSearchHistory(next, storageKey);
    return cleanQuery;
  };

  const handleClearAllHistory = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setHistory([]);
    saveVenueSearchHistory([], storageKey);
    setIsDropdownOpen(false);
    setStatusAnnouncement('Search history cleared.');
  };

  const handleInputChange = (nextVal: string) => {
    if (controlledValue === undefined) {
      setInternalQuery(nextVal);
    }
    onChange?.(nextVal);
  };

  const handleSelectItem = (term: string) => {
    const cleanQuery = recordSearchQuery(term);
    if (!cleanQuery) return;
    handleInputChange(cleanQuery);
    onSelectQuery?.(cleanQuery);
    emitSearchParams(cleanQuery);
    setIsDropdownOpen(false);
  };


    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, inputRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const cleanQuery = normalizeSearchQuery(query);
      if (!cleanQuery) return;
      recordSearchQuery(cleanQuery);
      onSelectQuery?.(cleanQuery);
      emitSearchParams(cleanQuery);
      setIsDropdownOpen(false);
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };


  return (
    <div ref={containerRef} className={`relative w-full ${className}`.trim()}>
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        aria-label="Search venues"
        data-testid="venue-search-input"
        onFocus={() => setIsDropdownOpen(true)}
        onChange={(e) => {
          handleInputChange(e.target.value);
          setIsDropdownOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
      />


export const VenueSearchInput = forwardRef<
  HTMLInputElement,
  VenueSearchInputProps
>(function VenueSearchInput(
  {
    className = "",
    shortcutLabel,
    showShortcutBadge = true,
    hasZeroResults = false,
    resultCount,
    amenitiesList = DEFAULT_VENUE_AMENITIES,
    onSelectSuggestion,
    value,
    onChange,
    ...rest
  },
  ref,
) {
  const [isFocused, setIsFocused] = useState(false);
  const innerRef = useRef<HTMLInputElement | null>(null);

  const setRefs = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref && typeof ref === "object") {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
  };

  const resolvedLabel = shortcutLabel ?? (isMacPlatform() ? "⌘K" : "Ctrl+K");
  const queryValue = typeof value === "string" ? value : "";
  const hasValue = queryValue.length > 0 || Boolean(rest.defaultValue);
  const shouldDisplayBadge = showShortcutBadge && !isFocused && !hasValue;

  // Detect zero or low results
  const isLowOrZeroResults =
    hasZeroResults || (typeof resultCount === "number" && resultCount <= 1);

  const suggestions: string[] = useMemo(() => {
    if (!isLowOrZeroResults || !queryValue.trim()) return [];
    return getAmenitySuggestions(queryValue, amenitiesList, 2);
  }, [isLowOrZeroResults, queryValue, amenitiesList]);

  const handleSuggestionClick = (suggestion: string) => {
    if (onChange) {
      const syntheticEvent = {
        target: { value: suggestion },
        currentTarget: { value: suggestion },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange(syntheticEvent);
    }
    onSelectSuggestion?.(suggestion);

    // Re-execute search by updating the input element and dispatching events/submit
    const inputEl = innerRef.current;
    if (inputEl) {
      inputEl.value = suggestion;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      const form = inputEl.form;
      if (form) {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
        }
      }
    }
  };

  return (
    <div className="flex flex-col w-full gap-1">
      <div className="relative flex items-center w-full">
        <input
          ref={setRefs}
          type="search"
          value={value}
          onChange={onChange}
          onFocus={(e) => {
            setIsFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            rest.onBlur?.(e);
          }}
          className={`w-full pr-16 ${className}`.trim()}
          {...rest}
        />

        {shouldDisplayBadge && (
          <kbd
            aria-label={`Keyboard shortcut ${resolvedLabel}`}
            data-testid="search-shortcut-badge"
            className="pointer-events-none absolute right-2.5 inline-flex items-center rounded border border-slate-300/80 bg-slate-100/90 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 select-none"
          >
            {resolvedLabel}
          </kbd>
        )}
      </div>

      {suggestions.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 mt-0.5"
          data-testid="amenity-suggestions"
          role="status"
          aria-live="polite"
        >
          <span className="font-medium text-slate-500">Did you mean:</span>
          {suggestions.map((suggestion: string) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900 border border-indigo-200 transition-colors cursor-pointer"
              data-testid={`amenity-suggestion-${suggestion}`}
              aria-label={`Search for ${suggestion}`}
            >
              {suggestion}?
            </button>
          ))}

      <div
        role="status"
        aria-live="polite"
        data-testid="search-history-live-region"
        className="sr-only"
      >
        {statusAnnouncement}
      </div>

      {isDropdownOpen && history.length > 0 && (
        <div
          data-testid="search-history-dropdown"
          className="absolute z-20 mt-1.5 w-full rounded-xl border border-slate-200 bg-white py-2 shadow-lg"
        >
          <div className="flex items-center justify-between px-3 pb-1.5 text-xs font-medium text-slate-500">
            <span>Recent searches</span>
            <button
              type="button"
              data-testid="clear-all-history-btn"
              onClick={handleClearAllHistory}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              Clear all
            </button>
          </div>

          <ul className="divide-y divide-slate-100">
            {history.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => handleSelectItem(item)}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {item}
                </button>
              </li>
            ))}
          </ul>

        </div>
      )}
    </div>
  );

});

};
