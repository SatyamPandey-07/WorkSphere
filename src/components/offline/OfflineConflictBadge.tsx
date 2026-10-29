"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useOfflineConflicts } from "@/hooks/useOfflineConflicts";
import { OfflineConflictResolutionModal } from "./OfflineConflictResolutionModal";

export interface OfflineConflictBadgeProps {
  className?: string;
  onClick?: () => void;
  showPulse?: boolean;
  "data-testid"?: string;
}

export function OfflineConflictBadge({
  className = "",
  onClick,
  showPulse = true,
  "data-testid": testId = "offline-conflict-badge",
}: OfflineConflictBadgeProps = {}) {
  const { conflictCount } = useOfflineConflicts();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const safeCount =
    typeof conflictCount === "number" &&
    !Number.isNaN(conflictCount) &&
    Number.isFinite(conflictCount)
      ? Math.max(0, Math.floor(conflictCount))
      : 0;

  if (safeCount <= 0) {
    return null;
  }

  const handleClick = () => {
    setIsModalOpen(true);
    onClick?.();
  };

  const countLabel = `${safeCount} ${safeCount === 1 ? "Conflict" : "Conflicts"}`;
  const accessibleLabel = `${safeCount} offline conflict${safeCount === 1 ? "" : "s"} detected in IndexedDB. Click to resolve.`;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        data-testid={testId}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all cursor-pointer shadow-sm ${
          showPulse ? "animate-pulse" : ""
        } ${className}`.trim()}
      >
        <AlertTriangle
          data-testid="offline-conflict-badge-icon"
          className="w-3.5 h-3.5 text-amber-400 shrink-0"
        />
        <span data-testid="offline-conflict-badge-text">{countLabel}</span>
      </button>

      <OfflineConflictResolutionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}

export default OfflineConflictBadge;
