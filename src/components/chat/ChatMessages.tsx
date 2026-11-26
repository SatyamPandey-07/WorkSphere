"use client";

import {
  BookOpen,
  Brain,
  Building2,
  ChevronDown,
  ChevronUp,
  Coffee,
  FolderPlus,
  Heart,
  Headphones,
  Info,
  Loader2,
  MapPin,
  Navigation,
  Star,
  Volume2,
  Wifi,
  Zap,
  LayoutGrid,
  List,
  Copy,
  Check,
  Clock,
} from "lucide-react";
import { usePreferenceReranking } from "@/hooks/usePreferenceReranking";
import { useKMeansClustering } from "@/hooks/useKMeansClustering";
import { useSavedVenues } from "@/hooks/useSavedVenues";
import { RecommendedBadge } from "@/components/RecommendedBadge";
import { ClusterBadge } from "@/components/ClusterBadge";
import {
  RefObject,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { motion, LayoutGroup } from "framer-motion";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { BrainTerminal } from "./BrainTerminal";
import { trackVenueInteraction } from "@/lib/analytics";
import { MessageRenderer } from "./GenerativeUI";
import { AddToFolderModal } from "@/components/collections/AddToFolderModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ComparisonDrawer } from "@/components/ComparisonDrawer";
import { ChatMessageSkeleton } from "@/components/ui/skeleton";
import { ReadAloudButton } from "./ReadAloudButton";
import { TranslatedMessage } from "./TranslatedMessage";
import { RecentlyViewedVenues } from "@/components/venues/RecentlyViewedVenues";
import { getVenueCoverTransitionName } from "@/lib/viewTransitions";
import { getVenueHoursStatus } from "@/lib/venueHours";
import {
  VenueGrid,
  LayoutBoundary,
  SubgridCell,
} from "@/components/ui/VenueGrid";

// ─── Shared types (re-declared so sub-components are self-contained) ──────────

import type { Venue, ClientVenue } from "@/types/venue";

/**
 * @deprecated Venue has moved to `@/types/venue`. Import Venue or ClientVenue from `@/types/venue` instead.
 */
export type { Venue, ClientVenue };

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: number | string;
  name?: string;
  venues?: Venue[];
  agentSteps?: Array<{
    agent: string;
    result: Record<string, unknown>;
    timestamp: number;
    latencyMs?: number;
  }>;
  suggestions?: string[];
  cached?: boolean;
  complexity?: string;
  isStreaming?: boolean;
}

/**
 * Deduplicates chat messages by unique identifier (message.id).
 * Retains the first occurrence, preserving message sequence and order.
 * Prevents duplicate message bubbles from rendering during rapid WebRTC
 * DataChannel reconnects or redundant peer mesh history sync (#10014).
 */
export function deduplicateChatMessages(
  messages: readonly Message[],
): Message[] {
  if (!Array.isArray(messages)) return [];
  const seen = new Set<string>();
  const result: Message[] = [];
  for (const msg of messages) {
    if (!msg || !msg.id) continue;
    if (!seen.has(msg.id)) {
      seen.add(msg.id);
      result.push(msg);
    }
  }
  return result;
}

const AGENT_ICONS: Record<string, React.ElementType> = {
  Orchestrator: Brain,
  Context: SearchIcon,
  Data: DatabaseIcon,
  Reasoning: Zap,
  Action: Navigation,
};

function SearchIcon(props: any) {
  return <span {...props}>🔍</span>;
}
function DatabaseIcon(props: any) {
  return <span {...props}>💾</span>;
}

const AGENT_COLORS: Record<string, string> = {
  Orchestrator: "text-purple-500",
  Context: "text-blue-500",
  Data: "text-green-500",
  Reasoning: "text-orange-500",
  Action: "text-pink-500",
};

interface VenueChatCardProps {
  venue: Venue;
  isFavorited: boolean;
  onGetDirections: (venue: Venue) => void;
  onToggleFavorite: (venue: Venue) => void;
  onRate: (venue: Venue) => void;
  onOpenDetails: (venue: Venue) => void;
  onBook: (venue: Venue) => void;
  viewMode?: "card" | "list";
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  "data-index"?: number;
  isSelected?: boolean;
  compareDisabled?: boolean;
  onToggleCompare?: (venue: Venue) => void;
  isRecommended?: boolean;
  clusterScore?: number;
  cluster?: number;
}

export function VenueChatCard({
  venue,
  isFavorited,
  onGetDirections,
  onToggleFavorite,
  onRate,
  onOpenDetails,
  onBook,
  viewMode = "card",
  tabIndex,
  onKeyDown,
  "data-index": dataIndex,
  isSelected,
  compareDisabled,
  onToggleCompare,
  isRecommended,
  clusterScore,
  cluster,
}: VenueChatCardProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [enableTransition, setEnableTransition] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({
      name: venue.name,
      lat: String(venue.lat),
      lng: String(venue.lng),
    });

    setPhotoLoading(true);
    fetch(`/api/venues/${encodeURIComponent(venue.id)}
    </div>
  );
}/photo?${params}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load venue photo");
        }
        setPhotoUrl(response.url);
      })
      .catch(() => {
        setPhotoUrl(null);
      })
      .finally(() => {
        setPhotoLoading(false);
      });
  }, [venue.id, venue.name, venue.lat, venue.lng]);

  useEffect(() => {
    const timer = setTimeout(() => setEnableTransition(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const CategoryIcon =
    venue.category === "cafe"
      ? Coffee
      : venue.category === "library"
        ? BookOpen
        : venue.category === "coworking_space"
          ? Building2
          : MapPin;

  const iconColor =
    venue.category === "cafe"
      ? "text-amber-600"
      : venue.category === "library"
        ? "text-blue-600"
        : venue.category === "coworking_space"
          ? "text-purple-600"
          : "text-zinc-600";

  const venueFallbacks: Record<string, string> = {
    cafe: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=800",
    library:
      "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=800",
    coworking_space:
      "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&q=80&w=800",
    default:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=800",
  };

  const displayPhoto =
    photoUrl || venueFallbacks[venue.category] || venueFallbacks.default;

  if (viewMode === "list") {
    return (
      <>
        <div
          onClick={() => onOpenDetails(venue)}
          tabIndex={tabIndex}
          onKeyDown={onKeyDown}
          data-index={dataIndex}
          className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 bg-white dark:bg-zinc-900 hover:shadow-md hover:scale-[1.01] transition-all cursor-pointer shadow-sm my-1 active:scale-[0.99] flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          {photoLoading ? (
            <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-lg shrink-0" />
          ) : (
            <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayPhoto}
                alt={venue.name}
                className="w-full h-full object-cover"
                style={{
                  viewTransitionName: getVenueCoverTransitionName(venue.id),
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = venueFallbacks.default;
                }}
              />
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <CategoryIcon className={`w-3.5 h-3.5 ${iconColor} shrink-0`} />
                <h4 className="font-bold text-xs text-zinc-900 dark:text-zinc-50 truncate uppercase tracking-tight">
                  {venue.name}
                </h4>
                {isRecommended && <RecommendedBadge />}
                {clusterScore != null && clusterScore > 0.75 && (
                  <ClusterBadge cluster={cluster} score={clusterScore} />
                )}
                {venue.score != null && (
                  <span className="text-[10px] font-black text-blue-600 bg-blue-50 dark:bg-blue-950/30 px-1 py-0.5 rounded">
                    {Math.round(venue.score * 10)}%
                  </span>
                )}
              </div>
              {venue.address && (
                <p className="text-[10px] text-zinc-500 font-medium truncate">
                  {venue.address}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {venue.openingHours &&
                (() => {
                  const status = getVenueHoursStatus(venue.openingHours);
                  if (!status.isAvailable || !status.badgeText) return null;
                  const isOpen = status.isOpen || status.is24Hours;
                  return (
                    <div
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                        isOpen
                          ? "bg-green-500/10 border-green-500/20 text-green-600"
                          : "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                      }`}
                      title={status.badgeText}
                    >
                      <Clock
                        className={`w-3 h-3 ${isOpen ? "text-green-600" : "text-amber-600"}`}
                      />
                      <span className="text-[9px] font-bold uppercase">
                        {status.badgeText}
                      </span>
                    </div>
                  );
                })()}
              {venue.wifi && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20">
                  <Wifi className="w-3 h-3 text-green-600" />
                  <span className="text-[9px] font-bold text-green-600 uppercase">
                    WiFi
                  </span>
                </div>
              )}
              {venue.hasOutlets && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/20">
                  <Zap className="w-3 h-3 text-yellow-600" />
                  <span className="text-[9px] font-bold text-yellow-600 uppercase">
                    Power
                  </span>
                </div>
              )}
              {venue.noiseLevel === "quiet" && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  <Volume2 className="w-3 h-3 text-blue-600" />
                  <span className="text-[9px] font-bold text-blue-600 uppercase">
                    Quiet
                  </span>
                </div>
              )}
              {venue.hasAncHeadsetRental && (
                <div
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20"
                  title="Active noise-cancelling headsets available for rent"
                >
                  <Headphones className="w-3 h-3 text-violet-600" />
                  <span className="text-[9px] font-bold text-violet-600 uppercase">
                    ANC Rental
                  </span>
                </div>
              )}
            </div>
          </div>

          <div
            className="flex items-center gap-1.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {onToggleCompare && (
              <label
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
                  !isSelected && compareDisabled
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer"
                } ${
                  isSelected
                    ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400"
                    : "bg-zinc-100 border-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleCompare(venue)}
                  disabled={!isSelected && compareDisabled}
                  className="w-3.5 h-3.5 rounded accent-text disabled:opacity-50"
                />
                <span className="text-[10px] font-black uppercase tracking-tighter hidden sm:inline">
                  Compare
                </span>
              </label>
            )}

            <button
              onClick={() => onBook(venue)}
              className="joyride-booking p-1.5 rounded-lg bg-[var(--primary-accent)] text-white hover:opacity-90 transition-all active:scale-[0.95]"
              title="Book Now"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
            </button>
            <button
              onClick={() => onToggleFavorite(venue)}
              aria-label={
                isFavorited ? "Remove from favorites" : "Save to favorites"
              }
              className={`p-1.5 rounded-lg border active:scale-[0.95] ${
                enableTransition ? "transition-all duration-300" : ""
              } ${
                isFavorited
                  ? "bg-red-500 text-white border-red-500"
                  : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-200"
              }`}
              title="Save favorite"
            >
              <Heart
                className={`w-3.5 h-3.5 ${
                  enableTransition ? "transition-all duration-300" : ""
                } ${isFavorited ? "fill-current" : ""}`}
              />
            </button>
          </div>
        </div>
        {showFolderModal && venue && (
          <AddToFolderModal
            venue={venue}
            onClose={() => setShowFolderModal(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        onClick={() => onOpenDetails(venue)}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
        data-index={dataIndex}
        className="relative border-2 border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 hover:shadow-2xl hover:scale-[1.02] transition-all cursor-pointer shadow-lg my-2 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        {photoLoading ? (
          <div className="w-full h-44 bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        ) : (
          <div className="relative w-full h-44 overflow-hidden group/photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayPhoto}
              alt={venue.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover/photo:scale-110"
              style={{
                viewTransitionName: getVenueCoverTransitionName(venue.id),
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = venueFallbacks.default;
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

            <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-black px-2 py-1 rounded-md bg-zinc-950 border border-zinc-700 text-white">
              <CategoryIcon className="w-3 h-3" />
              {venue.category?.replace("_", " ")}
            </span>

            {onToggleCompare && (
              <div
                className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-white/90 dark:bg-black/80 px-2.5 py-1.5 rounded-lg shadow-md backdrop-blur-md cursor-pointer"
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
                  className="w-4 h-4 accent-text rounded border-zinc-300 focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] disabled:opacity-50 pointer-events-none"
                />
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 select-none uppercase tracking-tight pointer-events-none">
                  Compare
                </span>
              </div>
            )}

            {venue.score != null && (
              <div className="absolute top-3 right-3 flex flex-col items-center justify-center h-12 w-12 rounded-full bg-[var(--primary-accent)] text-white border-2 border-[color-mix(in_srgb,var(--primary-accent),white_0.4)] shadow-2xl z-10">
                <span className="text-[10px] font-black leading-none uppercase">
                  Vibe
                </span>
                <span className="text-sm font-black leading-none">
                  {Math.round(venue.score * 10)}%
                </span>
              </div>
            )}
          </div>
        )}

        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex-shrink-0">
              <CategoryIcon className={`w-5 h-5 ${iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <h4 className="font-black text-sm text-zinc-900 dark:text-zinc-50 truncate uppercase tracking-tight">
                  {venue.name}
                </h4>
                {isRecommended && <RecommendedBadge />}
                {clusterScore != null && clusterScore > 0.75 && (
                  <ClusterBadge cluster={cluster} score={clusterScore} />
                )}
              </div>

              {venue.address && (
                <p className="text-[11px] text-zinc-500 font-medium truncate mb-2">
                  {venue.address}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-2">
                {venue.openingHours &&
                  (() => {
                    const status = getVenueHoursStatus(venue.openingHours);
                    if (!status.isAvailable || !status.badgeText) return null;
                    const isOpen = status.isOpen || status.is24Hours;
                    return (
                      <div
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${
                          isOpen
                            ? "bg-green-500/10 border-green-500/20 text-green-600"
                            : "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                        }`}
                        title={status.badgeText}
                      >
                        <Clock
                          className={`w-3 h-3 ${isOpen ? "text-green-600" : "text-amber-600"}`}
                        />
                        <span className="text-[10px] font-bold uppercase">
                          {status.badgeText}
                        </span>
                      </div>
                    );
                  })()}
                {venue.wifi && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-500/10 border border-green-500/20">
                    <Wifi className="w-3 h-3 text-green-600" />
                    <span className="text-[10px] font-bold text-green-600 uppercase">
                      WiFi
                    </span>
                  </div>
                )}
                {venue.hasOutlets && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                    <Zap className="w-3 h-3 text-yellow-600" />
                    <span className="text-[10px] font-bold text-yellow-600 uppercase">
                      Power
                    </span>
                  </div>
                )}
                {venue.noiseLevel === "quiet" && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20">
                    <Volume2 className="w-3 h-3 text-blue-600" />
                    <span className="text-[10px] font-bold text-blue-600 uppercase">
                      Quiet
                    </span>
                  </div>
                )}
                {venue.hasAncHeadsetRental && (
                  <div
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20"
                    title="Active noise-cancelling headsets available for rent"
                  >
                    <Headphones className="w-3 h-3 text-violet-600" />
                    <span className="text-[10px] font-bold text-violet-600 uppercase">
                      ANC Rental
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      trackVenueInteraction("viewed", {
                        id: venue.id,
                        name: venue.name,
                        category: venue.category,
                      });
                      onOpenDetails(venue);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-950 hover:bg-zinc-800 transition-all font-black text-xs shadow-lg uppercase tracking-tight active:scale-[0.98]"
                  >
                    <Info className="w-3.5 h-3.5" />
                    Details
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onBook(venue);
                    }}
                    className="joyride-booking flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--primary-accent)] text-white hover:opacity-90 transition-all font-black text-xs shadow-lg uppercase tracking-tight active:scale-[0.98]"
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    Book Now
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      trackVenueInteraction("directions", {
                        id: venue.id,
                        name: venue.name,
                        category: venue.category,
                      });
                      onGetDirections(venue);
                    }}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] uppercase font-black tracking-tighter rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                  >
                    <Navigation className="w-3 h-3" />
                    Navigate
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      trackVenueInteraction(
                        isFavorited ? "unfavorited" : "favorited",
                        {
                          id: venue.id,
                          name: venue.name,
                          category: venue.category,
                        },
                      );
                      onToggleFavorite(venue);
                    }}
                    aria-label={
                      isFavorited
                        ? "Remove from favorites"
                        : "Save to favorites"
                    }
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] uppercase font-black tracking-tighter rounded-lg ${
                      enableTransition ? "transition-all duration-300" : ""
                    } ${
                      isFavorited
                        ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                        : "bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    <Heart
                      className={`w-3 h-3 ${
                        enableTransition ? "transition-all duration-300" : ""
                      } ${isFavorited ? "fill-current" : ""}`}
                    />
                    {isFavorited ? "Saved" : "Save"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRate(venue);
                    }}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] uppercase font-black tracking-tighter rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                  >
                    <Star className="w-3 h-3" />
                    Rate
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFolderModal(true);
                    }}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] uppercase font-black tracking-tighter rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                    title="Add to Collection"
                  >
                    <FolderPlus className="w-3 h-3" />
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showFolderModal && venue && (
        <AddToFolderModal
          venue={venue}
          onClose={() => setShowFolderModal(false)}
        />
      )}
    </>
  );
}

// ─── VenueListings ─────────────────────────────────────────────────────────────

interface VenueListingsProps {
  venues: Venue[];
  favorites: Set<string>;
  onGetDirections: (venue: Venue) => void;
  onToggleFavorite: (venue: Venue) => void;
  onRateVenue: (venue: Venue) => void;
  onOpenDetails: (venue: Venue) => void;
  onBook: (venue: Venue) => void;
  onLoadMore?: () => Promise<void>;
  onRefresh?: () => Promise<void>;
}

export function VenueListings({
  venues,
  favorites,
  onGetDirections,
  onToggleFavorite,
  onRateVenue,
  onOpenDetails,
  onBook,
  onLoadMore,
  onRefresh,
}: VenueListingsProps) {
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const PULL_THRESHOLD = 70;
  const MAX_PULL_DISTANCE = 100;
  const [selectedVenues, setSelectedVenues] = useState<Venue[]>([]);

  // Apply preference reranking
  const { rerankedResults } = usePreferenceReranking(venues);

  // Federated K-Means clustering for personalized ranking
  const { favorites: savedFavorites } = useSavedVenues();
  const savedVenueLike = savedFavorites.map((f) => ({
    id: f.venueId,
    venueId: f.venueId,
    venue: {
      id: f.venue.id,
      rating: f.venue.rating,
      wifiQuality: f.venue.wifiQuality,
      hasOutlets: f.venue.hasOutlets,
      noiseLevel: f.venue.noiseLevel,
    },
  }));
  const {
    centroids,
    rankVenues: kmeansRank,
    isReady: kmeansReady,
  } = useKMeansClustering(savedVenueLike);

  // Cluster-ranked venues state
  const [clusterRanked, setClusterRanked] = useState<
    Array<Venue & { clusterScore: number; cluster: number }>
  >([]);

  useEffect(() => {
    if (!kmeansReady || !centroids || venues.length === 0) {
      setClusterRanked([]);
      return;
    }
    let cancelled = false;
    kmeansRank(venues).then((ranked) => {
      if (!cancelled) setClusterRanked(ranked);
    });
    return () => {
      cancelled = true;
    };
  }, [venues, centroids, kmeansReady, kmeansRank]);

  // Blend k-means cluster scores with preference reranking
  const blendedResults = useMemo(() => {
    if (clusterRanked.length === 0) return rerankedResults;

    const clusterMap = new Map(
      clusterRanked.map((v) => [
        v.id,
        { clusterScore: v.clusterScore, cluster: v.cluster },
      ]),
    );

    return rerankedResults.map((venue) => {
      const clusterData = clusterMap.get(venue.id);
      if (!clusterData) return venue;

      const prefScore = (venue as any).similarityScore ?? 0;
      const blend = prefScore * 0.6 + clusterData.clusterScore * 0.4;

      return {
        ...venue,
        score: (venue.score ?? 5) + blend * 2,
        isRecommended: venue.isRecommended || clusterData.clusterScore > 0.75,
        _clusterScore: clusterData.clusterScore,
        _cluster: clusterData.cluster,
      };
    });
  }, [rerankedResults, clusterRanked]);

  // INFINITE SCROLL STATES
  const [visibleCount, setVisibleCount] = useState(5);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);

  // FIX 1: Reset pagination state when a new search result set arrives
  useEffect(() => {
    setVisibleCount(5);
    setIsFetchingNextPage(false);
  }, [venues]);

  // FIX 2 & 3: Clean up timer and support explicit pagination callback
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) {
          // If we have more venues locally, mock the pagination load
          if (visibleCount < blendedResults.length) {
            setIsFetchingNextPage(true);
            timeoutId = setTimeout(() => {
              setVisibleCount((prev) =>
                Math.min(prev + 5, blendedResults.length),
              );
              setIsFetchingNextPage(false);
            }, 800);
          }
          // If we hit the end of the local array and have an API callback, fetch real data
          else if (onLoadMore) {
            setIsFetchingNextPage(true);
            onLoadMore().finally(() => setIsFetchingNextPage(false));
          }
        }
      },
      { threshold: 0.1 },
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      observer.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    visibleCount,
    venues.length,
    blendedResults.length,
    isFetchingNextPage,
    onLoadMore,
  ]);

  const handleToggleCompare = (venue: Venue) => {
    setSelectedVenues((prev) => {
      const isSelected = prev.some((v) => v.id === venue.id);
      if (isSelected) {
        return prev.filter((v) => v.id !== venue.id);
      } else if (prev.length < 3) {
        return [...prev, venue];
      }
      return prev;
    });
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    index: number,
    venue: Venue,
  ) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = Math.min(index + 1, blendedResults.length - 1);
      const nextEl = containerRef.current?.querySelector(
        `[data-index="${nextIndex}"]`,
      ) as HTMLElement;
      nextEl?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = Math.max(index - 1, 0);
      const prevEl = containerRef.current?.querySelector(
        `[data-index="${prevIndex}"]`,
      ) as HTMLElement;
      prevEl?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onOpenDetails(venue);
    }
  };
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!onRefresh || isRefreshing) return;

    const scrollContainer = containerRef.current?.closest(
      ".overflow-y-auto",
    ) as HTMLElement | null;

    if (scrollContainer?.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartY.current === null || isRefreshing) return;

    const distance = e.touches[0].clientY - touchStartY.current;

    if (distance > 0) {
      setPullDistance(Math.min(distance * 0.5, MAX_PULL_DISTANCE));
    }
  };

  const handleTouchEnd = async () => {
    if (touchStartY.current === null) return;

    const shouldRefresh = pullDistance >= PULL_THRESHOLD;

    touchStartY.current = null;
    setPullDistance(0);

    if (!shouldRefresh || !onRefresh || isRefreshing) return;

    setIsRefreshing(true);

    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };
  return (
    <div
      className="space-y-3 pl-2"
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <RecentlyViewedVenues />
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-all duration-200"
          style={{
            height: isRefreshing ? 40 : Math.min(pullDistance, 40),
          }}
          aria-live="polite"
        >
          {isRefreshing ? (
            <Loader2
              className="h-5 w-5 animate-spin text-zinc-500"
              aria-label="Refreshing venues"
            />
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {pullDistance >= PULL_THRESHOLD
                ? "Release to refresh"
                : "Pull to refresh"}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-1">
        <p className="text-[10px] uppercase font-black tracking-widest text-zinc-400">
          Recommended Venues ({blendedResults.length})
        </p>
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-inner">
          <button
            onClick={() => setViewMode("card")}
            className={`p-1 rounded-md transition-all active:scale-90 ${
              viewMode === "card"
                ? "bg-white dark:bg-zinc-800 accent-text dark:text-[color-mix(in_srgb,var(--primary-accent),transparent_0.2)] shadow-sm"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
            title="Card View"
            aria-label="View as rich cards"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1 rounded-md transition-all active:scale-90 ${
              viewMode === "list"
                ? "bg-white dark:bg-zinc-800 accent-text dark:text-[color-mix(in_srgb,var(--primary-accent),transparent_0.2)] shadow-sm"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
            title="List View"
            aria-label="View as compact list"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {blendedResults.length === 0 ? (
        <EmptyState
          illustration="search"
          message="No venues found"
          description="Try broadening your search criteria or adjusting your chat request."
        />
      ) : (
        <LayoutGroup id="venue-listings">
          <VenueGrid viewMode={viewMode}>
            {blendedResults.slice(0, visibleCount).map((venue, index) => (
              <SubgridCell key={venue.id}>
                {/* 
                  Measurement Container Pattern for Issue #1037:
                  LayoutBoundary (parent) is position: relative, preserving layout measurements during grid/subgrid resize.
                  motion.div layoutId wrapper is positioned relative within the boundary so layout transitions stay stable
                  when drawers open/close or column counts change.
                */}
                <LayoutBoundary>
                  <motion.div
                    layout
                    layoutId={`venue-card-${venue.id}`}
                    className="w-full min-w-0 [transform:translate3d(0,0,0)]"
                    transition={{
                      layout: { type: "spring", stiffness: 350, damping: 30 },
                    }}
                  >
                    <VenueChatCard
                      venue={venue}
                      isRecommended={(venue as any).isRecommended}
                      clusterScore={(venue as any)._clusterScore}
                      cluster={(venue as any)._cluster}
                      isFavorited={favorites.has(venue.id)}
                      onGetDirections={onGetDirections}
                      onToggleFavorite={onToggleFavorite}
                      onRate={onRateVenue}
                      onOpenDetails={onOpenDetails}
                      onBook={onBook}
                      viewMode={viewMode}
                      tabIndex={0}
                      data-index={index}
                      onKeyDown={(e) => handleKeyDown(e, index, venue)}
                      isSelected={selectedVenues.some((v) => v.id === venue.id)}
                      compareDisabled={selectedVenues.length >= 3}
                      onToggleCompare={handleToggleCompare}
                    />
                  </motion.div>
                </LayoutBoundary>
              </SubgridCell>
            ))}

            {/* Infinite Scroll Sentinel */}
            {(visibleCount < venues.length || onLoadMore) && (
              <div ref={observerTarget} className="py-4 flex justify-center">
                {isFetchingNextPage && (
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                )}
              </div>
            )}
          </VenueGrid>
        </LayoutGroup>
      )}

      {/* Comparison Drawer Integration */}
      <ComparisonDrawer
        selectedVenues={selectedVenues as any}
        onRemoveVenue={(id) =>
          setSelectedVenues((prev) => prev.filter((v) => v.id !== id))
        }
      />
    </div>
  );
}

// ─── MessageList ──────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  expandedSteps: Record<string, boolean>;
  favorites: Set<string>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onToggleSteps: (id: string) => void;
  onGetDirections: (venue: Venue) => void;
  onToggleFavorite: (venue: Venue) => void;
  onRateVenue: (venue: Venue) => void;
  onOpenDetails: (venue: Venue) => void;
  onBook: (venue: Venue) => void;
  onSuggestionClick: (s: string) => void;
  initialSuggestions: string[];
  onRefreshVenues?: () => Promise<void>;
}

export function MessageList({
  messages,
  isLoading,
  error,
  expandedSteps,
  favorites,
  messagesEndRef,
  onToggleSteps,
  onGetDirections,
  onToggleFavorite,
  onRateVenue,
  onOpenDetails,
  onBook,
  onSuggestionClick,
  initialSuggestions,
  onRefreshVenues,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { speakingMessageId, speakingSentenceIndex } = useSpeechSynthesis();

  // Deduplicate incoming messages to prevent rendering duplicate bubbles on rapid WebRTC reconnect (#10014)
  const displayMessages = useMemo(
    () => deduplicateChatMessages(messages),
    [messages],
  );

  const prevMessageCountRef = useRef(displayMessages.length);
  const isNearBottomRef = useRef(true);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const _checkIsNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= 100;
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= 100;
    isNearBottomRef.current = nearBottom;

    if (nearBottom) {
      setHasNewMessagesBelow(false);
      setShowScrollToLatest(false);
    } else {
      setShowScrollToLatest(true);
    }
  }, []);

  const handleScrollToLatest = useCallback(() => {
    setHasNewMessagesBelow(false);
    setShowScrollToLatest(false);
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView?.({ behavior: "smooth" });
    } else if (containerRef.current) {
      containerRef.current.scrollTo?.({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messagesEndRef]);

  // Handle messages changes and auto-scroll logic
  useEffect(() => {
    const container = containerRef.current;
    const isNewMessage = displayMessages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = displayMessages.length;

    if (!container) return;

    if (isNearBottomRef.current || isLoading) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
      setHasNewMessagesBelow(false);
      setShowScrollToLatest(false);
    } else if (isNewMessage) {
      // User is scrolled up and a new message arrived
      setHasNewMessagesBelow(true);
      setShowScrollToLatest(true);
    }
  }, [displayMessages, isLoading]);

  // Also re-check whenever the container's own size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const resizeObserver = new ResizeObserver(() => {
      if (isNearBottomRef.current || isLoading) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isLoading]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
        style={{ scrollbarGutter: "stable" }}
      >
        {displayMessages.length === 0 && (
          <div className="text-center py-8">
            <Brain className="w-12 h-12 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
            <p className="text-zinc-900 dark:text-white font-bold mb-4 uppercase text-xs tracking-widest">
              How can I help you find a workspace today?
            </p>
            <div className="grid grid-cols-1 gap-2">
              {initialSuggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onSuggestionClick(s)}
                  disabled={isLoading}
                  className="text-left cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-tighter rounded-xl border-2 border-zinc-200 dark:border-zinc-800 hover:bg-[var(--primary-accent)] hover:text-white transition-all shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {displayMessages.map((message) => (
          <div
            key={message.id}
            data-testid={`chat-message-${message.id}`}
            className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            {message.role === "assistant" &&
            message.content.trim().length === 0 ? (
              <ChatMessageSkeleton />
            ) : (
              <div
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`group relative max-w-[90%] rounded-2xl px-5 py-3 shadow-md border-2 ${
                    message.role === "user"
                      ? "bg-zinc-950 border-zinc-800 text-white rounded-tr-none"
                      : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 border-zinc-100 dark:border-zinc-700 rounded-tl-none"
                  }`}
                >
                  {message.role === "assistant" && (
                    <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <ReadAloudButton text={message.content} />
                      <CopyMessageButton text={message.content} />
                    </div>
                  )}
                  <div
                    className={`text-sm font-medium leading-relaxed ${message.role === "assistant" ? "pr-12" : ""}`}
                  >
                    {message.role === "assistant" ? (
                      <div className="relative">
                        <MessageRenderer
                          content={message.content}
                          speakingSentenceIndex={
                            speakingMessageId === message.id
                              ? speakingSentenceIndex
                              : null
                          }
                        />
                        {message.isStreaming && (
                          <span className="inline-flex gap-0.5 items-center ml-1 accent-text dark:text-[color-mix(in_srgb,var(--primary-accent),transparent_0.2)] font-black animate-pulse">
                            <span>.</span>
                            <span>.</span>
                            <span>.</span>
                          </span>
                        )}
                      </div>
                    ) : (
                      <TranslatedMessage
                        messageId={message.id}
                        text={message.content}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {message.agentSteps && message.agentSteps.length > 0 && (
              <div className="ml-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => onToggleSteps(message.id)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-widest font-black text-zinc-500 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all hover:scale-105"
                  >
                    <TerminalIcon className="w-3 h-3" />
                    <span>Agent Reasoning Details</span>
                    {expandedSteps[message.id] ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                  {message.cached && (
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
                      ⚡ Cached
                    </span>
                  )}
                  {message.complexity === "simple" && !message.cached && (
                    <span className="flex items-center gap-1 px-2 py-1 rounded accent-bg-10 accent-text accent-bg-dark-20 dark:text-[color-mix(in_srgb,var(--primary-accent),transparent_0.2)] text-[10px] font-bold uppercase tracking-wider">
                      ⚡ Simple Routing
                    </span>
                  )}
                </div>

                {expandedSteps[message.id] && (
                  <div className="mt-3 space-y-2 ml-4">
                    {message.agentSteps.map((step, idx) => {
                      const Icon = AGENT_ICONS[step.agent] || Brain;
                      const color = AGENT_COLORS[step.agent] || "text-zinc-500";
                      const skipped = (step.result as any)?.skipped;

                      return (
                        <div
                          key={idx}
                          className={`rounded-xl p-3 text-xs border ${skipped ? "bg-zinc-900/50 border-zinc-800/50 opacity-50" : "bg-zinc-950 border-zinc-800"}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div
                              className={`flex items-center gap-2 font-black uppercase tracking-widest text-[10px] ${color}`}
                            >
                              {(() => {
                                const AnyIcon = Icon as any;
                                return <AnyIcon className="w-3 h-3" />;
                              })()}
                              <span>
                                {step.agent} {skipped && "(Skipped)"}
                              </span>
                            </div>
                            {step.latencyMs !== undefined && (
                              <span className="text-[10px] text-zinc-500 font-mono font-bold">
                                {step.latencyMs}ms
                              </span>
                            )}
                          </div>
                          <div className="text-zinc-400 font-mono text-[11px]">
                            {(() => {
                              const res = step.result as any;
                              if (res.reasoning) return String(res.reasoning);
                              if (res.reason) return String(res.reason);
                              if (step.agent === "Action")
                                return `Rendered ${res.markerCount || 0} map markers.`;
                              if (step.agent === "Context")
                                return res.skipped
                                  ? "Skipped."
                                  : `Extracted filters: ${JSON.stringify(res.parameters)}`;
                              if (step.agent === "Data")
                                return res.skipped
                                  ? "Skipped."
                                  : `Found ${res.venueCount || 0} venues.`;
                              return JSON.stringify(res).slice(0, 100);
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {message.venues && message.venues.length > 0 && (
              <VenueListings
                venues={message.venues}
                favorites={favorites}
                onGetDirections={onGetDirections}
                onToggleFavorite={onToggleFavorite}
                onRateVenue={onRateVenue}
                onOpenDetails={onOpenDetails}
                onBook={onBook}
                onRefresh={onRefreshVenues}
              />
            )}
          </div>
        ))}

        {isLoading && (
          <div className="space-y-6 pt-4">
            <BrainTerminal />
          </div>
        )}

        {error && (
          <div className="bg-red-950 border-2 border-red-800 rounded-xl px-4 py-3 text-xs font-bold text-red-100">
            SYSTEM ERROR: {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showScrollToLatest && displayMessages.length > 0 && (
        <button
          type="button"
          onClick={handleScrollToLatest}
          aria-label={
            hasNewMessagesBelow
              ? "New messages below"
              : "Scroll to latest message"
          }
          title={
            hasNewMessagesBelow ? "New messages below" : "Scroll to latest"
          }
          className={`absolute bottom-3 z-10 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-zinc-400 ${
            hasNewMessagesBelow
              ? "left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg text-xs font-bold flex items-center gap-1.5 animate-bounce"
              : "right-4 p-2 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 shadow-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          {hasNewMessagesBelow ? (
            <>
              <span>New messages below</span>
              <span aria-hidden="true">↓</span>
            </>
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}

function TerminalIcon(props: any) {
  return <span {...props}>💻</span>;
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      title="Copy message"
      aria-label="Copy message"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// ─── ChatInput ────────────────────────────────────────────────────────────────

export { ChatInput, type ChatInputProps } from "./ChatInput";
