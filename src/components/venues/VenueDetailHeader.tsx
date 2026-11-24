'use client';

import React, { useCallback, useState } from 'react';
import { Toast } from '@/components/ui/Toast';

export const VENUE_LINK_COPIED_TOAST = 'Venue link copied to clipboard!';

export interface VenueDetailHeaderProps {
  venueId: string;
  venueName: string;
  neighborhood?: string;
  city?: string;
  className?: string;
}

export function buildVenueShareUrl(venueId: string): string {
  const cleanId = venueId.trim();
  const path = `/venues/${cleanId}`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    try {
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const execCopy =
        typeof document.execCommand === 'function'
          ? document.execCommand('copy')
          : false;
      return Boolean(execCopy);
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  return false;
}

export const VenueDetailHeader: React.FC<VenueDetailHeaderProps> = ({
  venueId,
  venueName,
  neighborhood,
  city,
  className = '',
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleCopyLink = useCallback(async () => {
    const shareUrl = buildVenueShareUrl(venueId);
    await copyTextToClipboard(shareUrl);
    setToastMessage(VENUE_LINK_COPIED_TOAST);
  }, [venueId]);

  const dismissToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  const locationSubtitle = [neighborhood, city].filter(Boolean).join(', ');

  return (
    <header
      data-testid="venue-detail-header"
      className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-slate-900 sm:text-2xl dark:text-slate-100">
          {venueName}
        </h1>
        {locationSubtitle && (
          <p className="mt-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
            {locationSubtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleCopyLink()}
          data-testid="copy-venue-link-btn"
          aria-label="Copy Link"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M12.586 4.586a2 2 0 1 1 2.828 2.828l-3 3a2 2 0 0 1-2.828 0 1 1 0 0 0-1.414 1.414 4 4 0 0 0 5.656 0l3-3a4 4 0 0 0-5.656-5.656l-1.5 1.5a1 1 0 1 0 1.414 1.414l1.5-1.5Zm-5 5a2 2 0 0 1 2.828 0 1 1 0 1 0 1.414-1.414 4 4 0 0 0-5.656 0l-3 3a4 4 0 1 0 5.656 5.656l1.5-1.5a1 1 0 1 0-1.414-1.414l-1.5 1.5a2 2 0 1 1-2.828-2.828l3-3Z"
              clipRule="evenodd"
            />
          </svg>
          <span>Copy Link</span>
        </button>
      </div>

      <Toast message={toastMessage} onClose={dismissToast} />
    </header>
  );
};

export default VenueDetailHeader;
