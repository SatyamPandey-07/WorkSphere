"use client";

import React, { useState } from "react";
import { Bookmark, Heart, Share2 } from "lucide-react";

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
}

export const VenueCard: React.FC<VenueCardProps> = ({
  venue,
  onBookmark,
  onFavorite,
  onShare,
}) => {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  const focusRingClasses =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900";

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

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-zinc-100 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold truncate">{venue.name}</h3>
        <div className="flex items-center gap-2">
          {/* Bookmark Button */}
          <button
            type="button"
            onClick={handleBookmark}
            aria-label={`Bookmark ${venue.name}`}
            className={`p-2 rounded-lg transition-colors hover:bg-zinc-800 ${
              isBookmarked ? "text-emerald-400" : "text-zinc-400"
            } ${focusRingClasses}`}
          >
            <Bookmark className="w-5 h-5" />
          </button>

          {/* Favorite Button */}
          <button
            type="button"
            onClick={handleFavorite}
            aria-label={`Favorite ${venue.name}`}
            className={`p-2 rounded-lg transition-colors hover:bg-zinc-800 ${
              isFavorited ? "text-rose-500" : "text-zinc-400"
            } ${focusRingClasses}`}
          >
            <Heart className="w-5 h-5" />
          </button>

          {/* Quick Share Button */}
          <button
            type="button"
            onClick={handleShare}
            aria-label={`Share ${venue.name}`}
            className={`p-2 rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 ${focusRingClasses}`}
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </div>
      {venue.description && (
        <p className="text-sm text-zinc-400 line-clamp-2">
          {venue.description}
        </p>
      )}
    </div>
  );
};

export default VenueCard;
