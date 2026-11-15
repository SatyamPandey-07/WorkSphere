"use client";

import React, { useState } from "react";
import { Bookmark, CalendarCheck, Heart, Share2 } from "lucide-react";
import { ShortcutTooltip } from "@/components/ui/ShortcutTooltip";

export interface VenueCardProps {
  venue: {
    id: string;
    name: string;
    description?: string;
    imageUrl?: string;
  };
  onBookmark?: (id: string) => void;
  onFavorite?: (id: string) => void;
  onShare?: (id: string) => void;
  /**
   * Instant booking action for the card's primary button.
   * When provided, the button renders a keyboard shortcut tooltip hint.
   */
  onBook?: (id: string) => void;
  /**
   * Shortcut hint shown for the booking action.
   * Pass `null` to render the booking button without a tooltip hint.
   */
  bookingHotkey?: string | null;
}

const focusRingClasses =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900";

export const VenueCard: React.FC<VenueCardProps> = ({
  venue,
  onBookmark,
  onFavorite,
  onShare,
  onBook,
  bookingHotkey = "B",
}) => {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  const handleBookmark = () => {
    setIsBookmarked((prev) => !prev);
    if (onBookmark) onBookmark(venue.id);
  };

  const handleFavorite = () => {
    setIsFavorited((prev) => !prev);
    if (onFavorite) onFavorite(venue.id);
  };

  const handleShare = () => {
    if (onShare) onShare(venue.id);
  };

  const bookingButton = (
    <button
      type="button"
      onClick={() => onBook?.(venue.id)}
      aria-label={`Instant booking for ${venue.name}`}
      className={`flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 ${focusRingClasses}`}
    >
      <CalendarCheck className="h-4 w-4" aria-hidden="true" />
      <span>Book now</span>
    </button>
  );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-zinc-100 shadow-md">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="truncate text-lg font-bold">{venue.name}</h3>
        <div className="flex items-center gap-2">
          {/* Bookmark Button */}
          <button
            type="button"
            onClick={handleBookmark}
            aria-label={`Bookmark ${venue.name}`}
            aria-pressed={isBookmarked}
            className={`rounded-lg p-2 transition-colors hover:bg-zinc-800 ${
              isBookmarked ? "text-emerald-400" : "text-zinc-400"
            } ${focusRingClasses}`}
          >
            <Bookmark className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Favorite Button */}
          <button
            type="button"
            onClick={handleFavorite}
            aria-label={`Favorite ${venue.name}`}
            aria-pressed={isFavorited}
            className={`rounded-lg p-2 transition-colors hover:bg-zinc-800 ${
              isFavorited ? "text-rose-500" : "text-zinc-400"
            } ${focusRingClasses}`}
          >
            <Heart className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Quick Share Button */}
          <button
            type="button"
            onClick={handleShare}
            aria-label={`Share ${venue.name}`}
            className={`rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 ${focusRingClasses}`}
          >
            <Share2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {venue.description && (
        <p className="line-clamp-2 text-sm text-zinc-400">
          {venue.description}
        </p>
      )}

      {onBook && (
        <div className="mt-3">
          {bookingHotkey === null ? (
            bookingButton
          ) : (
            <ShortcutTooltip
              content="Instant booking"
              shortcut={bookingHotkey}
              withModifier={false}
              position="top"
              className="w-full"
            >
              {bookingButton}
            </ShortcutTooltip>
          )}
        </div>
      )}
    </div>
  );
};

export default VenueCard;
