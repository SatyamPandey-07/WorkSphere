"use client";

import { useEffect, useState } from "react";
import { ThumbsUp } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface CollectionUpvoteButtonProps {
  folderId: string;
  initialUpvotes: number;
  initialHasUpvoted?: boolean;
  className?: string;
}

export function CollectionUpvoteButton({
  folderId,
  initialUpvotes,
  initialHasUpvoted = false,
  className = "",
}: CollectionUpvoteButtonProps) {
  const [upvotes, setUpvotes] = useState(initialUpvotes);
  const [hasUpvoted, setHasUpvoted] = useState(initialHasUpvoted);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setUpvotes(initialUpvotes);
    setHasUpvoted(initialHasUpvoted);
  }, [folderId, initialUpvotes, initialHasUpvoted]);

  const handleToggleUpvote = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isPending) return;

    // Snapshot previous state for rollback
    const prevUpvotes = upvotes;
    const prevHasUpvoted = hasUpvoted;

    // 1. Optimistic UI update: Immediate update
    const nextHasUpvoted = !prevHasUpvoted;
    const nextUpvotes = prevUpvotes + (nextHasUpvoted ? 1 : -1);

    setHasUpvoted(nextHasUpvoted);
    setUpvotes(nextUpvotes);
    setIsPending(true);

    try {
      const res = await fetch("/api/collections/public/upvote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update upvote");
      }

      const data = await res.json();
      // Sync with server authoritative state
      if (typeof data.upvotes === "number") {
        setUpvotes(data.upvotes);
      }
      if (typeof data.hasUpvoted === "boolean") {
        setHasUpvoted(data.hasUpvoted);
      }
    } catch (err: any) {
      // 2. Smooth rollback on network failure or error
      setHasUpvoted(prevHasUpvoted);
      setUpvotes(prevUpvotes);

      // 3. User notification via toast alert
      toast(
        err?.message || "Failed to update upvote. Please try again.",
        "error",
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggleUpvote}
      disabled={isPending}
      aria-label={`Upvote collection (${upvotes} upvotes)`}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
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
