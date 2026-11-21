import React, { forwardRef, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_VENUE_CATEGORIES,
  getFuzzyCategorySuggestion,
} from '@/lib/search/fuzzySuggestions';

export interface VenueSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  shortcutLabel?: string;
  showShortcutBadge?: boolean;
  hasZeroResults?: boolean;
  categoryCandidates?: readonly string[];
  onSelectSuggestion?: (suggestion: string) => void;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  const userAgent = navigator.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac os x|macintosh/i.test(userAgent);
}

export function useGlobalSearchShortcut(
  inputRef: React.RefObject<HTMLInputElement | null>,
  enabled = true
): string {
  const [shortcutLabel, setShortcutLabel] = useState<string>('Ctrl+K');

  useEffect(() => {
    setShortcutLabel(isMacPlatform() ? '⌘K' : 'Ctrl+K');
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        event.key.toLowerCase() === 'k' &&
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, inputRef]);

  return shortcutLabel;
}

export const VenueSearchInput = forwardRef<HTMLInputElement, VenueSearchInputProps>(
  function VenueSearchInput(
    {
      className = '',
      shortcutLabel,
      showShortcutBadge = true,
      hasZeroResults = false,
      categoryCandidates = DEFAULT_VENUE_CATEGORIES,
      onSelectSuggestion,
      value,
      onChange,
      ...rest
    },
    ref
  ) {
    const [isFocused, setIsFocused] = useState(false);
    const resolvedLabel = shortcutLabel ?? (isMacPlatform() ? '⌘K' : 'Ctrl+K');
    const queryValue = typeof value === 'string' ? value : '';
    const hasValue = queryValue.length > 0 || Boolean(rest.defaultValue);
    const shouldDisplayBadge = showShortcutBadge && !isFocused && !hasValue;

    const suggestion = useMemo(() => {
      if (!hasZeroResults || !queryValue.trim()) return null;
      return getFuzzyCategorySuggestion(queryValue, categoryCandidates);
    }, [hasZeroResults, queryValue, categoryCandidates]);

    const handleSuggestionClick = () => {
      if (!suggestion) return;
      if (onChange) {
        const syntheticEvent = {
          target: { value: suggestion },
          currentTarget: { value: suggestion },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
      onSelectSuggestion?.(suggestion);
    };

    return (
      <div className="flex flex-col gap-1.5 w-full">
        <div className="relative flex items-center w-full">
          <input
            ref={ref}
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

        {suggestion && (
          <div className="text-xs text-slate-600" data-testid="fuzzy-suggestion-bar">
            Did you mean:{' '}
            <button
              type="button"
              onClick={handleSuggestionClick}
              className="font-semibold text-indigo-600 underline hover:text-indigo-800"
            >
              {suggestion}?
            </button>
          </div>
        )}
      </div>
    );
  }
);