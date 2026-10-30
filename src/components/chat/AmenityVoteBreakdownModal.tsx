"use client";

import React, { useEffect } from "react";
import { X, ThumbsUp, ThumbsDown, BarChart3 } from "lucide-react";

export interface VoteMetric {
  confidenceScore: number;
  upvotes: number;
  downvotes: number;
  hidden: boolean;
  userVote: boolean | null;
}

export const AMENITY_LABELS: Record<string, string> = {
  wifi: "WiFi",
  outlets: "Power Outlets",
  silentRoom: "Silent Room",
  studyTable: "Study Tables",
  scanner: "Scanners / Printers",
  freeStreetParking: "Free Street Parking",
  paidGarage: "Paid Garage",
  bicycleRack: "Bicycle Rack",
  secureMotorcycleParking: "Secure Motorcycle Parking",
  petsAllowedIndoors: "Pets Allowed Indoors",
};

export const AMENITY_COLORS: Record<string, string> = {
  wifi: "bg-blue-500",
  outlets: "bg-amber-500",
  silentRoom: "bg-emerald-500",
  studyTable: "bg-indigo-500",
  scanner: "bg-cyan-500",
  freeStreetParking: "bg-sky-500",
  paidGarage: "bg-emerald-500",
  bicycleRack: "bg-orange-500",
  secureMotorcycleParking: "bg-zinc-500",
  petsAllowedIndoors: "bg-rose-500",
};

export interface AmenityVoteBreakdownModalProps {
  metrics?: Record<string, VoteMetric> | null;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  testId?: string;
}

export function AmenityVoteBreakdownModal({
  metrics,
  isOpen,
  onClose,
  className = "",
  testId = "amenity-vote-breakdown-modal",
}: AmenityVoteBreakdownModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const safeMetrics = metrics && typeof metrics === "object" ? metrics : {};

  const entries = Object.entries(safeMetrics).filter(
    ([, m]) =>
      m &&
      typeof m === "object" &&
      ((typeof m.upvotes === "number" && m.upvotes > 0) ||
        (typeof m.downvotes === "number" && m.downvotes > 0)),
  );

  const totalVotesAcrossAmenities = entries.reduce((sum, [, m]) => {
    const up = typeof m?.upvotes === "number" && !isNaN(m.upvotes) ? m.upvotes : 0;
    const down = typeof m?.downvotes === "number" && !isNaN(m.downvotes) ? m.downvotes : 0;
    return sum + up + down;
  }, 0);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="amenity-vote-title"
      data-testid={testId}
      className={`fixed inset-0 z-[13000] flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-200 ${className}`.trim()}
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <h3
              id="amenity-vote-title"
              className="text-sm font-black uppercase tracking-widest text-white"
            >
              Community Vote Breakdown
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close vote breakdown"
            data-testid="amenity-vote-close-btn"
            className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {entries.length === 0 ? (
            <div className="text-center py-8" data-testid="amenity-vote-empty">
              <BarChart3 className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-zinc-400">No votes yet</p>
              <p className="text-xs text-zinc-500 mt-1">
                Be the first to verify amenities at this venue.
              </p>
            </div>
          ) : (
            <>
              <div
                className="text-xs text-zinc-500 font-mono text-right"
                data-testid="amenity-total-votes"
              >
                {totalVotesAcrossAmenities} total vote
                {totalVotesAcrossAmenities !== 1 ? "s" : ""}
              </div>

              {entries.map(([key, metric]) => {
                const upvotes =
                  typeof metric?.upvotes === "number" && !isNaN(metric.upvotes)
                    ? Math.max(0, metric.upvotes)
                    : 0;
                const downvotes =
                  typeof metric?.downvotes === "number" && !isNaN(metric.downvotes)
                    ? Math.max(0, metric.downvotes)
                    : 0;
                const total = upvotes + downvotes;
                const upPercent =
                  total > 0 ? Math.min(100, Math.max(0, (upvotes / total) * 100)) : 0;
                const barColor = AMENITY_COLORS[key] || "bg-blue-500";
                const confidence =
                  typeof metric?.confidenceScore === "number" && !isNaN(metric.confidenceScore)
                    ? metric.confidenceScore
                    : 0;
                const confidenceColor =
                  confidence >= 80
                    ? "text-green-400"
                    : confidence >= 60
                      ? "text-amber-400"
                      : "text-red-400";

                return (
                  <div
                    key={key}
                    data-testid={`amenity-metric-${key}`}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        {AMENITY_LABELS[key] || key.replace(/_/g, " ")}
                      </span>
                      <span
                        className={`text-xs font-black font-mono ${confidenceColor}`}
                      >
                        {confidence}% confidence
                      </span>
                    </div>

                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden flex">
                      <div
                        className={`h-full ${barColor} opacity-80 transition-all duration-500`}
                        style={{ width: `${upPercent}%` }}
                      />
                      <div
                        className="h-full bg-red-500/40 transition-all duration-500"
                        style={{ width: `${100 - upPercent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-green-400">
                        <ThumbsUp className="w-3 h-3" />
                        <span className="font-mono font-bold">
                          {upvotes}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-red-400">
                        <ThumbsDown className="w-3 h-3" />
                        <span className="font-mono font-bold">
                          {downvotes}
                        </span>
                      </div>
                    </div>

                    {metric?.hidden && (
                      <div
                        data-testid={`amenity-hidden-${key}`}
                        className="flex items-center gap-1.5 text-[10px] text-amber-500 font-semibold mt-1"
                      >
                        <span>Low confidence — amenity hidden</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AmenityVoteBreakdownModal;
