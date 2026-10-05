"use client";

import { useState } from "react";
import { ThumbsUp } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface ReviewVoteButtonProps {
  reviewId: string;
  initialUpvotes?: number;
  initialHasUpvoted?: boolean;
  onVoteChange?: (upvotes: number, hasUpvoted: boolean) => void;
  className?: string;
}

export function ReviewVoteButton({
  reviewId,
  initialUpvotes = 0,
  initialHasUpvoted = false,
  onVoteChange,
  className = "",
}: ReviewVoteButtonProps) {
  const [upvotes, setUpvotes] = useState(initialUpvotes);
  const [hasUpvoted, setHasUpvoted] = useState(initialHasUpvoted);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();

  const handleToggleVote = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isPending) return;

    // Snapshot previous state for rollback
    const prevUpvotes = upvotes;
    const prevHasUpvoted = hasUpvoted;

    // 1. Optimistic UI update: Immediate local state change & pending disable
    const nextHasUpvoted = !prevHasUpvoted;
    const nextUpvotes = prevUpvotes + (nextHasUpvoted ? 1 : -1);

    setHasUpvoted(nextHasUpvoted);
    setUpvotes(nextUpvotes);
    setIsPending(true);
    if (onVoteChange) {
      onVoteChange(nextUpvotes, nextHasUpvoted);
    }

    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update review vote");
      }

      const data = await res.json();
      // Sync with server authoritative state if returned
      const finalUpvotes = typeof data.upvotes === "number" ? data.upvotes : nextUpvotes;
      const finalHasUpvoted = typeof data.hasUpvoted === "boolean" ? data.hasUpvoted : nextHasUpvoted;

      setUpvotes(finalUpvotes);
      setHasUpvoted(finalHasUpvoted);
      if (onVoteChange) {
        onVoteChange(finalUpvotes, finalHasUpvoted);
      }
    } catch (err: any) {
      // 2. Smooth rollback on network failure or 409 conflict
      setHasUpvoted(prevHasUpvoted);
      setUpvotes(prevUpvotes);
      if (onVoteChange) {
        onVoteChange(prevUpvotes, prevHasUpvoted);
      }

      // 3. User notification via toast alert
      toast(
        err?.message || "Failed to update review vote. Please try again.",
        "error"
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      type="button"
      data-testid={`review-vote-button-${reviewId}`}
      onClick={handleToggleVote}
      disabled={isPending}
      aria-label={`Upvote review (${upvotes} helpful votes)`}
      aria-pressed={hasUpvoted}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border disabled:opacity-60 disabled:cursor-not-allowed ${
        hasUpvoted
          ? "accent-bg accent-border text-white shadow-sm shadow-[var(--primary-accent)]/20 scale-105"
          : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:accent-border-50 hover:accent-text"
      } ${className}`}
    >
      <ThumbsUp className={`w-3.5 h-3.5 ${hasUpvoted ? "fill-current" : ""}`} />
      <span>{upvotes}</span>
    </button>
  );
}
