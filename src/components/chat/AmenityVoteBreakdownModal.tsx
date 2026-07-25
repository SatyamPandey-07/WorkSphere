"use client";

import { X, ThumbsUp, ThumbsDown, BarChart3 } from "lucide-react";

interface VoteMetric {
  confidenceScore: number;
  upvotes: number;
  downvotes: number;
  hidden: boolean;
  userVote: boolean | null;
}

const AMENITY_LABELS: Record<string, string> = {
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

const AMENITY_COLORS: Record<string, string> = {
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

interface AmenityVoteBreakdownModalProps {
  metrics: Record<string, VoteMetric>;
  isOpen: boolean;
  onClose: () => void;
}

export function AmenityVoteBreakdownModal({
  metrics,
  isOpen,
  onClose,
}: AmenityVoteBreakdownModalProps) {
  if (!isOpen) return null;

  const entries = Object.entries(metrics).filter(
    ([, m]) => m.upvotes > 0 || m.downvotes > 0,
  );

  const totalVotesAcrossAmenities = entries.reduce(
    (sum, [, m]) => sum + m.upvotes + m.downvotes,
    0,
  );

  return (
    <div
      className="fixed inset-0 z-[13000] flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-black uppercase tracking-widest text-white">
              Community Vote Breakdown
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {entries.length === 0 ? (
            <div className="text-center py-8">
              <BarChart3 className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-zinc-400">No votes yet</p>
              <p className="text-xs text-zinc-500 mt-1">
                Be the first to verify amenities at this venue.
              </p>
            </div>
          ) : (
            <>
              <div className="text-xs text-zinc-500 font-mono text-right">
                {totalVotesAcrossAmenities} total vote{totalVotesAcrossAmenities !== 1 ? "s" : ""}
              </div>

              {entries.map(([key, metric]) => {
                const total = metric.upvotes + metric.downvotes;
                const upPercent = total > 0 ? (metric.upvotes / total) * 100 : 0;
                const barColor = AMENITY_COLORS[key] || "bg-blue-500";
                const confidenceColor =
                  metric.confidenceScore >= 80
                    ? "text-green-400"
                    : metric.confidenceScore >= 60
                      ? "text-amber-400"
                      : "text-red-400";

                return (
                  <div key={key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        {AMENITY_LABELS[key] || key.replace(/_/g, " ")}
                      </span>
                      <span className={`text-xs font-black font-mono ${confidenceColor}`}>
                        {metric.confidenceScore}% confidence
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
                        <span className="font-mono font-bold">{metric.upvotes}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-red-400">
                        <ThumbsDown className="w-3 h-3" />
                        <span className="font-mono font-bold">{metric.downvotes}</span>
                      </div>
                    </div>

                    {metric.hidden && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-500 font-semibold mt-1">
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
