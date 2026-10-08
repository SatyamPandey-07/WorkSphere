import { Frown, Meh, Smile } from "lucide-react";
import type { SentimentLabel, SentimentSummary } from "@/lib/reviewSentiment";

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

interface ReviewSentimentBadgeProps {
  summary: SentimentSummary | null;
  className?: string;
}

export function ReviewSentimentBadge({
  summary,
  className = "",
}: ReviewSentimentBadgeProps) {
  if (!summary) return null;

  const { text, tone, Icon } = BADGES[summary.label];
  const showHighlights =
    summary.label !== "needs_improvement" && summary.highlights.length > 0;

  return (
    <div
      data-testid="review-sentiment-badge"
      title={`Based on ${summary.reviewCount} recent reviews`}
      className={`flex flex-wrap items-center gap-2 ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}
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
