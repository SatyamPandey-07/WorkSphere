"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { useOfflineDraftCount } from "@/hooks/useOfflineDraftCount";
import { DraftStore } from "@/worker/bookingSync/DraftStore";

export interface OfflineDraftCountBadgeProps {
  className?: string;
  onClick?: () => void;
  destinationRoute?: string;
  customStore?: DraftStore;
  "data-testid"?: string;
}

export function OfflineDraftCountBadge({
  className = "",
  onClick,
  destinationRoute = "/dashboard",
  customStore,
  "data-testid": testId = "offline-draft-count-badge",
}: OfflineDraftCountBadgeProps) {
  const { count, isLoading } = useOfflineDraftCount(customStore);
  const router = useRouter();
  const [, startTransition] = useTransition();

  if (isLoading || count <= 0) {
    return null;
  }

  const label = `${count} ${count === 1 ? "Offline Draft" : "Offline Drafts"}`;
  const accessibleLabel = `${count} pending offline booking ${
    count === 1 ? "draft" : "drafts"
  }. Click to view bookings.`;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (destinationRoute) {
      startTransition(() => {
        router.push(destinationRoute);
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid={testId}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${className}`.trim()}
    >
      <CalendarClock
        className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0"
        aria-hidden="true"
        data-testid="offline-draft-count-badge-icon"
      />
      <span data-testid="offline-draft-count-badge-text">{label}</span>
    </button>
  );
}

export default OfflineDraftCountBadge;
