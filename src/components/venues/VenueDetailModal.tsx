'use client';

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';

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

  // Reset gallery index when switching venues
  useEffect(() => {
    setActivePhotoIndex(0);
  }, [venue?.id]);

  // Close modal on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !venue) {
    return null;
  }

  const currentPhotoUrl = galleryPhotos[activePhotoIndex] ?? null;
  const isCurrentLoaded = currentPhotoUrl ? Boolean(loadedUrls[currentPhotoUrl]) : false;
  const isCurrentErrored = currentPhotoUrl ? Boolean(erroredUrls[currentPhotoUrl]) : false;

  const handleImageLoad = (url: string) => {
    setLoadedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const handleImageError = (url: string) => {
    setErroredUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const handlePrevPhoto = () => {
    if (galleryPhotos.length <= 1) return;
    setActivePhotoIndex((prev) =>
      prev === 0 ? galleryPhotos.length - 1 : prev - 1
    );
  };

  const handleNextPhoto = () => {
    if (galleryPhotos.length <= 1) return;
    setActivePhotoIndex((prev) =>
      prev === galleryPhotos.length - 1 ? 0 : prev + 1
    );
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
            <img
              key={currentPhotoUrl}
              src={currentPhotoUrl}
              alt={`${venue.name} workspace preview`}
              width={1280}
              height={720}
              decoding="async"
              onLoad={() => handleImageLoad(currentPhotoUrl)}
              onError={() => handleImageError(currentPhotoUrl)}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isCurrentLoaded ? 'opacity-100' : 'opacity-0'
                }`}
            />
          ) : (
            <div
              data-testid="venue-hero-fallback"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 text-zinc-500"
            >
              <ImageOff className="h-8 w-8 text-zinc-600" />
              <span className="text-xs font-medium">Venue preview unavailable</span>
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
            </div>

            {typeof venue.rating === 'number' && (
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-xs">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-semibold text-zinc-100">
                  {venue.rating.toFixed(1)}
                </span>
                {typeof venue.reviewCount === 'number' && (
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

          {/* Workspace Telemetry Metrics */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                <span>Wi-Fi Speed</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {typeof venue.wifiSpeedMbps === 'number'
                  ? `${venue.wifiSpeedMbps} Mbps`
                  : 'Verified'}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Ambient Noise</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {typeof venue.noiseDb === 'number' ? `${venue.noiseDb} dB` : 'Quiet'}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Plug className="h-3.5 w-3.5 text-amber-400" />
                <span>Power Outlets</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {typeof venue.outletDensity === 'number'
                  ? `${venue.outletDensity}/5`
                  : 'Available'}
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