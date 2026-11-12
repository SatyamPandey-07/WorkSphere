"use client";

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
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 hover:text-white",
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
        </div>
      </div>
    </div>
  );
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
export default VenueDetailModal;
