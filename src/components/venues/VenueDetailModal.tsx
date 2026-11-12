"use client";

 feat/ambient-noise-visualizer
import React, { useEffect } from "react";
import { MapPin, Users, Wifi, X, CheckCircle2 } from "lucide-react";
import NoiseVisualizer, { NoiseBand } from "./NoiseVisualizer";

export interface VenueDetails {
  id: string;
  name: string;
  address?: string;
  capacity?: number;
  wifiSpeedMbps?: number;
  description?: string;
  amenities?: string[];
}

interface VenueDetailModalProps {
  venue: VenueDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmitNoiseRating?: (
    venueId: string,
    rating: { db: number; band: NoiseBand; label: string },
  ) => void;
}

export const VenueDetailModal: React.FC<VenueDetailModalProps> = ({
  venue,
  isOpen,
  onClose,
  onSubmitNoiseRating,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !venue) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-detail-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2
              id="venue-detail-modal-title"
              className="text-xl font-bold text-slate-100"
            >
              {venue.name}
            </h2>
            {venue.address && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                <span>{venue.address}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close venue details"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Venue Metadata */}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-300">
          {typeof venue.capacity === "number" && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
              <Users className="h-3.5 w-3.5 text-indigo-400" />
              <span>{venue.capacity} seats</span>
            </span>
          )}
          {typeof venue.wifiSpeedMbps === "number" && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
              <span>{venue.wifiSpeedMbps} Mbps Wi-Fi</span>
            </span>
          )}
        </div>

        {venue.description && (
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            {venue.description}
          </p>
        )}

        {venue.amenities && venue.amenities.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {venue.amenities.map((amenity) => (
              <span
                key={amenity}
                className="inline-flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200"
              >
                <CheckCircle2 className="h-3 w-3 text-cyan-400" />
                {amenity}
              </span>
            ))}
          </div>
        )}

        {/* Live Web Audio Ambient Noise Visualizer */}
        <div className="mt-6">
          <NoiseVisualizer
            isActive={isOpen}
            onSampleRating={(rating) => {
              onSubmitNoiseRating?.(venue.id, rating);
            }}
          />

import React, { useState, useEffect, useRef } from "react";
import { Terminal, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VenueDetailDialog,
  VenueDetailDialogProps,
} from "../chat/VenueDetailDialog";
import {
  HourlyCrowdForecast,
  HourlyCrowdForecastProps,
} from "./HourlyCrowdForecast";
import {
  AmbientNoiseSparkline,
  AmbientNoiseSparklineProps,
  HourlyDecibelPoint,
} from "../analytics/AmbientNoiseSparkline";

export interface VenueDetailModalProps extends VenueDetailDialogProps {
  hourlyForecastProps?: Partial<HourlyCrowdForecastProps>;
  hourlyDecibels?: HourlyDecibelPoint[];
  initialTab?: "overview" | "reviews" | "menu" | "developer";
}

/**
 * Generates formatted cURL command for developers to query a venue via REST API.
 */
export function generateVenueCurlSnippet(venueId: string): string {
  const safeId = venueId || "{venueId}";
  return `curl -s https://work-sphere.vercel.app/api/venues/${safeId} | jq .`;
}

export interface VenueDeveloperTabProps {
  venueId: string;
  venueName?: string;
  className?: string;
}

/**
 * Developer Tab component displaying terminal cURL snippet with one-click copy feedback.
 */
export function VenueDeveloperTab({
  venueId,
  venueName,
  className,
}: VenueDeveloperTabProps) {
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const curlCommand = generateVenueCurlSnippet(venueId);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(curlCommand);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = curlCommand;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
    } catch {
      // Graceful fallback
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    setIsCopied(true);
    timerRef.current = setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  return (
    <div
      data-testid="venue-developer-tab-content"
      className={cn("space-y-6 animate-in fade-in duration-200", className)}
    >
      {/* Tab Header Info */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            Developer API Access
          </h4>
          <p className="text-xs text-zinc-400 mt-0.5">
            Query real-time telemetry, noise metrics, and amenity stats for{" "}
            <span className="text-zinc-200 font-semibold">
              {venueName || "this venue"}
            </span>
            .
          </p>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          REST API
        </span>
      </div>

      {/* Terminal cURL Snippet Container */}
      <div
        data-testid="curl-snippet-container"
        className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl font-mono text-xs"
      >
        {/* Terminal Window Header Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800 select-none">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            <span className="ml-2 text-[11px] text-zinc-400 font-sans font-medium">
              bash — cURL
            </span>
          </div>

          {/* One-Click Copy Button with animated checkmark feedback */}
          <button
            type="button"
            onClick={handleCopy}
            data-testid="copy-curl-button"
            aria-label={isCopied ? "Copied cURL command" : "Copy cURL command"}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-all duration-200 cursor-pointer",
              isCopied
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 hover:text-white"
            )}
          >
            {isCopied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400 animate-in zoom-in duration-200" />
                <span className="text-emerald-400 font-semibold animate-in fade-in duration-200">
                  Copied!
                </span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Terminal Code Body */}
        <div className="p-4 bg-zinc-950 overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 select-none font-bold">$</span>
            <code
              data-testid="curl-command-text"
              className="text-zinc-100 whitespace-pre font-mono text-xs sm:text-sm selection:bg-emerald-500/30"
            >
              {curlCommand}
            </code>
          </div>
        </div>
      </div>

      {/* Endpoint Specs Meta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-lg p-3">
          <div className="text-zinc-400 text-[11px] font-medium mb-1">
            HTTP Method
          </div>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono font-bold text-[10px]">
              GET
            </span>
            <span className="font-mono text-zinc-300 truncate">
              /api/venues/{venueId}
            </span>
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-lg p-3">
          <div className="text-zinc-400 text-[11px] font-medium mb-1">
            Output Format
          </div>
          <div className="flex items-center gap-1.5 font-mono text-zinc-300">
            <span>JSON (formatted via jq)</span>
          </div>
 main
        </div>
      </div>
    </div>
  );
 feat/ambient-noise-visualizer
};


}

/**
 * VenueDetailModal
 *
 * Wrapper component providing modal compatibility for venue details with
 * integrated HourlyCrowdForecast and Developer tab terminal cURL snippet generator.
 * Applies theme-aware overlay and backdrop styling to prevent white flash during theme transitions.
 */
export function VenueDetailModal(props: VenueDetailModalProps) {
  return (
    <div
      style={{ colorScheme: "dark light" }}
      className="[color-scheme:dark_light] [&>div]:!bg-black/60 dark:[&>div]:!bg-black/80 [&_[role='dialog']]:!bg-white dark:[&_[role='dialog']]:!bg-zinc-950 [&_[role='dialog']]:!backdrop-blur-md"
    >
      <VenueDetailDialog {...props} />
    </div>
  );
}

export { HourlyCrowdForecast, AmbientNoiseSparkline };
export type { AmbientNoiseSparklineProps, HourlyDecibelPoint };
 main
export default VenueDetailModal;
