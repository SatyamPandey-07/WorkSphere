"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { buildVenueSearchParams } from "@/lib/venues/searchQuery";
import { usePlatformModifier } from "@/hooks/usePlatformModifier";

export const VENUE_SEARCH_HISTORY_STORAGE_KEY =
  "worksphere:venue_search_history:v1";
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
  enableShortcut?: boolean;
  shortcutLabel?: string;
  "aria-label"?: string;
}

export function normalizeSearchQuery(rawQuery: string): string {
  return rawQuery.trim().replace(/\s+/g, " ");
}

export function deduplicateSearchHistory(
  existingHistory: string[],
  nextQuery: string,
  maxItems = MAX_VENUE_SEARCH_HISTORY,
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
    if (typeof rawItem !== "string") continue;
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
  storageKey = VENUE_SEARCH_HISTORY_STORAGE_KEY,
): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return deduplicateSearchHistory(parsed, "");
  } catch {
    return [];
  }
}

export function saveVenueSearchHistory(
  items: string[],
  storageKey = VENUE_SEARCH_HISTORY_STORAGE_KEY,
): void {
  if (typeof window === "undefined") return;
  try {
    const sanitized = deduplicateSearchHistory(items, "");
    window.localStorage.setItem(storageKey, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function useGlobalSearchShortcut(
  _inputRef: React.RefObject<HTMLInputElement | null>,
  _enableShortcut = true,
): string {
  const { isMac } = usePlatformModifier();
  return isMac ? "⌘K" : "Ctrl+K";
}

export const VenueSearchInput = forwardRef<
  HTMLInputElement,
  VenueSearchInputProps
>(
  (
    {
      value: controlledValue,
      onChange,
      onSelectQuery,
      onQueryParamsChange,
      activeAmenities,
      existingSearchParams = "",
      storageKey = VENUE_SEARCH_HISTORY_STORAGE_KEY,
      placeholder = "Search cafes, coworking spaces, neighborhoods...",
      className = "",
      enableShortcut = true,
      shortcutLabel,
      "aria-label": ariaLabel = "Search venues",
    },
    forwardedRef,
  ) => {
    const [internalQuery, setInternalQuery] = useState(controlledValue ?? "");
    const [history, setHistory] = useState<string[]>(() =>
      loadVenueSearchHistory(storageKey),
    );
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [statusAnnouncement, setStatusAnnouncement] = useState("");
    const containerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const { isMac } = usePlatformModifier();

    useImperativeHandle(
      forwardedRef,
      () => inputRef.current as HTMLInputElement,
    );

    const query =
      controlledValue !== undefined ? controlledValue : internalQuery;

    const displayedShortcut = shortcutLabel ?? (isMac ? "⌘K" : "Ctrl+K");

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
      document.addEventListener("mousedown", handleOutsideClick);
      return () =>
        document.removeEventListener("mousedown", handleOutsideClick);
    }, []);

    useEffect(() => {
      if (!enableShortcut) return;

      const handleGlobalKeyDown = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() !== "k") return;

        const shortcutMatches = isMac
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey;
        if (
          !shortcutMatches ||
          event.altKey ||
          event.shiftKey ||
          (event.metaKey && event.ctrlKey)
        )
          return;

        const target = event.target;
        if (target instanceof HTMLElement) {
          const tagName = target.tagName.toLowerCase();
          if (
            target !== inputRef.current &&
            (tagName === "input" ||
              tagName === "textarea" ||
              tagName === "select" ||
              target.isContentEditable ||
              target.closest('[contenteditable="true"]'))
          ) {
            return;
          }
        }

        event.preventDefault();
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
        setIsDropdownOpen(true);
      };

      window.addEventListener("keydown", handleGlobalKeyDown);
      return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    }, [enableShortcut, isMac]);

    const emitSearchParams = (term: string) => {
      if (!onQueryParamsChange) return;
      const params = buildVenueSearchParams(
        {
          q: term,
          amenities: activeAmenities,
        },
        existingSearchParams,
      );
      onQueryParamsChange(params.toString());
    };

    const recordSearchQuery = (term: string): string => {
      const cleanQuery = normalizeSearchQuery(term);
      if (!cleanQuery) return "";
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
      setStatusAnnouncement("Search history cleared.");
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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const cleanQuery = normalizeSearchQuery(query);
        if (!cleanQuery) return;
        recordSearchQuery(cleanQuery);
        onSelectQuery?.(cleanQuery);
        emitSearchParams(cleanQuery);
        setIsDropdownOpen(false);
      } else if (e.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };

    return (
      <div ref={containerRef} className={`relative w-full ${className}`.trim()}>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-keyshortcuts={
            enableShortcut ? (isMac ? "Meta+K" : "Control+K") : undefined
          }
          data-testid="venue-search-input"
          onFocus={() => setIsDropdownOpen(true)}
          onChange={(e) => {
            handleInputChange(e.target.value);
            setIsDropdownOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none md:pr-20"
        />

        {enableShortcut && (
          <kbd
            data-testid="search-shortcut-badge"
            aria-label={`Shortcut: ${isMac ? "Command" : "Control"} plus K`}
            className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 shadow-sm md:inline-flex"
          >
            {displayedShortcut}
          </kbd>
        )}

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
  },
);

VenueSearchInput.displayName = "VenueSearchInput";
