"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import {
  NoiseMeasurement,
  NoiseMeter,
} from "@/components/noise/NoiseMeter";

interface VenueRatingDialogProps {
  venueName: string;
  venueId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    avgDecibels?: number;
    peakDecibels?: number;
    comment?: string;
    hasErgonomic: boolean;
    outletDensity: "every_table" | "some_tables" | "wall_seats" | "none";
    wifiSpeed?: number;
  }) => void;
}

export function VenueRatingDialog({
  venueName,
  venueId: _venueId,
  isOpen,
  onClose,
  onSubmit,
}: VenueRatingDialogProps) {
  const [wifiQuality, setWifiQuality] = useState(3);
  const [hasOutlets, setHasOutlets] = useState<boolean | null>(null);
  const [noiseLevel, setNoiseLevel] = useState<
    "quiet" | "moderate" | "loud"
  >("moderate");
  const [measurement, setMeasurement] = useState<NoiseMeasurement | null>(null);
  const [comment, setComment] = useState("");
  const [hasErgonomic, setHasErgonomic] = useState(false);
  const [outletDensity, setOutletDensity] = useState<
    "every_table" | "some_tables" | "wall_seats" | "none"
  >("none");
  const [wifiSpeed, setWifiSpeed] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (hasOutlets === null) {
      alert("Please indicate if outlets are available");
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit({
        wifiQuality,
        hasOutlets,
        noiseLevel,
        avgDecibels: measurement?.averageDb,
        peakDecibels: measurement?.peakDb,
        comment: comment.trim() || undefined,
        hasErgonomic,
        outletDensity,
        wifiSpeed: wifiSpeed ? parseInt(wifiSpeed, 10) : undefined,
      });

      setWifiQuality(3);
      setHasOutlets(null);
      setNoiseLevel("moderate");
      setMeasurement(null);
      setComment("");
      setHasErgonomic(false);
      setOutletDensity("none");
      setWifiSpeed("");
      onClose();
    } catch (error) {
      console.error("Error submitting rating:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              Rate {venueName}
            </h2>
            <p className="text-xs text-zinc-500">
              Add subjective feedback and optional measured noise data.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-5">
          <section>
            <label className="mb-2 block text-sm font-medium">
              WiFi Quality
            </label>

            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setWifiQuality(rating)}
                  className={`rounded-lg p-2 transition ${
                    rating <= wifiQuality
                      ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
                  }`}
                >
                  <Star className="h-5 w-5 fill-current" />
                </button>
              ))}

              <span className="ml-2 text-sm text-zinc-500">
                {wifiQuality}/5
              </span>
            </div>
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium">
              Power Outlets Available?
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setHasOutlets(true)}
                className={`flex-1 rounded-lg px-4 py-2 font-medium ${
                  hasOutlets === true
                    ? "bg-green-600 text-white"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                Yes
              </button>

              <button
                type="button"
                onClick={() => setHasOutlets(false)}
                className={`flex-1 rounded-lg px-4 py-2 font-medium ${
                  hasOutlets === false
                    ? "bg-red-600 text-white"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                No
              </button>
            </div>
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium">
              Subjective Noise Level
            </label>

            <div className="grid grid-cols-3 gap-2">
              {(["quiet", "moderate", "loud"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setNoiseLevel(level)}
                  className={`rounded-lg px-4 py-2 font-medium capitalize ${
                    noiseLevel === level
                      ? level === "quiet"
                        ? "bg-green-600 text-white"
                        : level === "moderate"
                          ? "bg-orange-600 text-white"
                          : "bg-red-600 text-white"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </section>

          <NoiseMeter onMeasured={setMeasurement} />

          <section>
            <label className="mb-2 block text-sm font-medium">
              Verified Wi-Fi Speed (Mbps - Optional)
            </label>

            <input
              type="number"
              value={wifiSpeed}
              onChange={(event) => setWifiSpeed(event.target.value)}
              placeholder="e.g. 80"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium">
              Power Outlet Density
            </label>

            <select
              value={outletDensity}
              onChange={(event) =>
                setOutletDensity(
                  event.target.value as
                    | "every_table"
                    | "some_tables"
                    | "wall_seats"
                    | "none",
                )
              }
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="none">None / No Outlets</option>
              <option value="every_table">Every Table</option>
              <option value="some_tables">Some Tables</option>
              <option value="wall_seats">Wall Seats Only</option>
            </select>
          </section>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={hasErgonomic}
              onChange={(event) => setHasErgonomic(event.target.checked)}
              className="h-4 w-4 rounded"
            />
            Features Ergonomic Seating/Desks?
          </label>

          <section>
            <label className="mb-2 block text-sm font-medium">
              Comments (optional)
            </label>

            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Share your experience..."
              rows={3}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </section>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 rounded-lg bg-zinc-100 px-4 py-2 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || hasOutlets === null}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Submitting..." : "Submit Rating"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
