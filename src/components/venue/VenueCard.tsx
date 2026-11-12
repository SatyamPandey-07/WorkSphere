"use client";

 docs/spacing-and-layout-tokens

 feat/noise-level-slider-filter

 fix/telemetry-ws-auth-token-refresh

 fix/map-route-layer-cleanup

 fix/solana-escrow-rpc-timeout-retry

 feat/ambient-noise-visualizer
 main
 main
 main
 main
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
 docs/spacing-and-layout-tokens
}

 feat/noise-level-slider-filter
}

 fix/telemetry-ws-auth-token-refresh
}

 fix/map-route-layer-cleanup
}

 fix/solana-escrow-rpc-timeout-retry
}

}

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
 main
 main
 main
 main
 main
 main
