"use client";

import React, { useState, useEffect, useRef } from "react";
import { Star, X, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const REVIEW_MIN_LENGTH = 10;
export const REVIEW_MAX_LENGTH = 500;
export const REVIEW_ERROR_MESSAGE =
  "Review must contain at least 10 non-whitespace characters.";
export const REVIEW_MAX_ERROR_MESSAGE = "Review cannot exceed 500 characters.";

/**
 * Validates review text by trimming whitespace and enforcing minimum and maximum character counts.
 */
export function validateReviewComment(comment: string): {
  isValid: boolean;
  trimmedComment: string;
  trimmedLength: number;
  errorMessage: string | null;
} {
  const trimmedComment = typeof comment === "string" ? comment.trim() : "";
  const trimmedLength = trimmedComment.length;
  const rawLength = typeof comment === "string" ? comment.length : 0;
  const isTooShort = trimmedLength < REVIEW_MIN_LENGTH;
  const isTooLong = rawLength > REVIEW_MAX_LENGTH;
  const isValid = !isTooShort && !isTooLong;

  let errorMessage: string | null = null;
  if (isTooShort) {
    errorMessage = REVIEW_ERROR_MESSAGE;
  } else if (isTooLong) {
    errorMessage = REVIEW_MAX_ERROR_MESSAGE;
  }

  return {
    isValid,
    trimmedComment,
    trimmedLength,
    errorMessage,
  };
}

export interface VenueReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  venueId: string;
  venueName?: string;
  initialRating?: number;
  initialComment?: string;
  onSubmit?: (review: {
    venueId: string;
    rating: number;
    comment: string;
  }) => Promise<void> | void;
  className?: string;
  "data-testid"?: string;
}

/**
 * VenueReviewModal
 *
 * Modal dialog for submitting verified workspace ratings and written reviews.
 * Enforces non-empty, trimmed comment validation (min 10 characters, max 500 characters)
 * and displays a dynamic character counter with color threshold warnings.
 */
export function VenueReviewModal({
  isOpen,
  onClose,
  venueId,
  venueName = "Workspace",
  initialRating = 0,
  initialComment = "",
  onSubmit,
  className,
  "data-testid": dataTestId = "venue-review-modal",
}: VenueReviewModalProps) {
  const [rating, setRating] = useState<number>(initialRating);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState<string>(initialComment);
  const [isTouched, setIsTouched] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync initial props when modal opens
  useEffect(() => {
    if (isOpen) {
      setRating(initialRating);
      setComment(initialComment);
      setIsTouched(false);
      setIsSubmitting(false);
    }
  }, [isOpen, initialRating, initialComment]);

  // Handle ESC key to dismiss modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Validation logic
  const {
    isValid: isCommentValid,
    trimmedComment,
    trimmedLength,
    errorMessage,
  } = validateReviewComment(comment);
  const hasValidRating = rating > 0 && rating <= 5;
  const isSubmitDisabled = !hasValidRating || !isCommentValid || isSubmitting;

  // Show error if user typed text (or touched) but character criteria are violated
  const showError =
    ((isTouched || comment.length > 0) && trimmedLength < REVIEW_MIN_LENGTH) ||
    comment.length > REVIEW_MAX_LENGTH;

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComment(e.target.value);
  };

  const handleBlur = () => {
    setIsTouched(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTouched(true);

    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    try {
      await onSubmit?.({
        venueId,
        rating,
        comment: trimmedComment,
      });
      onClose();
    } catch {
      // Handled by parent or toast notifications
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-review-modal-title"
      data-testid={dataTestId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      {/* Backdrop click handler */}
      <div
        className="fixed inset-0 -z-10"
        aria-hidden="true"
        onClick={onClose}
        data-testid="venue-review-modal-backdrop"
      />

      <div
        ref={modalRef}
        className={cn(
          "w-full max-w-lg rounded-3xl border border-zinc-200 dark:border-zinc-800",
          "bg-white dark:bg-zinc-900 p-6 sm:p-7 shadow-2xl space-y-6 relative",
          className,
        )}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3
              id="venue-review-modal-title"
              className="text-lg font-bold text-zinc-900 dark:text-zinc-100"
            >
              Review {venueName}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Share your productivity, acoustic, and WiFi experience with the
              nomad community.
            </p>
          </div>
          <button
            type="button"
            data-testid="venue-review-modal-close"
            onClick={onClose}
            aria-label="Close review modal"
            className="rounded-xl p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Rating Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              Overall Rating
            </label>
            <div
              role="radiogroup"
              aria-label="Star rating"
              className="flex items-center gap-1.5"
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const activeStar = hoverRating !== null ? hoverRating : rating;
                const isFilled = star <= activeStar;

                return (
                  <button
                    key={star}
                    type="button"
                    role="radio"
                    aria-checked={rating === star}
                    aria-label={`${star} star${star === 1 ? "" : "s"}`}
                    data-testid={`star-rating-${star}`}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    className="p-1 rounded-lg text-zinc-300 dark:text-zinc-700 hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    <Star
                      className={cn(
                        "w-6 h-6 transition-colors",
                        isFilled
                          ? "fill-amber-400 text-amber-400"
                          : "text-zinc-300 dark:text-zinc-600",
                      )}
                    />
                  </button>
                );
              })}
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 ml-2">
                {rating > 0 ? `${rating} / 5` : "Select rating"}
              </span>
            </div>
          </div>

          {/* Comment Textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="venue-review-comment"
                className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
              >
                Review Comments
              </label>
              <span
                data-testid="venue-review-char-count"
                className={cn(
                  "text-[11px] font-mono",
                  trimmedLength >= REVIEW_MIN_LENGTH
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-400",
                )}
              >
                {trimmedLength} / {REVIEW_MIN_LENGTH} min
              </span>
            </div>

            <textarea
              id="venue-review-comment"
              ref={textareaRef}
              data-testid="venue-review-textarea"
              rows={4}
              value={comment}
              onChange={handleCommentChange}
              onBlur={handleBlur}
              placeholder="Tell others about the desk ergonomics, outlet availability, WiFi speed, and noise levels (minimum 10 characters)..."
              className={cn(
                "w-full rounded-2xl p-3.5 text-sm resize-none outline-none transition-all",
                "bg-zinc-50 dark:bg-zinc-800/80 border text-zinc-900 dark:text-zinc-100 placeholder-zinc-400",
                showError
                  ? "border-rose-500 focus:ring-2 focus:ring-rose-500/30"
                  : "border-zinc-200 dark:border-zinc-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20",
              )}
            />

            {/* Sub-textarea status row: Validation Error on left, Remaining Capacity Counter on right */}
            <div className="flex items-center justify-between min-h-[20px] gap-2 pt-1">
              {showError ? (
                <div
                  role="alert"
                  data-testid="venue-review-error"
                  className="flex items-center gap-1.5 text-xs text-rose-500 dark:text-rose-400 font-medium"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{errorMessage || REVIEW_ERROR_MESSAGE}</span>
                </div>
              ) : (
                <div />
              )}
              <span
                data-testid="venue-review-char-counter"
                className={cn(
                  "text-xs font-mono transition-colors shrink-0 ml-auto",
                  comment.length >= REVIEW_MAX_LENGTH
                    ? "text-rose-500 dark:text-rose-400 font-semibold"
                    : comment.length >= 450
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-zinc-500 dark:text-zinc-400",
                )}
              >
                {comment.length} / {REVIEW_MAX_LENGTH} characters
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              data-testid="venue-review-cancel-button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="venue-review-submit-button"
              disabled={isSubmitDisabled}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm",
                isSubmitDisabled
                  ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  : "bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-blue-500/20",
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                "Submit Review"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default VenueReviewModal;
