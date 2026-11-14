"use client";

 fix/telemetry-ws-backoff-jitter

 fix/canvas-provider-idb-memory-leak
 main
import React from "react";
import Image from "next/image";
import { PhotoAttribution } from "./VenueGallery";

export interface VenueCardProps {
  id: string;
  name: string;
  address?: string;
  imageUrl?: string;
  attribution?: PhotoAttribution;
  rating?: number;
  wifiSpeed?: number;
  noiseLevel?: string;
  onClick?: () => void;
}

export function VenueCard({
  name,
  address,
  imageUrl,
  attribution,
  rating,
  wifiSpeed,
  noiseLevel,
  onClick,
}: VenueCardProps) {
  // Fallback check for photographer string
  const photographerName = attribution?.photographer?.trim() || "Verified Contributor";

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-slate-900 border border-slate-800 p-4 shadow-md transition-all hover:border-slate-700 cursor-pointer"
    >
      {/* Venue Photo Container */}
      {imageUrl && (
        <div className="relative h-40 w-full overflow-hidden rounded-lg bg-slate-800">
          <Image
            src={imageUrl}
            alt={name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}

      {/* Venue Details */}
      <div className="mt-3 flex flex-col gap-1">
        <h3 className="font-semibold text-lg text-slate-100 group-hover:text-indigo-400 transition-colors">
          {name}
        </h3>
        {address && <p className="text-xs text-slate-400">{address}</p>}

        <div className="mt-2 flex items-center gap-3 text-xs text-slate-300">
          {rating !== undefined && <span>⭐ {rating.toFixed(1)}</span>}
          {wifiSpeed !== undefined && <span>⚡ {wifiSpeed} Mbps</span>}
          {noiseLevel && <span className="capitalize">🔊 {noiseLevel}</span>}
        </div>

        {/* Photo Attribution with secure link & fallback safeguard */}
        {attribution && (
          <div className="mt-2 text-[11px] text-slate-500">
            Photo by{" "}
            {attribution.photographerUrl ? (
              <a
                href={attribution.photographerUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline hover:text-slate-300"
              >
                {photographerName}
              </a>
            ) : (
              <span>{photographerName}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
 fix/telemetry-ws-backoff-jitter
}

}

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
 main
 main
