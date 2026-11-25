"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  MapPin,
  Wifi,
  Volume2,
  Plug,
  Star,
  CalendarPlus,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Clock,
} from "lucide-react";
import { getVenueOpeningStatus } from "@/lib/utils/openingHours";

export interface VenueDetail {
  id: string;
  name: string;
  address?: string | null;
  category?: string;
  rating?: number;
  reviewCount?: number;
  wifiSpeedMbps?: number | null;
  noiseDb?: number | null;
  outletDensity?: number | null;
  photos?: string[];
  heroPhotoUrl?: string | null;
  description?: string | null;
  amenities?: string[] | null;
  tags?: string[] | null;
  openingHours?: string | null;
  opening_hours?: string | null;
  hours?: string | null;
  timezone?: string | null;
  timeZone?: string | null;
}

export interface VenueDetailModalProps {
  venue: VenueDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onBookClick?: (venue: VenueDetail) => void;
}

export function VenueDetailModal({
  venue,
  isOpen,
  onClose,
  onBookClick,
}: VenueDetailModalProps) {
  const galleryPhotos = React.useMemo(() => {
    if (!venue) return [];
    const list = [
      ...(venue.heroPhotoUrl ? [venue.heroPhotoUrl] : []),
      ...(Array.isArray(venue.photos) ? venue.photos : []),
    ].filter((url, index, self) => Boolean(url) && self.indexOf(url) === index);
    return list;
  }, [venue]);

  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
  const [erroredUrls, setErroredUrls] = useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [statusReferenceTime, setStatusReferenceTime] = useState<Date | null>(null);
  const hasVenue = Boolean(venue);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyRequestIdRef.current += 1;
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  // Reset gallery index when switching venues
  useEffect(() => {
    setActivePhotoIndex(0);
  }, [venue?.id]);

  useEffect(() => {
    copyRequestIdRef.current += 1;
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopyFeedback("idle");
  }, [venue?.id, isOpen]);

  useEffect(() => {
    if (!isOpen || !hasVenue) {
      setStatusReferenceTime(null);
      return;
    }

    setStatusReferenceTime(new Date());
    const interval = window.setInterval(() => {
      setStatusReferenceTime(new Date());
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [hasVenue, isOpen]);

  // Close modal on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !venue) {
    return null;
  }

  const currentPhotoUrl = galleryPhotos[activePhotoIndex] ?? null;
  const isCurrentLoaded = currentPhotoUrl
    ? Boolean(loadedUrls[currentPhotoUrl])
    : false;
  const isCurrentErrored = currentPhotoUrl
    ? Boolean(erroredUrls[currentPhotoUrl])
    : false;
  const openingHours =
    venue.openingHours ||
    venue.opening_hours ||
    venue.hours ||
    null;
  const openingStatus =
    statusReferenceTime && openingHours
      ? getVenueOpeningStatus(
          openingHours,
          statusReferenceTime,
          venue.timezone || venue.timeZone,
        )
      : openingHours
        ? null
        : getVenueOpeningStatus(null);

  const handleImageLoad = (url: string) => {
    setLoadedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const handleImageError = (url: string) => {
    setErroredUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const handlePrevPhoto = () => {
    if (galleryPhotos.length <= 1) return;
    setActivePhotoIndex((prev) =>
      prev === 0 ? galleryPhotos.length - 1 : prev - 1,
    );
  };

  const handleNextPhoto = () => {
    if (galleryPhotos.length <= 1) return;
    setActivePhotoIndex((prev) =>
      prev === galleryPhotos.length - 1 ? 0 : prev + 1,
    );
  };

  const copyWithFallback = (text: string): boolean => {
    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      document.body.removeChild(textarea);
    }
    return copied;
  };

  const showCopyFeedback = (feedback: "success" | "error") => {
    if (!mountedRef.current) return;
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    setCopyFeedback(feedback);
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null;
      if (mountedRef.current) setCopyFeedback("idle");
    }, 2000);
  };

  const handleCopyVenueLink = async () => {
    if (!venue) return;
    const requestId = ++copyRequestIdRef.current;
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopyFeedback("idle");

    const url = `${window.location.origin}/venues/${venue.id}`;
    let copied = false;

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(url);
        copied = true;
      } else {
        copied = copyWithFallback(url);
      }
    } catch {
      copied = copyWithFallback(url);
    }

    if (!mountedRef.current || requestId !== copyRequestIdRef.current) {
      return;
    }

    showCopyFeedback(copied ? "success" : "error");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-detail-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
        <button
          type="button"
          onClick={handleCopyVenueLink}
          aria-label="Copy venue link"
          title={copyFeedback === "success" ? "Copied!" : "Copy venue link"}
          className="absolute right-14 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-950/80 text-zinc-200 backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          {copyFeedback === "success" ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
        {copyFeedback !== "idle" && (
          <span
            role="status"
            aria-live="polite"
            className={`absolute right-14 top-14 z-30 rounded-md border px-2.5 py-1 text-xs font-medium shadow-lg backdrop-blur-md ${
              copyFeedback === "success"
                ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-300"
                : "border-rose-500/30 bg-rose-950/90 text-rose-300"
            }`}
          >
            {copyFeedback === "success" ? "Copied!" : "Copy failed"}
          </span>
        )}

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close venue details"
          className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-950/80 text-zinc-200 backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Zero-CLS Reserved Aspect-Ratio Gallery Hero Container */}
        <div
          data-testid="venue-hero-gallery-container"
          className="relative aspect-video w-full overflow-hidden bg-zinc-900"
        >
          {/* Animated Skeleton Shimmer Placeholder (visible until image finishes decoding) */}
          {currentPhotoUrl && !isCurrentLoaded && !isCurrentErrored && (
            <div
              data-testid="venue-hero-skeleton"
              aria-hidden="true"
              className="absolute inset-0 animate-pulse bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900"
            />
          )}

          {/* Hero Image (absolutely positioned inside aspect-video box so 0px layout shift occurs) */}
          {currentPhotoUrl && !isCurrentErrored ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={currentPhotoUrl}
              src={currentPhotoUrl}
              alt={`${venue.name} workspace preview`}
              width={1280}
              height={720}
              decoding="async"
              onLoad={() => handleImageLoad(currentPhotoUrl)}
              onError={() => handleImageError(currentPhotoUrl)}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                isCurrentLoaded ? "opacity-100" : "opacity-0"
              }`}
            />
          ) : (
            <div
              data-testid="venue-hero-fallback"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 text-zinc-500"
            >
              <ImageOff className="h-8 w-8 text-zinc-600" />
              <span className="text-xs font-medium">
                Venue preview unavailable
              </span>
            </div>
          )}

          {/* Subtle Bottom Gradient Scrim */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-zinc-950/90 to-transparent"
          />

          {/* Multi-Photo Gallery Controls */}
          {galleryPhotos.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrevPhoto}
                aria-label="Previous venue photo"
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-zinc-700/80 bg-zinc-950/75 p-1.5 text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleNextPhoto}
                aria-label="Next venue photo"
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-zinc-700/80 bg-zinc-950/75 p-1.5 text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="absolute bottom-3 right-3 z-10 rounded-full border border-zinc-700/80 bg-zinc-950/80 px-2.5 py-0.5 font-mono text-[11px] text-zinc-300">
                {activePhotoIndex + 1} / {galleryPhotos.length}
              </span>
            </>
          )}
        </div>

        {/* Venue Metadata & Booking Actions (stable vertical position before & after image load) */}
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {venue.category && (
                <span className="inline-block rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-violet-300">
                  {venue.category}
                </span>
              )}
              <h2
                id="venue-detail-modal-title"
                className="mt-1.5 text-xl font-semibold text-white"
              >
                {venue.name}
              </h2>
              {venue.address && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span>{venue.address}</span>
                </p>
              )}
              {openingStatus && (
                <div
                  data-testid="venue-opening-hours-status"
                  aria-label={`Venue operating status: ${openingStatus.text}`}
                  aria-live="off"
                  className={`mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    openingStatus.kind === "open"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : openingStatus.kind === "closing-soon"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        : openingStatus.kind === "24-7"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : openingStatus.kind === "closed"
                            ? "border-zinc-700 bg-zinc-800/80 text-zinc-300"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                  }`}
                >
                  {openingStatus.kind === "closing-soon" ? (
                    <Clock
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 animate-pulse motion-reduce:animate-none"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        openingStatus.kind === "open" ||
                        openingStatus.kind === "24-7"
                          ? "bg-emerald-400"
                          : openingStatus.kind === "closed"
                            ? "bg-zinc-400"
                            : "bg-zinc-500"
                      }`}
                    />
                  )}
                  <span className="break-words">{openingStatus.text}</span>
                </div>
              )}
            </div>

            {typeof venue.rating === "number" && (
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-xs">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-semibold text-zinc-100">
                  {venue.rating.toFixed(1)}
                </span>
                {typeof venue.reviewCount === "number" && (
                  <span className="text-zinc-500">({venue.reviewCount})</span>
                )}
              </div>
            )}
          </div>

          {venue.description && (
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              {venue.description}
            </p>
          )}

          {/* Venue Amenity Tags with responsive mobile wrapping */}
          {((venue.amenities && venue.amenities.length > 0) ||
            (venue.tags && venue.tags.length > 0)) && (
            <div
              data-testid="venue-modal-amenities"
              className="mt-3 flex flex-wrap items-center gap-1.5 overflow-hidden"
            >
              {[...(venue.amenities || []), ...(venue.tags || [])]
                .filter((item, index, arr) => arr.indexOf(item) === index)
                .map((amenity, idx) => (
                  <span
                    key={`${amenity}-${idx}`}
                    data-testid="modal-amenity-tag-pill"
                    className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-zinc-800 text-zinc-200 border border-zinc-700 break-words"
                  >
                    {amenity}
                  </span>
                ))}
            </div>
          )}

          {/* Workspace Telemetry Metrics */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                <span>Wi-Fi Speed</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {typeof venue.wifiSpeedMbps === "number"
                  ? `${venue.wifiSpeedMbps} Mbps`
                  : "Verified"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Ambient Noise</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {typeof venue.noiseDb === "number"
                  ? `${venue.noiseDb} dB`
                  : "Quiet"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Plug className="h-3.5 w-3.5 text-amber-400" />
                <span>Power Outlets</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {typeof venue.outletDensity === "number"
                  ? `${venue.outletDensity}/5`
                  : "Available"}
              </div>
            </div>
          </div>

          {/* Primary Action Bar */}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-zinc-800/80 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              Close
            </button>
            {onBookClick && (
              <button
                type="button"
                onClick={() => onBookClick(venue)}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <CalendarPlus className="h-4 w-4" />
                <span>Reserve Desk</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function VenueDeveloperTab({
  venueId,
  venueName: _venueName,
}: {
  venueId: string;
  venueName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = `curl -X GET https://work-sphere-one.vercel.app/api/venues/${venueId}`;

  const handleCopy = () => {
    navigator.clipboard?.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-200">Developer API Info</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          <span>{copied ? "Copied" : "Copy cURL"}</span>
        </button>
      </div>
      <div>
        <p className="text-slate-400">Venue ID:</p>
        <code className="rounded bg-slate-950 px-2 py-0.5 font-mono text-emerald-400">
          {venueId}
        </code>
      </div>
      <div>
        <p className="text-slate-400">cURL Request:</p>
        <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 font-mono text-slate-300">
          {snippet}
        </pre>
      </div>
    </div>
  );
}
