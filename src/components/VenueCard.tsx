"use client";

import { MapMarker } from "@/types/map";
import { Star, Wifi, Zap, Volume2, Navigation, Heart, MessageSquare, Clock, ExternalLink, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import Image from "next/image";

interface FoursquareData {
  found: boolean;
  fsqId?: string;
  rating?: number;
  price?: number;
  photos?: string[];
  tips?: Array<{ text: string; createdAt: string }>;
  hours?: { open_now?: boolean; display?: string };
  website?: string;
}

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
  const [fsqData, setFsqData] = useState<FoursquareData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  // Fetch Foursquare data for venue enrichment
  useEffect(() => {
    async function enrichVenue() {
      if (!venue.position) return;
      
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          name: venue.name,
          lat: venue.position.lat.toString(),
          lng: venue.position.lng.toString(),
        });
        
        const response = await fetch(`/api/venues/enrich?${params}`);
        if (response.ok) {
          const data = await response.json();
          if (data.found) {
            setFsqData(data);
          }
        }
      } catch (error) {
        console.error("Failed to enrich venue:", error);
      } finally {
        setIsLoading(false);
      }
    }

    enrichVenue();
  }, [venue.name, venue.position]);

  const handleFavorite = () => {
    setIsFavorited(!isFavorited);
    onSaveFavorite?.(venue);
  };

  // Cycle through photos
  const nextPhoto = () => {
    if (fsqData?.photos && fsqData.photos.length > 1) {
      setPhotoIndex((prev) => (prev + 1) % fsqData.photos!.length);
    }
  };

  const displayRating = fsqData?.rating || venue.rating;
  const photos = fsqData?.photos || [];
  const tips = fsqData?.tips || [];

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 hover:shadow-lg transition-all">
      {/* Photo Section */}
      {photos.length > 0 && (
        <div className="relative h-32 bg-zinc-100 dark:bg-zinc-800 cursor-pointer" onClick={nextPhoto}>
          <Image
            src={photos[photoIndex]}
            alt={venue.name}
            fill
            className="object-cover"
            unoptimized // External URLs from Foursquare
          />
          {photos.length > 1 && (
            <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded-full text-xs text-white">
              {photoIndex + 1}/{photos.length}
            </div>
          )}
          {/* Open Now Badge */}
          {fsqData?.hours?.open_now !== undefined && (
            <div className={`absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-medium ${
              fsqData.hours.open_now 
                ? "bg-green-500 text-white" 
                : "bg-red-500 text-white"
            }`}>
              {fsqData.hours.open_now ? "Open Now" : "Closed"}
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              {venue.name}
              {isLoading && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
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
          {displayRating && (
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 text-yellow-500 fill-current" />
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {typeof displayRating === 'number' ? displayRating.toFixed(1) : displayRating}
              </span>
            </div>
          )}
          {fsqData?.price && (
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">
              {"$".repeat(fsqData.price)}
            </span>
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

        {/* Hours */}
        {fsqData?.hours?.display && (
          <div className="flex items-center gap-2 mb-3 text-xs text-zinc-600 dark:text-zinc-400">
            <Clock className="w-3 h-3" />
            <span>{fsqData.hours.display}</span>
          </div>
        )}

        {/* Tips/Reviews */}
        {tips.length > 0 && (
          <div className="mb-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
            <p className="text-xs text-zinc-600 dark:text-zinc-400 italic line-clamp-2">
              "{tips[0].text}"
            </p>
          </div>
        )}

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
          {fsqData?.website && (
            <a
              href={fsqData.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
