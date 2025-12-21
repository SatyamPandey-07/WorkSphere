"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Star } from "lucide-react";

interface VenueRatingDialogProps {
  venueName: string;
  venueId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    comment?: string;
  }) => void;
}

export function VenueRatingDialog({
  venueName,
  venueId,
  isOpen,
  onClose,
  onSubmit,
}: VenueRatingDialogProps) {
  const [wifiQuality, setWifiQuality] = useState(3);
  const [hasOutlets, setHasOutlets] = useState<boolean | null>(null);
  const [noiseLevel, setNoiseLevel] = useState<"quiet" | "moderate" | "loud">("moderate");
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
        comment: comment.trim() || undefined,
      });
      
      // Reset form
      setWifiQuality(3);
      setHasOutlets(null);
      setNoiseLevel("moderate");
      setComment("");
      onClose();
    } catch (error) {
      console.error("Error submitting rating:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mounted) return null;

  const dialogContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Rate {venueName}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* WiFi Quality */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              WiFi Quality
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setWifiQuality(rating)}
                  className={`p-2 rounded-lg transition-colors ${
                    rating <= wifiQuality
                      ? "bg-blue-100 dark:bg-blue-900/20"
                      : "bg-zinc-100 dark:bg-zinc-800"
                  }`}
                >
                  <Star
                    className={`w-6 h-6 ${
                      rating <= wifiQuality
                        ? "text-blue-600 fill-current"
                        : "text-zinc-400"
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm text-zinc-600 dark:text-zinc-400">
                {wifiQuality}/5
              </span>
            </div>
          </div>

          {/* Outlets */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Power Outlets Available?
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setHasOutlets(true)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  hasOutlets === true
                    ? "bg-green-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setHasOutlets(false)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  hasOutlets === false
                    ? "bg-red-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                No
              </button>
            </div>
          </div>

          {/* Noise Level */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Noise Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["quiet", "moderate", "loud"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setNoiseLevel(level)}
                  className={`px-4 py-2 rounded-lg font-medium capitalize transition-colors ${
                    noiseLevel === level
                      ? level === "quiet"
                        ? "bg-green-600 text-white"
                        : level === "moderate"
                        ? "bg-orange-600 text-white"
                        : "bg-red-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Comments (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your experience..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 rounded-lg font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || hasOutlets === null}
              className="flex-1 px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "Submitting..." : "Submit Rating"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(dialogContent, document.body);
}
