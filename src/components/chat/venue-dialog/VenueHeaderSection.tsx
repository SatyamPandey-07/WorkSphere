"use client";

import React, { useEffect, useId, useState } from "react";
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
  currentScore?: number | null;
  airQuality?: AirQualityReading | null;
  displayPhoto?: string;
  photoLoading?: boolean;
  setImageError?: (error: boolean) => void;
  sentiment?: any;
  activeTab: "overview" | "reviews" | "menu" | "developer";
  setActiveTab: (tab: "overview" | "reviews" | "menu" | "developer") => void;
  onClose: () => void;
  onOpenLightbox?: (index?: number) => void;
  voteMetrics?: Record<string, VoteMetricState>;
  isLibrary?: boolean;
  quickSaveLoading?: boolean;
  onQuickSave: () => void;
  enableTransition?: boolean;
}

export interface AirQualityReading {
  co2: number;
  pm25: number;
  tvoc: number;
  timestamp: string;
}

interface AirQualityScore {
  overall: number;
  co2: number;
  pm25: number;
  tvoc: number;
  label: "Good" | "Moderate" | "Action Required";
  colorClass: string;
}

function calculatePm25Index(value: number): number {
  const breakpoints = [
    { cLow: 0, cHigh: 12, iLow: 0, iHigh: 50 },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
    { cLow: 250.5, cHigh: 500.4, iLow: 301, iHigh: 500 },
  ];
  const concentration = Math.floor(value * 10) / 10;

  for (const breakpoint of breakpoints) {
    if (concentration >= breakpoint.cLow && concentration <= breakpoint.cHigh) {
      return Math.round(
        ((breakpoint.iHigh - breakpoint.iLow) /
          (breakpoint.cHigh - breakpoint.cLow)) *
          (concentration - breakpoint.cLow) +
          breakpoint.iLow,
      );
    }
  }

  return concentration > 500.4 ? 500 : 0;
}

function calculateCo2Index(value: number): number {
  if (value < 800) return Math.round((value / 800) * 50);
  if (value < 1000) return Math.round(50 + ((value - 800) / 200) * 50);
  if (value < 1400) return Math.round(100 + ((value - 1000) / 400) * 50);
  return Math.round(150 + Math.min(150, ((value - 1400) / 600) * 150));
}

function calculateTvocIndex(value: number): number {
  if (value <= 220) return Math.round((value / 220) * 50);
  if (value <= 660) return Math.round(50 + ((value - 220) / 440) * 50);
  if (value <= 1660) return Math.round(100 + ((value - 660) / 1000) * 50);
  return Math.round(150 + Math.min(150, ((value - 1660) / 1000) * 150));
}

export function calculateIndoorAirQualityScore(
  reading: AirQualityReading,
): AirQualityScore {
  const co2 = calculateCo2Index(reading.co2);
  const pm25 = calculatePm25Index(reading.pm25);
  const tvoc = calculateTvocIndex(reading.tvoc);
  const overall = Math.max(co2, pm25, tvoc);

  return {
    overall,
    co2,
    pm25,
    tvoc,
    label:
      overall <= 50 ? "Good" : overall <= 100 ? "Moderate" : "Action Required",
    colorClass:
      overall <= 50
        ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100"
        : overall <= 100
          ? "border-yellow-400/50 bg-yellow-500/20 text-yellow-100"
          : overall <= 150
            ? "border-orange-400/50 bg-orange-500/20 text-orange-100"
            : "border-rose-400/50 bg-rose-500/20 text-rose-100",
  };
}

/**
 * Formats GPS coordinates as "DD.DDDD° N/S, DD.DDDD° E/W".
 * - Exactly 4 decimal places.
 * - Negative latitude is South ('S'), positive or zero is North ('N').
 * - Negative longitude is West ('W'), positive or zero is East ('E').
 * - Absolute numeric values to avoid negative-zero formatting.
 */
export function formatGpsCoordinates(lat: number, lng: number): string {
  const normalizedLat = lat === 0 ? 0 : lat;
  const normalizedLng = lng === 0 ? 0 : lng;
  const latDirection = normalizedLat >= 0 ? "N" : "S";
  const lngDirection = normalizedLng >= 0 ? "E" : "W";
  const formattedLat = Math.abs(normalizedLat).toFixed(4);
  const formattedLng = Math.abs(normalizedLng).toFixed(4);
  return `${formattedLat}° ${latDirection}, ${formattedLng}° ${lngDirection}`;
}

function AirQualityBadge({ reading }: { reading: AirQualityReading }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipId = useId();
  const score = calculateIndoorAirQualityScore(reading);

  return (
    <div
      className="relative pointer-events-auto"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        data-testid="air-quality-badge"
        aria-describedby={showTooltip ? tooltipId : undefined}
        aria-label={`Indoor air quality index ${score.overall}, ${score.label}`}
        onClick={() => setShowTooltip((visible) => !visible)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        className={`rounded border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest shadow-lg backdrop-blur-md ${score.colorClass}`}
      >
        AQI {score.overall} · {score.label}
      </button>
      {showTooltip && (
        <div
          id={tooltipId}
          role="tooltip"
          data-testid="air-quality-tooltip"
          className="absolute bottom-full left-0 z-20 mb-2 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-zinc-700 bg-zinc-950/95 p-3 text-xs text-zinc-100 shadow-xl"
        >
          <div className="font-semibold">Pollutant sub-indices</div>
          <ul className="mt-2 space-y-1 text-zinc-300">
            <li>
              CO₂: {score.co2} ({reading.co2} ppm)
            </li>
            <li>
              PM2.5: {score.pm25} ({reading.pm25} µg/m³)
            </li>
            <li>
              TVOC: {score.tvoc} ({reading.tvoc} ppb)
            </li>
          </ul>
          <p className="mt-2 break-all border-t border-zinc-800 pt-2 text-zinc-400">
            Sensor timestamp: {reading.timestamp}
          </p>
        </div>
      )}
    </div>
  );
}

export function VenueHeaderSection({
  venue,
  currentScore,
  airQuality = null,
  displayPhoto,
  photoLoading = false,
  setImageError,
  sentiment,
  activeTab,
  setActiveTab,
  onClose,
  onOpenLightbox,
  voteMetrics,
  isLibrary = false,
  quickSaveLoading = false,
  onQuickSave,
  enableTransition = false,
}: VenueHeaderSectionProps) {
  const { t } = useTranslation();

  const venueName = venue?.name || "Venue";

  const CategoryIcon =
    venue?.category === "cafe"
      ? Coffee
      : venue?.category === "library"
        ? BookOpen
        : Building2;

  const safeVoteMetrics = voteMetrics ?? {};
  const wifiLowConfidence = Boolean(safeVoteMetrics.wifi?.hidden);
  const outletsLowConfidence = Boolean(
    venue?.hasOutlets && safeVoteMetrics.outlets?.hidden,
  );
  const silentRoomLowConfidence = Boolean(
    isLibrary && safeVoteMetrics.silentRoom?.hidden,
  );
  const studyTableLowConfidence = Boolean(
    isLibrary && safeVoteMetrics.studyTable?.hidden,
  );
  const scannerLowConfidence = Boolean(
    isLibrary && safeVoteMetrics.scanner?.hidden,
  );

  const transitionName =
    enableTransition && venue?.id
      ? getVenueCoverTransitionName(venue.id)
      : undefined;

  const rawReviewsLabel = t ? t("venue.reviews") : "Reviews";
  const reviewsLabel =
    !rawReviewsLabel || rawReviewsLabel === "venue.reviews"
      ? "Reviews"
      : rawReviewsLabel;

  return (
    <>
      {/* Community Warnings */}
      {wifiLowConfidence && (
        <div
          data-testid="wifi-warning-banner"
          className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report WiFi might not be available or is
            broken.
          </span>
        </div>
      )}
      {outletsLowConfidence && (
        <div
          data-testid="outlets-warning-banner"
          className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report Power Outlets might be
            unavailable.
          </span>
        </div>
      )}
      {silentRoomLowConfidence && (
        <div
          data-testid="silent-room-warning-banner"
          className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report Strict Silent Rooms might be
            unavailable.
          </span>
        </div>
      )}
      {studyTableLowConfidence && (
        <div
          data-testid="study-table-warning-banner"
          className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            ⚠️ Community Warning: Users report Bookable Study Tables might be
            unavailable.
          </span>
        </div>
      )}
      {scannerLowConfidence && (
        <div
          data-testid="scanner-warning-banner"
          className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold"
        >
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
          <div
            data-testid="photo-loading-skeleton"
            className="w-full h-full bg-black/40 animate-pulse"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid="cover-photo-img"
            src={displayPhoto}
            alt={"Photo of " + venueName}
            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-all duration-500"
            style={
              transitionName
                ? { viewTransitionName: transitionName }
                : undefined
            }
            onClick={() => onOpenLightbox?.(0)}
            onError={() => setImageError?.(true)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent pointer-events-none" />

        <div className="absolute top-4 right-4 flex gap-2">
          <button
            type="button"
            data-testid="quick-save-btn"
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
            type="button"
            data-testid="close-venue-btn"
            onClick={onClose}
            aria-label="Close venue details"
            className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-full shadow-2xl border border-white/20 transition-all font-bold active:scale-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="absolute bottom-6 left-6 right-6 pointer-events-none">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase font-black accent-bg-80 backdrop-blur-md accent-border-50 text-white px-2.5 py-1 rounded shadow-lg pointer-events-auto">
              <CategoryIcon className="w-3.5 h-3.5" />
              {venue?.category?.replace("_", " ") || "Workspace"}
            </span>
            {currentScore != null && (
              <span className="text-[10px] tracking-widest uppercase font-black bg-white/20 backdrop-blur-md text-white border border-white/30 px-2.5 py-1 rounded shadow-lg pointer-events-auto">
                VIBE SCORE: {Math.round(currentScore * 10)}%
              </span>
            )}
            {airQuality ? (
              <AirQualityBadge reading={airQuality} />
            ) : (
              <span
                data-testid="air-quality-calibrating"
                className="rounded border border-zinc-300/30 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-200 shadow-lg backdrop-blur-md pointer-events-auto"
              >
                Sensors Calibrating
              </span>
            )}
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter leading-none mb-1 text-shadow-lg flex items-center gap-2">
            <span>{venueName}</span>
            {venue?.isClaimed && (
              <span
                title="Verified Host"
                data-testid="verified-host-badge"
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
              {venue?.address || "Location details loading..."}
            </span>
            {venue?.address && (
              <CopyToClipboardButton
                textToCopy={venue.address}
                label="Copy"
                className="!py-0.5 !px-2 text-xs shrink-0 pointer-events-auto ml-1"
              />
            )}
            {typeof venue?.lat === "number" &&
              typeof venue?.lng === "number" && (
                <CopyToClipboardButton
                  textToCopy={formatGpsCoordinates(venue.lat, venue.lng)}
                  label="Copy Coordinates"
                  ariaLabel={`Copy GPS coordinates for ${venueName}`}
                  toastMessage="Coordinates copied to clipboard"
                  className="!py-0.5 !px-2 text-xs shrink-0 pointer-events-auto"
                />
              )}
          </div>
        </div>
      </div>

      {/* Tabs Header */}
      <div
        role="tablist"
        aria-label="Venue information tabs"
        className="flex border-b border-white/10 bg-transparent px-8 py-3 gap-6 shrink-0"
      >
        {[
          { id: "overview", label: "Overview" },
          { id: "reviews", label: reviewsLabel },
          { id: "menu", label: "Menus & Prices" },
          { id: "developer", label: "Developer" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`tab-${tab.id}`}
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
  selectedVenueLang?: string;
  onSelectVenueLang?: (lang: string) => void;
  isTranslatingDesc?: boolean;
  descTranslationError?: string | null;
  translatedDescription?: string;
}

export function VenueDescriptionAndHostCard({
  venue,
  selectedVenueLang = "EN",
  onSelectVenueLang,
  isTranslatingDesc = false,
  descTranslationError = null,
  translatedDescription = "",
}: VenueHeaderOverviewCardsProps) {
  return (
    <>
      {/* Multi-Language Venue Description Translator */}
      <div
        data-testid="venue-description-card"
        className="mb-6 p-5 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl shadow-sm space-y-4"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h3 className="font-semibold text-lg text-white">
              Venue Description
            </h3>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Languages className="w-4 h-4 text-zinc-400 shrink-0" />
            <select
              data-testid="venue-lang-select"
              value={selectedVenueLang}
              onChange={(e) => onSelectVenueLang?.(e.target.value)}
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
            <p
              data-testid="desc-translation-error"
              className="text-xs text-amber-400 mb-2 font-medium"
            >
              {descTranslationError}
            </p>
          )}
          <p
            data-testid="venue-description-text"
            className="whitespace-pre-line"
          >
            {translatedDescription ||
              venue?.description ||
              `Analysis based on Multi-Agent telemetry suggests this ${venue?.category || "workspace"} is optimal for collaborative sessions.`}
          </p>
        </div>
      </div>

      {/* Verified Host Pinned Message */}
      {venue?.isClaimed && venue?.hostMessage && (
        <div
          data-testid="venue-host-card"
          className="mb-6 p-5 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-2xl shadow-sm"
        >
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
      {!venue?.isClaimed && (
        <div
          data-testid="unclaimed-listing-notice"
          className="mb-6 p-4 bg-zinc-800/40 border border-zinc-700/30 rounded-2xl flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-zinc-700/40 rounded-xl text-zinc-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-200">
                Are you the owner or manager?
              </p>
              <p className="text-[11px] text-zinc-400">
                Claim this listing to update hours, amenities, and verify
                details.
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
  isFavorited?: boolean;
  enableTransition?: boolean;
  onRate?: (venue: Venue) => void;
  showFlagMenu?: boolean;
  setShowFlagMenu?: React.Dispatch<React.SetStateAction<boolean>>;
  flagSubmitting?: boolean;
  flagSubmitted?: boolean;
  onSubmitFlag?: (reason: string) => void;
  copied?: boolean;
  onShare: () => void;
}

export function VenueActionButtons({
  venue,
  onGetDirections,
  onToggleFavorite,
  isFavorited = false,
  enableTransition = false,
  onRate,
  showFlagMenu = false,
  setShowFlagMenu,
  flagSubmitting = false,
  flagSubmitted = false,
  onSubmitFlag,
  copied = false,
  onShare,
}: VenueActionButtonsProps) {
  // Escape key handler to close flag menu
  useEffect(() => {
    if (!showFlagMenu || !setShowFlagMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowFlagMenu(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showFlagMenu, setShowFlagMenu]);

  const venueName = venue?.name || "Venue";

  return (
    <div className="flex flex-col gap-3 pt-6 border-t border-white/10 mt-6">
      <button
        type="button"
        data-testid="navigate-btn"
        onClick={() => onGetDirections(venue)}
        className="w-full flex items-center justify-center gap-2 bg-[var(--primary-accent)] hover:opacity-90 text-white font-black uppercase tracking-widest py-4 px-8 rounded-2xl transition-all shadow-xl shadow-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] active:scale-[0.98]"
      >
        <Navigation className="w-5 h-5" />
        Navigate
      </button>
      <div className="flex gap-3">
        <button
          type="button"
          data-testid="favorite-btn"
          onClick={() => onToggleFavorite(venue)}
          aria-label={
            isFavorited
              ? `Remove ${venueName} from favorites`
              : `Save ${venueName} to favorites`
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
            type="button"
            data-testid="rate-btn"
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
            data-testid="flag-menu-btn"
            onClick={() => setShowFlagMenu?.((v) => !v)}
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
            <div
              data-testid="flag-menu-dropdown"
              className="absolute bottom-full mb-2 right-0 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-52 py-1 text-sm"
            >
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
                  data-testid={`flag-reason-btn-${id}`}
                  onClick={() => onSubmitFlag?.(id)}
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
          type="button"
          data-testid="share-btn"
          onClick={onShare}
          aria-label={"Share " + venueName}
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
