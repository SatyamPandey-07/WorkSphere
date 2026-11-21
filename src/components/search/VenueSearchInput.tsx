import React, { forwardRef, useEffect, useState } from 'react';

export interface VenueSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  shortcutLabel?: string;
  showShortcutBadge?: boolean;
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
      value,
      ...rest
    },
    ref
  ) {
    const [isFocused, setIsFocused] = useState(false);
    const resolvedLabel = shortcutLabel ?? (isMacPlatform() ? '⌘K' : 'Ctrl+K');
    const hasValue = typeof value === 'string' ? value.length > 0 : Boolean(rest.defaultValue);
    const shouldDisplayBadge = showShortcutBadge && !isFocused && !hasValue;

    return (
      <div className="relative flex items-center w-full">
        <input
          ref={ref}
          type="search"
          value={value}
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
    );
  }
);