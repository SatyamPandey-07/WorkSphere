"use client";

import React, { useState } from "react";
import {
  MapPin,
  Search,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  CheckCircle2,
  Info,
} from "lucide-react";
import { geocodePostalOrCity, GeocodedLocation } from "@/hooks/useUserLocation";

export interface GeolocationFallbackBannerProps {
  onLocationSelected?: (location: GeocodedLocation) => void;
  currentLocationName?: string | null;
  onDismiss?: () => void;
  className?: string;
}

export function GeolocationFallbackBanner({
  onLocationSelected,
  currentLocationName,
  onDismiss,
  className = "",
}: GeolocationFallbackBannerProps) {
  const [query, setQuery] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLocation, setSuccessLocation] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsResolving(true);
    setError(null);
    setSuccessLocation(null);

    try {
      const result = await geocodePostalOrCity(trimmed);
      if (result) {
        setSuccessLocation(result.displayName);
        if (onLocationSelected) {
          onLocationSelected(result);
        }
      } else {
        setError(
          `Could not find coordinates for "${trimmed}". Please try a different city name or postal code.`,
        );
      }
    } catch {
      setError("Failed to geocode location. Please check your network connection.");
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Location permission fallback"
      className={`relative rounded-2xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/30 backdrop-blur-md p-4 sm:p-5 shadow-lg shadow-amber-500/5 transition-all ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
            <AlertCircle className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>Location access disabled</span>
            </h4>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5 leading-relaxed">
              Location access disabled. Enter city or postal code to find nearby spots.
            </p>

            {/* Postal code / City search form */}
            <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSuccessLocation(null);
                    if (error) setError(null);
                  }}
                  placeholder="e.g., 94103, Brooklyn, or London"
                  aria-label="Enter city or postal code"
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all shadow-sm"
                />
              </div>

              <button
                type="submit"
                disabled={isResolving || !query.trim()}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-1.5 shrink-0"
              >
                {isResolving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5" />
                    <span>Set Location</span>
                  </>
                )}
              </button>
            </form>

            {/* Success message */}
            {successLocation && (
              <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Map centered at: {successLocation}</span>
              </div>
            )}

            {/* Error message */}
            {error && (
              <p className="mt-2 text-xs text-rose-500 font-medium animate-in fade-in">
                {error}
              </p>
            )}

            {/* Current fallback indicator */}
            {currentLocationName && !successLocation && (
              <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                Currently showing default area: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{currentLocationName}</span>
              </p>
            )}

            {/* Toggle instructions */}
            <div className="mt-3 pt-2 border-t border-amber-500/20">
              <button
                type="button"
                onClick={() => setShowInstructions((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline transition-all"
              >
                <Info className="w-3 h-3" />
                <span>How to re-enable location in your browser settings</span>
                {showInstructions ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>

              {showInstructions && (
                <div className="mt-2.5 p-3 rounded-xl bg-white/70 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800 text-[11px] space-y-2 text-zinc-600 dark:text-zinc-300 animate-in fade-in">
                  <div>
                    <strong className="text-zinc-800 dark:text-zinc-200">Chrome / Edge / Brave:</strong> Click the tune or lock icon next to the URL in the address bar &rarr; enable <em>Location</em> &rarr; refresh the page.
                  </div>
                  <div>
                    <strong className="text-zinc-800 dark:text-zinc-200">Safari (Mac):</strong> Safari &rarr; Settings &rarr; Websites &rarr; Location &rarr; set WorkSphere to <em>Allow</em>.
                  </div>
                  <div>
                    <strong className="text-zinc-800 dark:text-zinc-200">Firefox:</strong> Click the permissions icon on the left of the address bar &rarr; remove the <em>Blocked</em> permission &rarr; refresh.
                  </div>
                  <div>
                    <strong className="text-zinc-800 dark:text-zinc-200">Mobile (iOS / Android):</strong> Ensure browser location is enabled in your phone&apos;s Settings &rarr; Privacy &rarr; Location Services.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Close / Dismiss button */}
        <button
          type="button"
          onClick={() => {
            setIsDismissed(true);
            if (onDismiss) onDismiss();
          }}
          aria-label="Dismiss location warning"
          className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
