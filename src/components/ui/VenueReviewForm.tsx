"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Send, Star, RefreshCw } from "lucide-react";
import { submitReviewWithOfflineSync } from "@/lib/offlineReviewSync";

export interface PendingReview {
  id: string;
  venueId?: string;
  text: string;
  rating: number;
  createdAt: number;
  status: "pending_sync" | "synced";
}

export interface ReviewDraft {
  text: string;
  rating: number;
  updatedAt: number;
}

export function getDraftStorageKey(venueId?: string): string {
  return `worksphere:review-draft:${venueId || "default"}`;
}

export interface VenueReviewFormProps {
  venueId?: string;
  initialRating?: number;
  rating?: number;
  onRatingChange?: (rating: number) => void;
  onSubmit?: (review: string, rating?: number) => void;
  onOptimisticReview?: (review: PendingReview) => void;
}

export function VenueReviewForm({
  venueId,
  initialRating = 0,
  rating: controlledRating,
  onRatingChange,
  onSubmit,
  onOptimisticReview,
}: VenueReviewFormProps) {
  const [internalRating, setInternalRating] = useState<number>(initialRating);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const isLoadedRef = useRef(false);
  const MAX_CHARS = 500;

  const currentRating =
    controlledRating !== undefined ? controlledRating : internalRating;
  const activeScore = hoverRating !== null ? hoverRating : currentRating;

  const currentLength = reviewText.length;
  const trimmedLength = reviewText.trim().length;

  // Restore draft from localStorage on initial render
  useEffect(() => {
    if (typeof window === "undefined" || isLoadedRef.current) return;
    try {
      const savedDraft = localStorage.getItem(getDraftStorageKey(venueId));
      if (savedDraft) {
        const parsed: ReviewDraft = JSON.parse(savedDraft);
        if (parsed.text) {
          setReviewText(parsed.text);
        }
        if (parsed.rating && controlledRating === undefined) {
          setInternalRating(parsed.rating);
          onRatingChange?.(parsed.rating);
        }
      }
    } catch {
      // Ignore localStorage errors
    } finally {
      isLoadedRef.current = true;
    }
  }, [venueId, controlledRating, onRatingChange]);

  // Persist draft to localStorage on keystroke or rating change
  const saveDraft = useCallback(
    (text: string, rating: number) => {
      if (typeof window === "undefined") return;
      try {
        if (!text.trim() && rating === 0) {
          localStorage.removeItem(getDraftStorageKey(venueId));
        } else {
          const draft: ReviewDraft = {
            text,
            rating,
            updatedAt: Date.now(),
          };
          localStorage.setItem(getDraftStorageKey(venueId), JSON.stringify(draft));
        }
      } catch {
        // Ignore localStorage quota errors
      }
    },
    [venueId],
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setReviewText(newText);
    saveDraft(newText, currentRating);
  };

  // Check if empty or exceeded
  const isExceeded = currentLength > MAX_CHARS;
  const isEmpty = trimmedLength === 0;
  const isDisabled = isEmpty || isExceeded;

  const handleRatingChange = (newRating: number) => {
    const clamped = Math.min(5, Math.max(0.5, Math.round(newRating * 2) / 2));
    if (controlledRating === undefined) {
      setInternalRating(clamped);
    }
    onRatingChange?.(clamped);
    saveDraft(reviewText, clamped);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(5, (currentRating || 0) + 0.5);
      handleRatingChange(next);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(0.5, (currentRating || 0.5) - 0.5);
      handleRatingChange(next);
    } else if (e.key === "Home") {
      e.preventDefault();
      handleRatingChange(0.5);
    } else if (e.key === "End") {
      e.preventDefault();
      handleRatingChange(5.0);
    }
  };

  const handleMouseMove = (
    e: React.MouseEvent<HTMLDivElement>,
    starIndex: number,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeftHalf = x < rect.width / 2;
    const score = isLeftHalf ? starIndex - 0.5 : starIndex;
    setHoverRating(score);
  };

  const handleClick = (
    e: React.MouseEvent<HTMLDivElement>,
    starIndex: number,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeftHalf = x < rect.width / 2;
    const score = isLeftHalf ? starIndex - 0.5 : starIndex;
    handleRatingChange(score);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabled) return;
    const trimmed = reviewText.trim();
    if (trimmed.length === 0) return;

    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

    if (isOffline) {
      // Optimistically append review to local feed with Pending Sync badge
      const pending: PendingReview = {
        id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        venueId,
        text: trimmed,
        rating: currentRating,
        createdAt: Date.now(),
        status: "pending_sync",
      };

      setPendingReviews((prev) => [pending, ...prev]);
      onOptimisticReview?.(pending);

      // Enqueue into offlineStorage / sync queue
      try {
        submitReviewWithOfflineSync({
          venueId: venueId || "default",
          data: {
            comment: trimmed,
            rating: currentRating,
          },
        }).catch(() => {});
      } catch {
        // Ignore offline sync queue failure
      }

      onSubmit?.(trimmed, currentRating);

      // Clear draft
      try {
        localStorage.removeItem(getDraftStorageKey(venueId));
      } catch {}

      setReviewText("");
      return;
    }

    if (onSubmit) {
      onSubmit(trimmed, currentRating);
    }

    // Clear draft after successful submission
    try {
      localStorage.removeItem(getDraftStorageKey(venueId));
    } catch {}

    setReviewText("");
  };

  return (
    <div className="w-full max-w-2xl flex flex-col gap-4">
      <form
        onSubmit={handleSubmit}
        className="w-full flex flex-col gap-3"
      >
        {/* Star Rating Section with Gold Hover Preview and Half-Star Increments */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              id="venue-rating-label"
              className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
            >
              Rating
            </label>
            <span
              data-testid="rating-preview-text"
              className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 font-mono"
            >
              {activeScore > 0
                ? `${activeScore.toFixed(1)} / 5.0`
                : "Select rating"}
            </span>
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Venue rating"
            aria-valuemin={0.5}
            aria-valuemax={5.0}
            aria-valuenow={currentRating}
            aria-valuetext={`${currentRating} out of 5 stars`}
            onKeyDown={handleKeyDown}
            onMouseLeave={() => setHoverRating(null)}
            className="inline-flex items-center gap-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-lg w-fit cursor-pointer"
          >
            {[1, 2, 3, 4, 5].map((starIndex) => {
              const isFull = activeScore >= starIndex;
              const isHalf = !isFull && activeScore >= starIndex - 0.5;

              return (
                <div
                  key={starIndex}
                  data-testid={`star-slot-${starIndex}`}
                  onMouseMove={(e) => handleMouseMove(e, starIndex)}
                  onClick={(e) => handleClick(e, starIndex)}
                  className="relative inline-block w-7 h-7 select-none"
                >
                  {/* Left half hit region (starIndex - 0.5) */}
                  <button
                    type="button"
                    data-testid={`star-${starIndex}-left`}
                    aria-label={`${starIndex - 0.5} stars`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRatingChange(starIndex - 0.5);
                    }}
                    onMouseEnter={() => setHoverRating(starIndex - 0.5)}
                    className="absolute left-0 top-0 w-1/2 h-full z-10 cursor-pointer focus:outline-none"
                    tabIndex={-1}
                  />

                  {/* Right half hit region (starIndex) */}
                  <button
                    type="button"
                    data-testid={`star-${starIndex}-right`}
                    aria-label={`${starIndex} stars`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRatingChange(starIndex);
                    }}
                    onMouseEnter={() => setHoverRating(starIndex)}
                    className="absolute right-0 top-0 w-1/2 h-full z-10 cursor-pointer focus:outline-none"
                    tabIndex={-1}
                  />

                  {/* Background empty star */}
                  <Star
                    className="w-7 h-7 text-zinc-300 dark:text-zinc-700 fill-zinc-100 dark:fill-zinc-800 transition-colors pointer-events-none"
                    data-testid={`star-${starIndex}-empty`}
                  />

                  {/* Fully filled gold star */}
                  {isFull && (
                    <Star
                      className="absolute left-0 top-0 w-7 h-7 text-amber-400 fill-amber-400 transition-colors pointer-events-none"
                      data-testid={`star-${starIndex}-full`}
                    />
                  )}

                  {/* Half-filled gold star */}
                  {isHalf && (
                    <div
                      className="absolute left-0 top-0 w-1/2 h-full overflow-hidden pointer-events-none"
                      data-testid={`star-${starIndex}-half`}
                    >
                      <Star className="w-7 h-7 text-amber-400 fill-amber-400 transition-colors max-w-none" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative">
          {/* Text Area with Auto-save on Keystroke */}
          <label htmlFor="venue-review-text" className="sr-only">
            Share your experience at this venue
          </label>
          <textarea
            id="venue-review-text"
            value={reviewText}
            onChange={handleTextChange}
            placeholder="Share your experience at this venue..."
            className={`w-full min-h-[120px] p-4 text-sm rounded-xl border bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 transition-colors resize-y ${
              isExceeded
                ? "border-red-500 focus:ring-red-500/20 text-red-900 dark:text-red-400"
                : "border-zinc-200 dark:border-zinc-800 focus:ring-blue-500/20 focus:border-blue-500"
            }`}
            aria-invalid={isExceeded}
            aria-describedby="venue-review-count"
          />

          <div className="flex justify-between items-start mt-2">
            {/* Character Counter Badge & Warning Text */}
            <div
              id="venue-review-count"
              className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                isExceeded
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {currentLength}/{MAX_CHARS} characters
              {isExceeded && (
                <span className="ml-1.5 font-bold">(Too long!)</span>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isDisabled}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                isDisabled
                  ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed opacity-70"
                  : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95"
              }`}
            >
              <Send className="w-4 h-4" />
              Submit Review
            </button>
          </div>
        </div>
      </form>

      {/* Optimistic Pending Reviews Feed */}
      {pendingReviews.length > 0 && (
        <div
          data-testid="pending-reviews-feed"
          className="flex flex-col gap-2.5 pt-2"
        >
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            Pending Offline Reviews
          </h4>
          {pendingReviews.map((item) => (
            <div
              key={item.id}
              data-testid={`pending-review-${item.id}`}
              className="p-3.5 rounded-xl border border-amber-300/80 dark:border-amber-700/60 bg-amber-50/70 dark:bg-amber-950/20 flex flex-col gap-2 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  <span className="text-xs font-bold font-mono">
                    {item.rating.toFixed(1)} / 5.0
                  </span>
                </div>
                {/* Pending Sync badge with amber sync icon */}
                <span
                  data-testid="pending-sync-badge"
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 shadow-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-spin" />
                  Pending Sync
                </span>
              </div>
              <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default VenueReviewForm;
