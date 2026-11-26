"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toast } from "@/components/ui/Toast";

export const VENUE_LINK_COPIED_TOAST = "Venue link copied to clipboard!";
export const VENUE_COORDINATES_COPIED_TOAST = "Coordinates copied!";

export interface VenueDetailHeaderProps {
  venueId: string;
  venueName: string;
  neighborhood?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  className?: string;
}

export function buildVenueShareUrl(venueId: string): string {
  const cleanId = venueId.trim();
  const path = `/venues/${cleanId}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    try {
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const execCopy =
        typeof document.execCommand === "function"
          ? document.execCommand("copy")
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
  latitude,
  longitude,
  className = "",
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showCoordinatesTooltip, setShowCoordinatesTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current !== null) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    };
  }, []);

  const hasCoordinates =
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    typeof longitude === "number" &&
    Number.isFinite(longitude);

  const handleCopyLink = useCallback(async () => {
    const shareUrl = buildVenueShareUrl(venueId);
    await copyTextToClipboard(shareUrl);
    setToastMessage(VENUE_LINK_COPIED_TOAST);
  }, [venueId]);

  const handleCopyCoordinates = useCallback(async () => {
    if (!hasCoordinates) return;
    const coords = `${latitude}, ${longitude}`;
    await copyTextToClipboard(coords);
    setToastMessage(VENUE_COORDINATES_COPIED_TOAST);
    setShowCoordinatesTooltip(true);
    if (tooltipTimerRef.current !== null) {
      clearTimeout(tooltipTimerRef.current);
    }
    tooltipTimerRef.current = setTimeout(() => {
      setShowCoordinatesTooltip(false);
      tooltipTimerRef.current = null;
    }, 2000);
  }, [hasCoordinates, latitude, longitude]);

  const dismissToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  const locationSubtitle = [neighborhood, city].filter(Boolean).join(", ");

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
        {hasCoordinates && (
          <div className="relative inline-flex items-center">
            <button
              type="button"
              onClick={() => void handleCopyCoordinates()}
              data-testid="copy-venue-coordinates-btn"
              aria-label="Copy venue coordinates"
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
                  d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.742 11.742 0 0 0 .977.533l.068.033.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Copy Coordinates</span>
            </button>
            {showCoordinatesTooltip && (
              <span
                role="status"
                data-testid="coordinates-tooltip"
                className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-md animate-in fade-in zoom-in-95 dark:bg-slate-100 dark:text-slate-900"
              >
                Coordinates copied!
              </span>
            )}
          </div>
        )}

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
