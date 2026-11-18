"use client";

import { useState } from "react";
import { Leaf, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calculateCarbonOffsetSummary,
  type CommuteTrip,
} from "@/lib/sustainability/carbonCalculator";

export interface NomadStatsCardProps {
  trips?: CommuteTrip[];
  goalKgCo2?: number;
  className?: string;
}

export function NomadStatsCard({
  trips = [],
  goalKgCo2 = 100,
  className = "",
}: NomadStatsCardProps) {
  const [isShareOpen, setIsShareOpen] = useState(false);
  const summary = calculateCarbonOffsetSummary(trips);
  const goal =
    Number.isFinite(goalKgCo2) && goalKgCo2 > 0 ? goalKgCo2 : 100;
  const progress = Math.min(100, (summary.co2SavedKg / goal) * 100);
  const shareText = `I have offset an estimated ${summary.co2SavedKg.toFixed(2)} kg of CO₂ through lower-carbon commutes on WorkSphere!`;
  const shareUrl =
    typeof window !== "undefined" ? window.location.href : "";
  const encodedShareText = encodeURIComponent(shareText);
  const encodedShareUrl = encodeURIComponent(shareUrl);

  const handleDeviceShare = async () => {
    if (typeof navigator === "undefined") return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "My WorkSphere carbon impact",
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch {
        // A dismissed share sheet is not an application error.
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      } catch {
        // Clipboard permissions are browser-controlled; social links remain available.
      }
    }
  };

  return (
    <>
      <section
        aria-labelledby="profile-carbon-offset-title"
        data-testid="profile-overview-carbon-offset"
        className={cn(
          "mt-5 rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20",
          className,
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <Leaf className="h-5 w-5" />
            </span>
            <div>
              <h3
                id="profile-carbon-offset-title"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
              >
                Nomad Carbon Impact
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Estimated savings from recorded commute trips
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="profile-carbon-share-button"
            onClick={() => setIsShareOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share badge
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">CO₂ offset</p>
            <p
              data-testid="profile-carbon-offset-kg"
              className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300"
            >
              {summary.co2SavedKg.toFixed(2)} kg
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Tree equivalents
            </p>
            <p
              data-testid="profile-carbon-trees"
              className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-50"
            >
              ~{summary.treesEquivalent.toFixed(2)} trees/year
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Offset goal
            </span>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
              {summary.co2SavedKg.toFixed(2)} / {goal.toFixed(2)} kg
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Carbon offset goal progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(progress.toFixed(1))}
            data-testid="profile-carbon-progress"
            className="h-2.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-zinc-800"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            Based on a 170 g CO₂/km gasoline-car benchmark; tree equivalents
            use an approximate annual 21 kg CO₂ uptake per tree.
          </p>
        </div>
      </section>

      {isShareOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsShareOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-carbon-share-title"
            data-testid="profile-carbon-share-dialog"
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3
                  id="profile-carbon-share-title"
                  className="text-lg font-bold text-zinc-900 dark:text-zinc-50"
                >
                  Share your carbon impact
                </h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Your estimated commute savings in one shareable badge.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close share dialog"
                onClick={() => setIsShareOpen(false)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="my-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
              <Leaf className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                WorkSphere Nomad Impact
              </p>
              <p className="mt-1 text-3xl font-bold text-zinc-900 dark:text-white">
                {summary.co2SavedKg.toFixed(2)} kg
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                estimated CO₂ avoided
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodedShareText}&url=${encodedShareUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="profile-carbon-share-x"
                className="rounded-lg bg-zinc-900 px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-zinc-700"
              >
                Share on X
              </a>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedShareUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="profile-carbon-share-linkedin"
                className="rounded-lg border border-zinc-300 px-3 py-2.5 text-center text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Share on LinkedIn
              </a>
            </div>

            <button
              type="button"
              onClick={handleDeviceShare}
              className="mt-3 w-full rounded-lg border border-emerald-300 px-3 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              Share from device or copy badge text
            </button>
          </section>
        </div>
      )}
    </>
  );
}

export default NomadStatsCard;
