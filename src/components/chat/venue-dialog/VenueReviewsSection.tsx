"use client";

import React from "react";
import { AlertTriangle, Info, Globe2, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Venue } from "../ChatMessages";
import { ExportRatingsCSVButton } from "@/components/analytics/ExportRatingsCSVButton";
import { sanitizeReviewComment } from "@/lib/reviewCommentSanitizer";
import type { QueuedVenueReview } from "@/lib/offlineReviewSync";

export interface VenueReviewsSectionProps {
  venue: Venue;
  reviews: any[];
  reviewsLoading: boolean;
  conflictReview: QueuedVenueReview | null;
  resolvingConflict: boolean;
  onResolveConflict: (choice: "KEEP_LOCAL" | "USE_REMOTE") => void;
  translatedReviews: Record<string, string>;
  translatingReviewId: string | null;
  onTranslateReview: (review: any) => void;
  onViewSpeedtestPhoto: (photoUrl: string) => void;
}

export function VenueReviewsSection({
  venue,
  reviews,
  reviewsLoading,
  conflictReview,
  resolvingConflict,
  onResolveConflict,
  translatedReviews,
  translatingReviewId,
  onTranslateReview,
  onViewSpeedtestPhoto,
}: VenueReviewsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Offline Review Sync Conflict Banner */}
      {conflictReview && (
        <div className="p-4 border border-amber-500/30 bg-amber-500/10 rounded-2xl space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-200">
                Review Conflict Detected
              </p>
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                This review was modified on the server while you were offline.
                Choose whether to overwrite with your offline review or keep the
                server version.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onResolveConflict("KEEP_LOCAL")}
              disabled={resolvingConflict}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-black transition-colors disabled:opacity-50"
            >
              {resolvingConflict ? "Resolving..." : "Keep Local (Overwrite)"}
            </button>
            <button
              onClick={() => onResolveConflict("USE_REMOTE")}
              disabled={resolvingConflict}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-50"
            >
              Use Remote (Discard Local)
            </button>
          </div>
        </div>
      )}

      {/* Reviews Count & CSV Export Header */}
      {reviews.length > 0 && (
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
            {reviews.length} {reviews.length === 1 ? "Review" : "Reviews"}
          </span>
          <ExportRatingsCSVButton
            ratings={reviews}
            venueName={venue.name}
            variant="compact"
          />
        </div>
      )}

      {/* Reviews Content: Loading, Empty, or List */}
      {reviewsLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-4 border border-white/10 bg-black/20 rounded-2xl space-y-3 animate-pulse"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <div className="h-3 w-24 bg-zinc-700 rounded" />
                  <div className="h-2 w-40 bg-zinc-800 rounded" />
                </div>
                <div className="h-3 w-12 bg-zinc-700 rounded" />
              </div>
              <div className="space-y-1.5">
                <div className="h-2 w-full bg-zinc-800 rounded" />
                <div className="h-2 w-3/4 bg-zinc-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="py-12 border-2 border-dashed border-white/10 rounded-2xl text-center px-4">
          <Info className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
          <p className="text-xs font-black uppercase tracking-wider text-zinc-400">
            {t("venue.noReviewsYet")}
          </p>
          <p className="text-[10px] text-zinc-500 mt-1">
            {t("venue.beTheFirst")}
          </p>
        </div>
      ) : (
        reviews.map((review: any, idx: number) => (
          <div
            key={idx}
            className="p-4 border border-white/10 bg-black/20 rounded-2xl space-y-3"
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-zinc-200 uppercase">
                  {review.user
                    ? `${review.user.firstName || "Nomad"} ${review.user.lastName || "Scout"}`
                    : "Anonymous"}
                </span>
                <div className="flex items-center gap-1.5 mt-1 text-[9px] font-mono text-zinc-400">
                  <span>
                    {t("venue.wifi")}: {review.wifiQuality}/5
                  </span>
                  <span>•</span>
                  <span>
                    {t("venue.power")}:{" "}
                    {review.hasOutlets ? t("venue.yes") : t("venue.no")}
                  </span>
                  <span>•</span>
                  <span>
                    {t("venue.noise")}: {review.noiseLevel}
                  </span>
                  {review.outletLocations &&
                    review.outletLocations.length > 0 && (
                      <>
                        <span>•</span>
                        <span>
                          Locations:{" "}
                          {review.outletLocations
                            .map((l: string) => l.replace("_", " "))
                            .join(", ")}
                        </span>
                      </>
                    )}
                </div>
              </div>
              {review.wifiSpeed && (
                <span className="px-2 py-0.5 accent-bg-20 accent-text rounded text-[9px] font-black tracking-wider border accent-border-30">
                  {review.wifiSpeed} MBPS
                </span>
              )}
            </div>
            {review.comment && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-200 leading-relaxed bg-black/40 p-3 rounded-xl border border-white/5 break-words">
                  {sanitizeReviewComment(
                    translatedReviews[review.id] || review.comment,
                  )}
                </p>
                {!translatedReviews[review.id] && (
                  <button
                    onClick={() => onTranslateReview(review)}
                    disabled={translatingReviewId === review.id}
                    className="inline-flex items-center gap-1 text-[10px] font-bold accent-text hover:opacity-80 transition-colors disabled:opacity-50"
                  >
                    <Globe2 className="w-3 h-3" />
                    {translatingReviewId === review.id
                      ? t("venue.translating")
                      : t("venue.translate")}
                  </button>
                )}
              </div>
            )}
            {review.speedtestPhoto && (
              <button
                onClick={() => onViewSpeedtestPhoto(review.speedtestPhoto)}
                className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest accent-text accent-bg-10 hover:accent-bg-20 px-3 py-1.5 rounded-lg border accent-border-20 transition-all active:scale-95"
              >
                <Eye className="w-3.5 h-3.5" />
                {t("venue.viewSpeedtest")}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default VenueReviewsSection;
