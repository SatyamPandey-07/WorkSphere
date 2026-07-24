"use client";
import { VenueShareButton } from "@/components/social/VenueShareButton";
import { MapMarker } from "@/types/map";
import {
  Star,
  Wifi,
  Zap,
  Volume2,
  Navigation,
  Heart,
  Headphones,
  MessageSquare,
  Clock,
  ExternalLink,
  Loader2,
  TreePine,
  Accessibility,
  AlertTriangle,
  Sun,
  VolumeX,
  Calendar,
  Printer,
  Plug,
  Smartphone,
  BatteryCharging,
  Car,
  CircleDollarSign,
  Bike,
  Shield,
  PawPrint,
} from "lucide-react";
import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { NoiseTimeChart } from "@/components/noise/NoiseTimeChart";
import { AmbientSoundPlayer } from "@/components/noise/AmbientSoundPlayer";
import { AddToFolderModal } from "@/components/collections/AddToFolderModal";
import { FolderPlus } from "lucide-react";
import { useCurrency } from "@/context/CurrencyContext";
import { useHoverPredictor } from "@/hooks/useHoverPredictor";

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
  // --- New Props for Issue #614 ---
  isSelected?: boolean;
  onToggleCompare?: (venue: MapMarker) => void;
  compareDisabled?: boolean;
}

interface VoteMetricState {
  confidenceScore: number;
  upvotes: number;
  downvotes: number;
  hidden: boolean;
  userVote: boolean | null;
}

export function VenueCard({
  venue,
  onGetDirections,
  onSaveFavorite,
  onRate,
  isSelected,
  onToggleCompare,
  compareDisabled,
}: VenueCardProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  const [enrichData, setEnrichData] = useState<VenueEnrichData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [enableTransition, setEnableTransition] = useState(false);

  const { currency } = useCurrency();
  const router = useRouter();

  const hoverPredictorRef = useHoverPredictor({
    onPredict: () => {
      if (venue.id) {
        router.prefetch(`/venues/${venue.id}`);
      }
      if (
        typeof navigator !== "undefined" &&
        navigator.serviceWorker?.controller
      ) {
        navigator.serviceWorker.controller.postMessage({
          type: "PREFETCH_VENUE",
          payload: {
            venueId: venue.id,
            position: venue.position,
          },
        });
      }
    },
    velocityThreshold: 0.5,
    hoverTimeThreshold: 300,
  });

  // Helper function to convert base USD price
  const formatPrice = (basePriceUSD: number) => {
    // Standard conversion rates (can be replaced with live API later)
    const rates = {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      INR: 83.5,
    };

    const symbols = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      INR: "₹",
    };

    const convertedPrice = basePriceUSD * rates[currency];
    return `${symbols[currency]}${convertedPrice.toFixed(2)}`;
  };

  // =========================================================================
  // COMMUNITY VERIFICATION VOTE STATE TRACKING SYSTEM
  // =========================================================================
  const [voteMetrics, setVoteMetrics] = useState<
    Record<string, VoteMetricState>
  >({
    wifi: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    outlets: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    ergonomic: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    silentRoom: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    studyTable: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    scanner: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    freeStreetParking: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    paidGarage: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    bicycleRack: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    secureMotorcycleParking: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    petsAllowedIndoors: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    dogFriendly: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    catsAllowed: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
  });

  // Load real vote metrics from the database on mount
  useEffect(() => {
    async function loadVoteMetrics() {
      try {
        const response = await fetch(`/api/venues/${venue.id}/amenity-votes`);
        if (response.ok) {
          const data = await response.json();
          setVoteMetrics((prev) => ({ ...prev, ...data.metrics }));
        }
      } catch (error) {
        console.error("Failed to load amenity vote metrics:", error);
      }
    }
    loadVoteMetrics();
  }, [venue.id]);

  useEffect(() => {
    const timer = setTimeout(() => setEnableTransition(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Async dynamic vote submittal query processor
  const submitAmenityVote = async (
    amenityKey:
      | "wifi"
      | "outlets"
      | "ergonomic"
      | "silentRoom"
      | "studyTable"
      | "scanner"
      | "freeStreetParking"
      | "paidGarage"
      | "bicycleRack"
      | "secureMotorcycleParking"
      | "petsAllowedIndoors"
      | "dogFriendly"
      | "catsAllowed",
    isUpvote: boolean,
  ) => {
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
            hidden: data.hidden,
            userVote: isUpvote,
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

  const handleFavorite = async () => {
    if (isSavingFavorite) return; // ignore rapid double-clicks

    const previous = isFavorited;
    setIsSavingFavorite(true);
    setIsFavorited(!previous);
    try {
      await onSaveFavorite?.(venue);
    } catch (err) {
      setIsFavorited(previous); // revert optimistic update on failure
      console.error("Failed to save favorite:", err);
    } finally {
      setIsSavingFavorite(false);
    }
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
  const wifiLowConfidence = venue.wifiQuality && voteMetrics.wifi.hidden;
  const outletsLowConfidence = venue.hasOutlets && voteMetrics.outlets.hidden;
  const ergonomicLowConfidence =
    venue.amenities?.hasErgonomic && voteMetrics.ergonomic.hidden;

  const isLibrary = venue.category?.toLowerCase() === "library";
  const silentRoomLowConfidence = isLibrary && voteMetrics.silentRoom.hidden;
  const studyTableLowConfidence = isLibrary && voteMetrics.studyTable.hidden;
  const scannerLowConfidence = isLibrary && voteMetrics.scanner.hidden;

  return (
    <div
      ref={hoverPredictorRef}
      className="antialiased bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.04)] border border-zinc-100 dark:border-zinc-800 transition-all hover:shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex flex-col h-full group/card relative"
    >
      {wifiLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>
            Users report reliable **WiFi** might not be available here.
          </span>
        </div>
      )}
      {outletsLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>
            Users report **Power Outlets** might be broken or missing.
          </span>
        </div>
      )}
      {silentRoomLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>
            Users report **Strict Silent Rooms** might not be available here.
          </span>
        </div>
      )}
      {studyTableLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>
            Users report **Bookable Study Tables** might not be available here.
          </span>
        </div>
      )}
      {scannerLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>
            Users report **Scanners/Printers** might not be available here.
          </span>
        </div>
      )}
      {ergonomicLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Users report **ergonomic seating** may not be available here.
          </span>
        </div>
      )}

      {/* Photo Section */}
      {photos.length > 0 && (
        <div
          className="relative h-32 bg-zinc-100 dark:bg-zinc-800 cursor-pointer"
          onClick={nextPhoto}
        >
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
            <div className="absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-medium bg-blue-500 text-white z-10">
              {enrichData.categories[0]}
            </div>
          )}

          {/* NEW: Compare Checkbox UI */}
          {onToggleCompare && (
            <div
              className="absolute top-2 right-2 z-20 flex items-center gap-2 bg-white/90 dark:bg-black/80 px-2 py-1 rounded-md shadow-sm backdrop-blur-sm cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                if (!(!isSelected && compareDisabled)) {
                  onToggleCompare(venue);
                }
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                readOnly
                disabled={!isSelected && compareDisabled}
                className="w-4 h-4 accent-text rounded border-zinc-300 focus:ring-[var(--primary-accent)] disabled:opacity-50 pointer-events-none"
              />
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 select-none pointer-events-none">
                Compare
              </span>
            </div>
          )}
        </div>
      )}

      {/* Fallback Checkbox (If no photos exist) */}
      {photos.length === 0 && onToggleCompare && (
        <div
          className="absolute top-2 right-2 z-20 flex items-center gap-2 bg-white/90 dark:bg-black/80 px-2 py-1 rounded-md shadow-sm border border-zinc-200 dark:border-zinc-700 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            if (!(!isSelected && compareDisabled)) {
              onToggleCompare(venue);
            }
          }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            readOnly
            disabled={!isSelected && compareDisabled}
            className="w-4 h-4 accent-text rounded border-zinc-300 focus:ring-[var(--primary-accent)] disabled:opacity-50 pointer-events-none"
          />
          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 select-none pointer-events-none">
            Compare
          </span>
        </div>
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-2 mt-4">
          <div className="flex-1">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              {venue.name}
              {isLoading && (
                <Loader2 className="w-3 h-3 animate-spin accent-text shrink-0" />
              )}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {venue.address || "Address not available"}
            </p>
          </div>
          <button
            onClick={handleFavorite}
            disabled={isSavingFavorite}
            className={`p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
              enableTransition ? "transition-colors duration-300" : ""
            } ${
              isFavorited
                ? "bg-red-100 dark:bg-red-900/20 text-red-600"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
            }`}
          >
            <Heart
              className={`w-5 h-5 shrink-0 ${
                enableTransition ? "transition-all duration-300" : ""
              } ${isFavorited ? "fill-current" : ""}`}
            />
          </button>
        </div>

        {/* Rating & Category */}
        <div className="flex items-center gap-3 mb-3">
          {displayRating && (
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 text-yellow-500 fill-current shrink-0" />
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {typeof displayRating === "number"
                  ? displayRating.toFixed(1)
                  : displayRating}
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
                <Wifi className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[200px]" title="WiFi Verified">
                  WiFi Verified
                </span>
              </div>
            )}
            {amenities.outdoor_seating && (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <TreePine className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[200px]" title="Outdoor">
                  Outdoor
                </span>
              </div>
            )}
            {amenities.wheelchair && (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <Accessibility className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[200px]" title="Accessible">
                  Accessible
                </span>
              </div>
            )}
          </div>
        )}

        {/* Hours */}
        {(enrichData?.opening_hours || venue.openingHours) && (
          <div className="flex items-center gap-2 mb-3 text-xs text-zinc-600 dark:text-zinc-400">
            <Clock className="w-3 h-3 shrink-0" />
            <span>{enrichData?.opening_hours || venue.openingHours}</span>
            {(() => {
              const hoursStr = enrichData?.opening_hours || venue.openingHours;
              if (!hoursStr) return null;
              const match = hoursStr.match(
                /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/,
              );
              if (!match) return null;

              const now = new Date();
              const currentMinutes = now.getHours() * 60 + now.getMinutes();
              const [openH, openM] = match[1].split(":").map(Number);
              const [closeH, closeM] = match[2].split(":").map(Number);

              const openMinutes = openH * 60 + openM;
              const closeMinutes = closeH * 60 + closeM;

              let isOpen = false;
              if (closeMinutes < openMinutes) {
                isOpen =
                  currentMinutes >= openMinutes ||
                  currentMinutes <= closeMinutes;
              } else {
                isOpen =
                  currentMinutes >= openMinutes &&
                  currentMinutes < closeMinutes;
              }

              return (
                <span
                  className={`px-2 py-0.5 rounded-full font-semibold truncate max-w-[150px] ${
                    isOpen
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                  title={isOpen ? "Open Now" : "Closed"}
                >
                  {isOpen ? "Open Now" : "Closed"}
                </span>
              );
            })()}
          </div>
        )}

        {/* INTERACTIVE AMENITY VERIFICATION TAG TRACKING ROW */}
        <div className="flex flex-col gap-2 mb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
          <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">
            Verify Amenities:
          </span>

          <div className="flex flex-wrap gap-2">
            {/* WiFi Tag Check Node */}
            {venue.wifiQuality && !voteMetrics.wifi.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.wifi.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Wifi className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`WiFi (${voteMetrics.wifi.confidenceScore}%)`}
                >
                  WiFi ({voteMetrics.wifi.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("wifi", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.wifi.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("wifi", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.wifi.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Outlets Tag Check Node */}
            {venue.hasOutlets && !voteMetrics.outlets.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.outlets.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Outlets (${voteMetrics.outlets.confidenceScore}%)`}
                >
                  Outlets ({voteMetrics.outlets.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("outlets", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.outlets.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("outlets", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.outlets.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Ergonomic Seating Tag Check Node */}
            {venue.amenities?.hasErgonomic && !voteMetrics.ergonomic.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.ergonomic.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Accessibility className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Ergonomic (${voteMetrics.ergonomic.confidenceScore}%)`}
                >
                  Ergonomic ({voteMetrics.ergonomic.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("ergonomic", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.ergonomic.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("ergonomic", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.ergonomic.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Strict Silent Rooms Tag */}
            {isLibrary && !voteMetrics.silentRoom.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.silentRoom.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <VolumeX className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Silent Room (${voteMetrics.silentRoom.confidenceScore}%)`}
                >
                  Silent Room ({voteMetrics.silentRoom.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("silentRoom", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.silentRoom.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("silentRoom", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.silentRoom.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Bookable Study Tables Tag */}
            {isLibrary && !voteMetrics.studyTable.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.studyTable.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Study Tables (${voteMetrics.studyTable.confidenceScore}%)`}
                >
                  Study Tables ({voteMetrics.studyTable.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("studyTable", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.studyTable.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("studyTable", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.studyTable.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Scanners/Printers Tag */}
            {isLibrary && !voteMetrics.scanner.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.scanner.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Printer className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Scanners/Printers (${voteMetrics.scanner.confidenceScore}%)`}
                >
                  Scanners/Printers ({voteMetrics.scanner.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("scanner", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.scanner.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("scanner", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.scanner.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Free Street Parking Tag */}
            {!voteMetrics.freeStreetParking.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.freeStreetParking.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Car className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Street Parking (${voteMetrics.freeStreetParking.confidenceScore}%)`}
                >
                  Street Parking (
                  {voteMetrics.freeStreetParking.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("freeStreetParking", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.freeStreetParking.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() =>
                      submitAmenityVote("freeStreetParking", false)
                    }
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.freeStreetParking.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Paid Garage Tag */}
            {!voteMetrics.paidGarage.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.paidGarage.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Paid Garage (${voteMetrics.paidGarage.confidenceScore}%)`}
                >
                  Paid Garage ({voteMetrics.paidGarage.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("paidGarage", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.paidGarage.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("paidGarage", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.paidGarage.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Bicycle Rack Tag */}
            {!voteMetrics.bicycleRack.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.bicycleRack.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Bike className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Bicycle Rack (${voteMetrics.bicycleRack.confidenceScore}%)`}
                >
                  Bicycle Rack ({voteMetrics.bicycleRack.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("bicycleRack", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.bicycleRack.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("bicycleRack", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.bicycleRack.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Secure Motorcycle Parking Tag */}
            {!voteMetrics.secureMotorcycleParking.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.secureMotorcycleParking.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Shield className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Moto Parking (${voteMetrics.secureMotorcycleParking.confidenceScore}%)`}
                >
                  Moto Parking (
                  {voteMetrics.secureMotorcycleParking.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() =>
                      submitAmenityVote("secureMotorcycleParking", true)
                    }
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.secureMotorcycleParking.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() =>
                      submitAmenityVote("secureMotorcycleParking", false)
                    }
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.secureMotorcycleParking.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Pets Allowed Tag */}
            {!voteMetrics.petsAllowedIndoors.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.petsAllowedIndoors.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <PawPrint className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span
                  className="font-medium font-mono text-[11px] truncate max-w-[200px]"
                  title={`Pets Allowed (${voteMetrics.petsAllowedIndoors.confidenceScore}%)`}
                >
                  Pets Allowed ({voteMetrics.petsAllowedIndoors.confidenceScore}
                  %)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() =>
                      submitAmenityVote("petsAllowedIndoors", true)
                    }
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.petsAllowedIndoors.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() =>
                      submitAmenityVote("petsAllowedIndoors", false)
                    }
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.petsAllowedIndoors.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Dog Friendly Tag */}
            {!voteMetrics.dogFriendly.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.dogFriendly.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : voteMetrics.dogFriendly.upvotes >= 5
                      ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400 font-bold"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <span
                  className="truncate max-w-[200px]"
                  title={`🐶 Dog Friendly ${voteMetrics.dogFriendly.upvotes >= 5 ? "⭐ " : ""}(${voteMetrics.dogFriendly.confidenceScore}%)`}
                >
                  🐶 Dog Friendly {voteMetrics.dogFriendly.upvotes >= 5 && "⭐"}{" "}
                  ({voteMetrics.dogFriendly.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("dogFriendly", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.dogFriendly.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("dogFriendly", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.dogFriendly.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Cats Allowed Tag */}
            {!voteMetrics.catsAllowed.hidden && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                  voteMetrics.catsAllowed.confidenceScore < 60
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : voteMetrics.catsAllowed.upvotes >= 5
                      ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400 font-bold"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <span
                  className="truncate max-w-[200px]"
                  title={`🐱 Cats Allowed ${voteMetrics.catsAllowed.upvotes >= 5 ? "⭐ " : ""}(${voteMetrics.catsAllowed.confidenceScore}%)`}
                >
                  🐱 Cats Allowed {voteMetrics.catsAllowed.upvotes >= 5 && "⭐"}{" "}
                  ({voteMetrics.catsAllowed.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("catsAllowed", true)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.catsAllowed.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("catsAllowed", false)}
                    className={`transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded ${voteMetrics.catsAllowed.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {venue.hasAncHeadsetRental && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-500/30 bg-violet-500/10 text-xs text-violet-700 dark:text-violet-300"
                title="Active noise-cancelling headsets are available to rent"
              >
                <Headphones className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[200px]">
                  ANC Headset Rental
                </span>
              </div>
            )}

            {/* Noise profile badge — Issue #701: ambient audio preview */}
            {venue.noiseLevel && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300">
                <Volume2
                  className={`w-3.5 h-3.5 shrink-0 ${
                    venue.noiseLevel === "quiet"
                      ? "text-green-600"
                      : venue.noiseLevel === "moderate"
                        ? "text-orange-600"
                        : "text-red-600"
                  }`}
                />
                <span
                  className="capitalize truncate max-w-[200px]"
                  title={venue.noiseLevel}
                >
                  {venue.noiseLevel}
                </span>
                <AmbientSoundPlayer noiseLevel={venue.noiseLevel} />
              </div>
            )}
            {/* Lighting profile badge */}
            {venue.lighting && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300">
                <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span
                  className="capitalize truncate max-w-[200px]"
                  title={venue.lighting.replace("_", " ")}
                >
                  {venue.lighting.replace("_", " ")}
                </span>
              </div>
            )}

            {venue.distance && (
              <div
                className="text-xs text-zinc-500 self-center ml-auto font-medium truncate max-w-[100px]"
                title={venue.distance}
              >
                📏 {venue.distance}
              </div>
            )}
          </div>
        </div>

        {/* Amenities */}
        <div className="flex flex-wrap gap-2 mb-4">
          {venue.wifiQuality && venue.wifiQuality >= 3 && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <Wifi className="w-4 h-4 text-blue-600 shrink-0" />
              <span
                className="truncate max-w-[200px]"
                title={`WiFi ${venue.wifiQuality}/5`}
              >
                WiFi {venue.wifiQuality}/5
              </span>
            </div>
          )}
          {venue.hasOutlets &&
            (!venue.powerTypes || venue.powerTypes.length === 0) && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <Zap className="w-4 h-4 text-yellow-600 shrink-0" />
                <span className="truncate max-w-[200px]" title="Outlets">
                  Outlets
                </span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.powerTypes &&
            venue.powerTypes.includes("ac_wall") && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <Plug className="w-4 h-4 text-yellow-600 shrink-0" />
                <span className="truncate max-w-[200px]" title="AC Outlets">
                  AC Outlets
                </span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.powerTypes &&
            venue.powerTypes.includes("usb_c") && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <Smartphone className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="truncate max-w-[200px]" title="USB-C PD">
                  USB-C PD
                </span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.powerTypes &&
            venue.powerTypes.includes("wireless") && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <BatteryCharging className="w-4 h-4 text-green-500 shrink-0" />
                <span className="truncate max-w-[200px]" title="Wireless">
                  Wireless
                </span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.outletDensity &&
            venue.outletDensity !== "none" && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <span className="truncate max-w-[200px]">
                  {venue.outletDensity === "every_table" && "🔋 Every Table"}
                  {venue.outletDensity === "some_tables" && "🔌 Some Tables"}
                  {venue.outletDensity === "wall_seats" && "🔌 Wall Seats Only"}
                </span>
              </div>
            )}
          {venue.outletLocations && venue.outletLocations.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span
                className="truncate max-w-[200px]"
                title={venue.outletLocations
                  .map((l) => l.replace("_", " "))
                  .join(", ")}
              >
                🗺️{" "}
                {venue.outletLocations
                  .map((l) => l.replace("_", " "))
                  .join(", ")}
              </span>
            </div>
          )}

          {venue.patioOnly && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="truncate max-w-[200px]" title="Patio Only">
                🌿 Patio Only
              </span>
            </div>
          )}

          {venue.waterBowlsProvided && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="truncate max-w-[200px]" title="Water Bowls">
                💧 Water Bowls
              </span>
            </div>
          )}
          {venue.singleOriginBeans && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="truncate max-w-[200px]" title="Single-Origin">
                ☕ Single-Origin
              </span>
            </div>
          )}

          {venue.specialtyEspresso && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span
                className="truncate max-w-[200px]"
                title="Specialty Espresso"
              >
                ⚙️ Specialty Espresso
              </span>
            </div>
          )}

          {venue.oatAlmondMilk && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="truncate max-w-[200px]" title="Oat/Almond Milk">
                🥛 Oat/Almond Milk
              </span>
            </div>
          )}

          {venue.pourOverAvailable && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="truncate max-w-[200px]" title="Pour Over">
                🫖 Pour Over
              </span>
            </div>
          )}
          {venue.musicStyle === "lofi" && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span
                className="truncate max-w-[200px]"
                title="Lo-Fi/Chill Beats"
              >
                🎵 Lo-Fi/Chill Beats
              </span>
            </div>
          )}
          {venue.musicStyle === "classical_jazz" && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span
                className="truncate max-w-[200px]"
                title="Classical/Jazz Background"
              >
                🎷 Classical/Jazz Background
              </span>
            </div>
          )}
          {(venue.musicStyle === "no_music" || venue.hasNoMusic) && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="truncate max-w-[200px]" title="No Music Played">
                🔇 No Music Played
              </span>
            </div>
          )}
          {venue.hasPhoneBooths && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span
                className="truncate max-w-[200px]"
                title="Soundproof Booths Available"
              >
                📞 Soundproof Booths Available
              </span>
            </div>
          )}
          {/* Noise level row — Issue #701: ambient audio preview */}
          {venue.noiseLevel && (
            <div className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
              <Volume2
                className={`w-4 h-4 shrink-0 ${
                  venue.noiseLevel === "quiet"
                    ? "text-green-600"
                    : venue.noiseLevel === "moderate"
                      ? "text-orange-600"
                      : "text-red-600"
                }`}
              />
              <span
                className="capitalize truncate max-w-[200px]"
                title={venue.noiseLevel}
              >
                {venue.noiseLevel}
              </span>
              <AmbientSoundPlayer noiseLevel={venue.noiseLevel} />
            </div>
          )}
          {venue.lighting && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <Sun className="w-4 h-4 text-amber-500 shrink-0" />
              <span
                className="capitalize truncate max-w-[200px]"
                title={venue.lighting.replace("_", " ")}
              >
                {venue.lighting.replace("_", " ")}
              </span>
            </div>
          )}
          {venue.distance && (
            <div
              className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]"
              title={venue.distance}
            >
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
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white accent-bg accent-bg-hover rounded-lg transition-colors"
          >
            <Navigation className="w-4 h-4 shrink-0" />
            Directions
          </button>
          <button
            onClick={() => onRate?.(venue)}
            className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            Rate
          </button>
          {venue.id && (
            <button
              onClick={() => setShowFolderModal(true)}
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              title="Add to Collection"
            >
              <FolderPlus className="w-4 h-4 shrink-0" />
            </button>
          )}
          {enrichData?.website && (
            <a
              href={enrichData.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
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
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 flex flex-col items-center leading-tight"
            >
              <span>Reserve</span>
              <span className="text-[10px] opacity-80">
                {typeof enrichData.price === "number"
                  ? formatPrice(enrichData.price)
                  : formatPrice(15.0)}{" "}
                / day
              </span>
            </a>
          )}
        </div>
      </div>
      {showFolderModal && venue.id && (
        <AddToFolderModal
          venue={venue}
          onClose={() => setShowFolderModal(false)}
        />
      )}
    </div>
  );
}
