"use client";

import React from "react";
import {
  AlertTriangle,
  Bookmark,
  Loader2,
  X,
  BadgeCheck,
  MapPin,
  Sparkles,
  Languages,
  Building2,
  Navigation,
  Heart,
  Star,
  Check,
  Share,
  Coffee,
  BookOpen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVenueCoverTransitionName } from "@/lib/viewTransitions";
import { CopyToClipboardButton } from "@/components/ui/CopyToClipboardButton";
import { ReviewSentimentBadge } from "@/components/venue/ReviewSentimentBadge";
import type { Venue } from "../ChatMessages";
import type { VoteMetricState } from "./useVenueAmenityVotes";

export interface VenueHeaderSectionProps {
  venue: Venue;
  currentScore: number | null;
  displayPhoto: string;
  photoLoading: boolean;
  setImageError: (error: boolean) => void;
  sentiment: any;
  activeTab: "overview" | "reviews" | "menu";
  setActiveTab: (tab: "overview" | "reviews" | "menu") => void;
  onClose: () => void;
  onOpenLightbox: (index?: number) => void;
  voteMetrics: Record<string, VoteMetricState>;
  isLibrary: boolean;
  quickSaveLoading: boolean;
  onQuickSave: () => void;
  selectedVenueLang: string;
  onSelectVenueLang: (lang: string) => void;
  isTranslatingDesc: boolean;
  descTranslationError: string | null;
  translatedDescription: string;
  onGetDirections: (venue: Venue) => void;
  onToggleFavorite: (venue: Venue) => void;
  isFavorited: boolean;
  enableTransition: boolean;
  onRate?: (venue: Venue) => void;
  showFlagMenu: boolean;
  setShowFlagMenu: React.Dispatch<React.SetStateAction<boolean>>;
  flagSubmitting: boolean;
  flagSubmitted: boolean;
  onSubmitFlag: (reason: string) => void;
  copied: boolean;
  onShare: () => void;
}

export function VenueHeaderSection({
  venue,
  currentScore,
  displayPhoto,
  photoLoading,
  setImageError,
  sentiment,
  activeTab,
  setActiveTab,
  onClose,
  onOpenLightbox,
  voteMetrics,
  isLibrary,
  quickSaveLoading,
  onQuickSave,
  selectedVenueLang,
  onSelectVenueLang,
  isTranslatingDesc,
  descTranslationError,
  translatedDescription,
  onGetDirections,
  onToggleFavorite,
  isFavorited,
  enableTransition,
  onRate,
  showFlagMenu,
  setShowFlagMenu,
  flagSubmitting,
  flagSubmitted,
  onSubmitFlag,
  copied,
  onShare,
}: VenueHeaderSectionProps) {
  const { t } = useTranslation();

  const CategoryIcon =
    venue.category === "cafe"
      ? Coffee
      : venue.category === "library"
        ? BookOpen
        : Building2;

  const wifiLowConfidence = voteMetrics.wifi?.hidden;
  const outletsLowConfidence = venue.hasOutlets && voteMetrics.outlets?.hidden;
  const silentRoomLowConfidence = isLibrary && voteMetrics.silentRoom?.hidden;
  const studyTableLowConfidence = isLibrary && voteMetrics.studyTable?.hidden;
  const scannerLowConfidence = isLibrary && voteMetrics.scanner?.hidden;

  return (
    <>
      {/* Community Warnings */}
      {wifiLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report WiFi might not be available or is
            broken.
          </span>
        </div>
      )}
      {outletsLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report Power Outlets might be unavailable.
          </span>
        </div>
      )}
      {silentRoomLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report Strict Silent Rooms might be
            unavailable.
          </span>
        </div>
      )}
      {studyTableLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report Bookable Study Tables might be
            unavailable.
          </span>
        </div>
      )}
      {scannerLowConfidence && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report Scanners/Printers might be
            unavailable.
          </span>
        </div>
      )}

      {/* Cover Media Header */}
      <div className="relative h-64 sm:h-80 w-full overflow-hidden shrink-0">
        {photoLoading ? (
          <div className="w-full h-full bg-black/40 animate-pulse" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayPhoto}
            alt={"Photo of " + venue.name}
            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-all duration-500"
            style={{
              viewTransitionName: getVenueCoverTransitionName(venue.id),
            }}
            onClick={() => onOpenLightbox(0)}
            onError={() => setImageError(true)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent pointer-events-none" />

        <div className="absolute top-4 right-4 flex gap-2">
          <button
            onClick={onQuickSave}
            disabled={quickSaveLoading}
            className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-full shadow-2xl border border-white/20 transition-all font-bold active:scale-90 flex items-center justify-center disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent)] focus:ring-offset-2"
            title="Quick Save"
            aria-label="Quick Save"
          >
            {quickSaveLoading ? (
              <Loader2 className="w-6 h-6 animate-spin accent-text" />
            ) : (
              <Bookmark className="w-6 h-6 accent-text" />
            )}
          </button>
          <button
            onClick={onClose}
            aria-label="Close venue details"
            className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-full shadow-2xl border border-white/20 transition-all font-bold active:scale-90"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="absolute bottom-6 left-6 right-6 pointer-events-none">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase font-black accent-bg-80 backdrop-blur-md accent-border-50 text-white px-2.5 py-1 rounded shadow-lg pointer-events-auto">
              <CategoryIcon className="w-3.5 h-3.5" />
              {venue.category?.replace("_", " ")}
            </span>
            {currentScore != null && (
              <span className="text-[10px] tracking-widest uppercase font-black bg-white/20 backdrop-blur-md text-white border border-white/30 px-2.5 py-1 rounded shadow-lg pointer-events-auto">
                VIBE SCORE: {Math.round(currentScore * 10)}%
              </span>
            )}
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter leading-none mb-1 text-shadow-lg flex items-center gap-2">
            <span>{venue.name}</span>
            {venue.isClaimed && (
              <span
                title="Verified Host"
                className="inline-flex shrink-0 pointer-events-auto"
              >
                <BadgeCheck className="w-6 h-6 text-green-400 shrink-0" />
              </span>
            )}
          </h2>
          <ReviewSentimentBadge summary={sentiment} className="mb-2" />
          <div className="flex items-center gap-1.5 text-zinc-300 text-sm font-medium flex-wrap">
            <MapPin className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="truncate max-w-[280px] sm:max-w-md">
              {venue.address || "Location details loading..."}
            </span>
            {venue.address && (
              <CopyToClipboardButton
                textToCopy={venue.address}
                label="Copy"
                className="!py-0.5 !px-2 text-xs shrink-0 pointer-events-auto ml-1"
              />
            )}
            {typeof venue.lat === "number" && typeof venue.lng === "number" && (
              <CopyToClipboardButton
                textToCopy={`${venue.lat}, ${venue.lng}`}
                label="Copy Coordinates"
                toastMessage="Coordinates copied to clipboard"
                className="!py-0.5 !px-2 text-xs shrink-0 pointer-events-auto"
              />
            )}
          </div>
        </div>
      </div>

      {/* Tabs Header */}
      <div className="flex border-b border-white/10 bg-transparent px-8 py-3 gap-6 shrink-0">
        {[
          { id: "overview", label: "Overview" },
          { id: "reviews", label: t("venue.reviews") },
          { id: "menu", label: "Menus & Prices" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`pb-1 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
              activeTab === tab.id
                ? "accent-border accent-text"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}

export interface VenueHeaderOverviewCardsProps {
  venue: Venue;
  selectedVenueLang: string;
  onSelectVenueLang: (lang: string) => void;
  isTranslatingDesc: boolean;
  descTranslationError: string | null;
  translatedDescription: string;
}

export function VenueDescriptionAndHostCard({
  venue,
  selectedVenueLang,
  onSelectVenueLang,
  isTranslatingDesc,
  descTranslationError,
  translatedDescription,
}: VenueHeaderOverviewCardsProps) {
  return (
    <>
      {/* Multi-Language Venue Description Translator */}
      <div className="mb-6 p-5 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h3 className="font-semibold text-lg text-white">Venue Description</h3>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Languages className="w-4 h-4 text-zinc-400 shrink-0" />
            <select
              value={selectedVenueLang}
              onChange={(e) => onSelectVenueLang(e.target.value)}
              disabled={isTranslatingDesc}
              aria-label="Select venue description language"
              className="w-full sm:w-48 text-sm rounded-md border border-zinc-700 bg-zinc-900 text-zinc-200 px-3 py-1.5 shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            >
              {[
                { code: "EN", label: "English" },
                { code: "ES", label: "Spanish" },
                { code: "FR", label: "French" },
                { code: "DE", label: "German" },
                { code: "HI", label: "Hindi" },
                { code: "JA", label: "Japanese" },
                { code: "ZH", label: "Chinese (Simplified)" },
              ].map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.label}
                </option>
              ))}
            </select>
            {isTranslatingDesc && (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            )}
          </div>
        </div>

        <div className="relative min-h-[60px] text-zinc-300 leading-relaxed text-sm">
          {descTranslationError && (
            <p className="text-xs text-amber-400 mb-2 font-medium">
              {descTranslationError}
            </p>
          )}
          <p className="whitespace-pre-line">
            {translatedDescription ||
              venue.description ||
              `Analysis based on Multi-Agent telemetry suggests this ${venue.category || "workspace"} is optimal for collaborative sessions.`}
          </p>
        </div>
      </div>

      {/* Verified Host Pinned Message */}
      {venue.isClaimed && venue.hostMessage && (
        <div className="mb-6 p-5 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-2xl shadow-sm">
          <div className="flex items-center gap-2 mb-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
            <BadgeCheck className="w-4 h-4" />
            <span>Message from Host</span>
          </div>
          <p className="text-zinc-200 text-sm italic font-medium">
            &ldquo;{venue.hostMessage}&rdquo;
          </p>
        </div>
      )}

      {/* Unverified Claim Link */}
      {!venue.isClaimed && (
        <div className="mb-6 p-4 bg-zinc-800/40 border border-zinc-700/30 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-zinc-700/40 rounded-xl text-zinc-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-200">
                Are you the owner or manager?
              </p>
              <p className="text-[11px] text-zinc-400">
                Claim this listing to update hours, amenities, and verify details.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export interface VenueActionButtonsProps {
  venue: Venue;
  onGetDirections: (venue: Venue) => void;
  onToggleFavorite: (venue: Venue) => void;
  isFavorited: boolean;
  enableTransition: boolean;
  onRate?: (venue: Venue) => void;
  showFlagMenu: boolean;
  setShowFlagMenu: React.Dispatch<React.SetStateAction<boolean>>;
  flagSubmitting: boolean;
  flagSubmitted: boolean;
  onSubmitFlag: (reason: string) => void;
  copied: boolean;
  onShare: () => void;
}

export function VenueActionButtons({
  venue,
  onGetDirections,
  onToggleFavorite,
  isFavorited,
  enableTransition,
  onRate,
  showFlagMenu,
  setShowFlagMenu,
  flagSubmitting,
  flagSubmitted,
  onSubmitFlag,
  copied,
  onShare,
}: VenueActionButtonsProps) {
  return (
    <div className="flex flex-col gap-3 pt-6 border-t border-white/10 mt-6">
      <button
        onClick={() => onGetDirections(venue)}
        className="w-full flex items-center justify-center gap-2 bg-[var(--primary-accent)] hover:opacity-90 text-white font-black uppercase tracking-widest py-4 px-8 rounded-2xl transition-all shadow-xl shadow-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] active:scale-[0.98]"
      >
        <Navigation className="w-5 h-5" />
        Navigate
      </button>
      <div className="flex gap-3">
        <button
          onClick={() => onToggleFavorite(venue)}
          aria-label={
            isFavorited
              ? `Remove ${venue.name} from favorites`
              : `Save ${venue.name} to favorites`
          }
          className={`flex-1 flex items-center justify-center gap-2 font-black uppercase tracking-widest py-3 px-6 rounded-2xl border-2 ${
            enableTransition ? "transition-all duration-300" : ""
          } ${
            isFavorited
              ? "bg-red-500 border-red-400 text-white shadow-xl shadow-red-500/20"
              : "bg-black/40 border-white/10 text-zinc-200 hover:bg-black/60 shadow-md"
          }`}
        >
          <Heart
            className={`w-4 h-4 ${
              enableTransition ? "transition-all duration-300" : ""
            } ${isFavorited ? "fill-current" : ""}`}
          />
          {isFavorited ? "Saved" : "Save"}
        </button>
        {onRate && (
          <button
            onClick={() => onRate(venue)}
            className="flex-1 flex items-center justify-center gap-2 bg-black/40 border-2 border-white/10 text-zinc-200 hover:bg-black/60 font-black uppercase tracking-widest py-3 px-6 rounded-2xl transition-all shadow-md active:scale-[0.98]"
          >
            <Star className="w-4 h-4" />
            Rate
          </button>
        )}
        {/* Report Inaccurate Data */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowFlagMenu((v) => !v)}
            aria-label="Report inaccurate venue data"
            aria-haspopup="true"
            aria-expanded={showFlagMenu}
            className="flex items-center justify-center gap-1.5 bg-black/40 border-2 border-white/10 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 py-3 px-4 rounded-2xl transition-all shadow-md active:scale-[0.98]"
          >
            {flagSubmitted ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
          </button>
          {showFlagMenu && (
            <div className="absolute bottom-full mb-2 right-0 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-52 py-1 text-sm">
              {[
                { id: "permanently_closed", label: "Permanently Closed" },
                { id: "wrong_hours", label: "Wrong Hours" },
                { id: "no_wifi", label: "No Longer Has WiFi" },
                { id: "wrong_address", label: "Wrong Address" },
                { id: "other", label: "Other Issue" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSubmitFlag(id)}
                  disabled={flagSubmitting}
                  className="w-full text-left px-4 py-2 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onShare}
          aria-label={"Share " + venue.name}
          className="flex-1 flex items-center justify-center gap-2 bg-black/40 border-2 border-white/10 text-zinc-200 hover:bg-black/60 font-black uppercase tracking-widest py-3 px-6 rounded-2xl transition-all shadow-md active:scale-[0.98]"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Share className="w-4 h-4" />
              Share
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default VenueHeaderSection;
