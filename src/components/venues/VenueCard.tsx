"use client";

import React, { useMemo, useState } from "react";
import { Bookmark, Heart, Share2 } from "lucide-react";
import {
  getVenueOpeningStatus,
  type VenueOpeningHours,
} from "@/lib/venues/hours";

export interface VenueCardProps {
  id: string;
  name: string;
  neighborhood?: string;
  openingHours?: VenueOpeningHours;
  currentTime?: Date | string | number;
  showCountdown?: boolean;
  onSelect?: (id: string) => void;
  className?: string;
  wifiSpeed?: number | null;
  isBookmarked?: boolean;
  isFavorited?: boolean;
  onBookmark?: (id: string) => void;
  onFavorite?: (id: string) => void;
  onShare?: (id: string) => void;
}

export const VenueCard: React.FC<VenueCardProps> = ({
  id,
  name,
  neighborhood,
  openingHours,
  currentTime,
  showCountdown = false,
  onSelect,
  className = "",
  wifiSpeed,
  isBookmarked,
  isFavorited,
  onBookmark,
  onFavorite,
  onShare,
}) => {
  const [internalBookmarked, setInternalBookmarked] = useState(
    Boolean(isBookmarked),
  );
  const [internalFavorited, setInternalFavorited] = useState(
    Boolean(isFavorited),
  );

  const bookmarked =
    typeof isBookmarked === "boolean" ? isBookmarked : internalBookmarked;
  const favorited =
    typeof isFavorited === "boolean" ? isFavorited : internalFavorited;

  const handleBookmark = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const next = !bookmarked;
    setInternalBookmarked(next);
    onBookmark?.(id);
  };

  const handleFavorite = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const next = !favorited;
    setInternalFavorited(next);
    onFavorite?.(id);
  };

  const handleShare = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onShare?.(id);
  };

  const status = useMemo(
    () =>
      openingHours ? getVenueOpeningStatus(openingHours, currentTime) : null,
    [openingHours, currentTime],
  );

  const badgeStyle =
    status?.state === "open"
      ? "border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/60 dark:text-emerald-300"
      : status?.state === "closing_soon"
        ? "border-amber-300/80 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-300"
        : "border-slate-300/80 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";

  const displayText =
    showCountdown && status?.countdownText
      ? status.countdownText
      : status?.badgeText;

  return (
    <article
      data-testid={`venue-card-${id}`}
      onClick={() => onSelect?.(id)}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 ${
        onSelect ? "cursor-pointer" : ""
      } ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {name}
          </h3>
          {neighborhood && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {neighborhood}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Action buttons with descriptive dynamic aria-labels & aria-pressed */}
          <button
            type="button"
            data-testid="venue-bookmark-btn"
            aria-label={
              bookmarked
                ? `Remove ${name} from bookmarks`
                : `Save ${name} to bookmarks`
            }
            aria-pressed={bookmarked}
            onClick={handleBookmark}
            className={`p-1.5 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              bookmarked
                ? "text-blue-600 dark:text-blue-400"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            <Bookmark
              className={`w-4 h-4 ${bookmarked ? "fill-current" : ""}`}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            data-testid="venue-favorite-btn"
            aria-label={
              favorited
                ? `Remove ${name} from favorites`
                : `Add ${name} to favorites`
            }
            aria-pressed={favorited}
            onClick={handleFavorite}
            className={`p-1.5 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              favorited
                ? "text-rose-500 dark:text-rose-400"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            <Heart
              className={`w-4 h-4 ${favorited ? "fill-current" : ""}`}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            data-testid="venue-share-btn"
            aria-label={`Share ${name}`}
            onClick={handleShare}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Share2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {(status || (typeof wifiSpeed === "number" && wifiSpeed >= 100)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          {status && (
            <span
              role="status"
              aria-label={status.ariaLabel}
              data-testid="venue-opening-badge"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeStyle}`}
            >
              {status.state === "open" && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"
                />
              )}
              <span>{displayText}</span>
            </span>
          )}
          {typeof wifiSpeed === "number" && wifiSpeed >= 100 && (
            <span
              data-testid="gigabit-verified-badge"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300"
            >
              <span>Gigabit Verified</span>
            </span>
          )}
        </div>
      )}
    </article>
  );
};

export default VenueCard;
