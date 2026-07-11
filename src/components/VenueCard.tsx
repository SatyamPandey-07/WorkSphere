"use client";
import { VenueShareButton } from "@/components/social/VenueShareButton";
import { MapMarker } from "@/types/map";
import { Star, Wifi, Zap, Volume2, Navigation, Heart, MessageSquare, Clock, ExternalLink, Loader2, TreePine, Accessibility, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import Image from "next/image";
import { NoiseTimeChart } from "@/components/noise/NoiseTimeChart";

interface VenueEnrichData {
  found: boolean;
  venueId?: string;
  fsqId?: string;
  rating?: number;
  price?: number;
  photos?: string[];
  tips?: Array<{ text: string; createdAt: string }>;
  hours?: { open_now?: boolean; display?: string };
  opening_hours?: string;
  website?: string;
  amenities?: {
    wifi?: boolean;
    outdoor_seating?: boolean;
    wheelchair?: boolean;
  };
  categories?: string[];
}

interface VenueCardProps {
  venue: MapMarker;
  onGetDirections?: (venue: MapMarker) => void;
  onSaveFavorite?: (venue: MapMarker) => void;
  onRate?: (venue: MapMarker) => void;
}

interface VoteMetricState {
  confidenceScore: number;
  upvotes: number;
  downvotes: number;
}

export function VenueCard({
  venue,
  onGetDirections,
  onSaveFavorite,
  onRate,
}: VenueCardProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [enrichData, setEnrichData] = useState<VenueEnrichData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  // =========================================================================
  // COMMUNITY VERIFICATION VOTE STATE TRACKING SYSTEM
  // =========================================================================
  const [voteMetrics, setVoteMetrics] = useState<Record<string, VoteMetricState>>({
    wifi: { confidenceScore: 100, upvotes: 6, downvotes: 0 },
    outlets: { confidenceScore: 100, upvotes: 6, downvotes: 0 },
  });

  // Async dynamic vote submittal query processor
  const submitAmenityVote = async (amenityKey: "wifi" | "outlets", isUpvote: boolean) => {
    try {
      const response = await fetch("/api/venues/amenity-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: venue.id,
          amenity: amenityKey,
          isUpvote,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setVoteMetrics((prev) => ({
          ...prev,
          [amenityKey]: {
            confidenceScore: data.confidenceScore,
            upvotes: data.upvotes,
            downvotes: data.downvotes,
          },
        }));
      }
    } catch (error) {
      console.error("Failed to post metadata verification score:", error);
    }
  };

  // Fetch venue data from OSM + Unsplash (FREE)
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
          setEnrichData(data);
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
    if (enrichData?.photos && enrichData.photos.length > 1) {
      setPhotoIndex((prev) => (prev + 1) % enrichData.photos!.length);
    }
  };

  const displayRating = enrichData?.rating || venue.rating;
  const photos = enrichData?.photos || [];
  const amenities = enrichData?.amenities;

  // Determine low confidence threshold parameters to trigger notice blocks
  const wifiLowConfidence = venue.wifiQuality && voteMetrics.wifi.confidenceScore < 50;
  const outletsLowConfidence = venue.hasOutlets && voteMetrics.outlets.confidenceScore < 50;

  return (
    <div className="relative border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 hover:shadow-lg transition-all">
      
      {/* CROWDSOURCED CONFIDENCE CRITICAL WARNING BANNERS */}
      {wifiLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Users report reliable **WiFi** might not be available here.</span>
        </div>
      )}
      {outletsLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Users report **Power Outlets** might be broken or missing.</span>
        </div>
      )}

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
          {/* Category Badge */}
          {enrichData?.categories?.[0] && (
            <div className="absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-medium bg-blue-500 text-white">
              {enrichData.categories[0]}
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

        {/* OpenStreetMap Base Feature List */}
        {amenities && (
          <div className="flex items-center gap-3 mb-3">
            {amenities.wifi && (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <Wifi className="w-3 h-3" />
                <span>WiFi Verified</span>
              </div>
            )}
            {amenities.outdoor_seating && (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <TreePine className="w-3 h-3" />
                <span>Outdoor</span>
              </div>
            )}
            {amenities.wheelchair && (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <Accessibility className="w-3 h-3" />
                <span>Accessible</span>
              </div>
            )}
          </div>
        )}

        {/* Hours */}
        {enrichData?.opening_hours && (
          <div className="flex items-center gap-2 mb-3 text-xs text-zinc-600 dark:text-zinc-400">
            <Clock className="w-3 h-3" />
            <span>{enrichData.opening_hours}</span>
          </div>
        )}


        {/* INTERACTIVE AMENITY VERIFICATION TAG TRACKING ROW */}
        <div className="flex flex-col gap-2 mb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
          <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">Verify Amenities:</span>
          
          <div className="flex flex-wrap gap-2">
            {/* WiFi Tag Check Node */}
            {venue.wifiQuality && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                voteMetrics.wifi.confidenceScore < 50 
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-500" 
                  : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
              }`}>
                <Wifi className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-medium font-mono text-[11px]">WiFi ({voteMetrics.wifi.confidenceScore}%)</span>
                
                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button onClick={() => submitAmenityVote("wifi", true)} className="hover:text-green-500 transition-colors">👍</button>
                  <button onClick={() => submitAmenityVote("wifi", false)} className="hover:text-red-500 transition-colors">👎</button>
                </div>
              </div>
            )}

            {/* Outlets Tag Check Node */}
            {venue.hasOutlets && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                voteMetrics.outlets.confidenceScore < 50 
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-500" 
                  : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
              }`}>
                <Zap className="w-3.5 h-3.5 text-yellow-500" />
                <span className="font-medium font-mono text-[11px]">Outlets ({voteMetrics.outlets.confidenceScore}%)</span>
                
                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button onClick={() => submitAmenityVote("outlets", true)} className="hover:text-green-500 transition-colors">👍</button>
                  <button onClick={() => submitAmenityVote("outlets", false)} className="hover:text-red-500 transition-colors">👎</button>
                </div>
              </div>
            )}

            {/* Noise profile badge */}
            {venue.noiseLevel && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300">
                <Volume2 className={`w-3.5 h-3.5 ${
                  venue.noiseLevel === "quiet" ? "text-green-600" : venue.noiseLevel === "moderate" ? "text-orange-600" : "text-red-600"
                }`} />
                <span className="capitalize">{venue.noiseLevel}</span>
              </div>
            )}
            
            {venue.distance && (
              <div className="text-xs text-zinc-500 self-center ml-auto font-medium">
                📏 {venue.distance}
              </div>
            )}
          </div>
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
          {enrichData?.venueId && (
  <div className="mt-4">
    <NoiseTimeChart venueId={enrichData.venueId} />
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
          {enrichData?.website && (
            <a
              href={enrichData.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {enrichData?.venueId && (
  <VenueShareButton
    venueId={enrichData.venueId}
    venueName={venue.name}
  />
)}

{enrichData?.venueId && (
  <a
    href={`/reserve/${enrichData.venueId}`}
    className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500"
  >
    Reserve desk
  </a>
)}
        </div>
      </div>
    </div>
  );
}
