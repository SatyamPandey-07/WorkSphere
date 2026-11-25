"use client";

import React from "react";
import { Star } from "lucide-react";

export interface StarRatingProps {
  /** The average rating value (0 - 5) */
  rating?: number | null;
  /** Total number of reviews */
  totalReviews?: number | null;
  /** Alias for totalReviews */
  reviewCount?: number | null;
  /** Maximum number of stars to display (default: 5) */
  maxStars?: number;
  /** Star size variant */
  size?: "sm" | "md" | "lg";
  /** Optional custom CSS class name */
  className?: string;
  /** Whether to show the text label alongside stars (default: true) */
  showLabel?: boolean;
}

const STAR_SIZE_MAP = {
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

const TEXT_SIZE_MAP = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

/**
 * StarRating component renders venue ratings with clean fractional stars
 * and an accessible unrated state when totalReviews is 0 or rating is uninitialized (#9761).
 */
export const StarRating: React.FC<StarRatingProps> = ({
  rating,
  totalReviews,
  reviewCount,
  maxStars = 5,
  size = "md",
  className = "",
  showLabel = true,
}) => {
  const effectiveReviews = totalReviews ?? reviewCount;
  const numericRating = typeof rating === "number" ? rating : null;

  const normalizedRating = Math.max(0, Math.min(5, Number(rating) || 0));
  const roundedRating = Math.round(normalizedRating * 2) / 2;

  // Guard: unrated if review count is 0, rating is null/undefined/0/NaN, or negative (#9761)
  const isUnrated =
    numericRating === null || normalizedRating === 0 || effectiveReviews === 0;

  const starSizeClass = STAR_SIZE_MAP[size] || STAR_SIZE_MAP.md;
  const textSizeClass = TEXT_SIZE_MAP[size] || TEXT_SIZE_MAP.md;

  if (isUnrated) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 leading-none ${className}`}
        role="img"
        aria-label="No reviews yet"
        data-testid="star-rating-unrated"
      >
        <span className="sr-only">No reviews yet</span>
        <div className="flex items-center gap-0.5" aria-hidden="true">
          {Array.from({ length: maxStars }, (_, index) => (
            <Star
              key={index}
              data-testid={`star-outline-${index}`}
              className={`${starSizeClass} text-zinc-400 dark:text-zinc-500 fill-none stroke-current shrink-0`}
            />
          ))}
        </div>
        {showLabel && (
          <span
            data-testid="star-rating-label"
            className={`${textSizeClass} text-zinc-500 dark:text-zinc-400 font-medium`}
          >
            New (No reviews yet)
          </span>
        )}
      </div>
    );
  }

  const clampedRating = Math.min(maxStars, roundedRating);
  const accessibleLabel = `${clampedRating.toFixed(1)} out of ${maxStars} stars${
    typeof effectiveReviews === "number" ? ` (${effectiveReviews} reviews)` : ""
  }`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 leading-none ${className}`}
      role="img"
      aria-label={accessibleLabel}
      data-testid="star-rating-rated"
    >
      <span className="sr-only">{accessibleLabel}</span>
      <div className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: maxStars }, (_, index) => {
          const starThreshold = index + 1;
          const fillRatio = Math.max(
            0,
            Math.min(1, clampedRating - (starThreshold - 1)),
          );
          const fillPercentage = Math.round(fillRatio * 100);

          if (fillPercentage >= 100) {
            return (
              <Star
                key={index}
                data-testid={`star-full-${index}`}
                className={`${starSizeClass} text-amber-400 fill-amber-400 shrink-0`}
              />
            );
          }

          if (fillPercentage <= 0) {
            return (
              <Star
                key={index}
                data-testid={`star-empty-${index}`}
                className={`${starSizeClass} text-zinc-300 dark:text-zinc-600 fill-none stroke-current shrink-0`}
              />
            );
          }

          // Fractional star (e.g. 50% for half-star) without clipping artifacts
          return (
            <div
              key={index}
              data-testid={`star-fractional-${index}`}
              className={`relative inline-block ${starSizeClass} shrink-0`}
            >
              {/* Background empty star */}
              <Star
                className={`absolute inset-0 ${starSizeClass} text-zinc-300 dark:text-zinc-600 fill-none stroke-current`}
              />
              {/* Foreground filled star with exact width */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fillPercentage}%` }}
              >
                <Star
                  className={`${starSizeClass} text-amber-400 fill-amber-400 max-w-none`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {showLabel && (
        <span
          data-testid="star-rating-label"
          className={`inline-flex items-center gap-1 font-semibold text-zinc-900 dark:text-zinc-100 ${textSizeClass}`}
        >
          <span>{clampedRating.toFixed(1)}</span>
          {typeof effectiveReviews === "number" && (
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              ({effectiveReviews})
            </span>
          )}
        </span>
      )}
    </div>
  );
};

export default StarRating;
