import React, { useState, useMemo } from "react";
import { Frown, Meh, Smile, Filter, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SentimentLabel,
  SentimentSummary,
  SentimentReview,
  ReviewSentimentCategory,
  classifyReviewSentiment,
  filterReviewsBySentiment,
} from "@/lib/reviewSentiment";

const BADGES: Record<
  SentimentLabel,
  { text: string; tone: string; Icon: typeof Smile }
> = {
  positive: {
    text: "Mostly positive",
    tone: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
    Icon: Smile,
  },
  mixed: {
    text: "Mixed reviews",
    tone: "bg-amber-500/20 text-amber-200 border-amber-400/40",
    Icon: Meh,
  },
  needs_improvement: {
    text: "Needs improvement",
    tone: "bg-red-500/20 text-red-200 border-red-400/40",
    Icon: Frown,
  },
};

export type SentimentFilterValue = "all" | "positive" | "neutral" | "critical";

export interface ReviewSentimentBadgeProps {
  summary: SentimentSummary | null;
  className?: string;
  "data-testid"?: string;
}

export function ReviewSentimentBadge({
  summary,
  className = "",
  "data-testid": testId = "review-sentiment-badge",
}: ReviewSentimentBadgeProps) {
  if (!summary) return null;

  const { text, tone, Icon } = BADGES[summary.label];
  const showHighlights =
    summary.label !== "needs_improvement" && summary.highlights.length > 0;

  return (
    <div
      data-testid={testId}
      title={`Based on ${summary.reviewCount} recent reviews`}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold",
          tone
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {text}
      </span>
      {showHighlights && (
        <span className="text-xs font-medium text-zinc-200">
          {`Loved for: ${summary.highlights.join(", ")}`}
        </span>
      )}
    </div>
  );
}

export interface ReviewSentimentFilterProps {
  value: SentimentFilterValue;
  onChange: (value: SentimentFilterValue) => void;
  reviewCounts?: {
    all?: number;
    positive?: number;
    neutral?: number;
    critical?: number;
  };
  className?: string;
  "data-testid"?: string;
}

export function ReviewSentimentFilter({
  value,
  onChange,
  reviewCounts,
  className = "",
  "data-testid": testId = "sentiment-filter-dropdown",
}: ReviewSentimentFilterProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <label
        htmlFor="sentiment-filter-select"
        className="text-xs font-semibold text-zinc-400 flex items-center gap-1"
      >
        <Filter className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
        <span>Filter:</span>
      </label>
      <div className="relative">
        <select
          id="sentiment-filter-select"
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value as SentimentFilterValue)}
          className="appearance-none bg-zinc-800/80 hover:bg-zinc-800 text-xs font-medium text-zinc-100 border border-zinc-700/80 rounded-xl px-3 py-1.5 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition shadow-sm"
        >
          <option value="all">
            All Reviews {reviewCounts?.all !== undefined ? `(${reviewCounts.all})` : ""}
          </option>
          <option value="positive">
            Positive {reviewCounts?.positive !== undefined ? `(${reviewCounts.positive})` : ""}
          </option>
          <option value="neutral">
            Neutral {reviewCounts?.neutral !== undefined ? `(${reviewCounts.neutral})` : ""}
          </option>
          <option value="critical">
            Critical {reviewCounts?.critical !== undefined ? `(${reviewCounts.critical})` : ""}
          </option>
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
}

export interface ReviewItem extends SentimentReview {
  id?: string;
  authorName?: string;
  author?: string;
  rating?: number;
  text?: string;
}

export interface ReviewSentimentSectionProps {
  reviews: ReviewItem[];
  summary?: SentimentSummary | null;
  className?: string;
  "data-testid"?: string;
}

export function ReviewSentimentSection({
  reviews,
  summary,
  className = "",
  "data-testid": testId = "review-sentiment-section",
}: ReviewSentimentSectionProps) {
  const [selectedSentiment, setSelectedSentiment] =
    useState<SentimentFilterValue>("all");

  const counts = useMemo(() => {
    const total = reviews.length;
    let pos = 0;
    let neu = 0;
    let crit = 0;

    for (const r of reviews) {
      const c = classifyReviewSentiment(r);
      if (c === "positive") pos += 1;
      else if (c === "critical") crit += 1;
      else neu += 1;
    }

    return { all: total, positive: pos, neutral: neu, critical: crit };
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    return filterReviewsBySentiment(reviews, selectedSentiment);
  }, [reviews, selectedSentiment]);

  return (
    <div data-testid={testId} className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        {summary && <ReviewSentimentBadge summary={summary} />}
        <ReviewSentimentFilter
          value={selectedSentiment}
          onChange={setSelectedSentiment}
          reviewCounts={counts}
        />
      </div>

      <div data-testid="filtered-reviews-list" className="space-y-3">
        {filteredReviews.length === 0 ? (
          <div
            data-testid="no-matching-reviews"
            className="text-xs text-zinc-400 text-center py-6"
          >
            No reviews match the selected sentiment filter.
          </div>
        ) : (
          filteredReviews.map((rev, index) => {
            const sentiment = classifyReviewSentiment(rev);
            const author = rev.authorName || rev.author || "Anonymous Member";
            const text = rev.comment || rev.text || "";

            return (
              <div
                key={rev.id || `review-${index}`}
                data-testid={`review-item-${rev.id || index}`}
                data-sentiment={sentiment}
                className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200">{author}</span>
                  <span
                    data-testid={`review-sentiment-tag-${sentiment}`}
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
                      sentiment === "positive"
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : sentiment === "critical"
                        ? "bg-red-500/15 text-red-300 border-red-500/30"
                        : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
                    )}
                  >
                    {sentiment === "positive" ? (
                      <Smile className="w-3 h-3" />
                    ) : sentiment === "critical" ? (
                      <Frown className="w-3 h-3" />
                    ) : (
                      <Meh className="w-3 h-3" />
                    )}
                    <span className="capitalize">{sentiment}</span>
                  </span>
                </div>
                {text && <p className="text-xs text-zinc-300">{text}</p>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ReviewSentimentBadge;
