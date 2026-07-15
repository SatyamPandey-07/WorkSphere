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
import { NoiseTimeChart } from "@/components/noise/NoiseTimeChart";
import { AddToFolderModal } from "@/components/collections/AddToFolderModal";
import { FolderPlus } from "lucide-react";

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
  hidden: boolean;
  userVote: boolean | null;
}

export function VenueCard({
  venue,
  onGetDirections,
  onSaveFavorite,
  onRate,
}: VenueCardProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  const [enrichData, setEnrichData] = useState<VenueEnrichData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showFolderModal, setShowFolderModal] = useState(false);

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
    <div className="bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.04)] border border-zinc-100 dark:border-zinc-800 transition-all hover:shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex flex-col h-full group/card relative">
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
              {isLoading && (
                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
              )}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {venue.address || "Address not available"}
            </p>
          </div>
          <button
            onClick={handleFavorite}
            disabled={isSavingFavorite}
            className={`p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
                <Wifi className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-medium font-mono text-[11px]">
                  WiFi ({voteMetrics.wifi.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("wifi", true)}
                    className={`transition-colors ${voteMetrics.wifi.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("wifi", false)}
                    className={`transition-colors ${voteMetrics.wifi.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <Zap className="w-3.5 h-3.5 text-yellow-500" />
                <span className="font-medium font-mono text-[11px]">
                  Outlets ({voteMetrics.outlets.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("outlets", true)}
                    className={`transition-colors ${voteMetrics.outlets.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("outlets", false)}
                    className={`transition-colors ${voteMetrics.outlets.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <Accessibility className="w-3.5 h-3.5 text-purple-500" />
                <span className="font-medium font-mono text-[11px]">
                  Ergonomic ({voteMetrics.ergonomic.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("ergonomic", true)}
                    className={`transition-colors ${voteMetrics.ergonomic.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("ergonomic", false)}
                    className={`transition-colors ${voteMetrics.ergonomic.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <VolumeX className="w-3.5 h-3.5 text-emerald-500" />
                <span className="font-medium font-mono text-[11px]">
                  Silent Room ({voteMetrics.silentRoom.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("silentRoom", true)}
                    className={`transition-colors ${voteMetrics.silentRoom.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("silentRoom", false)}
                    className={`transition-colors ${voteMetrics.silentRoom.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                <span className="font-medium font-mono text-[11px]">
                  Study Tables ({voteMetrics.studyTable.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("studyTable", true)}
                    className={`transition-colors ${voteMetrics.studyTable.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("studyTable", false)}
                    className={`transition-colors ${voteMetrics.studyTable.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <Printer className="w-3.5 h-3.5 text-cyan-500" />
                <span className="font-medium font-mono text-[11px]">
                  Scanners/Printers ({voteMetrics.scanner.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("scanner", true)}
                    className={`transition-colors ${voteMetrics.scanner.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("scanner", false)}
                    className={`transition-colors ${voteMetrics.scanner.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <Car className="w-3.5 h-3.5 text-blue-400" />
                <span className="font-medium font-mono text-[11px]">
                  Street Parking (
                  {voteMetrics.freeStreetParking.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("freeStreetParking", true)}
                    className={`transition-colors ${voteMetrics.freeStreetParking.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() =>
                      submitAmenityVote("freeStreetParking", false)
                    }
                    className={`transition-colors ${voteMetrics.freeStreetParking.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-medium font-mono text-[11px]">
                  Paid Garage ({voteMetrics.paidGarage.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("paidGarage", true)}
                    className={`transition-colors ${voteMetrics.paidGarage.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("paidGarage", false)}
                    className={`transition-colors ${voteMetrics.paidGarage.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <Bike className="w-3.5 h-3.5 text-orange-500" />
                <span className="font-medium font-mono text-[11px]">
                  Bicycle Rack ({voteMetrics.bicycleRack.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("bicycleRack", true)}
                    className={`transition-colors ${voteMetrics.bicycleRack.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("bicycleRack", false)}
                    className={`transition-colors ${voteMetrics.bicycleRack.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <Shield className="w-3.5 h-3.5 text-zinc-500" />
                <span className="font-medium font-mono text-[11px]">
                  Moto Parking (
                  {voteMetrics.secureMotorcycleParking.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() =>
                      submitAmenityVote("secureMotorcycleParking", true)
                    }
                    className={`transition-colors ${voteMetrics.secureMotorcycleParking.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() =>
                      submitAmenityVote("secureMotorcycleParking", false)
                    }
                    className={`transition-colors ${voteMetrics.secureMotorcycleParking.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <PawPrint className="w-3.5 h-3.5 text-orange-500" />
                <span className="font-medium font-mono text-[11px]">
                  Pets Allowed ({voteMetrics.petsAllowedIndoors.confidenceScore}
                  %)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() =>
                      submitAmenityVote("petsAllowedIndoors", true)
                    }
                    className={`transition-colors ${voteMetrics.petsAllowedIndoors.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() =>
                      submitAmenityVote("petsAllowedIndoors", false)
                    }
                    className={`transition-colors ${voteMetrics.petsAllowedIndoors.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <span>
                  🐶 Dog Friendly {voteMetrics.dogFriendly.upvotes >= 5 && "⭐"}{" "}
                  ({voteMetrics.dogFriendly.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("dogFriendly", true)}
                    className={`transition-colors ${voteMetrics.dogFriendly.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("dogFriendly", false)}
                    className={`transition-colors ${voteMetrics.dogFriendly.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
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
                <span>
                  🐱 Cats Allowed {voteMetrics.catsAllowed.upvotes >= 5 && "⭐"}{" "}
                  ({voteMetrics.catsAllowed.confidenceScore}%)
                </span>

                <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                  <button
                    onClick={() => submitAmenityVote("catsAllowed", true)}
                    className={`transition-colors ${voteMetrics.catsAllowed.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => submitAmenityVote("catsAllowed", false)}
                    className={`transition-colors ${voteMetrics.catsAllowed.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
            )}

            {/* Noise profile badge */}
            {venue.noiseLevel && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300">
                <Volume2
                  className={`w-3.5 h-3.5 ${
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
            {/* Lighting profile badge */}
            {venue.lighting && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300">
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span className="capitalize">
                  {venue.lighting.replace("_", " ")}
                </span>
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
          {venue.hasOutlets &&
            (!venue.powerTypes || venue.powerTypes.length === 0) && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <Zap className="w-4 h-4 text-yellow-600" />
                <span>Outlets</span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.powerTypes &&
            venue.powerTypes.includes("ac_wall") && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <Plug className="w-4 h-4 text-yellow-600" />
                <span>AC Outlets</span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.powerTypes &&
            venue.powerTypes.includes("usb_c") && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <Smartphone className="w-4 h-4 text-blue-500" />
                <span>USB-C PD</span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.powerTypes &&
            venue.powerTypes.includes("wireless") && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <BatteryCharging className="w-4 h-4 text-green-500" />
                <span>Wireless</span>
              </div>
            )}
          {venue.hasOutlets &&
            venue.outletDensity &&
            venue.outletDensity !== "none" && (
              <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                <span>
                  {venue.outletDensity === "every_table" && "🔋 Every Table"}
                  {venue.outletDensity === "some_tables" && "🔌 Some Tables"}
                  {venue.outletDensity === "wall_seats" && "🔌 Wall Seats Only"}
                </span>
              </div>
            )}
          {venue.outletLocations && venue.outletLocations.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                🗺️{" "}
                {venue.outletLocations
                  .map((l) => l.replace("_", " "))
                  .join(", ")}
              </span>
            </div>
          )}

          {venue.patioOnly && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>🌿 Patio Only</span>
            </div>
          )}

          {venue.waterBowlsProvided && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>💧 Water Bowls</span>
            </div>
          )}
          {venue.singleOriginBeans && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>☕ Single-Origin</span>
            </div>
          )}

          {venue.specialtyEspresso && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>⚙️ Specialty Espresso</span>
            </div>
          )}

          {venue.oatAlmondMilk && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>🥛 Oat/Almond Milk</span>
            </div>
          )}

          {venue.pourOverAvailable && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>🫖 Pour Over</span>
            </div>
          )}
          {venue.musicStyle === "lofi" && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>🎵 Lo-Fi/Chill Beats</span>
            </div>
          )}
          {venue.musicStyle === "classical_jazz" && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>🎷 Classical/Jazz Background</span>
            </div>
          )}
          {(venue.musicStyle === "no_music" || venue.hasNoMusic) && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>🔇 No Music Played</span>
            </div>
          )}
          {venue.hasPhoneBooths && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>📞 Soundproof Booths Available</span>
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
          {venue.lighting && (
            <div className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300">
              <Sun className="w-4 h-4 text-amber-500" />
              <span className="capitalize">
                {venue.lighting.replace("_", " ")}
              </span>
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
          {venue.id && (
            <button
              onClick={() => setShowFolderModal(true)}
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              title="Add to Collection"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          )}
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
      {showFolderModal && venue.id && (
        <AddToFolderModal
          venue={venue}
          onClose={() => setShowFolderModal(false)}
        />
      )}
    </div>
  );
}
