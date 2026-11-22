"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { Bookmark, CalendarCheck, Heart, Share2 } from "lucide-react";
import { PhotoAttribution } from "./VenueGallery";
import { ShortcutTooltip } from "@/components/ui/ShortcutTooltip";

export interface VenueCardProps {
  id?: string;
  name?: string;
  address?: string;
  imageUrl?: string;
  attribution?: PhotoAttribution;
  rating?: number;
  wifiSpeed?: number;
  noiseLevel?: string;
  amenities?: string[];
  tags?: string[];
  onClick?: () => void;
  venue?: {
    id: string;
    name: string;
    description?: string;
    imageUrl?: string;
    amenities?: string[];
    tags?: string[];
  };
  onBookmark?: (id: string) => void | Promise<void>;
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
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900";

export const VenueCard: React.FC<VenueCardProps> = ({
  id,
  name,
  address,
  imageUrl,
  attribution,
  rating,
  wifiSpeed,
  noiseLevel,
  amenities,
  tags,
  onClick,
  venue,
  onBookmark,
  onFavorite,
  onShare,
  onBook,
  bookingHotkey = "B",
}) => {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isBookmarkPending, setIsBookmarkPending] = useState(false);
  const isBookmarkPendingRef = useRef(false);

  // Resolved venue fields supporting both flat props and nested venue object
  const venueId = venue?.id || id || "";
  const venueName = venue?.name || name || "";
  const venueDescription = venue?.description;
  const venueImage = venue?.imageUrl || imageUrl;
  const rawAmenities =
    amenities || venue?.amenities || tags || venue?.tags || [];
  const amenityList = Array.isArray(rawAmenities) ? rawAmenities : [];

  const photographerName =
    attribution?.photographer?.trim() || "Verified Contributor";

  const handleBookmark = async () => {
    if (isBookmarkPendingRef.current) {
      return;
    }

    isBookmarkPendingRef.current = true;
    setIsBookmarkPending(true);
    setIsBookmarked((prev) => !prev);

    try {
      if (onBookmark && venueId) {
        await onBookmark(venueId);
      }
    } catch {
      // Rollback optimistic update on mutation failure
      setIsBookmarked((prev) => !prev);
    } finally {
      isBookmarkPendingRef.current = false;
      setIsBookmarkPending(false);
    }
  };

  const handleFavorite = () => {
    setIsFavorited((prev) => !prev);
    if (onFavorite && venueId) onFavorite(venueId);
  };

  const handleShare = () => {
    if (onShare && venueId) onShare(venueId);
  };

  const bookingButton = (
    <button
      type="button"
      onClick={() => onBook?.(venueId)}
      aria-label={`Instant booking for ${venueName}`}
      className={`flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 ${focusRingClasses}`}
    >
      <CalendarCheck className="h-4 w-4" aria-hidden="true" />
      <span>Book now</span>
    </button>
  );

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-zinc-100 shadow-md min-w-0 max-w-full ${
        onClick ? "cursor-pointer transition-all hover:border-zinc-700" : ""
      }`}
    >
      {/* Venue Photo Container if provided */}
      {venueImage && (
        <div className="relative mb-3 h-40 w-full overflow-hidden rounded-lg bg-zinc-800">
          <Image
            src={venueImage}
            alt={venueName}
            fill
            className="object-cover transition-transform duration-300 hover:scale-105"
          />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="truncate text-lg font-bold">{venueName}</h3>
        <div className="flex items-center gap-2">
          {/* Bookmark Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleBookmark();
            }}
            disabled={isBookmarkPending}
            aria-label={`Bookmark ${venueName}`}
            aria-pressed={isBookmarked}
            className={`venue-action-glass-btn rounded-lg p-2 transition-colors hover:backdrop-blur-md hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 ${
              isBookmarked ? "text-emerald-400" : "text-zinc-400"
            } ${focusRingClasses}`}
          >
            <Bookmark className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Favorite Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleFavorite();
            }}
            aria-label={`Favorite ${venueName}`}
            aria-pressed={isFavorited}
            className={`venue-action-glass-btn rounded-lg p-2 transition-colors hover:backdrop-blur-md hover:bg-zinc-800 ${
              isFavorited ? "text-rose-500" : "text-zinc-400"
            } ${focusRingClasses}`}
          >
            <Heart className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Quick Share Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleShare();
            }}
            aria-label={`Share ${venueName}`}
            className={`venue-action-glass-btn rounded-lg p-2 text-zinc-400 transition-colors hover:backdrop-blur-md hover:bg-zinc-800 ${focusRingClasses}`}
          >
            <Share2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {address && <p className="mb-2 text-xs text-zinc-400">{address}</p>}

      {(rating !== undefined || wifiSpeed !== undefined || noiseLevel) && (
        <div className="mb-3 flex items-center gap-3 text-xs text-zinc-300">
          {rating !== undefined && <span>⭐ {rating.toFixed(1)}</span>}
          {wifiSpeed !== undefined && <span>⚡ {wifiSpeed} Mbps</span>}
          {noiseLevel && <span className="capitalize">🔊 {noiseLevel}</span>}
        </div>
      )}

      {venueDescription && (
        <p className="line-clamp-2 text-sm text-zinc-400">{venueDescription}</p>
      )}

      {/* Amenity Tag Pills with responsive mobile wrapping */}
      {amenityList.length > 0 && (
        <div
          data-testid="venue-amenity-tags"
          className="mt-3 flex flex-wrap items-center gap-1.5 overflow-hidden min-w-0 max-w-full"
        >
          {amenityList.map((amenity, idx) => (
            <span
              key={`${amenity}-${idx}`}
              data-testid="amenity-tag-pill"
              className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-zinc-800 text-zinc-200 border border-zinc-700 break-words whitespace-normal min-w-0 max-w-full [overflow-wrap:anywhere]"
            >
              {amenity}
            </span>
          ))}
        </div>
      )}

      {/* Photo Attribution with secure link & fallback safeguard */}
      {attribution && (
        <div className="mt-2 text-[11px] text-zinc-500">
          Photo by{" "}
          {attribution.photographerUrl ? (
            <a
              href={attribution.photographerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline hover:text-zinc-300"
            >
              {photographerName}
            </a>
          ) : (
            <span>{photographerName}</span>
          )}
        </div>
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
