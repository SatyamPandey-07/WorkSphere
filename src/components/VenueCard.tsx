"use client";

import { MapMarker } from "@/types/map";
import { Star, Wifi, Zap, Volume2, Navigation, Heart, MessageSquare } from "lucide-react";
import { useState } from "react";

interface VenueCardProps {
  venue: MapMarker;
  onGetDirections?: (venue: MapMarker) => void;
  onSaveFavorite?: (venue: MapMarker) => void;
  onRate?: (venue: MapMarker) => void;
}

export function VenueCard({
  venue,
  onGetDirections,
  onSaveFavorite,
  onRate,
}: VenueCardProps) {
  const [isFavorited, setIsFavorited] = useState(false);

  const handleFavorite = () => {
    setIsFavorited(!isFavorited);
    onSaveFavorite?.(venue);
  };

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
            {venue.name}
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {venue.address || "Address not available"}
          </p>
        </div>
        <button
          onClick={handleFavorite}
          className={`p-2 rounded-lg transition-colors ${
            isFavorited
              ? "bg-red-100 dark:bg-red-900/20 text-red-600"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
          }`}
        >
          <Heart className={`w-5 h-5 ${isFavorited ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* Rating & Category */}
      <div className="flex items-center gap-3 mb-3">
        {venue.rating && (
          <div className="flex items-center gap-1">
            <Star className="w-4 h-4 text-yellow-500 fill-current" />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {venue.rating.toFixed(1)}
            </span>
          </div>
        )}
        {venue.category && (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
            {venue.category}
          </span>
        )}
        {venue.score && (
          <span className="ml-auto text-sm font-semibold text-green-600 dark:text-green-400">
            {venue.score}/10
          </span>
        )}
      </div>

      {/* Amenities */}
      <div className="flex flex-wrap gap-2 mb-4">
        {venue.wifiQuality && venue.wifiQuality >= 3 && (
          <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
            <Wifi className="w-4 h-4 text-blue-600" />
            <span>WiFi {venue.wifiQuality}/5</span>
          </div>
        )}
        {venue.hasOutlets && (
          <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
            <Zap className="w-4 h-4 text-yellow-600" />
            <span>Outlets</span>
          </div>
        )}
        {venue.noiseLevel && (
          <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
            <Volume2
              className={`w-4 h-4 ${
                venue.noiseLevel === "quiet"
                  ? "text-green-600"
                  : venue.noiseLevel === "moderate"
                  ? "text-orange-600"
                  : "text-red-600"
              }`}
            />
            <span className="capitalize">{venue.noiseLevel}</span>
          </div>
        )}
        {venue.distance && (
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            📏 {venue.distance}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onGetDirections?.(venue)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          <Navigation className="w-4 h-4" />
          Directions
        </button>
        <button
          onClick={() => onRate?.(venue)}
          className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          Rate
        </button>
      </div>
    </div>
  );
}
