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

      if (!isShortcut) return;

      const target = event.target as HTMLElement | null;
      const inputEl = inputRef.current;
      const isEditable =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target !== inputEl) ||
        Boolean(target?.isContentEditable);

      if (isEditable) return;

      event.preventDefault();
      inputEl?.focus();
      inputEl?.select();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, inputRef]);

  return shortcutLabel;
}

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
        </div>
      )}
    </div>
  );
});
